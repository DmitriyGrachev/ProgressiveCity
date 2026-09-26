export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface LabelCandidate {
  id: string;
  x: number;
  below: number;
  above: number;
  width: number;
  height: number;
  priority: number;
  eligible: boolean;
  objectVisible: boolean;
  obstacle?: ScreenRect;
}
export interface LabelPosition extends ScreenRect {
  slot: "below" | "above";
}
export function overlaps(a: ScreenRect, b: ScreenRect, gap = 0) {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}
function inside(a: ScreenRect, b: ScreenRect) {
  return (
    a.x >= b.x &&
    a.y >= b.y &&
    a.x + a.width <= b.x + b.width &&
    a.y + a.height <= b.y + b.height
  );
}
/** Stable greedy placement: selected/hover first, then retained names and stable IDs.
 * Retained labels need a smaller gap than newcomers, preventing boundary flicker. */
export function arrangeLabels(
  candidates: LabelCandidate[],
  viewport: ScreenRect,
  previous: ReadonlyMap<string, LabelPosition>,
) {
  const result = new Map<string, LabelPosition>();
  const sorted = candidates
    .filter((c) => c.eligible && c.objectVisible)
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        Number(previous.has(b.id)) - Number(previous.has(a.id)) ||
        a.id.localeCompare(b.id),
    );
  for (const c of sorted) {
    if (c.width > viewport.width || c.height > viewport.height) continue;
    const old = previous.get(c.id);
    const slots =
      old?.slot === "above"
        ? (["above", "below"] as const)
        : (["below", "above"] as const);
    for (const slot of slots) {
      const box: LabelPosition = {
        x: c.x - c.width / 2,
        y: slot === "below" ? c.below : c.above - c.height,
        width: c.width,
        height: c.height,
        slot,
      };
      if (c.priority >= 2) {
        box.x = Math.max(
          viewport.x,
          Math.min(box.x, viewport.x + viewport.width - box.width),
        );
        box.y = Math.max(
          viewport.y,
          Math.min(box.y, viewport.y + viewport.height - box.height),
        );
      }
      if (!inside(box, viewport)) continue;
      if (
        c.priority < 2 &&
        candidates.some(
          (other) =>
            other.id !== c.id &&
            other.obstacle &&
            overlaps(box, other.obstacle, old ? 1 : 5),
        )
      )
        continue;
      if ([...result.values()].some((r) => overlaps(box, r, old ? 2 : 8)))
        continue;
      result.set(c.id, box);
      break;
    }
  }
  return result;
}
export function fitBounds(bounds: ScreenRect, viewport: ScreenRect) {
  const zoom = Math.max(
    0.03,
    Math.min(
      1.6,
      Math.max(1, viewport.width - 32) / Math.max(1, bounds.width),
      Math.max(1, viewport.height - 32) / Math.max(1, bounds.height),
    ),
  );
  return {
    zoom,
    x: viewport.x + viewport.width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: viewport.y + viewport.height / 2 - (bounds.y + bounds.height / 2) * zoom,
  };
}
