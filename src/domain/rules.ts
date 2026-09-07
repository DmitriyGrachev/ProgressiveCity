import type { Rect, ResultKind, Rules } from "./model";
export const MAP_SIZE = 40;
export const TILE_W = 64;
export const TILE_H = 32;
export function overlaps(a: Rect, b: Rect) {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}
export function inside(r: Rect) {
  return (
    [r.x, r.y, r.w, r.h].every(Number.isInteger) &&
    r.x >= 0 &&
    r.y >= 0 &&
    r.w > 0 &&
    r.h > 0 &&
    r.x + r.w <= MAP_SIZE &&
    r.y + r.h <= MAP_SIZE
  );
}
export function canPlace(
  r: Rect,
  objects: (Rect & { id: string })[],
  ignoreId?: string,
) {
  return (
    inside(r) && objects.every((o) => o.id === ignoreId || !overlaps(r, o))
  );
}
export function gridToIso(x: number, y: number) {
  return { x: ((x - y) * TILE_W) / 2, y: ((x + y) * TILE_H) / 2 };
}
export function isoToGrid(x: number, y: number) {
  return {
    x: Math.floor(x / TILE_W + y / TILE_H),
    y: Math.floor(y / TILE_H - x / TILE_W),
  };
}
export function localDate(timezone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function rewardFor(rules: Rules, kind: ResultKind) {
  return rules.rewards[(["explore", "verify", "apply"] as const).indexOf(kind)];
}
export function checkRules(rewards: number[], costs: number[]) {
  if (
    rewards.length !== 3 ||
    costs.length !== 2 ||
    !rewards.every((n) => Number.isInteger(n) && n >= 1 && n <= 10) ||
    !costs.every((n) => Number.isInteger(n) && n >= 1 && n <= 100)
  )
    throw new Error(
      "Награды: 1–10, стоимость этапов: 1–100, только целые числа.",
    );
}
export function safeUrl(value: string) {
  try {
    return ["https:", "http:", "mailto:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
export function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
