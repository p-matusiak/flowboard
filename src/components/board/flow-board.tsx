import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  addEdge,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  ConnectionMode,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useStore,
  type Connection,
  type Edge,
  type NodeChange,
  type OnBeforeDelete,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowLeft,
  Check,
  FolderInput,
  ImagePlus,
  Loader2,
  Minus,
  Plus,
  Scan,
  Square,
  StickyNote,
} from "lucide-react";
import { toast } from "sonner";
import JSZip from "jszip";
import { FlowEdge } from "./flow-edge";
import { ScreenNode } from "./screen-node";
import { TextNode } from "./text-node";
import { useBoardStore, type BoardApi } from "./board-store";
import { anchorFromRect, decodeAnchor, encodeAnchor } from "./edge-anchor";
import { Logo } from "@/components/logo";
import { buildFlowJson, buildFlowText, type FlowDocument } from "@/lib/flow/export-flow";
import { downloadBlob, fileToBase64, readLocalImage } from "@/lib/flow/images";
import {
  displaySizeFor,
  gridPosition,
  mimeFromFile,
  projectZipName,
  screenNameFromFile,
  uniqueExportFileNames,
} from "@/lib/flow/names";
import { MAX_IMAGE_BYTES, STICKY_FILLS, type ScreenFlowEdge, type ScreenFlowNode, type StickyFill } from "@/lib/flow/types";
import { resolveAppPath } from "@/lib/flow/urls";
import {
  deleteConnections,
  deleteScreens,
  getBoard,
  renameProject,
  renameScreen,
  restoreConnections,
  restoreScreens,
  retargetScreen,
  saveBoardText,
  saveConnection,
  saveScreenImage,
  updateBoardText,
  updateConnectionLabel,
  updateScreenLayouts,
} from "@/lib/server/flow.functions";

const nodeTypes = { screen: ScreenNode, sticky: TextNode, frame: TextNode };
const edgeTypes = { flow: FlowEdge };

const EDGE_MARKER = {
  type: MarkerType.ArrowClosed,
  width: 18,
  height: 18,
  color: "#1d4ed8",
};

const EDGE_STYLE = { stroke: "#1d4ed8", strokeWidth: 2 };

type Layout = { id: string; x: number; y: number; w: number; h: number };

type EdgeSnap = {
  id: string;
  source: string;
  target: string;
  sourceHandle: string | null;
  targetHandle: string | null;
  label: string;
};

type MediaSnap = {
  name: string;
  originalFileName: string;
  storedFileName: string;
  storagePath: string;
  imageUrl: string;
  mimeType: string;
  naturalWidth: number;
  naturalHeight: number;
  displayWidth: number;
  displayHeight: number;
  positionX: number;
  positionY: number;
};

type Command =
  | { kind: "add-screens"; nodes: ScreenFlowNode[] }
  | { kind: "remove-screens"; nodes: ScreenFlowNode[]; edges: EdgeSnap[] }
  | { kind: "add-edges"; edges: EdgeSnap[] }
  | { kind: "remove-edges"; edges: EdgeSnap[] }
  | { kind: "move"; before: Layout[]; after: Layout[] }
  | { kind: "rename"; id: string; before: string; after: string }
  | { kind: "label"; id: string; before: string; after: string }
  | { kind: "reconnect"; id: string; before: EdgeSnap; after: EdgeSnap }
  | { kind: "replace"; id: string; before: MediaSnap; after: MediaSnap }
  | { kind: "body"; id: string; before: string; after: string }
  | { kind: "fill"; id: string; before: string | null; after: string | null };

function friendly(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  if (
    message.startsWith("Nie ") ||
    message.startsWith("Plik ") ||
    message.startsWith("W projekcie") ||
    message.startsWith("Za ")
  ) {
    return message;
  }
  return fallback;
}

function isUnauthorized(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("Unauthorized");
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

function layoutOf(node: ScreenFlowNode): Layout {
  const width = typeof node.width === "number" ? node.width : 280;
  const height = typeof node.height === "number" ? node.height : 420;
  return { id: node.id, x: node.position.x, y: node.position.y, w: width, h: height };
}

function withLayout(node: ScreenFlowNode, layout: Layout): ScreenFlowNode {
  return {
    ...node,
    position: { x: layout.x, y: layout.y },
    width: layout.w,
    height: layout.h,
    style: { width: layout.w, height: layout.h },
  };
}

function cloneNode(node: ScreenFlowNode): ScreenFlowNode {
  return {
    ...node,
    position: { ...node.position },
    data: { ...node.data },
    style: node.style ? { ...node.style } : undefined,
    selected: false,
  };
}

function packHandle(handle: string | null | undefined, ratio: number | undefined): string | null {
  const side = decodeAnchor(handle)?.side;
  if (!side) return null;
  return encodeAnchor({ side, t: ratio ?? decodeAnchor(handle)?.t ?? 0.5 });
}

function edgeSnap(edge: ScreenFlowEdge | Edge): EdgeSnap {
  const data = edge.data as { label?: string; sourceT?: number; targetT?: number } | undefined;
  const label = data?.label ?? (typeof edge.label === "string" ? edge.label : "");
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: packHandle(edge.sourceHandle, data?.sourceT),
    targetHandle: packHandle(edge.targetHandle, data?.targetT),
    label,
  };
}

function edgeFromSnap(snap: EdgeSnap): ScreenFlowEdge {
  const source = decodeAnchor(snap.sourceHandle);
  const target = decodeAnchor(snap.targetHandle);
  return {
    id: snap.id,
    type: "flow",
    source: snap.source,
    target: snap.target,
    sourceHandle: source?.side,
    targetHandle: target?.side,
    label: snap.label,
    data: { label: snap.label, sourceT: source?.t ?? 0.5, targetT: target?.t ?? 0.5 },
    markerEnd: EDGE_MARKER,
    style: { ...EDGE_STYLE },
  };
}

function mediaOf(node: ScreenFlowNode): MediaSnap {
  const layout = layoutOf(node);
  return {
    name: node.data.name,
    originalFileName: node.data.originalFileName,
    storedFileName: node.data.storedFileName,
    storagePath: node.data.storagePath,
    imageUrl: node.data.imageUrl,
    mimeType: node.data.mimeType,
    naturalWidth: node.data.naturalWidth,
    naturalHeight: node.data.naturalHeight,
    displayWidth: layout.w,
    displayHeight: layout.h,
    positionX: layout.x,
    positionY: layout.y,
  };
}

function isTextNode(node: ScreenFlowNode): boolean {
  return node.data.kind === "sticky" || node.data.kind === "frame";
}

function onServer(node: ScreenFlowNode): boolean {
  return Boolean(node.data.storagePath) || (isTextNode(node) && node.data.persisted);
}

function asStickyFill(value: string | null): StickyFill {
  return (STICKY_FILLS as readonly string[]).includes(value ?? "") ? (value as StickyFill) : "#F6E7A8";
}

function layoutsEqual(a: Layout[], b: Layout[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, index) => {
    const other = b[index];
    if (!other || item.id !== other.id) return false;
    return (
      Math.abs(item.x - other.x) < 0.5 &&
      Math.abs(item.y - other.y) < 0.5 &&
      Math.abs(item.w - other.w) < 0.5 &&
      Math.abs(item.h - other.h) < 0.5
    );
  });
}

function ZoomControls() {
  const rf = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const percent = `${Math.round(zoom * 100)}%`;
  return (
    <div className="zoom-cluster">
      <button type="button" className="icon-btn" aria-label="Pomniejsz" onClick={() => rf.zoomTo(Math.max(0.15, rf.getZoom() / 1.2))}>
        <Minus size={16} />
      </button>
      <button type="button" className="btn btn-secondary btn-sm" style={{ minWidth: 64 }} onClick={() => rf.zoomTo(1)}>
        {percent}
      </button>
      <button type="button" className="icon-btn" aria-label="Powiększ" onClick={() => rf.zoomTo(Math.min(2.5, rf.getZoom() * 1.2))}>
        <Plus size={16} />
      </button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => rf.fitView({ padding: 0.18, duration: 200 })}>
        <Scan size={14} />
        Fit
      </button>
    </div>
  );
}

export function FlowBoard({ projectId }: { projectId: string }) {
  return (
    <ReactFlowProvider>
      <FlowCanvas projectId={projectId} />
    </ReactFlowProvider>
  );
}

function FlowCanvas({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const rf = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<ScreenFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<ScreenFlowEdge>([]);
  useEffect(() => {
    setNodes((current) => {
      if (!current.some((node) => node.dragHandle)) return current;
      return current.map((node) => (node.dragHandle ? { ...node, dragHandle: undefined } : node));
    });
  }, [nodes, setNodes]);
  const [projectName, setProjectName] = useState("Projekt");
  const [ready, setReady] = useState(false);
  const [missing, setMissing] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [editingName, setEditingName] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  const layoutRef = useRef(new Map<string, Layout>());
  const chains = useRef(new Map<string, Promise<void>>());
  const edgeChains = useRef(new Map<string, Promise<void>>());
  const filesRef = useRef(new Map<string, File>());
  const cancelled = useRef(new Set<string>());
  const past = useRef<Command[]>([]);
  const future = useRef<Command[]>([]);
  const inflight = useRef(0);
  const dragBefore = useRef<Layout[] | null>(null);
  const resizeBefore = useRef<Layout | null>(null);
  const labelBefore = useRef(new Map<string, string>());
  const pendingLabels = useRef(new Map<string, string>());
  const labelTimer = useRef<number | null>(null);
  const pendingTexts = useRef(new Map<string, { body: string; fill: string | null }>());
  const textTimer = useRef<number | null>(null);
  const bodyBefore = useRef(new Map<string, string>());
  const addInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replaceId = useRef<string | null>(null);
  const dragDepth = useRef(0);
  const canvasRef = useRef<HTMLDivElement>(null);
  const connectStart = useRef<{ nodeId: string | null; handleId: string | null }>({ nodeId: null, handleId: null });
  const connectHit = useRef<Connection | null>(null);
  const connectPoint = useRef<{ x: number; y: number } | null>(null);
  const reconnectHit = useRef<{ edge: Edge; connection: Connection } | null>(null);
  const fitted = useRef(false);
  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});

  const track = useCallback(<T,>(promise: Promise<T>): Promise<T> => {
    inflight.current += 1;
    setSaveState("saving");
    return promise.then(
      (value) => {
        inflight.current -= 1;
        if (inflight.current <= 0) {
          inflight.current = 0;
          setSaveState("saved");
        }
        return value;
      },
      (error) => {
        inflight.current -= 1;
        setSaveState("error");
        throw error;
      },
    );
  }, []);

  const enqueue = useCallback((id: string, task: () => Promise<void>) => {
    const prev = chains.current.get(id) ?? Promise.resolve();
    const run = prev.then(task, task);
    chains.current.set(
      id,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }, []);

  const enqueueEdge = useCallback((id: string, task: () => Promise<void>) => {
    const prev = edgeChains.current.get(id) ?? Promise.resolve();
    const run = prev.then(task, task);
    edgeChains.current.set(
      id,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }, []);

  const push = useCallback((command: Command) => {
    past.current.push(command);
    if (past.current.length > 40) past.current.shift();
    future.current = [];
  }, []);

  const patchAdded = useCallback((id: string, data: Partial<ScreenFlowNode["data"]>) => {
    const patch = (commands: Command[]) => {
      for (const command of commands) {
        if (command.kind !== "add-screens") continue;
        command.nodes = command.nodes.map((node) =>
          node.id === id ? { ...node, data: { ...node.data, ...data } } : node,
        );
      }
    };
    patch(past.current);
    patch(future.current);
  }, []);

  const saveLayouts = useCallback(
    async (items: Layout[]) => {
      if (!items.length) return;
      await Promise.all(items.map((item) => enqueue(item.id, async () => undefined)));
      await track(updateScreenLayouts({ data: { projectId, items } }));
    },
    [enqueue, projectId, track],
  );

  const applyLayouts = useCallback(
    async (items: Layout[]) => {
      const byId = new Map(items.map((item) => [item.id, item]));
      setNodes((current) => current.map((node) => (byId.has(node.id) ? withLayout(node, byId.get(node.id)!) : node)));
      for (const item of items) layoutRef.current.set(item.id, item);
      await saveLayouts(items);
    },
    [saveLayouts, setNodes],
  );

  const applyRename = useCallback(
    async (id: string, name: string) => {
      setNodes((current) =>
        current.map((node) => (node.id === id ? { ...node, data: { ...node.data, name } } : node)),
      );
      patchAdded(id, { name });
      const node = nodesRef.current.find((item) => item.id === id);
      if (node?.data.kind === "screen" && (node.data.storagePath || node.data.persisted)) {
        await enqueue(id, async () => {
          await track(renameScreen({ data: { projectId, screenId: id, name } }));
        });
      }
    },
    [enqueue, patchAdded, projectId, setNodes, track],
  );

  const flushLabels = useCallback(async () => {
    if (labelTimer.current) {
      window.clearTimeout(labelTimer.current);
      labelTimer.current = null;
    }
    const entries = [...pendingLabels.current.entries()];
    pendingLabels.current.clear();
    await Promise.all(
      entries.map(([id, label]) =>
        enqueueEdge(id, async () => {
          const value = label.trim() ? label.trim() : null;
          await track(updateConnectionLabel({ data: { projectId, connectionId: id, label: value } }));
        }),
      ),
    );
  }, [enqueueEdge, projectId, track]);

  const applyLabel = useCallback(
    async (id: string, label: string, immediate = false) => {
      setEdges((current) =>
        current.map((edge) =>
          edge.id === id ? { ...edge, label, data: { ...edge.data, label } } : edge,
        ),
      );
      pendingLabels.current.set(id, label);
      setSaveState("saving");
      if (labelTimer.current) window.clearTimeout(labelTimer.current);
      if (immediate) {
        await flushLabels();
        return;
      }
      labelTimer.current = window.setTimeout(() => {
        void flushLabels().catch((error) => {
          toast.error(friendly(error, "Nie udało się zapisać projektu"));
        });
      }, 450);
    },
    [flushLabels, setEdges],
  );

  const flushTexts = useCallback(async () => {
    if (textTimer.current) {
      window.clearTimeout(textTimer.current);
      textTimer.current = null;
    }
    const entries = [...pendingTexts.current.entries()];
    pendingTexts.current.clear();
    await Promise.all(
      entries.map(([id, value]) =>
        enqueue(id, async () => {
          if (cancelled.current.has(id)) return;
          const node = nodesRef.current.find((item) => item.id === id);
          if (!node || !isTextNode(node)) return;
          const fill = node.data.kind === "sticky" ? asStickyFill(value.fill) : null;
          await track(updateBoardText({ data: { projectId, id, body: value.body, fill } }));
        }),
      ),
    );
  }, [enqueue, projectId, track]);

  const scheduleText = useCallback(
    (id: string, body: string, fill: string | null, immediate: boolean) => {
      pendingTexts.current.set(id, { body, fill });
      setSaveState("saving");
      if (textTimer.current) window.clearTimeout(textTimer.current);
      if (immediate) return flushTexts();
      textTimer.current = window.setTimeout(() => {
        void flushTexts().catch((error) => toast.error(friendly(error, "Nie udało się zapisać projektu")));
      }, 450);
      return Promise.resolve();
    },
    [flushTexts],
  );

  const applyBody = useCallback(
    async (id: string, body: string, immediate = false) => {
      const node = nodesRef.current.find((item) => item.id === id);
      const fill = node?.data.fill ?? null;
      setNodes((current) => {
        const next = current.map((item) => (item.id === id ? { ...item, data: { ...item.data, body } } : item));
        nodesRef.current = next;
        return next;
      });
      patchAdded(id, { body });
      await scheduleText(id, body, fill, immediate);
    },
    [patchAdded, scheduleText, setNodes],
  );

  const applyFill = useCallback(
    async (id: string, fill: string | null) => {
      const node = nodesRef.current.find((item) => item.id === id);
      const body = pendingTexts.current.get(id)?.body ?? node?.data.body ?? "";
      setNodes((current) => {
        const next = current.map((item) => (item.id === id ? { ...item, data: { ...item.data, fill } } : item));
        nodesRef.current = next;
        return next;
      });
      patchAdded(id, { fill });
      await scheduleText(id, body, fill, true);
    },
    [patchAdded, scheduleText, setNodes],
  );

  const uploadFile = useCallback(
    async (id: string, file: File, mode: "create" | "replace") => {
      return enqueue(id, async () => {
        if (cancelled.current.has(id)) return;
        let current = nodesRef.current.find((node) => node.id === id);
        if (!current) {
          await new Promise((resolve) => setTimeout(resolve, 40));
          current = nodesRef.current.find((node) => node.id === id);
        }
        if (!current || cancelled.current.has(id)) return;
        const before = mediaOf(current);
        const base64 = await fileToBase64(file);
        if (cancelled.current.has(id)) return;
        const layout = layoutRef.current.get(id) ?? layoutOf(current);
        const result = await track(
          saveScreenImage({
            data: {
              projectId,
              screenId: id,
              name: current.data.name,
              originalFileName: current.data.originalFileName || file.name,
              mimeType: (mimeFromFile(file) ?? "image/png") as "image/png" | "image/jpeg" | "image/webp",
              width: current.data.naturalWidth,
              height: current.data.naturalHeight,
              positionX: layout.x,
              positionY: layout.y,
              displayWidth: layout.w,
              displayHeight: layout.h,
              imageBase64: base64,
              replace: mode === "replace",
            },
          }),
        );
        if (cancelled.current.has(id)) {
          await deleteScreens({ data: { projectId, screenIds: [id] } }).catch(() => undefined);
          return;
        }
        const previousUrl = current.data.imageUrl;
        setNodes((list) =>
          list.map((node) =>
            node.id === id
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    imageUrl: result.imageUrl,
                    storagePath: result.storagePath,
                    storedFileName: result.storedFileName,
                    mimeType: result.mimeType,
                    uploadStatus: "saved",
                    persisted: true,
                  },
                }
              : node,
          ),
        );
        patchAdded(id, {
          imageUrl: result.imageUrl,
          storagePath: result.storagePath,
          storedFileName: result.storedFileName,
          mimeType: result.mimeType,
          uploadStatus: "saved",
          persisted: true,
        });
        if (previousUrl.startsWith("blob:") && previousUrl !== result.imageUrl) URL.revokeObjectURL(previousUrl);
        filesRef.current.delete(id);
        if (mode === "replace" && before.storagePath) {
          const afterNode = nodesRef.current.find((node) => node.id === id);
          push({
            kind: "replace",
            id,
            before,
            after: afterNode
              ? mediaOf({
                  ...afterNode,
                  data: {
                    ...afterNode.data,
                    imageUrl: result.imageUrl,
                    storagePath: result.storagePath,
                    storedFileName: result.storedFileName,
                    mimeType: result.mimeType,
                  },
                })
              : before,
          });
        }
      });
    },
    [enqueue, patchAdded, projectId, push, setNodes, track],
  );

  const ingest = useCallback(
    async (files: File[], origin: { x: number; y: number }) => {
      const accepted: Array<{ file: File; mime: "image/png" | "image/jpeg" | "image/webp"; url: string; width: number; height: number }> = [];
      for (const file of files) {
        const mime = mimeFromFile(file);
        if (!mime) {
          toast.error("Plik ma nieobsługiwany format");
          continue;
        }
        if (file.size > MAX_IMAGE_BYTES) {
          toast.error("Plik jest za duży (maks. 12 MB)");
          continue;
        }
        try {
          const image = await readLocalImage(file);
          accepted.push({ file, mime, ...image });
        } catch {
          toast.error("Nie udało się odczytać obrazu");
        }
      }
      if (!accepted.length) return;
      const created: ScreenFlowNode[] = accepted.map((item, index) => {
        const position = gridPosition(index, accepted.length, origin);
        const size = displaySizeFor(item.width, item.height);
        const id = crypto.randomUUID();
        filesRef.current.set(id, item.file);
        const layout = { id, x: position.x, y: position.y, w: size.width, h: size.height };
        layoutRef.current.set(id, layout);
        return {
          id,
          type: "screen",
          position,
          width: size.width,
          height: size.height,
          style: { width: size.width, height: size.height },
          data: {
            kind: "screen",
            name: screenNameFromFile(item.file.name),
            body: "",
            fill: null,
            originalFileName: item.file.name || "obraz.png",
            storedFileName: "",
            storagePath: "",
            imageUrl: item.url,
            mimeType: item.mime,
            uploadStatus: "uploading",
            naturalWidth: item.width,
            naturalHeight: item.height,
            persisted: false,
          },
        };
      });
      const nextNodes = [...nodesRef.current, ...created];
      nodesRef.current = nextNodes;
      setNodes(nextNodes);
      push({ kind: "add-screens", nodes: created.map(cloneNode) });
      for (const node of created) {
        const file = filesRef.current.get(node.id);
        if (!file) continue;
        void uploadFile(node.id, file, "create").catch((error) => {
          setNodes((current) =>
            current.map((item) =>
              item.id === node.id ? { ...item, data: { ...item.data, uploadStatus: "error" } } : item,
            ),
          );
          toast.error(friendly(error, "Nie udało się wysłać obrazu"));
        });
      }
    },
    [push, setNodes, uploadFile],
  );

  const applyMedia = useCallback(
    async (id: string, snap: MediaSnap) => {
      setNodes((current) =>
        current.map((node) =>
          node.id === id
            ? withLayout(
                {
                  ...node,
                  data: {
                    ...node.data,
                    name: snap.name,
                    originalFileName: snap.originalFileName,
                    storedFileName: snap.storedFileName,
                    storagePath: snap.storagePath,
                    imageUrl: snap.imageUrl,
                    mimeType: snap.mimeType,
                    naturalWidth: snap.naturalWidth,
                    naturalHeight: snap.naturalHeight,
                    uploadStatus: snap.storagePath ? "saved" : node.data.uploadStatus,
                  },
                },
                {
                  id,
                  x: snap.positionX,
                  y: snap.positionY,
                  w: snap.displayWidth,
                  h: snap.displayHeight,
                },
              )
            : node,
        ),
      );
      if (!snap.storagePath || snap.imageUrl.startsWith("blob:")) return;
      const mime = snap.mimeType === "image/jpeg" || snap.mimeType === "image/webp" ? snap.mimeType : "image/png";
      await track(
        retargetScreen({
          data: {
            projectId,
            screen: {
              id,
              name: snap.name,
              originalFileName: snap.originalFileName,
              storedFileName: snap.storedFileName,
              storagePath: snap.storagePath,
              imageUrl: snap.imageUrl,
              mimeType: mime,
              width: snap.naturalWidth,
              height: snap.naturalHeight,
              positionX: snap.positionX,
              positionY: snap.positionY,
              displayWidth: snap.displayWidth,
              displayHeight: snap.displayHeight,
            },
          },
        }),
      );
    },
    [projectId, setNodes, track],
  );

  const removeScreenIds = useCallback(
    async (ids: string[], snaps: ScreenFlowNode[]) => {
      for (const id of ids) cancelled.current.add(id);
      await Promise.all(ids.map((id) => chains.current.get(id) ?? Promise.resolve()));
      const idSet = new Set(ids);
      setNodes((current) => current.filter((node) => !idSet.has(node.id)));
      setEdges((current) => current.filter((edge) => !idSet.has(edge.source) && !idSet.has(edge.target)));
      const saved = snaps.filter(onServer).map((node) => node.id);
      if (saved.length) await track(deleteScreens({ data: { projectId, screenIds: saved } }));
    },
    [projectId, setEdges, setNodes, track],
  );

  const putBackScreens = useCallback(
    async (snaps: ScreenFlowNode[], edgeSnaps: EdgeSnap[]) => {
      for (const node of snaps) cancelled.current.delete(node.id);
      setNodes((current) => {
        const ids = new Set(current.map((node) => node.id));
        return [...current, ...snaps.filter((node) => !ids.has(node.id)).map(cloneNode)];
      });
      setEdges((current) => {
        const ids = new Set(current.map((edge) => edge.id));
        return [...current, ...edgeSnaps.filter((edge) => !ids.has(edge.id)).map(edgeFromSnap)];
      });
      const saved = snaps.filter((node) => node.data.kind === "screen" && node.data.storagePath);
      if (saved.length) {
        await track(
          restoreScreens({
            data: {
              projectId,
              screens: saved.map((node) => {
                const snap = mediaOf(node);
                const mime =
                  snap.mimeType === "image/jpeg" || snap.mimeType === "image/webp" ? snap.mimeType : "image/png";
                return {
                  id: node.id,
                  name: snap.name,
                  originalFileName: snap.originalFileName,
                  storedFileName: snap.storedFileName,
                  storagePath: snap.storagePath,
                  imageUrl: snap.imageUrl,
                  mimeType: mime,
                  width: snap.naturalWidth || 1,
                  height: snap.naturalHeight || 1,
                  positionX: snap.positionX,
                  positionY: snap.positionY,
                  displayWidth: snap.displayWidth,
                  displayHeight: snap.displayHeight,
                };
              }),
            },
          }),
        );
      }
      const texts = snaps.filter((node) => isTextNode(node) && node.data.persisted);
      if (texts.length) {
        await Promise.all(
          texts.map((node) => {
            const layout = layoutOf(node);
            const kind = node.data.kind === "frame" ? "frame" : "sticky";
            return track(
              saveBoardText({
                data: {
                  projectId,
                  id: node.id,
                  kind,
                  body: node.data.body,
                  fill: kind === "sticky" ? asStickyFill(node.data.fill) : null,
                  positionX: layout.x,
                  positionY: layout.y,
                  displayWidth: layout.w,
                  displayHeight: layout.h,
                },
              }),
            );
          }),
        );
      }
      if (edgeSnaps.length) {
        await track(
          restoreConnections({
            data: {
              projectId,
              connections: edgeSnaps.map((edge) => ({
                id: edge.id,
                fromScreenId: edge.source,
                toScreenId: edge.target,
                label: edge.label.trim() ? edge.label : null,
                sourceHandle: edge.sourceHandle,
                targetHandle: edge.targetHandle,
              })),
            },
          }),
        );
      }
      for (const node of snaps) {
        if (node.data.storagePath || isTextNode(node)) continue;
        const file = filesRef.current.get(node.id);
        if (!file) continue;
        void uploadFile(node.id, file, "create").catch(() => undefined);
      }
    },
    [projectId, setEdges, setNodes, track, uploadFile],
  );

  const undo = useCallback(async () => {
    const command = past.current.pop();
    if (!command) return;
    future.current.push(command);
    try {
      if (command.kind === "move") await applyLayouts(command.before);
      else if (command.kind === "rename") await applyRename(command.id, command.before);
      else if (command.kind === "label") await applyLabel(command.id, command.before, true);
      else if (command.kind === "body") await applyBody(command.id, command.before, true);
      else if (command.kind === "fill") await applyFill(command.id, command.before);
      else if (command.kind === "add-screens") await removeScreenIds(command.nodes.map((node) => node.id), command.nodes);
      else if (command.kind === "remove-screens") await putBackScreens(command.nodes, command.edges);
      else if (command.kind === "add-edges") {
        const ids = new Set(command.edges.map((edge) => edge.id));
        setEdges((current) => current.filter((edge) => !ids.has(edge.id)));
        await track(deleteConnections({ data: { projectId, connectionIds: [...ids] } }));
      } else if (command.kind === "remove-edges") {
        setEdges((current) => [...current, ...command.edges.map(edgeFromSnap)]);
        await track(
          restoreConnections({
            data: {
              projectId,
              connections: command.edges.map((edge) => ({
                id: edge.id,
                fromScreenId: edge.source,
                toScreenId: edge.target,
                label: edge.label.trim() ? edge.label : null,
                sourceHandle: edge.sourceHandle,
                targetHandle: edge.targetHandle,
              })),
            },
          }),
        );
      } else if (command.kind === "reconnect") {
        setEdges((current) => current.map((edge) => (edge.id === command.id ? edgeFromSnap(command.before) : edge)));
        await enqueueEdge(command.id, async () => {
          await track(
            saveConnection({
              data: {
                projectId,
                id: command.before.id,
                fromScreenId: command.before.source,
                toScreenId: command.before.target,
                label: command.before.label.trim() ? command.before.label : null,
                sourceHandle: command.before.sourceHandle,
                targetHandle: command.before.targetHandle,
              },
            }),
          );
        });
      } else if (command.kind === "replace") await applyMedia(command.id, command.before);
    } catch (error) {
      past.current.push(command);
      future.current.pop();
      toast.error(friendly(error, "Nie udało się cofnąć zmiany"));
    }
  }, [applyBody, applyFill, applyLabel, applyLayouts, applyMedia, applyRename, enqueueEdge, projectId, putBackScreens, removeScreenIds, setEdges, track]);

  const redo = useCallback(async () => {
    const command = future.current.pop();
    if (!command) return;
    past.current.push(command);
    try {
      if (command.kind === "move") await applyLayouts(command.after);
      else if (command.kind === "rename") await applyRename(command.id, command.after);
      else if (command.kind === "label") await applyLabel(command.id, command.after, true);
      else if (command.kind === "body") await applyBody(command.id, command.after, true);
      else if (command.kind === "fill") await applyFill(command.id, command.after);
      else if (command.kind === "add-screens") await putBackScreens(command.nodes, []);
      else if (command.kind === "remove-screens") await removeScreenIds(command.nodes.map((node) => node.id), command.nodes);
      else if (command.kind === "remove-edges") {
        const ids = new Set(command.edges.map((edge) => edge.id));
        setEdges((current) => current.filter((edge) => !ids.has(edge.id)));
        await track(deleteConnections({ data: { projectId, connectionIds: [...ids] } }));
      } else if (command.kind === "add-edges") {
        setEdges((current) => [...current, ...command.edges.map(edgeFromSnap)]);
        for (const edge of command.edges) {
          await enqueueEdge(edge.id, async () => {
            await track(
              saveConnection({
                data: {
                  projectId,
                  id: edge.id,
                  fromScreenId: edge.source,
                  toScreenId: edge.target,
                  label: edge.label.trim() ? edge.label : null,
                  sourceHandle: edge.sourceHandle,
                  targetHandle: edge.targetHandle,
                },
              }),
            );
          });
        }
      } else if (command.kind === "reconnect") {
        setEdges((current) => current.map((edge) => (edge.id === command.id ? edgeFromSnap(command.after) : edge)));
        await enqueueEdge(command.id, async () => {
          await track(
            saveConnection({
              data: {
                projectId,
                id: command.after.id,
                fromScreenId: command.after.source,
                toScreenId: command.after.target,
                label: command.after.label.trim() ? command.after.label : null,
                sourceHandle: command.after.sourceHandle,
                targetHandle: command.after.targetHandle,
              },
            }),
          );
        });
      } else if (command.kind === "replace") await applyMedia(command.id, command.after);
    } catch (error) {
      past.current.pop();
      future.current.push(command);
      toast.error(friendly(error, "Nie udało się ponowić zmiany"));
    }
  }, [applyBody, applyFill, applyLabel, applyLayouts, applyMedia, applyRename, enqueueEdge, projectId, putBackScreens, removeScreenIds, setEdges, track]);

  undoRef.current = () => {
    void undo();
  };
  redoRef.current = () => {
    void redo();
  };

  useEffect(() => {
    const api: BoardApi = {
      beginRename: (id) => useBoardStore.getState().setRenamingId(id),
      commitRename: (id, name) => {
        const next = name.trim();
        const node = nodesRef.current.find((item) => item.id === id);
        if (!node) return;
        if (!next || next === node.data.name) return;
        push({ kind: "rename", id, before: node.data.name, after: next });
        void applyRename(id, next).catch((error) => toast.error(friendly(error, "Nie udało się zapisać projektu")));
      },
      beginLabel: (id) => {
        const edge = edgesRef.current.find((item) => item.id === id);
        labelBefore.current.set(id, edge?.data?.label ?? "");
      },
      changeLabel: (id, label) => {
        void applyLabel(id, label, false);
      },
      commitLabel: (id, label) => {
        const before = labelBefore.current.get(id) ?? "";
        if (before !== label) push({ kind: "label", id, before, after: label });
        void applyLabel(id, label, true).catch((error) =>
          toast.error(friendly(error, "Nie udało się zapisać projektu")),
        );
      },
      beginBody: (id) => {
        const node = nodesRef.current.find((item) => item.id === id);
        bodyBefore.current.set(id, node?.data.body ?? "");
      },
      changeBody: (id, body) => {
        void applyBody(id, body, false).catch((error) => toast.error(friendly(error, "Nie udało się zapisać projektu")));
      },
      commitBody: (id, body) => {
        const before = bodyBefore.current.get(id) ?? "";
        if (before !== body) push({ kind: "body", id, before, after: body });
        void applyBody(id, body, true).catch((error) => toast.error(friendly(error, "Nie udało się zapisać projektu")));
      },
      setFill: (id, fill) => {
        const node = nodesRef.current.find((item) => item.id === id);
        if (!node || node.data.fill === fill) return;
        push({ kind: "fill", id, before: node.data.fill, after: fill });
        void applyFill(id, fill).catch((error) => toast.error(friendly(error, "Nie udało się zapisać projektu")));
      },
      requestReplace: (id) => {
        replaceId.current = id;
        replaceInput.current?.click();
      },
      downloadScreen: (id) => {
        const node = nodesRef.current.find((item) => item.id === id);
        if (!node) return;
        void fetch(resolveAppPath(node.data.imageUrl))
          .then((response) => {
            if (!response.ok) throw new Error("download");
            return response.blob();
          })
          .then((blob) => downloadBlob(blob, node.data.originalFileName || "screenshot.png"))
          .catch(() => toast.error("Nie udało się pobrać obrazu"));
      },
      deleteScreen: (id) => {
        void rf.deleteElements({ nodes: [{ id }] });
      },
      retryUpload: (id) => {
        const file = filesRef.current.get(id);
        if (!file) {
          replaceId.current = id;
          replaceInput.current?.click();
          return;
        }
        cancelled.current.delete(id);
        setNodes((current) =>
          current.map((node) =>
            node.id === id ? { ...node, data: { ...node.data, uploadStatus: "uploading" } } : node,
          ),
        );
        void uploadFile(id, file, nodeHasStorage(id) ? "replace" : "create").catch((error) => {
          toast.error(friendly(error, "Nie udało się wysłać obrazu"));
        });
      },
    };
    useBoardStore.setState({ api });
  }, [applyBody, applyFill, applyLabel, applyRename, push, rf, setNodes, uploadFile]);

  function nodeHasStorage(id: string): boolean {
    return Boolean(nodesRef.current.find((node) => node.id === id)?.data.storagePath);
  }

  useEffect(() => {
    let ignore = false;
    setReady(false);
    getBoard({ data: { projectId } })
      .then((board) => {
        if (ignore) return;
        setProjectName(board.project.name);
        const nextNodes = board.screens.map((screen) => {
          const kind = screen.kind;
          const node: ScreenFlowNode = {
            id: screen.id,
            type: kind,
            position: { x: screen.positionX, y: screen.positionY },
            width: screen.displayWidth,
            height: screen.displayHeight,
            style: { width: screen.displayWidth, height: screen.displayHeight },
            data: {
              kind,
              name: screen.name,
              body: screen.body,
              fill: kind === "sticky" ? asStickyFill(screen.fill) : null,
              originalFileName: screen.originalFileName,
              storedFileName: screen.storedFileName,
              storagePath: screen.storagePath,
              imageUrl: screen.imageUrl,
              mimeType: screen.mimeType,
              uploadStatus: "saved",
              naturalWidth: screen.width,
              naturalHeight: screen.height,
              persisted: true,
            },
          };
          layoutRef.current.set(screen.id, layoutOf(node));
          return node;
        });
        setNodes(nextNodes);
        setEdges(
          board.connections.map((connection) =>
            edgeFromSnap({
              id: connection.id,
              source: connection.fromScreenId,
              target: connection.toScreenId,
              sourceHandle: connection.sourceHandle,
              targetHandle: connection.targetHandle,
              label: connection.label ?? "",
            }),
          ),
        );
        setReady(true);
      })
      .catch((error) => {
        if (ignore) return;
        if (isUnauthorized(error)) {
          void navigate({ to: "/login" });
          return;
        }
        if (error instanceof Error && error.message === "Nie znaleziono projektu") setMissing(true);
        else toast.error(friendly(error, "Nie udało się wczytać projektu"));
        setReady(true);
      });
    return () => {
      ignore = true;
    };
  }, [navigate, projectId, setEdges, setNodes]);

  useEffect(() => {
    if (!ready || fitted.current) return;
    fitted.current = true;
    const timer = window.setTimeout(() => rf.fitView({ padding: 0.18, duration: 200 }), 40);
    return () => window.clearTimeout(timer);
  }, [ready, rf]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setNodes((current) => current.map((node) => ({ ...node, selected: true })));
        setEdges((current) => current.map((edge) => ({ ...edge, selected: true })));
      }
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redoRef.current();
        else undoRef.current();
      }
    };
    const onPaste = (event: ClipboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const files = [...(event.clipboardData?.files ?? [])];
      if (!files.length) return;
      event.preventDefault();
      const center = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      void ingest(files, center);
    };
    const preventNav = (event: DragEvent) => {
      if ([...(event.dataTransfer?.types ?? [])].includes("Files")) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    window.addEventListener("dragover", preventNav);
    window.addEventListener("drop", preventNav);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("dragover", preventNav);
      window.removeEventListener("drop", preventNav);
    };
  }, [ingest, rf, setEdges, setNodes]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<ScreenFlowNode>[]) => {
      for (const change of changes) {
        if (change.type === "dimensions" && change.resizing && !resizeBefore.current) {
          const node = nodesRef.current.find((item) => item.id === change.id);
          if (node) resizeBefore.current = layoutOf(node);
        }
      }
      onNodesChange(changes);
      const ended = changes.find((change) => change.type === "dimensions" && change.resizing === false);
      if (ended && ended.type === "dimensions" && resizeBefore.current) {
        const before = resizeBefore.current;
        resizeBefore.current = null;
        window.setTimeout(() => {
          const node = nodesRef.current.find((item) => item.id === before.id);
          if (!node) return;
          const after = layoutOf(node);
          if (ended.dimensions) {
            after.w = ended.dimensions.width;
            after.h = ended.dimensions.height;
          }
          layoutRef.current.set(node.id, after);
          setNodes((current) => current.map((item) => (item.id === after.id ? withLayout(item, after) : item)));
          if (layoutsEqual([before], [after])) return;
          push({ kind: "move", before: [before], after: [after] });
          void saveLayouts([after]).catch((error) => toast.error(friendly(error, "Nie udało się zapisać projektu")));
        }, 0);
      }
    },
    [onNodesChange, push, saveLayouts],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || connection.source === connection.target) return;
      const snap: EdgeSnap = {
        id: crypto.randomUUID(),
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? null,
        targetHandle: connection.targetHandle ?? null,
        label: "",
      };
      setEdges((current) => addEdge(edgeFromSnap(snap), current));
      push({ kind: "add-edges", edges: [snap] });
      void enqueueEdge(snap.id, async () => {
        await enqueue(snap.source, async () => undefined);
        await enqueue(snap.target, async () => undefined);
        await track(
          saveConnection({
            data: {
              projectId,
              id: snap.id,
              fromScreenId: snap.source,
              toScreenId: snap.target,
              label: null,
              sourceHandle: snap.sourceHandle,
              targetHandle: snap.targetHandle,
            },
          }),
        );
      }).catch((error) => {
        setEdges((current) => current.filter((edge) => edge.id !== snap.id));
        toast.error(friendly(error, "Nie udało się zapisać projektu"));
      });
    },
    [enqueue, enqueueEdge, projectId, push, setEdges, track],
  );

  function anchorHandle(nodeId: string, point: { x: number; y: number }): string | null {
    const node = rf.getInternalNode(nodeId);
    if (!node) return null;
    const width = node.measured.width ?? node.width ?? 0;
    const height = node.measured.height ?? node.height ?? 0;
    if (width < 2 || height < 2) return null;
    return encodeAnchor(
      anchorFromRect(
        { x: node.internals.positionAbsolute.x, y: node.internals.positionAbsolute.y, width, height },
        point.x,
        point.y,
      ),
    );
  }

  const onBeforeDelete: OnBeforeDelete<ScreenFlowNode, ScreenFlowEdge> = useCallback(
    async ({ nodes: doomedNodes, edges: doomedEdges }) => {
      if (!doomedNodes.length && !doomedEdges.length) return false;
      try {
        for (const node of doomedNodes) cancelled.current.add(node.id);
        await Promise.all(doomedNodes.map((node) => chains.current.get(node.id) ?? Promise.resolve()));
        const nodeSnaps = doomedNodes.map((node) => {
          const patched = past.current
            .flatMap((command) => (command.kind === "add-screens" ? command.nodes : []))
            .find((item) => item.id === node.id);
          return cloneNode(patched?.data.storagePath ? { ...node, data: { ...node.data, ...patched.data } } : node);
        });
        const edgeSnaps = doomedEdges.map(edgeSnap);
        if (doomedNodes.length) {
          const saved = nodeSnaps.filter(onServer).map((node) => node.id);
          if (saved.length) await track(deleteScreens({ data: { projectId, screenIds: saved } }));
          const nodeIds = new Set(doomedNodes.map((node) => node.id));
          const lone = doomedEdges.filter((edge) => !nodeIds.has(edge.source) && !nodeIds.has(edge.target));
          if (lone.length) {
            await track(deleteConnections({ data: { projectId, connectionIds: lone.map((edge) => edge.id) } }));
          }
          push({ kind: "remove-screens", nodes: nodeSnaps, edges: edgeSnaps });
        } else {
          await track(deleteConnections({ data: { projectId, connectionIds: doomedEdges.map((edge) => edge.id) } }));
          push({ kind: "remove-edges", edges: edgeSnaps });
        }
        return true;
      } catch (error) {
        toast.error(friendly(error, "Nie udało się zapisać projektu"));
        return false;
      }
    },
    [projectId, push, track],
  );

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const field = target?.closest("textarea, input");
      if (field && document.activeElement === field) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.ctrlKey || event.metaKey) {
        const viewport = rf.getViewport();
        const rect = el.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        const factor = event.deltaY < 0 ? 1.07 : 1 / 1.07;
        const zoom = Math.min(2.5, Math.max(0.15, viewport.zoom * factor));
        const flowX = (px - viewport.x) / viewport.zoom;
        const flowY = (py - viewport.y) / viewport.zoom;
        void rf.setViewport({ x: px - flowX * zoom, y: py - flowY * zoom, zoom });
        return;
      }
      const viewport = rf.getViewport();
      void rf.setViewport({ x: viewport.x - event.deltaX, y: viewport.y - event.deltaY, zoom: viewport.zoom });
    };
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => el.removeEventListener("wheel", onWheel);
  }, [rf]);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragOver(false);
      dragDepth.current = 0;
      const files = [...event.dataTransfer.files];
      if (!files.length) return;
      const origin = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      void ingest(files, origin);
    },
    [ingest, rf],
  );

  async function onExport() {
    if (!nodesRef.current.length) return;
    if (nodesRef.current.some((node) => node.data.kind === "screen" && node.data.uploadStatus !== "saved")) {
      toast.error("Poczekaj, aż wszystkie obrazy zostaną zapisane");
      return;
    }
    const toastId = toast.loading("Tworzenie paczki…");
    try {
      await flushLabels();
      await flushTexts();
      await Promise.all([...chains.current.values(), ...edgeChains.current.values()]);
      const liveNodes = nodesRef.current;
      const imageNodes = liveNodes.filter((node) => node.data.kind === "screen");
      const noteNodes = liveNodes.filter(isTextNode);
      const names = uniqueExportFileNames(
        imageNodes.map((node) => ({ id: node.id, name: node.data.name, mimeType: node.data.mimeType || "image/png" })),
      );
      const screens = imageNodes.map((node) => ({
        id: node.id,
        name: node.data.name,
        file: `screens/${names.get(node.id) ?? "ekran.png"}`,
        originalFileName: node.data.originalFileName,
      }));
      const notes = noteNodes.map((node) => ({
        id: node.id,
        kind: node.data.kind === "frame" ? ("frame" as const) : ("sticky" as const),
        text: node.data.body,
      }));
      const fileById = new Map(screens.map((screen) => [screen.id, screen.file]));
      for (const note of notes) fileById.set(note.id, `notes/${note.id}`);
      const connections = edgesRef.current.map((edge) => ({
        id: edge.id,
        fromScreenId: edge.source,
        toScreenId: edge.target,
        fromFile: fileById.get(edge.source) ?? "",
        toFile: fileById.get(edge.target) ?? "",
        label: edge.data?.label?.trim() ? edge.data.label.trim() : null,
      }));
      const doc: FlowDocument = {
        version: 1,
        project: { id: projectId, name: projectName },
        screens,
        connections,
        ...(notes.length ? { notes } : {}),
      };
      const zip = new JSZip();
      const folder = zip.folder("screens");
      if (!folder) throw new Error("zip");
      for (const node of imageNodes) {
        const response = await fetch(resolveAppPath(node.data.imageUrl));
        if (!response.ok) throw new Error("image");
        folder.file(names.get(node.id) ?? "ekran.png", await response.arrayBuffer());
      }
      zip.file("flow.txt", buildFlowText(doc));
      zip.file("flow.json", buildFlowJson(doc));
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, projectZipName(projectName));
      toast.success("Paczka gotowa", { id: toastId });
    } catch {
      toast.error("Nie udało się wygenerować eksportu", { id: toastId });
    }
  }

  function addText(kind: "sticky" | "frame") {
    const id = crypto.randomUUID();
    const size = kind === "sticky" ? { w: 220, h: 180 } : { w: 340, h: 200 };
    const center = rf.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const existing = nodesRef.current;
    const position = existing.length
      ? {
          x: Math.max(...existing.map((node) => node.position.x + (typeof node.width === "number" ? node.width : 220))) + 64,
          y: Math.min(...existing.map((node) => node.position.y)),
        }
      : { x: center.x - size.w / 2, y: center.y - size.h / 2 };
    const node: ScreenFlowNode = {
      id,
      type: kind,
      position,
      width: size.w,
      height: size.h,
      style: { width: size.w, height: size.h },
      selected: true,
      data: {
        kind,
        name: kind === "sticky" ? "Notatka" : "Ramka",
        body: "",
        fill: kind === "sticky" ? "#F6E7A8" : null,
        originalFileName: "",
        storedFileName: "",
        storagePath: "",
        imageUrl: "",
        mimeType: "text/plain",
        uploadStatus: "saved",
        naturalWidth: 0,
        naturalHeight: 0,
        persisted: false,
      },
    };
    const nextNodes = [...nodesRef.current.map((item) => ({ ...item, selected: false })), node];
    nodesRef.current = nextNodes;
    layoutRef.current.set(id, { id, x: position.x, y: position.y, w: size.w, h: size.h });
    setNodes(nextNodes);
    push({ kind: "add-screens", nodes: [cloneNode(node)] });
    void enqueue(id, async () => {
      if (cancelled.current.has(id)) return;
      await track(
        saveBoardText({
          data: {
            projectId,
            id,
            kind,
            body: nodesRef.current.find((item) => item.id === id)?.data.body ?? "",
            fill: kind === "sticky" ? "#F6E7A8" : null,
            positionX: position.x,
            positionY: position.y,
            displayWidth: size.w,
            displayHeight: size.h,
          },
        }),
      );
      if (cancelled.current.has(id)) {
        await deleteScreens({ data: { projectId, screenIds: [id] } }).catch(() => undefined);
        return;
      }
      setNodes((current) => {
        const next = current.map((item) =>
          item.id === id ? { ...item, data: { ...item.data, persisted: true } } : item,
        );
        nodesRef.current = next;
        return next;
      });
      patchAdded(id, { persisted: true });
    }).catch((error) => {
      toast.error(friendly(error, "Nie udało się zapisać projektu"));
      setNodes((current) => current.filter((item) => item.id !== id));
    });
  }

  if (missing) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="surface max-w-md p-4 text-center">
          <h1 className="text-lg font-semibold">Nie znaleziono projektu</h1>
          <p className="mt-2 text-sm text-muted">Mógł zostać usunięty albo nie należy do tego konta.</p>
          <Link to="/" className="btn btn-primary mt-4">
            Wróć do projektów
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="board-shell">
      <header className="board-toolbar">
        <Link to="/" className="icon-btn" aria-label="Projekty">
          <ArrowLeft size={16} />
        </Link>
        <Logo compact />
        {editingName ? (
          <input
            className="text-input"
            style={{ maxWidth: 280, height: 36 }}
            autoFocus
            defaultValue={projectName}
            aria-label="Nazwa projektu"
            onBlur={(event) => {
              const next = event.currentTarget.value.trim();
              setEditingName(false);
              if (!next || next === projectName) return;
              setProjectName(next);
              void track(renameProject({ data: { id: projectId, name: next } })).catch((error) => {
                setProjectName(projectName);
                toast.error(friendly(error, "Nie udało się zapisać projektu"));
              });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") setEditingName(false);
            }}
          />
        ) : (
          <button type="button" className="project-name-btn" onClick={() => setEditingName(true)}>
            {projectName}
          </button>
        )}
        <button type="button" className="btn btn-secondary" onClick={() => addInput.current?.click()}>
          <ImagePlus size={16} />
          Dodaj obrazy
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => addText("sticky")}>
          <StickyNote size={16} />
          Notatka
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => addText("frame")}>
          <Square size={16} />
          Ramka
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void onExport()} disabled={!nodes.length}>
          <FolderInput size={16} />
          Eksport ZIP
        </button>
        <span className={saveState === "error" ? "save-pill is-error" : saveState === "saved" ? "save-pill is-ok" : "save-pill"}>
          {saveState === "saving" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {saveState === "saving" ? "Zapisywanie…" : saveState === "error" ? "Błąd zapisu" : "Zapisano"}
        </span>
        <ZoomControls />
      </header>
      <div
        ref={canvasRef}
        className={dragOver ? "board-canvas is-dragging" : "board-canvas"}
        onDragEnter={(event) => {
          if (![...event.dataTransfer.types].includes("Files")) return;
          dragDepth.current += 1;
          setDragOver(true);
        }}
        onDragLeave={() => {
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) {
            dragDepth.current = 0;
            setDragOver(false);
          }
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={(connection) => {
            connectHit.current = connection;
          }}
          onConnectStart={(event, params) => {
            connectHit.current = null;
            const point = "touches" in event && event.touches[0] ? event.touches[0] : "clientX" in event ? event : null;
            connectPoint.current = point ? rf.screenToFlowPosition({ x: point.clientX, y: point.clientY }) : null;
            connectStart.current = { nodeId: params.nodeId ?? null, handleId: params.handleId ?? null };
          }}
          onConnectEnd={(event, state) => {
            const hit = connectHit.current;
            connectHit.current = null;
            const client = "changedTouches" in event && event.changedTouches[0] ? event.changedTouches[0] : "clientX" in event ? event : null;
            const source = hit?.source ?? state.fromNode?.id ?? connectStart.current.nodeId;
            let target = hit?.target ?? state.toNode?.id ?? null;
            if (!target && client) {
              target =
                document
                  .elementsFromPoint(client.clientX, client.clientY)
                  .map((element) => element.closest(".react-flow__node")?.getAttribute("data-id"))
                  .find((id): id is string => Boolean(id)) ?? null;
            }
            if (!source || !target || source === target) return;
            const end = client ? rf.screenToFlowPosition({ x: client.clientX, y: client.clientY }) : connectPoint.current;
            const start = connectPoint.current ?? end;
            onConnect({
              source,
              target,
              sourceHandle: (start ? anchorHandle(source, start) : null) ?? hit?.sourceHandle ?? connectStart.current.handleId,
              targetHandle: (end ? anchorHandle(target, end) : null) ?? hit?.targetHandle ?? null,
            });
          }}
          onReconnect={(oldEdge, connection) => {
            if (!connection.source || !connection.target || connection.source === connection.target) return;
            reconnectHit.current = { edge: oldEdge, connection };
          }}
          onReconnectEnd={(event, _edge, handleType) => {
            const pending = reconnectHit.current;
            reconnectHit.current = null;
            if (!pending?.connection.source || !pending.connection.target || pending.connection.source === pending.connection.target) return;
            const client = "changedTouches" in event && event.changedTouches[0] ? event.changedTouches[0] : "clientX" in event ? event : null;
            const flow = client ? rf.screenToFlowPosition({ x: client.clientX, y: client.clientY }) : null;
            const before = edgeSnap(pending.edge);
            const movedId = handleType === "source" ? pending.connection.source : pending.connection.target;
            const moved = flow ? anchorHandle(movedId, flow) : null;
            const after: EdgeSnap = {
              ...before,
              source: pending.connection.source,
              target: pending.connection.target,
              sourceHandle: handleType === "source" ? moved ?? before.sourceHandle : before.sourceHandle,
              targetHandle: handleType === "target" ? moved ?? before.targetHandle : before.targetHandle,
            };
            setEdges((current) => current.map((item) => (item.id === before.id ? edgeFromSnap(after) : item)));
            push({ kind: "reconnect", id: before.id, before, after });
            void enqueueEdge(before.id, async () => {
              await track(
                saveConnection({
                  data: {
                    projectId,
                    id: before.id,
                    fromScreenId: after.source,
                    toScreenId: after.target,
                    label: after.label.trim() ? after.label : null,
                    sourceHandle: after.sourceHandle,
                    targetHandle: after.targetHandle,
                  },
                }),
              );
            }).catch((error) => toast.error(friendly(error, "Nie udało się zapisać projektu")));
          }}
          onBeforeDelete={onBeforeDelete}
          onNodeDragStart={(_, __, dragged) => {
            dragBefore.current = dragged.map((node) => layoutOf(node as ScreenFlowNode));
          }}
          onNodeDragStop={(_, __, dragged) => {
            const before = dragBefore.current;
            dragBefore.current = null;
            if (!before?.length) return;
            const after = dragged.map((node) => layoutOf(node as ScreenFlowNode));
            for (const item of after) layoutRef.current.set(item.id, item);
            if (layoutsEqual(before, after)) return;
            push({ kind: "move", before, after });
            void saveLayouts(after).catch((error) => toast.error(friendly(error, "Nie udało się zapisać projektu")));
          }}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionMode={ConnectionMode.Loose}
          connectionLineType={ConnectionLineType.SmoothStep}
          connectionLineStyle={{ stroke: "#1d4ed8", strokeWidth: 2 }}
          defaultEdgeOptions={{ type: "flow", markerEnd: EDGE_MARKER, style: EDGE_STYLE }}
          isValidConnection={(connection) => connection.source !== connection.target}
          connectionRadius={64}
          fitView
          minZoom={0.15}
          maxZoom={2.5}
          selectionOnDrag={false}
          panOnDrag
          panActivationKeyCode="Space"
          selectionKeyCode="Shift"
          multiSelectionKeyCode={["Meta", "Control", "Shift"]}
          deleteKeyCode={["Backspace", "Delete"]}
          zoomOnScroll={false}
          panOnScroll={false}
          zoomOnPinch
          zoomOnDoubleClick={false}
          edgesReconnectable
          elevateEdgesOnSelect
          colorMode="light"
          proOptions={{ hideAttribution: false }}
          onDragOver={(event) => {
            if ([...event.dataTransfer.types].includes("Files")) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={onDrop}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.35} color="#c5cad3" />
        </ReactFlow>
        {ready && nodes.length === 0 ? (
          <div className="board-empty">
            <div className="board-empty__card">
              <h2 className="text-lg font-semibold">Upuść screenshoty</h2>
              <p className="mt-2 text-sm text-muted">
                PNG, JPG albo WebP lądują na serwerze od razu. Możesz też dodać notatkę albo ramkę tekstu i połączyć wszystko strzałkami.
              </p>
              <p className="mt-3 text-xs text-subtle">
                Kliknij i przytrzymaj element, żeby go przesunąć. Strzałka zostaje w miejscu upuszczenia. Dwuklik w notatkę edytuje tekst.
              </p>
            </div>
          </div>
        ) : null}
        {!ready ? (
          <div className="board-empty">
            <div className="board-empty__card">Wczytywanie tablicy…</div>
          </div>
        ) : null}
      </div>
      <input
        ref={addInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          if (!files.length) return;
          const origin = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
          void ingest(files, origin);
        }}
      />
      <input
        ref={replaceInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          const id = replaceId.current;
          replaceId.current = null;
          if (!file || !id) return;
          const mime = mimeFromFile(file);
          if (!mime) {
            toast.error("Plik ma nieobsługiwany format");
            return;
          }
          if (file.size > MAX_IMAGE_BYTES) {
            toast.error("Plik jest za duży (maks. 12 MB)");
            return;
          }
          void readLocalImage(file)
            .then((image) => {
              const size = displaySizeFor(image.width, image.height);
              filesRef.current.set(id, file);
              setNodes((current) =>
                current.map((node) => {
                  if (node.id !== id) return node;
                  if (node.data.imageUrl.startsWith("blob:")) URL.revokeObjectURL(node.data.imageUrl);
                  const next = withLayout(
                    {
                      ...node,
                      data: {
                        ...node.data,
                        imageUrl: image.url,
                        mimeType: mime,
                        naturalWidth: image.width,
                        naturalHeight: image.height,
                        uploadStatus: "uploading" as const,
                      },
                    },
                    { id, x: node.position.x, y: node.position.y, w: size.width, h: size.height },
                  );
                  layoutRef.current.set(id, layoutOf(next));
                  return next;
                }),
              );
              return uploadFile(id, file, "replace");
            })
            .catch((error) => toast.error(friendly(error, "Nie udało się wysłać obrazu")));
        }}
      />
    </div>
  );
}
