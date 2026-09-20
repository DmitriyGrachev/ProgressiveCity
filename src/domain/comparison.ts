import type { Building, CityData, District, Snapshot } from "./model";

export type VisualBuilding = Snapshot["buildings"][number];
export type ChangeFlag =
  "appeared" | "removed" | "stage" | "moved" | "appearance";
interface Difference<T> {
  key: string;
  before?: T;
  after?: T;
  flags: ChangeFlag[];
  decorative: boolean;
}
export type CityChange =
  | (Difference<VisualBuilding> & { entity: "building" })
  | (Difference<District> & { entity: "district" });
export type ComparisonView = "before" | "after" | "changes";
export type SceneData = Pick<
  CityData,
  | "city"
  | "tracks"
  | "learningObjects"
  | "buildings"
  | "districts"
  | "storageEpoch"
>;
export interface ComparisonSession {
  id: string;
  before: Snapshot;
  after: Snapshot;
  current: boolean;
  capturedAt: string;
  scene: SceneData;
  events: CityData["events"];
  activities: CityData["activities"];
  changes: CityChange[];
}
export const changeLabels: Record<ChangeFlag, string> = {
  appeared: "+ Появилось на карте",
  removed: "− Снято с карты",
  stage: "Э Изменился этап",
  moved: "↔ Перемещено",
  appearance: "◐ Изменено оформление",
};
export function buildingKey(b: Building) {
  return b.learningObjectId
    ? `learning:${b.learningObjectId}`
    : b.trackId
      ? `track:${b.trackId}`
      : `decor:${b.id}`;
}
function flags(
  a: District | VisualBuilding | undefined,
  b: District | VisualBuilding | undefined,
): ChangeFlag[] {
  if (!a) return ["appeared"];
  if (!b) return ["removed"];
  const result: ChangeFlag[] = [];
  if ("stage" in a && "stage" in b && a.stage !== b.stage) result.push("stage");
  if (a.x !== b.x || a.y !== b.y) result.push("moved");
  if (
    a.name !== b.name ||
    a.color !== b.color ||
    a.w !== b.w ||
    a.h !== b.h ||
    ("kind" in a && "kind" in b && a.kind !== b.kind)
  )
    result.push("appearance");
  return result;
}
/** Pure A -> B comparison. Presence is map placement, never a mastery claim. */
export function compareSnapshots(a: Snapshot, b: Snapshot): CityChange[] {
  const result: CityChange[] = [];
  const before = new Map(a.buildings.map((v) => [buildingKey(v), v]));
  const after = new Map(b.buildings.map((v) => [buildingKey(v), v]));
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const first = before.get(key),
      last = after.get(key),
      changes = flags(first, last);
    if (changes.length)
      result.push({
        key,
        entity: "building",
        before: first,
        after: last,
        flags: changes,
        decorative: !(first ?? last)!.trackId,
      });
  }
  const districtsA = new Map(a.districts.map((d) => [d.id, d]));
  const districtsB = new Map(b.districts.map((d) => [d.id, d]));
  for (const id of new Set([...districtsA.keys(), ...districtsB.keys()])) {
    const first = districtsA.get(id),
      last = districtsB.get(id),
      changes = flags(first, last);
    if (changes.length)
      result.push({
        key: `district:${id}`,
        entity: "district",
        before: first,
        after: last,
        flags: changes,
        decorative: true,
      });
  }
  return result;
}
export const visibleChanges = (changes: CityChange[], showDecor: boolean) =>
  changes.filter((c) => showDecor || !c.decorative);

export function snapshotLayout(
  data: Pick<
    CityData,
    "tracks" | "learningObjects" | "buildings" | "districts"
  >,
  id: string,
  name: string,
  createdAt: string,
): Snapshot {
  const objects = new Map(data.learningObjects.map((o) => [o.id, o.stage]));
  const tracks = new Map(data.tracks.map((t) => [t.id, t.stage]));
  return {
    id,
    name,
    createdAt,
    buildings: data.buildings.map((b) => ({
      ...b,
      stage:
        (b.learningObjectId
          ? objects.get(b.learningObjectId)
          : tracks.get(b.trackId ?? "")) ?? 1,
    })),
    districts: data.districts.map((d) => ({ ...d })),
  };
}

export function relatedEvents(change: CityChange, session: ComparisonSession) {
  if (change.entity !== "building") return [];
  const b = (change.after ?? change.before)!;
  if (!b.trackId) return [];
  const times = [session.before.createdAt, session.after.createdAt].sort();
  return session.events
    .filter(
      (e) =>
        e.createdAt >= times[0] &&
        e.createdAt <= times[1] &&
        (b.learningObjectId
          ? e.learningObjectId === b.learningObjectId
          : e.trackId === b.trackId && !e.learningObjectId),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
