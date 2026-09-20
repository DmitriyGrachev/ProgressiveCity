import { Container, Graphics, Text } from "pixi.js";
import { type CityChange, type ComparisonView } from "../domain/comparison";
import type { Rect } from "../domain/model";
import { gridToIso } from "../domain/rules";

function mark(
  layer: Container,
  rect: Rect,
  text: string,
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
  const bottom = gridToIso(rect.x + rect.w, rect.y + rect.h);
  const label = new Text({
    text,
    style: {
      fontFamily: "Segoe UI",
      fontSize: 11,
      fontWeight: "600",
      fill: color,
      stroke: { color: "#fafcf5", width: 4 },
    },
  });
  label.anchor.set(0.5, 0);
  label.position.set(bottom.x, bottom.y + (historical ? 4 : 20));
  layer.addChild(label);
}
export function comparisonArt(changes: CityChange[], view: ComparisonView) {
  const layer = new Container();
  // Historical contours are annotations, deliberately absent from hit testing.
  layer.eventMode = "none";
  if (view !== "changes") return layer;
  for (const c of changes) {
    if (c.before && (!c.after || c.flags.includes("moved")))
      mark(
        layer,
        c.before,
        c.after ? "A · место до переноса" : "− Снято · контур A",
        "#81514d",
        true,
      );
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
      mark(
        layer,
        c.after,
        tags.join(" · "),
        c.flags.includes("stage") ? "#805b20" : "#235f60",
        false,
      );
    }
  }
  return layer;
}
