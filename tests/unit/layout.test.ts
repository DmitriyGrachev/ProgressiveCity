import { afterEach, beforeEach, expect, it } from "vitest";
import { CityDB } from "../../src/storage/db";
import { CityService } from "../../src/storage/service";
import { extendRoad, roadCellState } from "../../src/domain/roads";
import { id, type Building } from "../../src/domain/model";

let db: CityDB;
let service: CityService;
let epoch: string;
const decor = (x = 3, y = 4): Building => ({
  id: id(),
  kind: "tree",
  name: "Дерево",
  color: "#507d78",
  x,
  y,
  w: 1,
  h: 1,
});
const road = () => ({ ...decor(), kind: "road" as const, name: "Дорога" });
beforeEach(async () => {
  db = new CityDB(`layout-${id()}`);
  service = new CityService(db);
  await service.initialize("Город", "Акварель");
  epoch = (await db.metadata.get("epoch"))!.value;
});
afterEach(async () => {
  await db.delete();
});

it("fills fast diagonal pointer gaps with a connected deduplicated route", () => {
  const path = extendRoad([{ x: 1, y: 1 }], { x: 4, y: 3 });
  expect(path[0]).toEqual({ x: 1, y: 1 });
  expect(path.at(-1)).toEqual({ x: 4, y: 3 });
  expect(path).toHaveLength(6);
  for (let i = 1; i < path.length; i++)
    expect(
      Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y),
    ).toBe(1);
  expect(roadCellState({ x: -1, y: 0 }, [])).toBe("blocked");
  expect(roadCellState({ x: 3, y: 4 }, [decor()])).toBe("blocked");
});

it("saves a whole road as one action, skips existing roads, and undoes/redoes only new cells", async () => {
  const existing = { ...road(), x: 2, y: 3 };
  await service.placeBuilding(existing, epoch);
  const points = extendRoad([{ x: 1, y: 3 }], { x: 5, y: 3 });
  await service.planning.placeRoad(road(), points, epoch);
  expect(await db.buildings.count()).toBe(6);
  expect(await db.events.where("type").equals("layout").count()).toBe(2);
  await service.planning.undo(epoch);
  expect(await db.buildings.count()).toBe(2);
  expect(await db.buildings.get(existing.id)).toEqual(existing);
  await service.planning.redo(epoch);
  expect(await db.buildings.count()).toBe(6);
});

it("rejects a whole route on collision or map exit without changing history or database", async () => {
  await service.placeBuilding(decor(), epoch);
  const previous = await db.buildings.toArray();
  const state = service.planning.getSnapshot();
  for (const cells of [
    [
      { x: 2, y: 4 },
      { x: 3, y: 4 },
    ],
    [
      { x: 39, y: 2 },
      { x: 40, y: 2 },
    ],
  ])
    await expect(
      service.planning.placeRoad(road(), cells, epoch),
    ).rejects.toThrow(/занято|предел/);
  expect(await db.buildings.toArray()).toEqual(previous);
  expect(service.planning.getSnapshot()).toEqual(state);
  expect(await db.events.where("type").equals("layout").count()).toBe(1);
});

it("does not undo materials, earned balance, paid construction or research stages", async () => {
  const workshop = (await db.buildings.toArray())[0];
  const trackId = workshop.trackId!;
  const note = await service.createNote(trackId);
  await service.placeBuilding({ ...workshop, x: 8, y: 8 }, epoch);
  const a = await service.saveActivity({
    trackId,
    title: "Результат",
    result: "Проверено",
    kind: "apply",
    date: "2026-09-19",
    achieved: true,
    noteIds: [note.id],
  });
  await service.confirmActivity(a.id);
  await service.upgrade(trackId, id());
  const tables = [
    db.tracks,
    db.learningObjects,
    db.notes,
    db.attachments,
    db.activities,
    db.snapshots,
  ];
  const before = await Promise.all(tables.map((t) => t.toArray()));
  await service.planning.undo(epoch);
  expect(await db.buildings.get(workshop.id)).toEqual(workshop);
  await service.planning.redo(epoch);
  expect((await db.buildings.get(workshop.id))?.x).toBe(8);
  expect(await Promise.all(tables.map((t) => t.toArray()))).toEqual(before);
  expect((await db.learningObjects.get(trackId))?.stage).toBe(2);
});

it("retains history and geometry on failed event persistence and allows retry", async () => {
  const b = decor();
  const fail = () => {
    throw new Error("QuotaExceededError test");
  };
  db.events.hook("creating", fail);
  await expect(service.placeBuilding(b, epoch)).rejects.toThrow(
    "QuotaExceededError",
  );
  expect(await db.buildings.get(b.id)).toBeUndefined();
  expect(service.planning.getSnapshot().undoLabel).toBeNull();
  db.events.hook("creating").unsubscribe(fail);
  await service.placeBuilding(b, epoch);
  const before = service.planning.getSnapshot();
  db.events.hook("creating", fail);
  await expect(service.planning.undo(epoch)).rejects.toThrow(
    "QuotaExceededError",
  );
  expect(await db.buildings.get(b.id)).toEqual(b);
  expect(service.planning.getSnapshot()).toEqual(before);
  db.events.hook("creating").unsubscribe(fail);
  await service.planning.undo(epoch);
  expect(await db.buildings.get(b.id)).toBeUndefined();
});

it("serializes rapid actions and clears redo only after a successful new change", async () => {
  await Promise.all([
    service.placeBuilding(decor(1, 1), epoch),
    service.placeBuilding(decor(2, 1), epoch),
  ]);
  await service.planning.undo(epoch);
  await expect(service.placeBuilding(decor(1, 1), epoch)).rejects.toThrow();
  expect(service.planning.getSnapshot().redoLabel).not.toBeNull();
  await service.placeBuilding(decor(3, 1), epoch);
  expect(service.planning.getSnapshot().redoLabel).toBeNull();
  await Promise.all([
    service.planning.undo(epoch),
    service.planning.undo(epoch),
  ]);
  expect(await db.buildings.count()).toBe(1);
});

it("refuses to overwrite a changed object or occupied restored position from another tab", async () => {
  const other = new CityService(db);
  const b = (await db.buildings.toArray())[0];
  await service.placeBuilding({ ...b, x: 5, y: 5 }, epoch);
  await other.placeBuilding({ ...b, x: 7, y: 7 }, epoch);
  await expect(service.planning.undo(epoch)).rejects.toThrow(/другой вкладке/);
  expect((await db.buildings.get(b.id))?.x).toBe(7);
  await other.placeBuilding({ ...b, x: 5, y: 5 }, epoch);
  const blocker = decor(b.x, b.y);
  await other.placeBuilding(blocker, epoch);
  await expect(service.planning.undo(epoch)).rejects.toThrow(/занято/);
  await other.removeBuilding(blocker.id, epoch);
  await service.planning.undo(epoch);
  expect(await db.buildings.get(b.id)).toEqual(b);
});

it("clears old commands on epoch replacement and rejects pending old-city placement", async () => {
  await service.placeBuilding(decor(), epoch);
  const buildings = await db.buildings.toArray();
  await db.metadata.put({ id: "epoch", value: id() });
  await expect(service.planning.undo(epoch)).rejects.toThrow(/восстановлен/);
  expect(service.planning.getSnapshot().undoLabel).toBeNull();
  await expect(service.placeBuilding(decor(9, 9), epoch)).rejects.toThrow(
    /восстановлен/,
  );
  expect(await db.buildings.toArray()).toEqual(buildings);
});

it("does not replay old commands when a caller already knows the imported epoch", async () => {
  const b = decor();
  await service.placeBuilding(b, epoch);
  const importedEpoch = id();
  await db.metadata.put({ id: "epoch", value: importedEpoch });
  await service.planning.undo(importedEpoch);
  expect(await db.buildings.get(b.id)).toEqual(b);
  expect(service.planning.getSnapshot().undoLabel).toBeNull();
  expect(service.planning.getSnapshot().redoLabel).toBeNull();
});

it("cannot clone a paid building and removing/restoring it preserves its identity", async () => {
  const initial = (await db.buildings.toArray())[0];
  const research = await service.createLearningObject(
    initial.trackId!,
    "Второе исследование",
    epoch,
  );
  const a = await service.saveActivity({
    trackId: initial.trackId!,
    title: "Результат",
    result: "Проверено",
    kind: "apply",
    date: "2026-09-19",
    achieved: true,
    noteIds: [],
  });
  await service.confirmActivity(a.id);
  await service.construct(research.id, id(), undefined, epoch);
  const b = { ...initial, id: id(), learningObjectId: research.id, x: 8, y: 8 };
  await service.placeBuilding(b, epoch);
  await service.planning.undo(epoch);
  expect((await db.learningObjects.get(research.id))?.built).toBe(true);
  expect((await db.tracks.get(initial.trackId!))?.balance).toBe(0);
  await service.planning.redo(epoch);
  await expect(
    service.placeBuilding({ ...b, id: id(), x: 5, y: 5 }, epoch),
  ).rejects.toThrow(/уже есть здание/);
  await service.removeBuilding(b.id, epoch);
  await service.planning.undo(epoch);
  expect(await db.buildings.get(b.id)).toEqual(b);
  expect(await db.learningObjects.count()).toBe(2);
});

it("rolls back every cell when the road event fails and retries as one history entry", async () => {
  const fail = () => {
    throw new Error("QuotaExceededError road");
  };
  const cells = extendRoad([{ x: 1, y: 1 }], { x: 8, y: 3 });
  db.events.hook("creating", fail);
  await expect(
    service.planning.placeRoad(road(), cells, epoch),
  ).rejects.toThrow("QuotaExceededError");
  expect(await db.buildings.count()).toBe(1);
  expect(service.planning.getSnapshot().undoLabel).toBeNull();
  db.events.hook("creating").unsubscribe(fail);
  await service.planning.placeRoad(road(), cells, epoch);
  expect(await db.buildings.count()).toBe(cells.length + 1);
  await service.planning.undo(epoch);
  expect(await db.buildings.count()).toBe(1);
});

it("keeps at most 100 session commands", async () => {
  const original = (await db.buildings.toArray())[0];
  for (let i = 1; i <= 101; i++)
    await service.placeBuilding({ ...original, name: `Имя ${i}` }, epoch);
  for (let i = 0; i < 101; i++) await service.planning.undo(epoch);
  expect((await db.buildings.get(original.id))?.name).toBe("Имя 1");
  expect(service.planning.getSnapshot().undoLabel).toBeNull();
});

it("undoes district geometry independently of buildings and skips no-op changes", async () => {
  const d = {
    id: id(),
    name: "Квартал",
    color: "#507d78",
    x: 1,
    y: 1,
    w: 5,
    h: 5,
  };
  await service.saveDistrict(d, epoch);
  await service.saveDistrict(d, epoch);
  expect(await db.events.where("type").equals("layout").count()).toBe(1);
  await service.planning.undo(epoch);
  expect(await db.districts.count()).toBe(0);
  expect(await db.buildings.count()).toBe(1);
  await service.planning.redo(epoch);
  expect(await db.districts.get(d.id)).toEqual(d);
});
