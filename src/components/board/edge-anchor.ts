export type AnchorSide = "top" | "right" | "bottom" | "left";

export type EdgeAnchor = { side: AnchorSide; t: number };

const SIDES = new Set<AnchorSide>(["top", "right", "bottom", "left"]);

export function encodeAnchor(anchor: EdgeAnchor): string {
  const t = Math.min(1, Math.max(0, anchor.t));
  return `${anchor.side}:${t.toFixed(4)}`;
}

export function decodeAnchor(handle: string | null | undefined): EdgeAnchor | null {
  if (!handle) return null;
  const [side, raw] = handle.split(":");
  if (!SIDES.has(side as AnchorSide)) return null;
  const t = raw == null || raw === "" ? 0.5 : Number(raw);
  return { side: side as AnchorSide, t: Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0.5 };
}

/** Closest point on the rectangle border, remembered as a side plus 0–1 offset. */
export function anchorFromRect(
  rect: { x: number; y: number; width: number; height: number },
  px: number,
  py: number,
): EdgeAnchor {
  const { x, y, width, height } = rect;
  const right = x + width;
  const bottom = y + height;
  const alongX = width > 0 ? (Math.min(right, Math.max(x, px)) - x) / width : 0.5;
  const alongY = height > 0 ? (Math.min(bottom, Math.max(y, py)) - y) / height : 0.5;
  const inside = px >= x && px <= right && py >= y && py <= bottom;
  if (!inside) {
    const onX = px >= x && px <= right;
    const onY = py >= y && py <= bottom;
    if (onX && py < y) return { side: "top", t: alongX };
    if (onX && py > bottom) return { side: "bottom", t: alongX };
    if (onY && px < x) return { side: "left", t: alongY };
    if (onY && px > right) return { side: "right", t: alongY };
    const pastX = Math.min(Math.abs(px - x), Math.abs(px - right));
    const pastY = Math.min(Math.abs(py - y), Math.abs(py - bottom));
    if (pastX >= pastY) return { side: px < x ? "left" : "right", t: alongY };
    return { side: py < y ? "top" : "bottom", t: alongX };
  }
  const dLeft = px - x;
  const dRight = right - px;
  const dTop = py - y;
  const dBottom = bottom - py;
  const min = Math.min(dLeft, dRight, dTop, dBottom);
  if (min === dTop) return { side: "top", t: alongX };
  if (min === dBottom) return { side: "bottom", t: alongX };
  if (min === dLeft) return { side: "left", t: alongY };
  return { side: "right", t: alongY };
}
