import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CityDB } from "../../src/storage/db";
import { CityService } from "../../src/storage/service";

let db: CityDB;
let service: CityService;
beforeEach(async () => {
  db = new CityDB(`test-${crypto.randomUUID()}`);
  service = new CityService(db);
  await service.initialize("Мой город", "Рисование");
});
afterEach(async () => {
  await db.delete();
});
async function activity() {
  const track = (await db.tracks.toArray())[0];
  return service.saveActivity({
    trackId: track.id,
    title: "Этюд",
    result: "Нарисовал свет и тень",
    kind: "apply",
    date: "2026-09-08",
    noteIds: [],
    achieved: true,
  });
}
describe("transactional progression", () => {
  it("confirms concurrently once and spends once per command", async () => {
    const a = await activity();
    const second = new CityService(new CityDB(db.name));
    await Promise.all([
      service.confirmActivity(a.id),
      second.confirmActivity(a.id),
    ]);
    expect((await db.tracks.get(a.trackId))?.balance).toBe(3);
    expect(await db.events.where("type").equals("activity").count()).toBe(1);
    await Promise.all([
      service.upgrade(a.trackId, "same-command"),
      second.upgrade(a.trackId, "same-command"),
    ]);
    expect((await db.tracks.get(a.trackId))?.stage).toBe(2);
    expect((await db.tracks.get(a.trackId))?.balance).toBe(0);
    await expect(
      service.upgrade(a.trackId, "different-command"),
    ).rejects.toThrow();
    second.db.close();
  });
  it("edits confirmed activity without reward and preserves old rule version", async () => {
    const a = await activity();
    await service.confirmActivity(a.id);
    await service.updateRules([5, 6, 7], [4, 8]);
    await service.saveActivity({ ...a, result: "Дополненный результат" });
    await service.confirmActivity(a.id);
    expect((await db.tracks.get(a.trackId))?.balance).toBe(3);
    const event = (
      await db.events.where("type").equals("activity").toArray()
    )[0];
    expect(event.amount).toBe(3);
    expect(event.ruleVersion).toBe(1);
    const b = await activity();
    await service.confirmActivity(b.id);
    expect((await db.tracks.get(a.trackId))?.balance).toBe(10);
  });
  it("habit has at most one reward per immutable local date, with no penalties", async () => {
    const t = await service.createTrack({
      name: "Меньше скроллинга",
      type: "reduce",
      description: "",
      goal: "Не больше 20 минут",
      schedule: "Ежедневно",
      unit: "мин",
      limit: 20,
      comparison: "max",
    });
    const input = {
      trackId: t.id,
      title: "День",
      result: "Сам отмечаю цель",
      kind: "apply" as const,
      date: "2026-09-08",
      noteIds: [],
      achieved: true,
      value: 10,
    };
    const a = await service.saveActivity(input);
    const b = await service.saveActivity(input);
    await Promise.all([
      service.confirmActivity(a.id),
      service.confirmActivity(b.id),
    ]);
    expect((await db.tracks.get(t.id))?.balance).toBe(3);
    await expect(
      service.saveActivity({ ...a, date: "2026-09-09" }),
    ).rejects.toThrow();
    const c = await service.saveActivity({
      ...input,
      date: "2026-09-09",
      achieved: false,
      value: 40,
    });
    await service.confirmActivity(c.id);
    expect((await db.tracks.get(t.id))?.balance).toBe(3);
  });
  it("rolls back confirmation when the event write fails", async () => {
    const a = await activity();
    const fail = () => {
      throw new Error("QuotaExceededError test");
    };
    db.events.hook("creating", fail);
    await expect(service.confirmActivity(a.id)).rejects.toThrow(
      "QuotaExceededError",
    );
    expect((await db.activities.get(a.id))?.confirmed).toBe(false);
    expect((await db.tracks.get(a.trackId))?.balance).toBe(0);
    db.events.hook("creating").unsubscribe(fail);
    await service.confirmActivity(a.id);
    expect((await db.tracks.get(a.trackId))?.balance).toBe(3);
  });
  it("moving, removing and archiving preserve notes and historical layout", async () => {
    const t = (await db.tracks.toArray())[0];
    const b = (await db.buildings.toArray())[0];
    const note = await service.createNote(t.id);
    const initial = (await db.snapshots.toArray())[0];
    await service.placeBuilding({ ...b, x: 5, y: 7 });
    await service.removeBuilding(b.id);
    await service.updateTrack({ ...t, archived: true });
    expect(await db.notes.get(note.id)).toBeDefined();
    expect((await db.snapshots.get(initial.id))?.buildings[0].x).toBe(b.x);
    expect(await db.buildings.count()).toBe(0);
  });
});
