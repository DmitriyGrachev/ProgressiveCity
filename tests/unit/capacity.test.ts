import { beforeEach, afterEach, it, expect } from "vitest";
import { CityDB } from "../../src/storage/db";
import { CityService } from "../../src/storage/service";
import { id, now, type Note, type Attachment } from "../../src/domain/model";
let db: CityDB, service: CityService, epoch: string;
beforeEach(async () => {
  db = new CityDB(`capacity-${id()}`);
  service = new CityService(db);
  await service.initialize("Город", "Свет");
  epoch = (await db.metadata.get("epoch"))!.value;
});
afterEach(async () => {
  await db.delete();
});
it("rejects an image that would make the city exceed the v3 backup budget without losing its prepared original", async () => {
  const pixel = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE2cAAAAASUVORK5CYII=",
    "base64",
  );
  const blob = new Blob(
    [pixel, new Uint8Array(5 * 1024 * 1024 - pixel.length)],
    { type: "image/png" },
  );
  await db.attachments.bulkAdd(
    Array.from({ length: 51 }, (): Attachment => ({
      id: id(),
      name: "large.png",
      mime: "image/png",
      size: blob.size,
      blob,
    })),
  );
  let retained: Attachment | undefined;
  await expect(
    service.attachImage(
      new File([blob], "one-more.png", { type: "image/png" }),
      epoch,
      (a) => {
        retained = a;
      },
    ),
  ).rejects.toThrow(/256 MiB/);
  expect(retained?.blob.size).toBe(blob.size);
  expect(await db.attachments.count()).toBe(51);
}, 60000);
it("blocks aggregate JSON growth but allows reducing an already oversized legacy library", async () => {
  const track = (await db.tracks.toArray())[0],
    text = "a".repeat(200000),
    date = now();
  const notes: Note[] = Array.from({ length: 86 }, (_, index) => ({
    id: id(),
    trackId: track.id,
    learningObjectId: track.id,
    title: `Материал ${index}`,
    text,
    doc: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    },
    tags: [],
    revision: 0,
    createdAt: date,
    updatedAt: date,
  }));
  await db.notes.bulkAdd(notes);
  const city = (await db.cities.get("city"))!;
  await expect(
    service.updateSettings({
      name: "Более длинное имя города",
      timezone: city.timezone,
      reducedMotion: city.reducedMotion,
    }),
  ).rejects.toThrow(/32 MiB/);
  expect(await db.cities.get("city")).toEqual(city);
  await expect(
    service.saveNote({ ...notes[0], title: "Ещё больший материал" }, epoch),
  ).rejects.toThrow(/32 MiB/);
  expect((await db.notes.get(notes[0].id))?.revision).toBe(0);
  const reduced = await service.saveNote(
    {
      ...notes[0],
      doc: { type: "doc", content: [{ type: "paragraph" }] },
      text: "",
    },
    epoch,
  );
  expect(reduced.text).toBe("");
  expect(reduced.revision).toBe(1);
  expect(await db.notes.count()).toBe(86);
}, 60000);
