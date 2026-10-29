import type { Edge, Node } from "@xyflow/react";

export type BoardKind = "screen" | "sticky" | "frame";

export const STICKY_FILLS = ["#F6E7A8", "#D9E6FB", "#D7EEDC", "#F6D9DE", "#E7E8EC"] as const;
export type StickyFill = (typeof STICKY_FILLS)[number];

/** A screenshot, sticky note, or text frame. React Flow node id === screens.id. */
export type ScreenNodeData = {
  kind: BoardKind;
  name: string;
  body: string;
  fill: string | null;
  originalFileName: string;
  storedFileName: string;
  storagePath: string;
  imageUrl: string;
  mimeType: string;
  uploadStatus: "uploading" | "saved" | "error";
  naturalWidth: number;
  naturalHeight: number;
  /** Row exists in the database (image uploaded, or note/frame saved). */
  persisted: boolean;
};

export type ScreenFlowNode = Node<ScreenNodeData, BoardKind>;
export type ScreenFlowEdge = Edge<{ label: string; sourceT?: number; targetT?: number }, "flow">;

export type ProjectRecord = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  screenCount: number;
};

export type ScreenRecord = {
  id: string;
  projectId: string;
  kind: BoardKind;
  name: string;
  body: string;
  fill: string | null;
  originalFileName: string;
  storedFileName: string;
  storagePath: string;
  imageUrl: string;
  mimeType: string;
  width: number;
  height: number;
  positionX: number;
  positionY: number;
  displayWidth: number;
  displayHeight: number;
  createdAt: string;
  updatedAt: string;
};

export type ConnectionRecord = {
  id: string;
  projectId: string;
  fromScreenId: string;
  toScreenId: string;
  label: string | null;
  sourceHandle: string | null;
  targetHandle: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BoardRecord = {
  project: ProjectRecord;
  screens: ScreenRecord[];
  connections: ConnectionRecord[];
};

export type SavedImage = {
  imageUrl: string;
  storagePath: string;
  storedFileName: string;
  mimeType: string;
  publicToken: string;
};

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp"] as const;
export type AllowedMime = (typeof ALLOWED_MIME)[number];
