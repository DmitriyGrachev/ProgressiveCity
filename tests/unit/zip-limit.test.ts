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
import { legacyCity, legacyStores, pixel } from "../fixtures/legacy-city";
import { migrateV1 } from "../../src/storage/migrate";
import { dataSchema as legacySchema } from "../../src/storage/legacy-validation";
import { zipBoundary } from "../fixtures/zip-boundary";

const limit = 64 * 1024 * 1024;
const databases: Dexie[] = [];
function database() {
  const db = new CityDB(`zip-limit-${crypto.randomUUID()}`);
  databases.push(db);
  return db;
}
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete();
});

it("does not trust declared image sizes when replacing a city", async () => {
  const db = database();
  await new CityService(db).initialize("Сохранить", "Свет");
  const before = await db.read();
  const data = migrateV1(legacySchema.parse(legacyCity()));
  const attachments = [
    {
      ...data.attachments[0],
      blob: new Blob([pixel, new Uint8Array(1)], { type: "image/png" }),
    },
  ];
  await expect(replaceCity(db, { data, attachments })).rejects.toThrow(
    /Метаданные вложения/,
  );
  expect(await db.read()).toEqual(before);
  expect(await db.attachments.count()).toBe(0);
});
async function seedLegacy(
  db: CityDB,
  fixture: Awaited<ReturnType<typeof zipBoundary>>,
) {
  const old = new Dexie(db.name);
  old.version(1).stores(legacyStores);
  try {
    await old.transaction("rw", old.tables, async () => {
      await old.table("cities").add(fixture.legacy.city);
      for (const key of [
        "tracks",
        "buildings",
        "districts",
        "notes",
        "activities",
        "events",
        "snapshots",
      ] as const)
        await old.table(key).bulkAdd(fixture.legacy[key]);
      await old.table("attachments").bulkAdd(fixture.attachments);
      await old
        .table("metadata")
        .add({ id: "epoch", value: "original-zip-epoch" });
    });
  } finally {
    old.close();
  }
}

it("a v1 ZIP just below 64 MiB cannot be accepted into an unexportable v2 city", async () => {
  const fixture = await zipBoundary(limit - 1024, 1);
  expect(fixture.zip.size).toBe(limit - 1024);
  expect(strToU8(JSON.stringify(fixture.legacy)).length).toBeLessThan(
    32 * 1024 * 1024,
  );
  expect(strToU8(JSON.stringify(fixture.migrated)).length).toBeLessThan(
    32 * 1024 * 1024,
  );
  const old = database();
  await seedLegacy(old, fixture);
  expect((await exportLegacyCity(old.name)).size).toBe(limit - 1024);
  const db = database();
  await new CityService(db).initialize("Текущий город", "Сохранить");
  const before = await db.read();
  const outcome = await inspectArchive(fixture.zip).then(
    (archive) => ({ archive, error: undefined }),
    (error: unknown) => ({ archive: undefined, error }),
  );
  if (outcome.archive) {
    await replaceCity(db, outcome.archive);
    // This fails on bffbc26: admission succeeded, but the real export exceeds 64 MiB.
    await expect(
      exportCity(db).then((zip) => zip.size),
    ).resolves.toBeLessThanOrEqual(limit);
  } else
    expect(outcome.error).toMatchObject({
      message: expect.stringContaining("64 MiB"),
    });
  expect(await db.read()).toEqual(before);
}, 30_000);

it.each([-1, 0, 1])(
  "admits ZIP import only when the real v2 STORE archive fits (%i byte)",
  async (offset) => {
    const fixture = await zipBoundary(limit + offset);
    const old = database();
    await seedLegacy(old, fixture);
    const v1 = await exportLegacyCity(old.name);
    expect(v1.size).toBeLessThan(limit);
    const db = database();
    await new CityService(db).initialize("Не заменять при отказе", "Свет");
    await db.attachments.add(fixture.attachments[0]);
    const before = await db.read();
    if (offset > 0) {
      await expect(
        inspectArchive(v1).then((data) => replaceCity(db, data)),
      ).rejects.toThrow(/64 MiB/);
      await expect(
        replaceCity(db, {
          data: fixture.migrated,
          attachments: fixture.attachments,
        }),
      ).rejects.toThrow(/64 MiB/);
      expect(await db.read()).toEqual(before);
      expect(await db.attachments.count()).toBe(1);
    } else {
      await replaceCity(db, await inspectArchive(v1));
      const exported = await exportCity(db);
      expect(exported.size).toBe(limit + offset);
      const restored = database();
      await replaceCity(restored, await inspectArchive(exported));
      expect((await restored.read()).notes).toEqual((await db.read()).notes);
      expect(await restored.attachments.count()).toBe(13);
      for (const image of fixture.attachments)
        expect(
          Buffer.from(
            await (await restored.attachments.get(
              image.id,
            ))!.blob.arrayBuffer(),
          ).equals(fixture.images[`attachments/${image.id}`]),
        ).toBe(true);
    }
  },
  30_000,
);

it.each([-1, 0, 1])(
  "upgrades only when the complete future archive fits and otherwise preserves v1 (%i byte)",
  async (offset) => {
    const fixture = await zipBoundary(limit + offset);
    const db = database();
    await seedLegacy(db, fixture);
    const v1 = await exportLegacyCity(db.name);
    if (offset > 0) {
      await expect(db.open().then(() => undefined)).rejects.toThrow(/64 MiB/);
      db.close();
      const old = new Dexie(db.name);
      old.version(1).stores(legacyStores);
      try {
        await old.open();
        expect(old.verno).toBe(1);
        expect(old.tables.map((t) => t.name)).not.toContain("learningObjects");
        expect(old.table("buildings").schema.idxByName.trackId.unique).toBe(
          true,
        );
        expect(await old.table("cities").get("city")).toEqual(
          fixture.legacy.city,
        );
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
            [...fixture.legacy[key]].sort((a, b) => a.id.localeCompare(b.id)),
          );
        expect(await old.table("metadata").get("epoch")).toEqual({
          id: "epoch",
          value: "original-zip-epoch",
        });
        for (const a of fixture.attachments)
          expect(
            Buffer.from(
              await (
                await old.table("attachments").get(a.id)
              ).blob.arrayBuffer(),
            ).equals(fixture.images[`attachments/${a.id}`]),
          ).toBe(true);
      } finally {
        old.close();
      }
      const saved = await exportLegacyCity(db.name);
      expect(saved.size).toBe(v1.size);
      const files = unzipSync(new Uint8Array(await saved.arrayBuffer()));
      expect(JSON.parse(strFromU8(files["manifest.json"])).version).toBe(1);
      expect(JSON.parse(strFromU8(files["data.json"]))).toEqual(
        JSON.parse(
          strFromU8(
            unzipSync(new Uint8Array(await v1.arrayBuffer()))["data.json"],
          ),
        ),
      );
      for (const a of fixture.attachments)
        expect(
          Buffer.from(files[`attachments/${a.id}`]).equals(
            fixture.images[`attachments/${a.id}`],
          ),
        ).toBe(true);
    } else {
      await db.open();
      expect((await db.read()).storageEpoch).toBe("original-zip-epoch");
      const exported = await exportCity(db);
      expect(exported.size).toBe(limit + offset);
      expect((await inspectArchive(exported)).data.notes).toHaveLength(200);
    }
  },
  30_000,
);
