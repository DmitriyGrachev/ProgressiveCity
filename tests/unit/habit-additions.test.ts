import { afterEach, describe, expect, it, vi } from "vitest";
import { CityDB } from "../../src/storage/db";
import { CityService } from "../../src/storage/service";
import { dataSchema, validateRelations } from "../../src/storage/validation";
import {
  exportCity,
  inspectArchive,
  replaceCity,
} from "../../src/storage/backup";
import {
  buildingKey,
  compareSnapshots,
  snapshotLayout,
} from "../../src/domain/comparison";

const databases: CityDB[] = [];
async function ready() {
  const db = new CityDB(`additions-${crypto.randomUUID()}`);
  databases.push(db);
  const service = new CityService(db);
  await service.initialize("Тест", "Исследование");
  const track = await service.createTrack({
    name: "Ходьба",
    type: "habit",
    description: "",
    goal: "",
    schedule: "",
    unit: "",
    comparison: "min",
  });
  for (let day = 1; day <= 5; day++) {
    const a = await service.saveActivity({
      trackId: track.id,
      title: `День ${day}`,
      result: "Прогулка",
      kind: "apply",
      date: `2026-10-0${day}`,
      achieved: true,
      noteIds: [],
    });
    await service.confirmActivity(a.id);
  }
  await service.upgrade(track.id, crypto.randomUUID());
  await service.upgrade(track.id, crypto.randomUUID());
  return { db, service, track, epoch: (await db.read()).storageEpoch };
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) await db.delete();
});
describe("owned habit additions", () => {
  it("charges atomically once across retries, retains the paid amount and actual positive source", async () => {
    const { db, service, track, epoch } = await ready();
    const balance = (await db.tracks.get(track.id))!.balance;
    const command = crypto.randomUUID();
    const [a, b] = await Promise.all([
      service.buyHabitAddition(track.id, "park", command, epoch),
      service.buyHabitAddition(track.id, "park", command, epoch),
    ]);
    expect(a.id).toBe(b.id);
    expect(a.amount).toBe(-3);
    expect(a.sourceActivityId).toBeTruthy();
    expect((await db.tracks.get(track.id))!.balance).toBe(balance - 3);
    await service.updateRules([1, 2, 3], [3, 6], 4);
    expect(
      (await service.buyHabitAddition(track.id, "park", command, epoch)).amount,
    ).toBe(-3);
    await expect(
      service.buyHabitAddition(track.id, "plaza", command, epoch),
    ).rejects.toThrow();
    await service.updateRules([1, 2, 3], [3, 6], 3);
    const before = await db.read();
    vi.spyOn(db.events, "add").mockRejectedValueOnce(new Error("write failed"));
    await expect(
      service.buyHabitAddition(track.id, "park", crypto.randomUUID(), epoch),
    ).rejects.toThrow("write failed");
    expect(await db.read()).toEqual(before);
    await expect(
      service.buyHabitAddition(
        track.id,
        "park",
        crypto.randomUUID(),
        "old epoch",
      ),
    ).rejects.toThrow();
    await service.updateRules([1, 2, 3], [3, 6], 4);
    await expect(
      service.buyHabitAddition(track.id, "park", crypto.randomUUID(), epoch),
    ).rejects.toThrow(/очков/);
  });
  it("keeps a separate owner through placement, undo, reload, re-placement, snapshots and ZIP", async () => {
    const { db, service, track, epoch } = await ready();
    const addition = await service.buyHabitAddition(
      track.id,
      "park",
      crypto.randomUUID(),
      epoch,
    );
    const base = {
      id: crypto.randomUUID(),
      trackId: track.id,
      kind: "workshop" as const,
      name: "Дом привычки",
      color: "#bc7153",
      x: 2,
      y: 2,
      w: 2,
      h: 2,
    };
    const park = {
      ...base,
      id: crypto.randomUUID(),
      habitAdditionId: addition.id,
      kind: "park" as const,
      name: "Заработанный сад",
      x: 5,
    };
    await service.placeBuilding(base, epoch);
    await service.placeBuilding(park, epoch);
    await expect(
      service.placeBuilding({ ...park, id: crypto.randomUUID(), x: 8 }, epoch),
    ).rejects.toThrow();
    await expect(
      service.placeBuilding({ ...park, kind: "plaza" }, epoch, park),
    ).rejects.toThrow();
    const before = snapshotLayout(
      await db.read(),
      "a",
      "До",
      "2026-10-10T00:00:00.000Z",
    );
    expect(before.buildings.find((b) => b.habitAdditionId)?.stage).toBe(1);
    await service.removeBuilding(park.id, epoch);
    await service.planning.undo(epoch);
    await service.planning.redo(epoch);
    await service.placeBuilding(
      { ...park, id: crypto.randomUUID(), x: 8 },
      epoch,
    );
    const after = snapshotLayout(
      await db.read(),
      "b",
      "После",
      "2026-10-11T00:00:00.000Z",
    );
    expect(buildingKey(park)).not.toBe(buildingKey(base));
    expect(
      compareSnapshots(before, after).find((c) => c.key === buildingKey(park))
        ?.flags,
    ).toEqual(["moved"]);
    expect((await db.tracks.get(track.id))!.balance).toBe(3);
    const inspected = await inspectArchive(await exportCity(db));
    validateRelations(dataSchema.parse(inspected.data));
    const clone = new CityDB(`addition-copy-${crypto.randomUUID()}`);
    databases.push(clone);
    await replaceCity(clone, inspected);
    expect((await clone.read()).buildings).toEqual((await db.read()).buildings);
  });
  it("rejects forged ownership, duplicate entitlements and non-positive funding sources on import", async () => {
    const { db, service, track, epoch } = await ready();
    const purchase = await service.buyHabitAddition(
      track.id,
      "park",
      crypto.randomUUID(),
      epoch,
    );
    const b = {
      id: crypto.randomUUID(),
      habitAdditionId: purchase.id,
      trackId: track.id,
      kind: "park" as const,
      name: "Сад",
      color: "#578b7c",
      x: 5,
      y: 5,
      w: 2,
      h: 2,
    };
    await expect(
      service.placeBuilding({ ...b, trackId: undefined }, epoch),
    ).rejects.toThrow();
    await service.placeBuilding(b, epoch);
    const archive = await inspectArchive(await exportCity(db));
    const invalid = structuredClone(archive.data);
    invalid.buildings.push({ ...b, id: crypto.randomUUID(), x: 9 });
    expect(() => validateRelations(dataSchema.parse(invalid))).toThrow();
    const wrong = structuredClone(archive.data);
    wrong.events.find((e) => e.id === purchase.id)!.sourceActivityId =
      "missing";
    expect(() => validateRelations(dataSchema.parse(wrong))).toThrow();
  });
});
