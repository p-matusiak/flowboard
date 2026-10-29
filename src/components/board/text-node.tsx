import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { NodeResizer, useStore, type Node, type NodeProps } from "@xyflow/react";
import { Trash2 } from "lucide-react";
import { STICKY_FILLS, type ScreenNodeData } from "@/lib/flow/types";
import { EdgeAnchors } from "./edge-anchors";
import { useBoardStore } from "./board-store";

const FILL_LABEL: Record<(typeof STICKY_FILLS)[number], string> = {
  "#F6E7A8": "Żółty",
  "#D9E6FB": "Niebieski",
  "#D7EEDC": "Zielony",
  "#F6D9DE": "Różowy",
  "#E7E8EC": "Szary",
};

function fitFontSize(text: string, width: number, height: number, family: string, weight: string) {
  if (width < 8 || height < 8) return 14;
  const probe = document.createElement("div");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.left = "-9999px";
  probe.style.width = `${Math.floor(width)}px`;
  probe.style.fontFamily = family;
  probe.style.fontWeight = weight;
  probe.style.lineHeight = "1.2";
  probe.style.whiteSpace = "pre-wrap";
  probe.style.overflowWrap = "anywhere";
  probe.style.wordBreak = "break-word";
  probe.style.textAlign = "center";
  document.body.appendChild(probe);
  let lo = 11;
  let hi = Math.max(11, Math.floor(Math.min(height * 0.72, 80)));
  let best = 11;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    probe.style.fontSize = `${mid}px`;
    probe.textContent = text;
    if (probe.scrollHeight <= height + 1) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  probe.remove();
  return best;
}

function TextNodeView({ id, type, data, selected, width, height }: NodeProps<Node<ScreenNodeData, "sticky" | "frame">>) {
  const frame = type === "frame";
  const deleteScreen = useBoardStore((s) => s.api.deleteScreen);
  const beginBody = useBoardStore((s) => s.api.beginBody);
  const changeBody = useBoardStore((s) => s.api.changeBody);
  const commitBody = useBoardStore((s) => s.api.commitBody);
  const setFill = useBoardStore((s) => s.api.setFill);
  const solo = useStore((s) => {
    let count = 0;
    for (const node of s.nodes) if (node.selected) count += 1;
    return count === 1;
  });
  const [draft, setDraft] = useState(data.body);
  const [editing, setEditing] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState(18);
  const placeholder = frame ? "Wpisz tekst…" : "Notatka…";

  useEffect(() => {
    setDraft(data.body);
  }, [data.body]);

  useLayoutEffect(() => {
    if (frame) return;
    const el = bodyRef.current;
    if (!el) return;
    const style = getComputedStyle(el);
    const padX = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
    const padY = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
    const sample = draft.trim() || placeholder;
    setFontSize(
      fitFontSize(sample, el.clientWidth - padX, el.clientHeight - padY, style.fontFamily, style.fontWeight),
    );
  }, [draft, frame, height, placeholder, width]);

  useEffect(() => {
    if (editing) areaRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!selected && editing) setEditing(false);
  }, [editing, selected]);

  return (
    <div
      className={`${frame ? "frame-card" : "sticky-card"}${selected ? " is-selected" : ""}`}
      style={{ width, height, background: frame ? undefined : (data.fill ?? "#F6E7A8") }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        setEditing(true);
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={160}
        minHeight={120}
        maxWidth={1200}
        maxHeight={900}
        color="#1d4ed8"
        lineStyle={{ borderColor: "#1d4ed8" }}
      />
      {selected && solo ? (
        <div className="screen-card__tools nodrag nopan">
          {frame ? null : (
            <div className="color-dots" role="group" aria-label="Kolor notatki">
              {STICKY_FILLS.map((fill) => (
                <button
                  key={fill}
                  type="button"
                  className={data.fill === fill ? "color-dot is-on" : "color-dot"}
                  style={{ background: fill }}
                  aria-label={FILL_LABEL[fill]}
                  onClick={() => setFill(id, fill)}
                />
              ))}
            </div>
          )}
          <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => deleteScreen(id)}>
            <Trash2 size={14} />
            Usuń
          </button>
        </div>
      ) : null}
      <div ref={bodyRef} className={frame ? "text-card__body is-frame" : "text-card__body is-note"} style={frame ? undefined : { fontSize }}>
        {editing ? (
          <textarea
            ref={areaRef}
            className="nodrag nopan nowheel"
            value={draft}
            placeholder={placeholder}
            aria-label={frame ? "Ramka tekstu" : "Notatka"}
            onFocus={() => beginBody(id)}
            onChange={(event) => {
              const next = event.target.value;
              setDraft(next);
              changeBody(id, next);
            }}
            onBlur={(event) => {
              commitBody(id, event.currentTarget.value);
              setEditing(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
          />
        ) : (
          <p className={draft.trim() ? undefined : "is-empty"}>{draft.trim() ? draft : placeholder}</p>
        )}
      </div>
      <EdgeAnchors />
    </div>
  );
}

export const TextNode = memo(TextNodeView);
