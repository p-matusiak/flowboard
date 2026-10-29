import { memo, useEffect, useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getSmoothStepPath,
  useInternalNode,
  type EdgeProps,
} from "@xyflow/react";
import type { ScreenFlowEdge } from "@/lib/flow/types";
import { useBoardStore } from "./board-store";
import { decodeAnchor, type AnchorSide } from "./edge-anchor";

const SIDE_POSITION: Record<AnchorSide, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

function anchoredPoint(
  node: { measured?: { width?: number; height?: number }; internals: { positionAbsolute: { x: number; y: number } } },
  handle: string | null | undefined,
  ratio: number | undefined,
): { x: number; y: number; position: Position } | null {
  const side = decodeAnchor(handle)?.side;
  const t = ratio ?? decodeAnchor(handle)?.t;
  const width = node.measured?.width ?? 0;
  const height = node.measured?.height ?? 0;
  if (!side || t == null || width < 2 || height < 2) return null;
  const left = node.internals.positionAbsolute.x;
  const top = node.internals.positionAbsolute.y;
  if (side === "top") return { x: left + width * t, y: top, position: SIDE_POSITION.top };
  if (side === "bottom") return { x: left + width * t, y: top + height, position: SIDE_POSITION.bottom };
  if (side === "left") return { x: left, y: top + height * t, position: SIDE_POSITION.left };
  return { x: left + width, y: top + height * t, position: SIDE_POSITION.right };
}

function FlowEdgeView({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  sourceHandleId,
  targetHandleId,
  selected,
  data,
  markerEnd,
  style,
}: EdgeProps<ScreenFlowEdge>) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const from = sourceNode ? anchoredPoint(sourceNode, sourceHandleId, data?.sourceT) : null;
  const to = targetNode ? anchoredPoint(targetNode, targetHandleId, data?.targetT) : null;
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: from?.x ?? sourceX,
    sourceY: from?.y ?? sourceY,
    targetX: to?.x ?? targetX,
    targetY: to?.y ?? targetY,
    sourcePosition: from?.position ?? sourcePosition,
    targetPosition: to?.position ?? targetPosition,
    borderRadius: 16,
  });
  const label = data?.label ?? "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const beginLabel = useBoardStore((s) => s.api.beginLabel);
  const changeLabel = useBoardStore((s) => s.api.changeLabel);
  const commitLabel = useBoardStore((s) => s.api.commitLabel);

  useEffect(() => {
    if (!editing) setDraft(label);
  }, [editing, label]);

  const show = editing || selected || label.trim().length > 0;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={22}
        style={{
          ...style,
          stroke: selected ? "#1e3a8a" : "#1d4ed8",
          strokeWidth: selected ? 2.75 : 2,
        }}
      />
      {show ? (
        <EdgeLabelRenderer>
          <div
            className={label.trim() ? "flow-label nodrag nopan" : "flow-label is-empty nodrag nopan"}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {editing ? (
              <input
                autoFocus
                value={draft}
                aria-label="Akcja przejścia"
                placeholder="Akcja"
                onPointerDown={(event) => event.stopPropagation()}
                onChange={(event) => {
                  setDraft(event.target.value);
                  changeLabel(id, event.target.value);
                }}
                onBlur={() => {
                  setEditing(false);
                  commitLabel(id, draft);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setDraft(label);
                    changeLabel(id, label);
                    setEditing(false);
                  }
                }}
              />
            ) : (
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  beginLabel(id);
                  setEditing(true);
                }}
              >
                {label.trim() || "Akcja"}
              </button>
            )}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const FlowEdge = memo(FlowEdgeView);
