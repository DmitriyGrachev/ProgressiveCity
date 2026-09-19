import type { Building } from "./model";
import { inside, MAP_SIZE, overlaps } from "./rules";

export interface Cell {
  x: number;
  y: number;
}
// A four-connected line also fills gaps between sparse pointer events.
export function extendRoad(path: Cell[], to: Cell): Cell[] {
  const from = path.at(-1) ?? to;
  for (const p of [from, to])
    if (
      ![p.x, p.y].every((v) => Number.isInteger(v) && v >= -1 && v <= MAP_SIZE)
    )
      throw new Error("Маршрут находится за пределами карты.");
  const result = path.length ? [...path] : [{ ...from }];
  let { x, y } = from;
  const dx = Math.abs(to.x - x),
    dy = Math.abs(to.y - y);
  let ix = 0,
    iy = 0;
  while (ix < dx || iy < dy) {
    if (ix < dx && (iy === dy || (1 + 2 * ix) * dy <= (1 + 2 * iy) * dx)) {
      x += Math.sign(to.x - from.x);
      ix++;
    } else {
      y += Math.sign(to.y - from.y);
      iy++;
    }
    result.push({ x, y });
  }
  return result;
}

export function roadCellState(cell: Cell, buildings: Building[]) {
  const rect = { ...cell, w: 1, h: 1 };
  if (!inside(rect)) return "blocked";
  const hit = buildings.find((b) => overlaps(rect, b));
  return !hit ? "free" : hit.kind === "road" ? "road" : "blocked";
}
