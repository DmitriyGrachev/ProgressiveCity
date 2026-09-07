import Dexie, { type EntityTable } from "dexie";
import type {
  Activity,
  Attachment,
  Building,
  City,
  CityData,
  District,
  Note,
  ProgressEvent,
  Snapshot,
  Track,
} from "../domain/model";

export class CityDB extends Dexie {
  cities!: EntityTable<City, "id">;
  tracks!: EntityTable<Track, "id">;
  buildings!: EntityTable<Building, "id">;
  districts!: EntityTable<District, "id">;
  notes!: EntityTable<Note, "id">;
  attachments!: EntityTable<Attachment, "id">;
  activities!: EntityTable<Activity, "id">;
  events!: EntityTable<ProgressEvent, "id">;
  snapshots!: EntityTable<Snapshot, "id">;
  metadata!: EntityTable<{ id: "epoch"; value: string }, "id">;
  constructor(name = "progress-city-v1") {
    super(name);
    this.version(1).stores({
      cities: "id",
      tracks: "id",
      buildings: "id,&trackId",
      districts: "id",
      notes: "id,trackId,updatedAt,*tags",
      attachments: "id",
      activities: "id,trackId,date",
      events: "id,type,trackId,createdAt",
      snapshots: "id,createdAt",
      metadata: "id",
    });
  }
  async read(): Promise<CityData> {
    return this.transaction("r", this.tables, async () => {
      const [
        city,
        tracks,
        buildings,
        districts,
        notes,
        activities,
        events,
        snapshots,
      ] = await Promise.all([
        this.cities.get("city"),
        this.tracks.toArray(),
        this.buildings.toArray(),
        this.districts.toArray(),
        this.notes.toArray(),
        this.activities.toArray(),
        this.events.toArray(),
        this.snapshots.toArray(),
      ]);
      return {
        city,
        storageEpoch: (await this.metadata.get("epoch"))?.value ?? "",
        tracks,
        buildings,
        districts,
        notes,
        activities,
        events,
        snapshots,
      };
    });
  }
}
export const db = new CityDB();
