import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Sql } from "@/lib/db";
import {
  MAX_IMAGE_BYTES,
  STICKY_FILLS,
  type AllowedMime,
  type BoardKind,
  type BoardRecord,
  type ConnectionRecord,
  type ProjectRecord,
  type SavedImage,
  type ScreenRecord,
} from "@/lib/flow/types";
import { safeStoredFileName, sniffImage } from "@/lib/flow/names";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const mimeSchema = z.enum(["image/png", "image/jpeg", "image/webp"]);

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error("Nieprawidłowe dane");
  return result.data;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date(0).toISOString();
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function token(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i += 1) hex += bytes[i]!.toString(16).padStart(2, "0");
  return hex;
}

function decodeBase64(input: string): Uint8Array {
  const clean = input.includes(",") ? input.slice(input.indexOf(",") + 1) : input;
  if (clean.length > Math.ceil(MAX_IMAGE_BYTES * 1.4)) {
    throw new Error("Plik jest za duży (maks. 12 MB)");
  }
  const buf = Buffer.from(clean, "base64");
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

async function sqlClient(): Promise<Sql> {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

async function ownedProject(sql: Sql, projectId: string, userId: string): Promise<void> {
  const rows = await sql<{ id: string }>`
    select id from projects where id = ${projectId}::uuid and user_id = ${userId}
  `;
  if (!rows[0]) throw new Error("Nie znaleziono projektu");
}

async function touchProject(sql: Sql, projectId: string, userId: string): Promise<void> {
  await sql`
    update projects set updated_at = now()
    where id = ${projectId}::uuid and user_id = ${userId}
  `;
}

function mapProject(row: {
  id: string;
  name: string;
  created_at: unknown;
  updated_at: unknown;
  screen_count?: unknown;
}): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    screenCount: num(row.screen_count),
  };
}

function mapKind(value: unknown): BoardKind {
  if (value === "sticky" || value === "frame" || value === "screen") return value;
  return "screen";
}

function mapScreen(row: Record<string, unknown>): ScreenRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    kind: mapKind(row.kind),
    name: String(row.name),
    body: row.body == null ? "" : String(row.body),
    fill: row.fill == null || row.fill === "" ? null : String(row.fill),
    originalFileName: String(row.original_file_name ?? ""),
    storedFileName: String(row.stored_file_name ?? ""),
    storagePath: String(row.storage_path ?? ""),
    imageUrl: String(row.image_url ?? ""),
    mimeType: String(row.mime_type ?? ""),
    width: num(row.width),
    height: num(row.height),
    positionX: num(row.position_x),
    positionY: num(row.position_y),
    displayWidth: num(row.display_width, 280),
    displayHeight: num(row.display_height, 420),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapConnection(row: Record<string, unknown>): ConnectionRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    fromScreenId: String(row.from_screen_id),
    toScreenId: String(row.to_screen_id),
    label: row.label == null || row.label === "" ? null : String(row.label),
    sourceHandle: row.source_handle == null ? null : String(row.source_handle),
    targetHandle: row.target_handle == null ? null : String(row.target_handle),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

const nameSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const listProjects = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<ProjectRecord[]> => {
    const sql = await sqlClient();
    const rows = await sql<{
      id: string;
      name: string;
      created_at: unknown;
      updated_at: unknown;
      screen_count: unknown;
    }>`
      select p.id, p.name, p.created_at, p.updated_at,
        (select count(*) from screens s where s.project_id = p.id and s.kind = 'screen')::int as screen_count
      from projects p
      where p.user_id = ${context.userId}
      order by p.updated_at desc
    `;
    return rows.map(mapProject);
  });

export const createProject = createServerFn({ method: "POST" })
  .validator((input: unknown) => parse(nameSchema, input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<ProjectRecord> => {
    const sql = await sqlClient();
    const id = crypto.randomUUID();
    const rows = await sql<{ id: string; name: string; created_at: unknown; updated_at: unknown }>`
      insert into projects (id, user_id, name)
      values (${id}::uuid, ${context.userId}, ${data.name})
      returning id, name, created_at, updated_at
    `;
    const row = rows[0];
    if (!row) throw new Error("Nie udało się zapisać projektu");
    return mapProject({ ...row, screen_count: 0 });
  });

export const renameProject = createServerFn({ method: "POST" })
  .validator((input: unknown) => parse(z.object({ id: uuid, name: z.string().trim().min(1).max(80) }), input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const sql = await sqlClient();
    const rows = await sql<{ id: string }>`
      update projects set name = ${data.name}, updated_at = now()
      where id = ${data.id}::uuid and user_id = ${context.userId}
      returning id
    `;
    if (!rows[0]) throw new Error("Nie znaleziono projektu");
    return { ok: true };
  });

export const deleteProject = createServerFn({ method: "POST" })
  .validator((input: unknown) => parse(z.object({ id: uuid }), input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const sql = await sqlClient();
    const rows = await sql<{ id: string }>`
      delete from projects where id = ${data.id}::uuid and user_id = ${context.userId}
      returning id
    `;
    if (!rows[0]) throw new Error("Nie znaleziono projektu");
    return { ok: true };
  });

export const getBoard = createServerFn({ method: "POST" })
  .validator((input: unknown) => parse(z.object({ projectId: uuid }), input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<BoardRecord> => {
    const sql = await sqlClient();
    const projects = await sql<{
      id: string;
      name: string;
      created_at: unknown;
      updated_at: unknown;
      screen_count: unknown;
    }>`
      select p.id, p.name, p.created_at, p.updated_at,
        (select count(*) from screens s where s.project_id = p.id and s.kind = 'screen')::int as screen_count
      from projects p
      where p.id = ${data.projectId}::uuid and p.user_id = ${context.userId}
    `;
    const project = projects[0];
    if (!project) throw new Error("Nie znaleziono projektu");
    const screens = await sql<Record<string, unknown>>`
      select * from screens
      where project_id = ${data.projectId}::uuid
      order by created_at asc
    `;
    const connections = await sql<Record<string, unknown>>`
      select * from connections
      where project_id = ${data.projectId}::uuid
      order by created_at asc
    `;
    return {
      project: mapProject(project),
      screens: screens.map(mapScreen),
      connections: connections.map(mapConnection),
    };
  });

const layoutItem = z.object({
  id: uuid,
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().positive().max(8000),
  h: z.number().positive().max(8000),
});

export const updateScreenLayouts = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    parse(
      z.object({
        projectId: uuid,
        items: z.array(layoutItem).min(1).max(200),
      }),
      input,
    ),
  )
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const sql = await sqlClient();
    await ownedProject(sql, data.projectId, context.userId);
    const payload = JSON.stringify(data.items);
    await sql`
      update screens as s
      set position_x = v.x,
          position_y = v.y,
          display_width = v.w,
          display_height = v.h,
          updated_at = now()
      from jsonb_to_recordset(${payload}::jsonb) as v(id uuid, x float8, y float8, w float8, h float8)
      where s.id = v.id
        and s.project_id = ${data.projectId}::uuid
    `;
    await touchProject(sql, data.projectId, context.userId);
    return { ok: true };
  });

const saveImageInput = z.object({
  projectId: uuid,
  screenId: uuid,
  name: z.string().trim().min(1).max(200),
  originalFileName: z.string().trim().min(1).max(300),
  mimeType: mimeSchema,
  width: z.number().int().positive().max(20000),
  height: z.number().int().positive().max(20000),
  positionX: z.number().finite(),
  positionY: z.number().finite(),
  displayWidth: z.number().positive().max(8000),
  displayHeight: z.number().positive().max(8000),
  imageBase64: z.string().min(16),
  replace: z.boolean(),
});

export const saveScreenImage = createServerFn({ method: "POST" })
  .validator((input: unknown) => parse(saveImageInput, input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<SavedImage> => {
    const sql = await sqlClient();
    await ownedProject(sql, data.projectId, context.userId);
    const bytes = decodeBase64(data.imageBase64);
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("Plik jest za duży (maks. 12 MB)");
    const sniffed = sniffImage(bytes);
    if (!sniffed) throw new Error("Plik ma nieobsługiwany format");
    const mime: AllowedMime = sniffed;
    const countRows = await sql<{ count: number }>`
      select count(*)::int as count from screens where project_id = ${data.projectId}::uuid
    `;
    const existing = await sql<{ id: string }>`
      select id from screens where id = ${data.screenId}::uuid
    `;
    if (!existing[0] && num(countRows[0]?.count) >= 400) {
      throw new Error("W projekcie jest już za dużo ekranów");
    }
    if (existing[0]) {
      const owned = await sql<{ id: string }>`
        select s.id from screens s
        join projects p on p.id = s.project_id
        where s.id = ${data.screenId}::uuid
          and s.project_id = ${data.projectId}::uuid
          and p.user_id = ${context.userId}
      `;
      if (!owned[0]) throw new Error("Nie znaleziono ekranu");
    }

    const storedFileName = data.replace
      ? `${Date.now().toString(36)}-${safeStoredFileName(data.originalFileName, mime)}`
      : safeStoredFileName(data.originalFileName, mime);
    const storagePath = `projects/${data.projectId}/screens/${data.screenId}/${storedFileName}`;
    const publicToken = token();
    const imageUrl = `/api/media/${data.screenId}/${publicToken}`;
    const hex = bytesToHex(bytes);

    await sql`
      insert into storage_objects (path, project_id, user_id, mime_type, byte_size, data)
      values (
        ${storagePath},
        ${data.projectId}::uuid,
        ${context.userId},
        ${mime},
        ${bytes.byteLength},
        decode(${hex}, 'hex')
      )
      on conflict (path) do update set
        mime_type = excluded.mime_type,
        byte_size = excluded.byte_size,
        data = excluded.data
    `;

    await sql`
      insert into screens (
        id, project_id, name, original_file_name, stored_file_name, storage_path,
        image_url, public_token, mime_type, width, height, position_x, position_y,
        display_width, display_height
      ) values (
        ${data.screenId}::uuid,
        ${data.projectId}::uuid,
        ${data.name},
        ${data.originalFileName},
        ${storedFileName},
        ${storagePath},
        ${imageUrl},
        ${publicToken},
        ${mime},
        ${data.width},
        ${data.height},
        ${data.positionX},
        ${data.positionY},
        ${data.displayWidth},
        ${data.displayHeight}
      )
      on conflict (id) do update set
        stored_file_name = excluded.stored_file_name,
        storage_path = excluded.storage_path,
        image_url = excluded.image_url,
        public_token = excluded.public_token,
        mime_type = excluded.mime_type,
        width = excluded.width,
        height = excluded.height,
        position_x = excluded.position_x,
        position_y = excluded.position_y,
        display_width = excluded.display_width,
        display_height = excluded.display_height,
        updated_at = now()
    `;
    await touchProject(sql, data.projectId, context.userId);
    return { imageUrl, storagePath, storedFileName, mimeType: mime, publicToken };
  });

const screenRestore = z.object({
  id: uuid,
  name: z.string().trim().min(1).max(200),
  originalFileName: z.string().trim().min(1).max(300),
  storedFileName: z.string().trim().min(1).max(300),
  storagePath: z.string().min(1).max(600),
  imageUrl: z.string().min(1).max(600),
  mimeType: mimeSchema,
  width: z.number().int().nonnegative().max(20000),
  height: z.number().int().nonnegative().max(20000),
  positionX: z.number().finite(),
  positionY: z.number().finite(),
  displayWidth: z.number().positive().max(8000),
  displayHeight: z.number().positive().max(8000),
});

export const retargetScreen = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    parse(z.object({ projectId: uuid, screen: screenRestore }), input),
  )
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const sql = await sqlClient();
    const screen = data.screen;
    const prefix = `projects/${data.projectId}/screens/${screen.id}/`;
    if (!screen.storagePath.startsWith(prefix) || screen.storagePath.includes("..")) {
      throw new Error("Nieprawidłowe dane");
    }
    const expectedUrl = `/api/media/${screen.id}/`;
    if (!screen.imageUrl.startsWith(expectedUrl)) throw new Error("Nieprawidłowe dane");
    const publicToken = screen.imageUrl.slice(expectedUrl.length);
    const rows = await sql<{ id: string }>`
      update screens s
      set storage_path = ${screen.storagePath},
          image_url = ${screen.imageUrl},
          public_token = ${publicToken},
          stored_file_name = ${screen.storedFileName},
          mime_type = ${screen.mimeType},
          width = ${screen.width},
          height = ${screen.height},
          display_width = ${screen.displayWidth},
          display_height = ${screen.displayHeight},
          updated_at = now()
      from projects p, storage_objects o
      where s.id = ${screen.id}::uuid
        and s.project_id = ${data.projectId}::uuid
        and p.id = s.project_id
        and p.user_id = ${context.userId}
        and o.path = ${screen.storagePath}
        and o.project_id = s.project_id
        and o.user_id = ${context.userId}
      returning s.id
    `;
    if (!rows[0]) throw new Error("Nie znaleziono ekranu");
    await touchProject(sql, data.projectId, context.userId);
    return { ok: true };
  });

export const renameScreen = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    parse(
      z.object({
        projectId: uuid,
        screenId: uuid,
        name: z.string().trim().min(1).max(200),
      }),
      input,
    ),
  )
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const sql = await sqlClient();
    const rows = await sql<{ id: string }>`
      update screens s
      set name = ${data.name}, updated_at = now()
      from projects p
      where s.id = ${data.screenId}::uuid
        and s.project_id = ${data.projectId}::uuid
        and p.id = s.project_id
        and p.user_id = ${context.userId}
      returning s.id
    `;
    if (!rows[0]) throw new Error("Nie znaleziono ekranu");
    await touchProject(sql, data.projectId, context.userId);
    return { ok: true };
  });

const textKind = z.enum(["sticky", "frame"]);
const fillSchema = z.enum(STICKY_FILLS).nullable();

const saveTextInput = z.object({
  projectId: uuid,
  id: uuid,
  kind: textKind,
  body: z.string().max(8000),
  fill: fillSchema,
  positionX: z.number().finite(),
  positionY: z.number().finite(),
  displayWidth: z.number().positive().max(8000),
  displayHeight: z.number().positive().max(8000),
});

export const saveBoardText = createServerFn({ method: "POST" })
  .validator((input: unknown) => parse(saveTextInput, input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const sql = await sqlClient();
    await ownedProject(sql, data.projectId, context.userId);
    const countRows = await sql<{ count: number }>`
      select count(*)::int as count from screens where project_id = ${data.projectId}::uuid
    `;
    const existing = await sql<{ id: string }>`
      select id from screens where id = ${data.id}::uuid and project_id = ${data.projectId}::uuid
    `;
    if (!existing[0]) {
      const foreign = await sql<{ id: string }>`
        select id from screens where id = ${data.id}::uuid
      `;
      if (foreign[0]) throw new Error("Nie znaleziono elementu");
      if (num(countRows[0]?.count) >= 400) throw new Error("W projekcie jest już za dużo elementów");
    } else {
      const owned = await sql<{ id: string }>`
        select s.id from screens s
        join projects p on p.id = s.project_id
        where s.id = ${data.id}::uuid
          and s.project_id = ${data.projectId}::uuid
          and p.user_id = ${context.userId}
          and s.kind in ('sticky', 'frame')
      `;
      if (!owned[0]) throw new Error("Nie znaleziono elementu");
    }
    const publicToken = token();
    const name = data.kind === "sticky" ? "Notatka" : "Ramka";
    await sql`
      insert into screens (
        id, project_id, kind, name, body, fill,
        original_file_name, stored_file_name, storage_path, image_url, public_token, mime_type,
        position_x, position_y, display_width, display_height
      ) values (
        ${data.id}::uuid,
        ${data.projectId}::uuid,
        ${data.kind},
        ${name},
        ${data.body},
        ${data.fill},
        '',
        '',
        '',
        '',
        ${publicToken},
        'text/plain',
        ${data.positionX},
        ${data.positionY},
        ${data.displayWidth},
        ${data.displayHeight}
      )
      on conflict (id) do update set
        body = excluded.body,
        fill = excluded.fill,
        position_x = excluded.position_x,
        position_y = excluded.position_y,
        display_width = excluded.display_width,
        display_height = excluded.display_height,
        updated_at = now()
    `;
    await touchProject(sql, data.projectId, context.userId);
    return { ok: true };
  });

export const updateBoardText = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    parse(
      z.object({
        projectId: uuid,
        id: uuid,
        body: z.string().max(8000),
        fill: fillSchema,
      }),
      input,
    ),
  )
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const sql = await sqlClient();
    const rows = await sql<{ id: string }>`
      update screens s
      set body = ${data.body},
          fill = ${data.fill},
          updated_at = now()
      from projects p
      where s.id = ${data.id}::uuid
        and s.project_id = ${data.projectId}::uuid
        and p.id = s.project_id
        and p.user_id = ${context.userId}
        and s.kind in ('sticky', 'frame')
      returning s.id
    `;
    if (!rows[0]) throw new Error("Nie znaleziono elementu");
    await touchProject(sql, data.projectId, context.userId);
    return { ok: true };
  });

export const restoreScreens = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    parse(z.object({ projectId: uuid, screens: z.array(screenRestore).min(1).max(100) }), input),
  )
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const sql = await sqlClient();
    await ownedProject(sql, data.projectId, context.userId);
    for (const screen of data.screens) {
      const prefix = `projects/${data.projectId}/screens/${screen.id}/`;
      if (!screen.storagePath.startsWith(prefix) || screen.storagePath.includes("..")) {
        throw new Error("Nieprawidłowe dane");
      }
      const expectedUrl = `/api/media/${screen.id}/`;
      if (!screen.imageUrl.startsWith(expectedUrl)) throw new Error("Nieprawidłowe dane");
      const publicToken = screen.imageUrl.slice(expectedUrl.length);
      const owned = await sql<{ path: string }>`
        select path from storage_objects
        where path = ${screen.storagePath}
          and project_id = ${data.projectId}::uuid
          and user_id = ${context.userId}
      `;
      if (!owned[0]) throw new Error("Nie znaleziono pliku ekranu");
      await sql`
        insert into screens (
          id, project_id, name, original_file_name, stored_file_name, storage_path,
          image_url, public_token, mime_type, width, height, position_x, position_y,
          display_width, display_height
        ) values (
          ${screen.id}::uuid,
          ${data.projectId}::uuid,
          ${screen.name},
          ${screen.originalFileName},
          ${screen.storedFileName},
          ${screen.storagePath},
          ${screen.imageUrl},
          ${publicToken},
          ${screen.mimeType},
          ${screen.width},
          ${screen.height},
          ${screen.positionX},
          ${screen.positionY},
          ${screen.displayWidth},
          ${screen.displayHeight}
        )
        on conflict (id) do nothing
      `;
    }
    await touchProject(sql, data.projectId, context.userId);
    return { ok: true };
  });

export const deleteScreens = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    parse(z.object({ projectId: uuid, screenIds: z.array(uuid).min(1).max(200) }), input),
  )
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const sql = await sqlClient();
    await ownedProject(sql, data.projectId, context.userId);
    const ids = JSON.stringify(data.screenIds);
    await sql`
      delete from screens s
      using projects p
      where s.project_id = p.id
        and p.user_id = ${context.userId}
        and s.project_id = ${data.projectId}::uuid
        and s.id in (select value::uuid from jsonb_array_elements_text(${ids}::jsonb))
    `;
    await touchProject(sql, data.projectId, context.userId);
    return { ok: true };
  });

const connectionInput = z.object({
  projectId: uuid,
  id: uuid,
  fromScreenId: uuid,
  toScreenId: uuid,
  label: z.string().max(200).nullable(),
  sourceHandle: z.string().max(40).nullable(),
  targetHandle: z.string().max(40).nullable(),
});

async function assertScreensInProject(
  sql: Sql,
  projectId: string,
  userId: string,
  screenIds: string[],
): Promise<void> {
  const ids = JSON.stringify(screenIds);
  const rows = await sql<{ count: number }>`
    select count(*)::int as count
    from screens s
    join projects p on p.id = s.project_id
    where p.user_id = ${userId}
      and s.project_id = ${projectId}::uuid
      and s.id in (select value::uuid from jsonb_array_elements_text(${ids}::jsonb))
  `;
  if (num(rows[0]?.count) !== new Set(screenIds).size) {
    throw new Error("Nie znaleziono ekranu");
  }
}

export const saveConnection = createServerFn({ method: "POST" })
  .validator((input: unknown) => parse(connectionInput, input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    if (data.fromScreenId === data.toScreenId) throw new Error("Nieprawidłowe połączenie");
    const sql = await sqlClient();
    await ownedProject(sql, data.projectId, context.userId);
    await assertScreensInProject(sql, data.projectId, context.userId, [
      data.fromScreenId,
      data.toScreenId,
    ]);
    const edgeCount = await sql<{ count: number }>`
      select count(*)::int as count from connections where project_id = ${data.projectId}::uuid
    `;
    const existing = await sql<{ id: string }>`
      select id from connections where id = ${data.id}::uuid
    `;
    if (!existing[0] && num(edgeCount[0]?.count) >= 800) {
      throw new Error("W projekcie jest już za dużo połączeń");
    }
    await sql`
      insert into connections (
        id, project_id, from_screen_id, to_screen_id, label, source_handle, target_handle
      ) values (
        ${data.id}::uuid,
        ${data.projectId}::uuid,
        ${data.fromScreenId}::uuid,
        ${data.toScreenId}::uuid,
        ${data.label},
        ${data.sourceHandle},
        ${data.targetHandle}
      )
      on conflict (id) do update set
        from_screen_id = excluded.from_screen_id,
        to_screen_id = excluded.to_screen_id,
        label = excluded.label,
        source_handle = excluded.source_handle,
        target_handle = excluded.target_handle,
        updated_at = now()
    `;
    await touchProject(sql, data.projectId, context.userId);
    return { ok: true };
  });

export const updateConnectionLabel = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    parse(
      z.object({
        projectId: uuid,
        connectionId: uuid,
        label: z.string().max(200).nullable(),
      }),
      input,
    ),
  )
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const sql = await sqlClient();
    const rows = await sql<{ id: string }>`
      update connections c
      set label = ${data.label}, updated_at = now()
      from projects p
      where c.id = ${data.connectionId}::uuid
        and c.project_id = ${data.projectId}::uuid
        and p.id = c.project_id
        and p.user_id = ${context.userId}
      returning c.id
    `;
    if (!rows[0]) throw new Error("Nie znaleziono połączenia");
    await touchProject(sql, data.projectId, context.userId);
    return { ok: true };
  });

const connectionRestore = z.object({
  id: uuid,
  fromScreenId: uuid,
  toScreenId: uuid,
  label: z.string().max(200).nullable(),
  sourceHandle: z.string().max(40).nullable(),
  targetHandle: z.string().max(40).nullable(),
});

export const restoreConnections = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    parse(
      z.object({ projectId: uuid, connections: z.array(connectionRestore).min(1).max(200) }),
      input,
    ),
  )
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const sql = await sqlClient();
    await ownedProject(sql, data.projectId, context.userId);
    for (const connection of data.connections) {
      if (connection.fromScreenId === connection.toScreenId) continue;
      await assertScreensInProject(sql, data.projectId, context.userId, [
        connection.fromScreenId,
        connection.toScreenId,
      ]);
      await sql`
        insert into connections (
          id, project_id, from_screen_id, to_screen_id, label, source_handle, target_handle
        ) values (
          ${connection.id}::uuid,
          ${data.projectId}::uuid,
          ${connection.fromScreenId}::uuid,
          ${connection.toScreenId}::uuid,
          ${connection.label},
          ${connection.sourceHandle},
          ${connection.targetHandle}
        )
        on conflict (id) do nothing
      `;
    }
    await touchProject(sql, data.projectId, context.userId);
    return { ok: true };
  });

export const deleteConnections = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    parse(z.object({ projectId: uuid, connectionIds: z.array(uuid).min(1).max(200) }), input),
  )
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const sql = await sqlClient();
    await ownedProject(sql, data.projectId, context.userId);
    const ids = JSON.stringify(data.connectionIds);
    await sql`
      delete from connections c
      using projects p
      where c.project_id = p.id
        and p.user_id = ${context.userId}
        and c.project_id = ${data.projectId}::uuid
        and c.id in (select value::uuid from jsonb_array_elements_text(${ids}::jsonb))
    `;
    await touchProject(sql, data.projectId, context.userId);
    return { ok: true };
  });
