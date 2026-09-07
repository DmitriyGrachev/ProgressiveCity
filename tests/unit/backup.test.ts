import { afterEach, beforeEach, expect, it } from "vitest";
import { strToU8, zipSync, unzipSync } from "fflate";
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
it.each([-1, 0, 1])(
  "uses identical data.json byte limits on both sides of the boundary (%i byte)",
  async (offset) => {
    const track = (await db.tracks.toArray())[0];
    const base = await service.createNote(track.id);
    const notes = Array.from({ length: 84 }, (_, i) => ({
      ...base,
      id: `boundary-${i}`,
      text: "я",
      doc: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "я" }] },
        ],
      },
    }));
    await db.notes.clear();
    const { storageEpoch, ...content } = await db.read();
    void storageEpoch;
    const payload = { ...content, notes, attachments: [] };
    const target = 32 * 1024 * 1024 + offset;
    let remaining = target - strToU8(JSON.stringify(payload)).length;
    for (const note of notes) {
      const count = Math.min(99_999, Math.floor(remaining / 4));
      note.text += "я".repeat(count);
      note.doc.content[0].content[0].text = note.text;
      remaining -= count * 4;
    }
    notes[0].title += "x".repeat(remaining);
    expect(strToU8(JSON.stringify(payload)).length).toBe(target);
    await db.notes.bulkPut(notes);
    if (offset > 0) {
      await expect(exportCity(db)).rejects.toThrow(/32 MiB/);
      const zip = zipSync({
        "data.json": strToU8(JSON.stringify(payload)),
        "manifest.json": strToU8("{}"),
      });
      await expect(inspectArchive(new Blob([zip]))).rejects.toThrow(
        /лимит распаковки/,
      );
    } else {
      const blob = await exportCity(db);
      expect(
        unzipSync(new Uint8Array(await blob.arrayBuffer()))["data.json"].length,
      ).toBe(target);
      const imported = await inspectArchive(blob);
      await replaceCity(db, imported);
      expect(await db.notes.toArray()).toEqual(
        notes.sort((a, b) => a.id.localeCompare(b.id)),
      );
    }
  },
  20_000,
);
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
it("refuses an export whose UTF-8 data exceeds its own import limit without changing the city", async () => {
  const track = (await db.tracks.toArray())[0];
  const original = await service.createNote(track.id);
  const text = "я".repeat(100_000);
  await db.notes.bulkPut(
    Array.from({ length: 100 }, (_, i) => ({
      ...original,
      id: `large-${i}`,
      text,
      doc: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      },
    })),
  );
  const before = await db.read();
  await expect(exportCity(db)).rejects.toThrow(/32 MiB/);
  expect(await db.read()).toEqual(before);
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
it("refuses an archive above the combined image limit without modifying stored attachments", async () => {
  const bytes = new Uint8Array(5 * 1024 * 1024);
  bytes.set(png);
  await db.attachments.bulkAdd(
    Array.from({ length: 13 }, (_, i) => ({
      id: `large-image-${i}`,
      name: `image-${i}.png`,
      mime: "image/png",
      size: bytes.length,
      blob: new Blob([bytes], { type: "image/png" }),
    })),
  );
  const before = await db.read();
  await expect(exportCity(db)).rejects.toThrow(/64 MiB/);
  expect(await db.read()).toEqual(before);
  expect(await db.attachments.count()).toBe(13);
  expect((await db.attachments.get("large-image-0"))!.blob.size).toBe(
    bytes.length,
  );
}, 20_000);
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
it("prevents stale copy and pending image upload from writing into the replacement city", async () => {
  const track = (await db.tracks.toArray())[0];
  const note = await service.createNote(track.id);
  const epoch = (await db.read()).storageEpoch;
  await replaceCity(db, await inspectArchive(await exportCity(db)));
  const before = await db.read();
  await expect(
    service.copyNote({ ...note, title: "Old draft" }, epoch),
  ).rejects.toThrow(/другой вкладке/);
  let retained: Blob | undefined;
  await expect(
    addAttachment(
      db,
      new File([png], "pending.png", { type: "image/png" }),
      epoch,
      (a) => {
        retained = a.blob;
      },
    ),
  ).rejects.toThrow(/другой вкладке/);
  expect(await db.read()).toEqual(before);
  expect(await db.attachments.count()).toBe(0);
  expect(new Uint8Array(await retained!.arrayBuffer())).toEqual(png);
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
