import Dexie, { type EntityTable } from "dexie";
import type {
  Activity,
  Attachment,
  Building,
  City,
  CityData,
  District,
  LearningObject,
  Note,
  ProgressEvent,
  Snapshot,
  Track,
} from "../domain/model";
import { migrateV1 } from "./migrate";
import type { ArchiveData as LegacyData } from "./legacy-validation";

export class CityDB extends Dexie {
  cities!: EntityTable<City, "id">;
  tracks!: EntityTable<Track, "id">;
  learningObjects!: EntityTable<LearningObject, "id">;
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
    this.version(2)
      .stores({
        learningObjects: "id,trackId",
        buildings: "id,trackId,&learningObjectId",
        notes: "id,trackId,learningObjectId,updatedAt,*tags",
        activities: "id,trackId,learningObjectId,date",
        events: "id,type,trackId,learningObjectId,createdAt",
      })
      .upgrade(async (transaction) => {
        const legacy = {
          city: await transaction
            .table<LegacyData["city"]>("cities")
            .get("city"),
          tracks: await transaction
            .table<LegacyData["tracks"][number]>("tracks")
            .toArray(),
          buildings: await transaction
            .table<LegacyData["buildings"][number]>("buildings")
            .toArray(),
          notes: await transaction
            .table<LegacyData["notes"][number]>("notes")
            .toArray(),
          activities: await transaction
            .table<LegacyData["activities"][number]>("activities")
            .toArray(),
          events: await transaction
            .table<LegacyData["events"][number]>("events")
            .toArray(),
          snapshots: await transaction
            .table<LegacyData["snapshots"][number]>("snapshots")
            .toArray(),
          districts: await transaction
            .table<LegacyData["districts"][number]>("districts")
            .toArray(),
        };
        const data = migrateV1(legacy);
        if (data.city) await transaction.table("cities").put(data.city);
        for (const key of [
          "tracks",
          "learningObjects",
          "buildings",
          "notes",
          "activities",
          "events",
          "snapshots",
        ] as const)
          await transaction.table(key).bulkPut(data[key]);
      });
  }
  async read(): Promise<CityData> {
    return this.transaction("r", this.tables, async () => {
      const [
        city,
        tracks,
        learningObjects,
        buildings,
        districts,
        notes,
        activities,
        events,
        snapshots,
      ] = await Promise.all([
        this.cities.get("city"),
        this.tracks.toArray(),
        this.learningObjects.toArray(),
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
        learningObjects,
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
