import { afterEach, beforeEach, expect, it } from "vitest";
import {
  compareSnapshots,
  visibleChanges,
  snapshotLayout,
  relatedEvents,
} from "../../src/domain/comparison";
import { readComparison } from "../../src/storage/comparison";
import { CityDB } from "../../src/storage/db";
import { CityService } from "../../src/storage/service";
import { id, type Snapshot } from "../../src/domain/model";

const building = {
  id: "building-a",
  learningObjectId: "research",
  trackId: "track",
  kind: "workshop" as const,
  x: 10,
  y: 10,
  w: 2,
  h: 2,
  color: "#bc7153",
  name: "Мастерская",
  stage: 1 as const,
};
const snap = (buildings: Snapshot["buildings"] = [building]): Snapshot => ({
  id: "snapshot",
  name: "Первый день",
  createdAt: "2026-09-01T10:00:00.000Z",
  buildings,
  districts: [],
});

it("reports no changes for equal independently read snapshots without mutating either", () => {
  const a = snap(),
    b = structuredClone(a);
  Object.freeze(a.buildings[0]);
  Object.freeze(a.buildings);
  Object.freeze(a);
  expect(compareSnapshots(a, b)).toEqual([]);
  expect(b).toEqual(a);
});
it("combines stage, move and appearance differences", () => {
  const a = snap();
  const b = snap([
    { ...building, stage: 2, x: 15, color: "#578b7c", name: "Студия" },
  ]);
  const changes = compareSnapshots(a, b);
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({
    key: "learning:research",
    flags: ["stage", "moved", "appearance"],
    decorative: false,
    before: { stage: 1 },
    after: { stage: 2 },
  });
  expect(a).toEqual(snap());
});
it("matches research and habit owners after replacement with a different placement ID", () => {
  const a = snap(),
    b = snap([{ ...building, id: "new-placement" }]);
  expect(compareSnapshots(a, b)).toEqual([]);
  const habit = { ...building, learningObjectId: undefined, trackId: "habit" };
  expect(
    compareSnapshots(
      snap([habit]),
      snap([{ ...habit, id: "another", x: 11 }]),
    )[0],
  ).toMatchObject({ key: "track:habit", flags: ["moved"] });
});
it("reports map presence, removed decor and independent decor placements", () => {
  const tree = {
    id: "tree",
    kind: "tree" as const,
    x: 1,
    y: 1,
    w: 1,
    h: 1,
    name: "Дерево",
    color: "#578b7c",
    stage: 1 as const,
  };
  const changes = compareSnapshots(
    snap([tree]),
    snap([building, { ...tree, id: "new-tree" }]),
  );
  expect(changes.find((c) => c.key === "decor:tree")?.flags).toEqual([
    "removed",
  ]);
  expect(changes.find((c) => c.key === "decor:new-tree")?.flags).toEqual([
    "appeared",
  ]);
  expect(visibleChanges(changes, false)).toMatchObject([
    { key: "learning:research", flags: ["appeared"] },
  ]);
  expect(compareSnapshots(snap(), snap([]))[0].flags).toEqual(["removed"]);
});
it("compares district geometry and appearance as optional decorative changes", () => {
  const a = snap(),
    b = snap();
  a.districts = [
    { id: "d", name: "Сад", color: "#578b7c", x: 1, y: 1, w: 5, h: 5 },
  ];
  b.districts = [{ ...a.districts[0], x: 2, name: "Сад открытий" }];
  const changes = compareSnapshots(a, b);
  expect(changes[0]).toMatchObject({
    entity: "district",
    flags: ["moved", "appearance"],
    decorative: true,
  });
  expect(visibleChanges(changes, false)).toEqual([]);
});

let db: CityDB;
let service: CityService;
beforeEach(async () => {
  db = new CityDB(`compare-${id()}`);
  service = new CityService(db);
  await service.initialize("Город", "Акварель");
});
afterEach(async () => {
  await db.delete();
});
it("captures current data consistently and keeps chosen stages independent of future writes", async () => {
  const first = (await db.snapshots.toArray())[0];
  const epoch = (await db.metadata.get("epoch"))!.value;
  const b = (await db.buildings.toArray())[0];
  await service.placeBuilding({ ...b, x: 6, y: 7 }, epoch);
  const state = service.planning.getSnapshot();
  const before = await db.read();
  const comparison = await readComparison(db, first.id, null, epoch);
  expect(comparison.before).toEqual(first);
  expect(comparison.after.buildings[0]).toMatchObject({ x: 6, y: 7, stage: 1 });
  expect(comparison.scene.storageEpoch).toBe(epoch);
  expect(await db.read()).toEqual(before);
  expect(service.planning.getSnapshot()).toEqual(state);
  await db.learningObjects.update(b.learningObjectId!, { stage: 2 });
  await service.placeBuilding({ ...b, x: 8, y: 9 }, epoch);
  expect(comparison.after.buildings[0]).toMatchObject({ x: 6, y: 7, stage: 1 });
  expect(await db.snapshots.get(first.id)).toEqual(first);
  const refreshed = await readComparison(db, first.id, null, epoch);
  expect(refreshed.after.buildings[0]).toMatchObject({ x: 8, y: 9, stage: 2 });
});
it("reads saved B instead of substituting today's stage and rejects missing or replaced sources", async () => {
  const a = (await db.snapshots.toArray())[0];
  const b = await service.snapshot("До следующего шага");
  const epoch = (await db.metadata.get("epoch"))!.value;
  const track = (await db.tracks.toArray())[0];
  await db.learningObjects.update(track.id, { stage: 3 });
  const comparison = await readComparison(db, a.id, b.id, epoch);
  expect(comparison.after).toEqual(b);
  expect(compareSnapshots(comparison.before, comparison.after)).toEqual([]);
  await expect(readComparison(db, "missing", null, epoch)).rejects.toThrow(
    /снимок/i,
  );
  await db.metadata.put({ id: "epoch", value: id() });
  await expect(readComparison(db, a.id, null, epoch)).rejects.toThrow(/город/i);
});
it("pure current snapshot copies geometry and districts, recording each owner's own stage", async () => {
  const data = await db.read();
  data.learningObjects[0].stage = 2;
  data.districts.push({
    id: "d",
    name: "Район",
    color: "#578b7c",
    x: 1,
    y: 1,
    w: 3,
    h: 3,
  });
  const snapshot = snapshotLayout(
    data,
    "capture",
    "Сейчас",
    "2026-09-20T10:00:00.000Z",
  );
  data.buildings[0].x = 1;
  data.districts[0].name = "Изменено";
  data.learningObjects[0].stage = 3;
  expect(snapshot.buildings[0]).toMatchObject({ x: 19, stage: 2 });
  expect(snapshot.districts[0].name).toBe("Район");
});

it("uses only genuine owner-linked events within the selected dates", async () => {
  const a = (await db.snapshots.toArray())[0];
  const b = (await db.buildings.toArray())[0];
  await service.placeBuilding({ ...b, x: 6, y: 7 });
  const session = await readComparison(
    db,
    a.id,
    null,
    (await db.metadata.get("epoch"))!.value,
  );
  const event = {
    id: "related",
    type: "upgrade" as const,
    trackId: b.trackId,
    learningObjectId: b.learningObjectId,
    amount: -3,
    ruleVersion: 1,
    description: "Этап 2",
    createdAt: session.after.createdAt,
  };
  session.events = [
    event,
    { ...event, id: "wrong-owner", learningObjectId: "different" },
    { ...event, id: "old", createdAt: "2020-01-01T00:00:00.000Z" },
    { ...event, id: "future", createdAt: "2099-01-01T00:00:00.000Z" },
  ];
  expect(relatedEvents(session.changes[0], session).map((e) => e.id)).toEqual([
    "related",
  ]);
  session.events = [];
  expect(relatedEvents(session.changes[0], session)).toEqual([]);
});

it("classifies stage-only and template-only changes, including reverse chronology", () => {
  const a = snap(),
    b = snap([{ ...building, stage: 3 }]);
  expect(compareSnapshots(a, b)[0].flags).toEqual(["stage"]);
  expect(compareSnapshots(b, a)[0]).toMatchObject({
    before: { stage: 3 },
    after: { stage: 1 },
    flags: ["stage"],
  });
  expect(
    compareSnapshots(a, snap([{ ...building, kind: "library" }]))[0].flags,
  ).toEqual(["appearance"]);
});
