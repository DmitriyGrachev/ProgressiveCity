import { beforeEach, afterEach, it, expect } from "vitest";
import { CityDB } from "../../src/storage/db";
import { CityService } from "../../src/storage/service";
import { id } from "../../src/domain/model";
let db: CityDB, service: CityService, epoch: string;
beforeEach(async () => {
  db = new CityDB(`activity-recovery-${id()}`);
  service = new CityService(db);
  await service.initialize("Город", "Свет");
  epoch = (await db.metadata.get("epoch"))!.value;
});
afterEach(async () => {
  await db.delete();
});
const input = async () => {
  const track = (await db.tracks.toArray())[0];
  return {
    id: id(),
    trackId: track.id,
    learningObjectId: track.id,
    title: "Опыт",
    result: "Проверил отражение",
    kind: "apply" as const,
    date: "2026-10-29",
    timezone: "Europe/Chisinau",
    noteIds: [],
    achieved: true,
  };
};
it("commits the caller stable Activity ID once and returns an identical crash retry", async () => {
  const draft = await input();
  const [a, b] = await Promise.all([
    service.saveActivity(draft, epoch, null),
    service.saveActivity(draft, epoch, null),
  ]);
  expect(a.id).toBe(draft.id);
  expect(b).toEqual(a);
  expect(await db.activities.count()).toBe(1);
  await service.confirmActivity(a.id, epoch);
  await service.saveActivity(draft, epoch, null);
  await service.confirmActivity(a.id, epoch);
  expect(
    await db.events.where("type").equals("activity").toArray(),
  ).toHaveLength(1);
});
it("a stale initial recovery conflicts instead of overwriting a newer commit with the same ID", async () => {
  const draft = await input();
  const saved = await service.saveActivity(draft, epoch, null);
  await service.saveActivity(
    { ...saved, result: "Более новая редакция" },
    epoch,
    saved,
  );
  const before = await db.read();
  await expect(service.saveActivity(draft, epoch, null)).rejects.toThrow(
    /измен|существ/,
  );
  expect(await db.read()).toEqual(before);
});
