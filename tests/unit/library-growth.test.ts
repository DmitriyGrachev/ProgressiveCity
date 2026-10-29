import { afterEach, beforeEach, it, expect } from "vitest";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { CityDB } from "../../src/storage/db";
import { CityService } from "../../src/storage/service";
import {
  exportCity,
  inspectArchive,
  replaceCity,
} from "../../src/storage/backup";
import {
  archiveLimits,
  ARCHIVE_LIMIT,
  EXPANDED_LIMIT,
  DATA_LIMIT,
} from "../../src/storage/limits";
import { id, type Attachment } from "../../src/domain/model";
let db: CityDB;
beforeEach(async () => {
  db = new CityDB(`library-${id()}`);
  await new CityService(db).initialize("Синтетическая библиотека", "Свет");
});
afterEach(async () => {
  await db.delete();
});

it("uses larger bounded v3 limits while legacy and materials constants stay unchanged", () => {
  expect(archiveLimits(1)).toEqual({
    zip: 64 * 1024 * 1024,
    expanded: 128 * 1024 * 1024,
  });
  expect(archiveLimits(2)).toEqual(archiveLimits(1));
  expect(archiveLimits(3)).toEqual({
    zip: 256 * 1024 * 1024,
    expanded: 512 * 1024 * 1024,
  });
  expect([ARCHIVE_LIMIT, EXPANDED_LIMIT, DATA_LIMIT]).toEqual(
    [64, 128, 32].map((n) => n * 1024 * 1024),
  );
});

it("round trips more than64MiB of real image originals in v3 and refuses the same payload labelled legacy", async () => {
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE2cAAAAASUVORK5CYII=",
    "base64",
  );
  const images: Attachment[] = Array.from({ length: 18 }, (_, index) => {
    const padding = new Uint8Array(4 * 1024 * 1024 - bytes.length);
    padding[padding.length - 1] = index;
    const blob = new Blob([bytes, padding], { type: "image/png" });
    return {
      id: id(),
      name: `original-${index}.png`,
      mime: "image/png",
      size: blob.size,
      blob,
    };
  });
  await db.attachments.bulkAdd(images);
  const service = new CityService(db),
    track = (await db.tracks.toArray())[0];
  const note = await service.createNote(track.id, track.id);
  await service.saveNote({
    ...note,
    doc: {
      type: "doc",
      content: [
        ...images.map((a) => ({
          type: "attachmentImage",
          attrs: { attachmentId: a.id, alt: a.name },
        })),
        { type: "paragraph" },
      ],
    },
  });
  const before = await db.read();
  const blob = await exportCity(db);
  expect(blob.size).toBeGreaterThan(64 * 1024 * 1024);
  const inspected = await inspectArchive(blob);
  expect(inspected.attachments).toHaveLength(18);
  for (const original of images) {
    const restored = inspected.attachments.find((a) => a.id === original.id)!;
    expect(restored).toMatchObject({
      name: original.name,
      size: original.size,
      mime: original.mime,
    });
    const digest = async (blob: Blob) =>
      Buffer.from(
        await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
      ).toString("hex");
    expect(await digest(restored.blob)).toBe(await digest(original.blob));
  }
  await replaceCity(db, inspected);
  const after = await db.read();
  expect({ ...after, storageEpoch: before.storageEpoch }).toEqual(before);
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  expect(manifest.version).toBe(3);
  manifest.version = 2;
  files["manifest.json"] = strToU8(JSON.stringify(manifest));
  await expect(
    inspectArchive(new Blob([zipSync(files, { level: 0 })])),
  ).rejects.toThrow(/64 MiB/);
  expect(await db.read()).toEqual(after);
}, 120000);
