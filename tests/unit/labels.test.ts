import { describe, expect, it } from "vitest";
import {
  arrangeLabels,
  overlaps,
  fitBounds,
  rightDockViewport,
  type LabelCandidate,
} from "../../src/city/label-layout";

const viewport = { x: 0, y: 0, width: 400, height: 300 };
it("keeps usable height beside a right dock when the area above it is exhausted", () => {
  const base = { x: 12, y: 120, width: 850, height: 280 };
  const dock = { x: 550, y: 150, width: 300, height: 250 };
  const usable = rightDockViewport(base, [dock]);
  expect(usable).toEqual({ x: 12, y: 120, width: 526, height: 280 });
  expect(overlaps(usable, dock)).toBe(false);
  const bounds = { x: -200, y: -90, width: 400, height: 300 };
  const camera = fitBounds(bounds, usable);
  expect(bounds.y * camera.zoom + camera.y).toBeGreaterThanOrEqual(
    usable.y + 15,
  );
});
it("keeps the area above a full-width dock on a narrow screen", () => {
  const base = { x: 12, y: 110, width: 300, height: 450 };
  expect(
    rightDockViewport(base, [{ x: 20, y: 350, width: 290, height: 200 }]),
  ).toEqual({ x: 12, y: 110, width: 300, height: 228 });
});
it("does not shrink the viewport for absent or out-of-view controls", () => {
  expect(rightDockViewport(viewport, [])).toEqual(viewport);
  expect(
    rightDockViewport(viewport, [{ x: 500, y: 10, width: 30, height: 30 }]),
  ).toEqual(viewport);
});
it("preserves the normal full-width label region when there is enough height above the dock", () => {
  expect(
    rightDockViewport({ x: 0, y: 0, width: 1200, height: 800 }, [
      { x: 900, y: 600, width: 300, height: 200 },
    ]),
  ).toEqual({ x: 0, y: 0, width: 1200, height: 588 });
});
const label = (id: string, x = 200, priority = 1): LabelCandidate => ({
  id,
  x,
  below: 150,
  above: 90,
  width: 130,
  height: 22,
  priority,
  eligible: true,
  objectVisible: true,
});
describe("screen label layout", () => {
  it("hides ordinary names that would cover neighboring buildings, but keeps selection readable", () => {
    const obstacle = {
      ...label("roof", 200),
      eligible: false,
      obstacle: { x: 0, y: 0, width: 400, height: 250 },
    };
    expect(
      arrangeLabels([label("name"), obstacle], viewport, new Map()).has("name"),
    ).toBe(false);
    expect(
      arrangeLabels([label("name", 200, 4), obstacle], viewport, new Map()).has(
        "name",
      ),
    ).toBe(true);
  });
  it("reserves the selected name before hover and ordinary labels without intersections", () => {
    const result = arrangeLabels(
      [label("normal"), label("hover", 210, 3), label("selected", 190, 4)],
      viewport,
      new Map(),
    );
    expect(result.has("selected")).toBe(true);
    const boxes = [...result.values()];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        expect(overlaps(boxes[i], boxes[j])).toBe(false);
  });
  it("keeps names readable at edges and never places ordinary labels outside the viewport", () => {
    const result = arrangeLabels(
      [
        label("selected", 2, 4),
        label("edge", 399),
        { ...label("off"), objectVisible: false },
      ],
      viewport,
      new Map(),
    );
    expect(result.get("selected")?.x).toBe(0);
    expect(result.has("edge")).toBe(false);
    expect(result.has("off")).toBe(false);
  });
  it("retains visible labels and their slots through small reversible pans", () => {
    const candidates = Array.from({ length: 20 }, (_, i) =>
      label(String(i), 15 + i * 20),
    );
    let previous = arrangeLabels(candidates, viewport, new Map());
    const visible = [...previous.keys()];
    for (const delta of [1, 2, 1, 0, -1, 0]) {
      previous = arrangeLabels(
        candidates.map((c) => ({ ...c, x: c.x + delta })),
        viewport,
        previous,
      );
      expect([...previous.keys()]).toEqual(visible);
    }
  });
  it("newcomers wait for a gap while retained labels remain disjoint", () => {
    const first = arrangeLabels([label("a", 100)], viewport, new Map());
    const next = arrangeLabels(
      [label("b", 230), label("a", 100)],
      viewport,
      first,
    );
    expect(next.has("a")).toBe(true);
    const boxes = [...next.values()];
    if (boxes.length === 2) expect(overlaps(boxes[0], boxes[1])).toBe(false);
  });
  it("fits real object bounds including roofs with screen padding and a zoom cap", () => {
    const bounds = { x: -600, y: -120, width: 1200, height: 900 };
    const camera = fitBounds(bounds, {
      x: 20,
      y: 180,
      width: 280,
      height: 440,
    });
    expect(camera.zoom).toBeGreaterThan(0);
    expect(bounds.x * camera.zoom + camera.x).toBeGreaterThanOrEqual(20);
    expect(
      (bounds.y + bounds.height) * camera.zoom + camera.y,
    ).toBeLessThanOrEqual(620);
    expect(
      fitBounds({ x: 10, y: -50, width: 128, height: 130 }, viewport).zoom,
    ).toBeLessThanOrEqual(1.6);
  });
});
