import {
  compareSnapshots,
  snapshotLayout,
  type ComparisonSession,
} from "../domain/comparison";
import { id, now } from "../domain/model";
import type { CityDB } from "./db";

/** Read-only transaction freezes both geometry and stages at one consistent point. */
export function readComparison(
  db: CityDB,
  beforeId: string,
  afterId: string | null,
  expectedEpoch: string,
): Promise<ComparisonSession> {
  return db.transaction(
    "r",
    [
      db.cities,
      db.metadata,
      db.snapshots,
      db.tracks,
      db.learningObjects,
      db.buildings,
      db.districts,
      db.events,
      db.activities,
    ],
    async () => {
      const storageEpoch = (await db.metadata.get("epoch"))?.value;
      if (storageEpoch !== expectedEpoch)
        throw new Error(
          "Город заменён. Выберите состояния для сравнения заново.",
        );
      const before = await db.snapshots.get(beforeId);
      const savedAfter = afterId ? await db.snapshots.get(afterId) : undefined;
      if (!before || (afterId && !savedAfter))
        throw new Error("Выбранный снимок больше не доступен.");
      const scene = {
        storageEpoch,
        city: await db.cities.get("city"),
        tracks: await db.tracks.toArray(),
        learningObjects: await db.learningObjects.toArray(),
        buildings: await db.buildings.toArray(),
        districts: await db.districts.toArray(),
      };
      if (!scene.city) throw new Error("Город не найден.");
      const capturedAt = now();
      const after =
        savedAfter ??
        snapshotLayout(
          scene,
          "comparison-current",
          `Текущий город «${scene.city.name}»`,
          capturedAt,
        );
      return {
        id: id(),
        before,
        after,
        current: !afterId,
        capturedAt,
        scene,
        events: await db.events.toArray(),
        activities: await db.activities.toArray(),
        changes: compareSnapshots(before, after),
      };
    },
  );
}
