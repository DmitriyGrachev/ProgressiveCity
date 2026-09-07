import { Container, Graphics, Text } from "pixi.js";
import type { Building } from "../domain/model";
import { gridToIso } from "../domain/rules";

function polygon(
  g: Graphics,
  points: number[],
  color: string | number,
  alpha = 1,
) {
  g.poly(points).fill({ color, alpha });
}
function block(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  d: number,
  height: number,
  light: string,
  dark: string,
  top: string,
) {
  polygon(
    g,
    [
      x,
      y - height,
      x + w,
      y + w / 2 - height,
      x + w - d,
      y + (w + d) / 2 - height,
      x - d,
      y + d / 2 - height,
    ],
    top,
  );
  polygon(
    g,
    [
      x - d,
      y + d / 2 - height,
      x + w - d,
      y + (w + d) / 2 - height,
      x + w - d,
      y + (w + d) / 2,
      x - d,
      y + d / 2,
    ],
    light,
  );
  polygon(
    g,
    [
      x + w - d,
      y + (w + d) / 2 - height,
      x + w,
      y + w / 2 - height,
      x + w,
      y + w / 2,
      x + w - d,
      y + (w + d) / 2,
    ],
    dark,
  );
}
function tree(g: Graphics, x: number, y: number, scale = 1, color = "#64a17a") {
  g.ellipse(x + 7 * scale, y + 4 * scale, 16 * scale, 7 * scale).fill({
    color: "#335446",
    alpha: 0.15,
  });
  g.rect(x - 2 * scale, y - 22 * scale, 4 * scale, 23 * scale).fill("#887252");
  g.ellipse(x + 1 * scale, y - 31 * scale, 13 * scale, 21 * scale).fill(
    "#3a7660",
  );
  g.ellipse(x - 5 * scale, y - 35 * scale, 10 * scale, 15 * scale).fill(color);
  g.ellipse(x - 8 * scale, y - 40 * scale, 4 * scale, 7 * scale).fill(
    "#8db68b",
  );
}
function windowPane(g: Graphics, x: number, y: number, side = 1) {
  polygon(
    g,
    [x, y, x + 8, y + 4 * side, x + 8, y + 15 + 4 * side, x, y + 15],
    "#386474",
  );
  g.moveTo(x + 4, y + 2 * side)
    .lineTo(x + 4, y + 15 + 2 * side)
    .stroke({ color: "#e9dcb9", width: 1.5 });
  g.moveTo(x, y + 7)
    .lineTo(x + 8, y + 7 + 4 * side)
    .stroke({ color: "#e9dcb9", width: 1.5 });
}
export function buildingArt(b: Building, stage: number, selected: boolean) {
  const container = new Container();
  const g = new Graphics();
  container.addChild(g);
  const center = gridToIso(b.x, b.y);
  container.position.set(center.x, center.y);
  const progress = Boolean(b.trackId);
  const size = b.w * 32;
  polygon(
    g,
    [0, 0, size, size / 2, 0, size, -size, size / 2],
    progress
      ? "#d8d6b5"
      : b.kind === "road" || b.kind === "plaza"
        ? b.color
        : "#86ad7d",
  );
  if (selected)
    g.poly([0, 0, size, size / 2, 0, size, -size, size / 2]).stroke({
      color: "#245e4b",
      width: 3,
    });
  if (!progress) {
    if (b.kind === "tree") tree(g, 0, 19, 0.75, b.color);
    if (b.kind === "road") {
      polygon(g, [-22, 5, 26, 29, 22, 31, -26, 7], "#e6e1c9");
      g.moveTo(-16, 16).lineTo(0, 24).stroke({ color: "#999d90", width: 2 });
    }
    if (b.kind === "park") {
      polygon(g, [-42, 31, 6, 7, 16, 12, -31, 36, 13, 58, 3, 63], b.color);
      tree(g, 22, 30, 0.9);
      tree(g, -20, 49, 0.7);
      g.ellipse(15, 46, 12, 6).fill("#75aabb");
    }
    if (b.kind === "plaza") {
      g.ellipse(0, 32, 27, 14).fill("#e9e2cc");
      g.ellipse(0, 31, 19, 10).fill("#8baba9");
      g.ellipse(0, 28, 14, 7).fill("#9dcccf");
      g.rect(-2, 5, 4, 21).fill("#e9e2cc");
      g.ellipse(0, 6, 11, 5).fill("#e9e2cc");
      g.ellipse(0, 4, 8, 3).fill("#a2d0d1");
    }
    return { container, graphic: g };
  }
  // Local vector architecture: warm masonry, pitched roofs, glazing and planted forecourts.
  polygon(g, [10, 15, 64, 42, 20, 64, -35, 37], "#9ea889", 0.35);
  const h = 27 + (stage - 1) * 17;
  if (b.kind === "workshop") {
    block(g, -4, 6, 39, 37, h, "#eddfbd", "#c2b595", "#f3e7ca");
    const y = 6 - h;
    polygon(g, [-46, y + 19, -8, y - 11, 37, y + 10, -1, y + 39], b.color);
    polygon(g, [-8, y - 11, 0, y - 8, 42, y + 14, 37, y + 10], "#804d40");
    polygon(g, [-46, y + 19, -1, y + 39, -1, y + 43, -46, y + 23], "#8c6750");
    for (let level = 0; level < stage; level++) {
      windowPane(g, -34, 6 + 23 - h + level * 17);
      windowPane(g, 10, 6 + 23 - h + level * 17, -1);
    }
    polygon(g, [-15, 33, -5, 38, -5, 21, -15, 16], "#73644d");
    block(g, 9, 7, 7, 6, h + 18, "#be9c77", "#957b60", "#d6b894");
    if (stage >= 2)
      block(g, -36, 37, 19, 14, 13, "#e2d8b5", "#b6ac8f", b.color);
    if (stage === 3) {
      g.rect(25, -h - 9, 2, 20).fill("#59644e");
      polygon(g, [27, -h - 9, 39, -h - 4, 27, -h], "#e5bd63");
    }
  } else if (b.kind === "library") {
    block(g, -3, 5, 42, 40, h + 3, "#e5dfce", "#b9b8a6", "#eee5d0");
    block(g, -3, 4 - h, 47, 44, 5, "#ddd0b3", "#a69f8d", b.color);
    for (let level = 0; level < stage; level++)
      for (let col = 0; col < 3; col++)
        windowPane(g, -36 + col * 11, 27 - h + col * 5.5 + level * 16);
    for (let col = 0; col < 3; col++)
      windowPane(g, 4 + col * 10, 34 - h - col * 5, -1);
    block(g, -1, 42, 22, 17, 4, "#ddd2b9", "#b5ac98", "#f0e5c8");
    if (stage >= 2) {
      block(g, -7, 5 - h, 17, 14, 13, "#ddd8c0", "#bab59f", b.color);
    }
    if (stage === 3) {
      g.circle(0, -h - 9, 8).fill("#e4c174");
      g.moveTo(0, -h - 14)
        .lineTo(0, -h - 9)
        .lineTo(4, -h - 9)
        .stroke({ color: "#596450", width: 1.5 });
    }
  } else {
    const top = 25 - h;
    for (const [x, y] of [
      [-35, 30],
      [0, 48],
      [35, 30],
      [0, 14],
    ]) {
      g.rect(x - 2, y - h + 4, 5, h - 3).fill("#e9d9b4");
    }
    block(g, 0, 11, 38, 38, 5, "#ded2b4", "#b2aa90", "#eee1bb");
    polygon(
      g,
      [-45, top, 0, top - 31 - stage * 4, 45, top, 0, top + 23],
      b.color,
    );
    polygon(
      g,
      [0, top - 31 - stage * 4, 45, top, 0, top + 23],
      "#49766b",
      0.48,
    );
    if (stage >= 2) {
      g.circle(0, top - 34 - stage * 4, 4).fill("#e2bc69");
      tree(g, -35, 45, 0.55);
    }
    if (stage === 3) {
      polygon(g, [-27, 38, 0, 52, 28, 38, 28, 31, 0, 45, -27, 31], "#e4d2ac");
    }
  }
  tree(g, 42, 44, 0.45);
  const label = new Text({
    text: b.name,
    style: {
      fontFamily: "Segoe UI, sans-serif",
      fontSize: 11,
      fill: "#344f41",
      fontWeight: "600",
      align: "center",
    },
  });
  label.anchor.set(0.5, 0);
  label.position.set(0, size + 4);
  label.label = "building-label";
  container.addChild(label);
  return { container, graphic: g };
}
