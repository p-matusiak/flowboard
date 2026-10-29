import { createFileRoute } from "@tanstack/react-router";

function bytesFromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("\\x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const Route = createFileRoute("/api/media/$screenId/$token")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        const parts = url.pathname.split("/").filter(Boolean);
        const screenId = params.screenId || parts.at(-2) || "";
        const token = params.token || parts.at(-1) || "";
        if (!/^[0-9a-f-]{36}$/i.test(screenId) || !/^[0-9a-f]{32,64}$/i.test(token)) {
          return new Response("Not found", { status: 404 });
        }
        try {
          const { getSql } = await import("@/lib/db");
          const sql = await getSql();
          const rows = await sql<{ hex: string; mime_type: string }>`
            select encode(o.data, 'hex') as hex, s.mime_type
            from screens s
            join storage_objects o on o.path = s.storage_path
            where s.id = ${screenId}::uuid
              and s.public_token = ${token}
          `;
          const row = rows[0];
          if (!row?.hex) return new Response("Not found", { status: 404 });
          const bytes = bytesFromHex(row.hex);
          const buffer = new ArrayBuffer(bytes.byteLength);
          new Uint8Array(buffer).set(bytes);
          const body = new Blob([buffer], { type: row.mime_type || "application/octet-stream" });
          return new Response(body, {
            status: 200,
            headers: {
              "Content-Type": row.mime_type || "application/octet-stream",
              "Content-Length": String(bytes.byteLength),
              "Cache-Control": "private, max-age=86400",
              "X-Content-Type-Options": "nosniff",
            },
          });
        } catch {
          return new Response("Not found", { status: 404 });
        }
      },
    },
  },
});
