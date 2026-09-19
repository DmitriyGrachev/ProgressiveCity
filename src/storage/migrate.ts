import type { LearningObject } from "../domain/model";
import { isLearning } from "../domain/model";
import type { ArchiveData as LegacyData } from "./legacy-validation";

/** Pure v1 -> v2 transformation, shared by IndexedDB and ZIP import. */
export function migrateV1<
  T extends Omit<LegacyData, "attachments" | "city"> & {
    city?: LegacyData["city"];
  },
>(data: T) {
  const learningTracks = new Set(
    data.tracks.filter(isLearning).map((t) => t.id),
  );
  const link = <R extends { trackId?: string }>(
    record: R,
  ): R & { learningObjectId?: string } =>
    record.trackId && learningTracks.has(record.trackId)
      ? { ...record, learningObjectId: record.trackId }
      : record;
  const learningObjects: LearningObject[] = data.tracks
    .filter(isLearning)
    .map((t) => ({
      id: t.id,
      trackId: t.id,
      name: t.name,
      nextQuestion: "",
      stage: t.stage,
      built: true,
      initial: true,
      createdAt: t.createdAt,
    }));
  return {
    ...data,
    city: data.city
      ? { ...data.city, rules: { ...data.city.rules, constructionCost: 3 } }
      : undefined,
    tracks: data.tracks.map((t) =>
      isLearning(t) ? { ...t, stage: 1 as const } : t,
    ),
    learningObjects,
    buildings: data.buildings.map(link),
    notes: data.notes.map(link),
    activities: data.activities.map(link),
    events: data.events.map(link),
    snapshots: data.snapshots.map((s) => ({
      ...s,
      buildings: s.buildings.map(link),
    })),
  };
}
