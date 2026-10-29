import { memo, useEffect, useRef, useState } from "react";
import { NodeResizer, useStore, type NodeProps } from "@xyflow/react";
import { Download, ImagePlus, Pencil, Trash2 } from "lucide-react";
import type { ScreenFlowNode } from "@/lib/flow/types";
import { resolveAppPath } from "@/lib/flow/urls";
import { EdgeAnchors } from "./edge-anchors";
import { useBoardStore } from "./board-store";

function ScreenNodeView({ id, data, selected, width, height }: NodeProps<ScreenFlowNode>) {
  const editing = useBoardStore((s) => s.renamingId === id);
  const setRenamingId = useBoardStore((s) => s.setRenamingId);
  const commitRename = useBoardStore((s) => s.api.commitRename);
  const requestReplace = useBoardStore((s) => s.api.requestReplace);
  const downloadScreen = useBoardStore((s) => s.api.downloadScreen);
  const deleteScreen = useBoardStore((s) => s.api.deleteScreen);
  const retryUpload = useBoardStore((s) => s.api.retryUpload);
  const solo = useStore((s) => {
    let count = 0;
    for (const node of s.nodes) if (node.selected) count += 1;
    return count === 1;
  });
  const cancelRef = useRef(false);
  const [flash, setFlash] = useState(false);
  const previous = useRef(data.uploadStatus);

  useEffect(() => {
    if (previous.current === "uploading" && data.uploadStatus === "saved") {
      setFlash(true);
      const timer = window.setTimeout(() => setFlash(false), 2200);
      previous.current = data.uploadStatus;
      return () => window.clearTimeout(timer);
    }
    previous.current = data.uploadStatus;
    return undefined;
  }, [data.uploadStatus]);

  return (
    <div className={selected ? "screen-card is-selected" : "screen-card"} style={{ width, height }}>
      <NodeResizer
        isVisible={selected}
        minWidth={140}
        minHeight={110}
        maxWidth={1600}
        keepAspectRatio
        color="#1d4ed8"
        lineStyle={{ borderColor: "#1d4ed8" }}
      />
      {selected && solo ? (
        <div className="screen-card__tools nodrag nopan">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRenamingId(id)}>
            <Pencil size={14} />
            Nazwa
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => requestReplace(id)}>
            <ImagePlus size={14} />
            Podmień
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadScreen(id)}>
            <Download size={14} />
            Pobierz
          </button>
          <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => deleteScreen(id)}>
            <Trash2 size={14} />
            Usuń
          </button>
        </div>
      ) : null}
      <div className="screen-card__bar">
        {editing ? (
          <input
            className="nodrag nopan screen-card__name-input"
            autoFocus
            defaultValue={data.name}
            aria-label="Nazwa ekranu"
            onFocus={(event) => event.currentTarget.select()}
            onPointerDown={(event) => event.stopPropagation()}
            onBlur={(event) => {
              const next = event.currentTarget.value;
              setRenamingId(null);
              if (cancelRef.current) {
                cancelRef.current = false;
                return;
              }
              commitRename(id, next);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                cancelRef.current = true;
                setRenamingId(null);
              }
            }}
          />
        ) : (
          <button type="button" className="screen-card__name" onDoubleClick={() => setRenamingId(id)}>
            {data.name}
          </button>
        )}
        <div className="screen-card__file">{data.originalFileName}</div>
      </div>
      <div className="screen-card__shot">
        <img src={resolveAppPath(data.imageUrl)} alt="" draggable={false} />
        {data.uploadStatus === "uploading" ? <div className="screen-card__status">Wysyłanie…</div> : null}
        {data.uploadStatus === "error" ? (
          <button type="button" className="screen-card__status is-error nodrag nopan" onClick={() => retryUpload(id)}>
            Błąd — ponów
          </button>
        ) : null}
        {flash ? <div className="screen-card__status is-ok">Zapisano</div> : null}
      </div>
      <EdgeAnchors />
    </div>
  );
}

export const ScreenNode = memo(ScreenNodeView);
