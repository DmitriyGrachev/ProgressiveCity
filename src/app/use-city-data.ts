import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../storage/db";
import type { CityData } from "../domain/model";
import type { Table } from "dexie";

function readRecords<T, TInsert>(table: Table<T, string, TInsert>) {
  return db.transaction("r", [table, db.metadata], async () => ({
    value: await table.toArray(),
    epoch: (await db.metadata.get("epoch"))?.value ?? "",
  }));
}

// Independent subscriptions: a note save does not reload snapshots, events or geometry.
export function useCityData(): CityData | undefined {
  const shell = useLiveQuery(() =>
    db.transaction("r", [db.cities, db.metadata], async () => ({
      city: await db.cities.get("city"),
      storageEpoch: (await db.metadata.get("epoch"))?.value ?? "",
    })),
  );
  const tracks = useLiveQuery(() => readRecords(db.tracks));
  const buildings = useLiveQuery(() => readRecords(db.buildings));
  const districts = useLiveQuery(() => readRecords(db.districts));
  const notes = useLiveQuery(() => readRecords(db.notes));
  const activities = useLiveQuery(() => readRecords(db.activities));
  const events = useLiveQuery(() => readRecords(db.events));
  const snapshots = useLiveQuery(() => readRecords(db.snapshots));
  if (
    !shell ||
    !tracks ||
    !buildings ||
    !districts ||
    !notes ||
    !activities ||
    !events ||
    !snapshots
  )
    return;
  if (
    [tracks, buildings, districts, notes, activities, events, snapshots].some(
      (part) => part.epoch !== shell.storageEpoch,
    )
  )
    return;
  return {
    ...shell,
    tracks: tracks.value,
    buildings: buildings.value,
    districts: districts.value,
    notes: notes.value,
    activities: activities.value,
    events: events.value,
    snapshots: snapshots.value,
  };
}
