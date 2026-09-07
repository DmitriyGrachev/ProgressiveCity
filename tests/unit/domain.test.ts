import { describe, expect, it } from "vitest";
import {
  canPlace,
  isoToGrid,
  gridToIso,
  localDate,
  overlaps,
} from "../../src/domain/rules";

describe("city geometry", () => {
  it("rejects collisions and map boundaries, allows the original moving object", () => {
    const occupied = [{ id: "a", x: 4, y: 5, w: 2, h: 2 }];
    expect(canPlace({ x: 5, y: 5, w: 2, h: 2 }, occupied)).toBe(false);
    expect(canPlace({ x: 39, y: 0, w: 2, h: 2 }, occupied)).toBe(false);
    expect(canPlace({ x: -1, y: 0, w: 1, h: 1 }, occupied)).toBe(false);
    expect(canPlace({ x: 4, y: 5, w: 2, h: 2 }, occupied, "a")).toBe(true);
    expect(
      overlaps({ x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 0, w: 1, h: 1 }),
    ).toBe(false);
  });
  it("round trips isometric coordinates", () => {
    for (const x of [0, 8, 39])
      for (const y of [0, 12, 39]) {
        const p = gridToIso(x + 0.5, y + 0.5);
        expect(isoToGrid(p.x, p.y)).toEqual({ x, y });
      }
  });
  it("uses the selected timezone, including a UTC date boundary", () => {
    expect(
      localDate("America/Los_Angeles", new Date("2026-01-01T01:00:00Z")),
    ).toBe("2025-12-31");
    expect(localDate("Asia/Tokyo", new Date("2026-01-01T23:00:00Z"))).toBe(
      "2026-01-02",
    );
  });
});
