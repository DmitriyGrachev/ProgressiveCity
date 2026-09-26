import { Container, Graphics } from "pixi.js";
import { type CityChange, type ComparisonView } from "../domain/comparison";
import type { Rect } from "../domain/model";
import { gridToIso } from "../domain/rules";
import type { CityLabel } from "./CityLabels";

function mark(
  layer: Container,
  rect: Rect,
  color: string,
  historical: boolean,
) {
  const points = [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x + rect.w, rect.y + rect.h],
    [rect.x, rect.y + rect.h],
  ].map(([x, y]) => gridToIso(x, y));
  const outline = new Graphics()
    .poly(points.flatMap((p) => [p.x, p.y]))
    .stroke({ color, width: historical ? 2 : 3, alpha: 0.9 });
  if (historical) {
    outline
      .moveTo(points[0].x, points[0].y)
      .lineTo(points[2].x, points[2].y)
      .moveTo(points[1].x, points[1].y)
      .lineTo(points[3].x, points[3].y)
      .stroke({ color, width: 1.5, alpha: 0.7 });
  }
  layer.addChild(outline);
  return {
    x: Math.min(...points.map((p) => p.x)),
    y: Math.min(...points.map((p) => p.y)),
    width:
      Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)),
    height:
      Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y)),
  };
}
export function comparisonArt(changes: CityChange[], view: ComparisonView) {
  const layer = new Container();
  const labels: CityLabel[] = [];
  // Historical contours are annotations, deliberately absent from hit testing.
  layer.eventMode = "none";
  if (view !== "changes") return { layer, labels };
  for (const c of changes) {
    if (c.before && (!c.after || c.flags.includes("moved"))) {
      const bounds = mark(layer, c.before, "#81514d", true);
      labels.push({
        id: `history:${c.key}`,
        changeKey: c.key,
        name: `A · ${c.before.name}`,
        detail: c.after
          ? "↔ Место до переноса · контур A"
          : "− Снято · контур A",
        bounds,
        historical: true,
      });
    }
    if (c.after) {
      const tags = c.flags
        .filter((f) => f !== "removed")
        .map((f) =>
          f === "appeared"
            ? "+ На карте"
            : f === "moved"
              ? "↔ Перенос"
              : f === "appearance"
                ? "◐ Вид"
                : c.entity === "building"
                  ? `Э ${c.before?.stage} → ${c.after?.stage}`
                  : "Этап",
        );
      const bounds = mark(
        layer,
        c.after,
        c.flags.includes("stage") ? "#805b20" : "#235f60",
        false,
      );
      labels.push({
        id: `${c.entity === "building" ? "building" : "district"}:${c.after.id}`,
        entityId: c.after.id,
        changeKey: c.key,
        name: `B · ${c.after.name}`,
        detail: tags.join(" · "),
        district: c.entity === "district",
        bounds,
      });
    }
  }
  return { layer, labels };
}
