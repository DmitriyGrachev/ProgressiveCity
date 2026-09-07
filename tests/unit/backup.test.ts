import { afterEach, beforeEach, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { CityDB } from "../../src/storage/db";
import { CityService } from "../../src/storage/service";
import {
  exportCity,
  inspectArchive,
  replaceCity,
} from "../../src/storage/backup";
import { addAttachment } from "../../src/storage/attachments";
import {
  validateDocument,
  validateRelations,
  dataSchema,
} from "../../src/storage/validation";

let db: CityDB;
let service: CityService;
const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE2cAAAAASUVORK5CYII=",
  ),
  (c) => c.charCodeAt(0),
);
beforeEach(async () => {
  db = new CityDB(`backup-${crypto.randomUUID()}`);
  service = new CityService(db);
  await service.initialize("Тестовый город", "Фотография");
});
afterEach(async () => {
  await db.delete();
});
it("round trips the complete city including stable image bytes and note JSON", async () => {
  const a = await addAttachment(
    db,
    new File([png], "pixel.png", { type: "image/png" }),
  );
  const t = (await db.tracks.toArray())[0];
  const note = await service.createNote(t.id);
  await service.saveNote({
    ...note,
    doc: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Мой этюд" }] },
        { type: "attachmentImage", attrs: { attachmentId: a.id, alt: "Этюд" } },
      ],
    },
    text: "Мой этюд",
  });
  const archive = await exportCity(db);
  const validated = await inspectArchive(archive);
  const target = new CityDB(`restore-${crypto.randomUUID()}`);
  try {
    await replaceCity(target, validated);
    expect((await target.read()).notes).toEqual((await db.read()).notes);
    const restored = await target.attachments.get(a.id);
    expect(new Uint8Array(await restored!.blob.arrayBuffer())).toEqual(png);
    expect(JSON.stringify((await target.notes.toArray())[0].doc)).not.toContain(
      "blob:",
    );
  } finally {
    await target.delete();
  }
});
it("rejects corrupt, unsupported and traversing archives before touching current data", async () => {
  const before = await db.read();
  const bad = [
    new Blob(["broken"]),
    new Blob([zipSync({ "../escape": strToU8("x") })]),
    new Blob([
      zipSync({ "manifest.json": strToU8(JSON.stringify({ version: 99 })) }),
    ]),
  ];
  for (const archive of bad)
    await expect(inspectArchive(archive)).rejects.toThrow();
  expect(await db.read()).toEqual(before);
});
it("rejects disguised or oversized image uploads", async () => {
  await expect(
    addAttachment(db, new File(["<svg/>"], "x.png", { type: "image/png" })),
  ).rejects.toThrow();
  await expect(
    addAttachment(db, new File([png], "x.svg", { type: "image/svg+xml" })),
  ).rejects.toThrow();
  await expect(
    addAttachment(
      db,
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], "x.png", {
        type: "image/png",
      }),
    ),
  ).rejects.toThrow();
});
it("rejects malformed editor structure rather than silently restoring a blank note", () => {
  expect(
    validateDocument({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }],
    }),
  ).toBe(false);
  expect(
    validateDocument({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "paragraph" }] }],
    }),
  ).toBe(false);
});
it("rejects a confirmed activity with no event", async () => {
  const track = (await db.tracks.toArray())[0];
  const activity = await service.saveActivity({
    trackId: track.id,
    title: "Результат",
    result: "Вывод",
    kind: "apply",
    date: "2026-09-08",
    achieved: true,
    noteIds: [],
  });
  const { storageEpoch, ...content } = await db.read();
  void storageEpoch;
  const raw = { ...content, attachments: [] };
  raw.activities[0] = { ...activity, confirmed: true };
  expect(() => validateRelations(dataSchema.parse(raw))).toThrow();
});
it("rejects unexportable note fields before marking them saved", async () => {
  const track = (await db.tracks.toArray())[0];
  const note = await service.createNote(track.id);
  await expect(
    service.saveNote({ ...note, tags: ["x".repeat(251)] }),
  ).rejects.toThrow();
  expect((await db.notes.get(note.id))?.tags).toEqual([]);
});
it("rolls back the entire replacement on an IndexedDB write failure", async () => {
  const archive = await inspectArchive(await exportCity(db));
  const before = await db.read();
  const fail = () => {
    throw new Error("replacement write failure");
  };
  db.tracks.hook("creating", fail);
  await expect(replaceCity(db, archive)).rejects.toThrow(
    "replacement write failure",
  );
  db.tracks.hook("creating").unsubscribe(fail);
  expect(await db.read()).toEqual(before);
});
it("rejects a stale editor after import even when the archived revision matches", async () => {
  const track = (await db.tracks.toArray())[0];
  const note = await service.createNote(track.id);
  const epoch = (await db.read()).storageEpoch;
  const archive = await inspectArchive(await exportCity(db));
  await replaceCity(db, archive);
  await expect(
    service.saveNote({ ...note, title: "Старый редактор" }, epoch),
  ).rejects.toThrow("другой вкладке");
  expect((await db.notes.get(note.id))?.title).toBe("Без названия");
});
it("restores earned stages and events without replaying rewards", async () => {
  const track = (await db.tracks.toArray())[0];
  const activity = await service.saveActivity({
    trackId: track.id,
    title: "Применение",
    result: "Сделал самостоятельно",
    kind: "apply",
    date: "2026-09-08",
    achieved: true,
    noteIds: [],
  });
  await service.confirmActivity(activity.id);
  await service.upgrade(track.id, "upgrade-once");
  const events = await db.events.toArray();
  const snapshots = await db.snapshots.toArray();
  const archive = await inspectArchive(await exportCity(db));
  await replaceCity(db, archive);
  await service.confirmActivity(activity.id);
  await service.upgrade(track.id, "upgrade-once");
  expect(await db.events.toArray()).toEqual(events);
  expect(await db.snapshots.toArray()).toEqual(snapshots);
  expect(await db.tracks.get(track.id)).toMatchObject({ balance: 0, stage: 2 });
});
