import { afterEach, beforeEach, expect, it } from "vitest";
import { CityDB } from "../../src/storage/db";
import { CityService } from "../../src/storage/service";
import {
  exportCity,
  inspectArchive,
  replaceCity,
} from "../../src/storage/backup";
import { id } from "../../src/domain/model";
import { previewImage } from "../../src/city/preview-cache";

let db: CityDB;
let service: CityService;
let epoch: string;
beforeEach(async () => {
  db = new CityDB(`constructor-${id()}`);
  service = new CityService(db);
  await service.initialize("Город", "Рисунок");
  epoch = (await db.metadata.get("epoch"))!.value;
});
afterEach(async () => {
  await db.delete();
});

it("keeps custom accents through layout undo redo and ZIP without changing ownership or progress", async () => {
  const before = (await db.buildings.toArray())[0];
  const protectedData = [
    await db.tracks.toArray(),
    await db.learningObjects.toArray(),
    await db.snapshots.toArray(),
  ];
  await service.placeBuilding({ ...before, kind: "library", color: "#127abc" });
  await service.planning.undo(epoch);
  expect(await db.buildings.get(before.id)).toEqual(before);
  await service.planning.redo(epoch);
  const changed = { ...before, kind: "library", color: "#127abc" };
  expect(await db.buildings.get(before.id)).toEqual(changed);
  const archive = await inspectArchive(await exportCity(db));
  await replaceCity(db, archive);
  expect(await db.buildings.get(before.id)).toEqual(changed);
  expect([
    await db.tracks.toArray(),
    await db.learningObjects.toArray(),
    await db.snapshots.toArray(),
  ]).toEqual(protectedData);
});
it("rejects malformed accents atomically and keeps both command stacks", async () => {
  const before = (await db.buildings.toArray())[0];
  await service.placeBuilding({ ...before, color: "#112233" });
  await service.planning.undo(epoch);
  const history = service.planning.getSnapshot();
  const events = await db.events.toArray();
  for (const color of ["red", "#123", "#GG0000", "#11223344", "url(x)"])
    await expect(service.placeBuilding({ ...before, color })).rejects.toThrow();
  expect(await db.buildings.get(before.id)).toEqual(before);
  expect(await db.events.toArray()).toEqual(events);
  expect(service.planning.getSnapshot()).toEqual(history);
});
it("reuses pending and completed preview work for equal visual variants, independent of color casing", async () => {
  let renders = 0;
  const render = async () => {
    renders++;
    return "image";
  };
  const variant = { kind: "library" as const, stage: 3, color: "#Ab1290" };
  const first = previewImage(variant, render);
  expect(previewImage({ ...variant, color: "#ab1290" }, render)).toBe(first);
  await first;
  await previewImage(variant, render);
  expect(renders).toBe(1);
  await previewImage({ ...variant, stage: 2 }, render);
  expect(renders).toBe(2);
});
it("retries a failed image extraction and bounds the retained preview cache", async () => {
  const variant = { kind: "workshop" as const, stage: 1, color: "#fedcba" };
  await expect(
    previewImage(variant, async () => {
      throw new Error("renderer unavailable");
    }),
  ).rejects.toThrow("renderer unavailable");
  let renders = 0;
  const render = async () => {
    renders++;
    return "image";
  };
  await previewImage(variant, render);
  for (let i = 0; i < 100; i++)
    await previewImage(
      { ...variant, color: `#${i.toString(16).padStart(6, "0")}` },
      render,
    );
  const count = renders;
  await previewImage(variant, render);
  expect(renders).toBe(count + 1);
});
