import Dexie from "dexie";
import { afterEach, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync } from "fflate";
import { CityDB } from "../../src/storage/db";
import { CityService } from "../../src/storage/service";
import {
  exportCity,
  exportLegacyCity,
  inspectArchive,
  replaceCity,
} from "../../src/storage/backup";
import { migrateV1 } from "../../src/storage/migrate";
import { archiveBytes, legacyStores, pixel } from "../fixtures/legacy-city";
import { migrationBoundary } from "../fixtures/migration-boundary";

const limit = 32 * 1024 * 1024;
const databases: Dexie[] = [];
function database() {
  const db = new CityDB(`migration-limit-${crypto.randomUUID()}`);
  databases.push(db);
  return db;
}
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete();
});
const image = () => ({
  id: "photo-image",
  name: "light.png",
  mime: "image/png",
  size: pixel.length,
  blob: new Blob([pixel], { type: "image/png" }),
});

it.each([-1, 0, 1])(
  "checks the resulting v2 ZIP payload before replacement (%i byte)",
  async (offset) => {
    const legacy = migrationBoundary(limit + offset);
    expect(strToU8(JSON.stringify(legacy)).length).toBeLessThan(limit);
    const db = database();
    await new CityService(db).initialize("Исходный город", "Сохранить");
    await db.attachments.put(image());
    const before = await db.read();
    const zip = await archiveBytes(legacy, 1, {
      "attachments/photo-image": pixel,
    });
    if (offset > 0) {
      await expect(
        inspectArchive(zip).then((archive) => replaceCity(db, archive)),
      ).rejects.toThrow(/32 MiB/);
      // The final write boundary must also reject oversized data passed directly.
      await expect(
        replaceCity(db, { data: migrateV1(legacy), attachments: [image()] }),
      ).rejects.toThrow(/32 MiB/);
      expect(await db.read()).toEqual(before);
    } else {
      await replaceCity(db, await inspectArchive(zip));
      const exported = await exportCity(db);
      expect(
        unzipSync(new Uint8Array(await exported.arrayBuffer()))["data.json"]
          .length,
      ).toBe(limit + offset);
      const roundTrip = await inspectArchive(exported);
      expect(
        roundTrip.data.notes.map(({ learningObjectId: _object, ...note }) => {
          void _object;
          return note;
        }),
      ).toEqual([...legacy.notes].sort((a, b) => a.id.localeCompare(b.id)));
    }
    expect(
      new Uint8Array(
        await (await db.attachments.get("photo-image"))!.blob.arrayBuffer(),
      ),
    ).toEqual(pixel);
  },
  30_000,
);

it("rejects an otherwise valid legacy ZIP at exactly 32 MiB that expands during migration", async () => {
  const legacy = migrationBoundary(limit, 1);
  expect(strToU8(JSON.stringify(legacy)).length).toBe(limit);
  expect(strToU8(JSON.stringify(migrateV1(legacy))).length).toBeGreaterThan(
    limit,
  );
  await expect(
    inspectArchive(
      await archiveBytes(legacy, 1, { "attachments/photo-image": pixel }),
    ).then(() => undefined),
  ).rejects.toThrow(/32 MiB/);
}, 30_000);

it.each([-1, 0, 1])(
  "checks the complete migrated database including attachment metadata (%i byte)",
  async (offset) => {
    const legacy = migrationBoundary(limit + offset);
    const db = database();
    const old = new Dexie(db.name);
    old.version(1).stores(legacyStores);
    await old.transaction("rw", old.tables, async () => {
      await old.table("cities").add(legacy.city);
      for (const key of [
        "tracks",
        "buildings",
        "districts",
        "notes",
        "activities",
        "events",
        "snapshots",
      ] as const)
        await old.table(key).bulkAdd(legacy[key]);
      await old.table("attachments").add(image());
      await old
        .table("metadata")
        .add({ id: "epoch", value: "unchanged-epoch" });
    });
    old.close();
    if (offset > 0) {
      await expect(db.open().then(() => undefined)).rejects.toThrow(/32 MiB/);
      db.close();
      try {
        await old.open();
        expect(old.verno).toBe(1);
        expect(old.tables.map((t) => t.name)).not.toContain("learningObjects");
        expect(old.table("buildings").schema.idxByName.trackId.unique).toBe(
          true,
        );
        expect(await old.table("cities").get("city")).toEqual(legacy.city);
        for (const key of [
          "tracks",
          "buildings",
          "districts",
          "notes",
          "activities",
          "events",
          "snapshots",
        ] as const)
          expect(await old.table(key).toArray()).toEqual(
            [...legacy[key]].sort((a, b) => a.id.localeCompare(b.id)),
          );
        expect(await old.table("metadata").get("epoch")).toEqual({
          id: "epoch",
          value: "unchanged-epoch",
        });
        expect(
          new Uint8Array(
            await (
              await old.table("attachments").get("photo-image")
            ).blob.arrayBuffer(),
          ),
        ).toEqual(pixel);
      } finally {
        old.close();
      }
      const backup = unzipSync(
        new Uint8Array(await (await exportLegacyCity(db.name)).arrayBuffer()),
      );
      expect(JSON.parse(strFromU8(backup["manifest.json"])).version).toBe(1);
      const recovered = JSON.parse(strFromU8(backup["data.json"]));
      expect(recovered.notes).toEqual(
        [...legacy.notes].sort((a, b) => a.id.localeCompare(b.id)),
      );
      expect(recovered.city).toEqual(legacy.city);
      expect(backup["attachments/photo-image"]).toEqual(pixel);
    } else {
      await db.open();
      expect((await db.read()).storageEpoch).toBe("unchanged-epoch");
      const zip = await exportCity(db);
      expect(
        unzipSync(new Uint8Array(await zip.arrayBuffer()))["data.json"].length,
      ).toBe(limit + offset);
      expect((await inspectArchive(zip)).data.notes).toHaveLength(84);
    }
  },
  30_000,
);

it("legacy recovery neither creates a missing database nor downgrades a current city", async () => {
  const name = `missing-${crypto.randomUUID()}`;
  await expect(exportLegacyCity(name)).rejects.toThrow();
  expect(await Dexie.exists(name)).toBe(false);
  const db = database();
  await new CityService(db).initialize("Новый город", "Свет");
  const before = await db.read();
  await expect(exportLegacyCity(db.name)).rejects.toThrow(/Старая версия/);
  expect(await db.read()).toEqual(before);
});
