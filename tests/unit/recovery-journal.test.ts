import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CityDB } from "../../src/storage/db";
import { CityService } from "../../src/storage/service";
import {
  exportCity,
  inspectArchive,
  replaceCity,
} from "../../src/storage/backup";
import {
  RecoveryJournal,
  type RecoveryPayload,
} from "../../src/storage/recovery-journal";
import { id, type Attachment } from "../../src/domain/model";
import { RecoveryWriter } from "../../src/notes/durable";
import { restoreNoteDraft } from "../../src/storage/restore-draft";

let db: CityDB;
let journal: RecoveryJournal;
let epoch: string;
const form = (text: string): RecoveryPayload => ({
  kind: "form",
  label: "Запись дня",
  text,
});
beforeEach(async () => {
  db = new CityDB(`journal-${id()}`);
  await new CityService(db).initialize("Город", "Свет");
  epoch = (await db.metadata.get("epoch"))!.value;
  journal = new RecoveryJournal(db);
});
afterEach(async () => {
  await db.delete();
});

it("keeps separate branches and rejects late writes and cleanup of a newer sequence", async () => {
  const a = id(),
    b = id();
  await journal.put(a, epoch, 1, form("Первый ввод"));
  await journal.put(b, epoch, 1, form("Другая вкладка"));
  await journal.put(a, epoch, 3, form("Новый ввод"));
  await journal.clearThrough(a, 2);
  await journal.put(a, epoch, 2, form("Поздний старый ввод"));
  expect((await journal.list()).map((r) => r.payload)).toEqual(
    expect.arrayContaining([form("Новый ввод"), form("Другая вкладка")]),
  );
  await expect(journal.discard(a, 1)).rejects.toThrow(/измен/);
  await journal.clearThrough(a, 3);
  await journal.put(a, epoch, 3, form("Запоздавший ввод"));
  expect((await journal.list()).map((r) => r.id)).toEqual([b]);
});

it("survives closing the connection and same-ID city replacement with exact original image bytes", async () => {
  const branch = id();
  const attachment: Attachment = {
    id: id(),
    name: "test.png",
    mime: "image/png",
    size: 4,
    blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" }),
  };
  const canonical = await db.read();
  await journal.put(branch, epoch, 1, form("Не сохранять в новый город"), [
    attachment,
  ]);
  expect(await db.read()).toEqual(canonical);
  const archive = await inspectArchive(await exportCity(db));
  await replaceCity(db, archive);
  expect((await db.read()).storageEpoch).not.toBe(epoch);
  db.close();
  await db.open();
  journal = new RecoveryJournal(db);
  expect((await journal.list())[0]).toMatchObject({
    id: branch,
    epoch,
    payload: form("Не сохранять в новый город"),
  });
  const [restored] = await journal.attachments(branch);
  expect(new Uint8Array(await restored.blob.arrayBuffer())).toEqual(
    new Uint8Array([1, 2, 3, 4]),
  );
  expect(await db.attachments.count()).toBe(0);
  expect(await db.events.toArray()).toEqual(canonical.events);
});

it("rolls back a failed journal write without deleting the older version or canonical data", async () => {
  const branch = id();
  await journal.put(branch, epoch, 1, form("Защищённый ввод"));
  const before = await db.read();
  const failure = vi
    .spyOn(db.recovery, "put")
    .mockRejectedValueOnce(
      new DOMException("Synthetic quota", "QuotaExceededError"),
    );
  await expect(
    journal.put(branch, epoch, 2, form("Новый ввод")),
  ).rejects.toThrow();
  failure.mockRestore();
  expect((await journal.list())[0].payload).toEqual(form("Защищённый ввод"));
  expect(await db.read()).toEqual(before);
});

it("does not acknowledge an older draft as protection for a newly selected image still being prepared", async () => {
  const statuses: string[] = [];
  const writer = new RecoveryWriter(
    epoch,
    (status) => statuses.push(status),
    db,
  );
  writer.update(form("Текст до выбора изображения"));
  writer.begin();
  await writer.flush();
  expect(statuses.at(-1)).toBe("Страховка сохраняется…");
  writer.update(form("Текст с подготовленным изображением"));
  await writer.flush();
  expect(statuses.at(-1)).toContain("защищён");
  await writer.discard();
  writer.detach();
});

it("remembers a clear even if it arrives before its first delayed put", async () => {
  const branch = id();
  await journal.clearThrough(branch, 2);
  await journal.put(branch, epoch, 1, form("Задержанный ввод"));
  expect(await journal.list()).toHaveLength(0);
  await journal.put(branch, epoch, 3, form("Действительно новая правка"));
  expect((await journal.list())[0].payload).toEqual(
    form("Действительно новая правка"),
  );
});

it("never overwrites a newer canonical note and makes recovered-copy retry idempotent", async () => {
  const service = new CityService(db);
  const track = (await db.tracks.toArray())[0];
  const note = await service.createNote(track.id, track.id, epoch);
  const draft = {
    ...note,
    title: "Мой черновик",
    doc: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Мой ввод" }] },
      ],
    },
    text: "Мой ввод",
  };
  await journal.put(id(), epoch, 1, {
    kind: "note",
    label: draft.title,
    note: draft,
  });
  const record = (await journal.list())[0];
  await service.saveNote(
    { ...note, title: "Сохранено в другой вкладке" },
    epoch,
  );
  const before = await db.read();
  await expect(restoreNoteDraft(db, record)).rejects.toThrow(/изменена/);
  expect(await db.read()).toEqual(before);
  const originalClear = RecoveryJournal.prototype.clearThrough;
  const cleanup = vi
    .spyOn(RecoveryJournal.prototype, "clearThrough")
    .mockRejectedValueOnce(new Error("Synthetic cleanup failure"));
  await expect(restoreNoteDraft(db, record, true)).rejects.toThrow(
    /восстановлена.*не удалена/,
  );
  cleanup.mockImplementation(originalClear);
  const copy = await restoreNoteDraft(db, record, true);
  expect(copy.text).toBe("Мой ввод");
  expect(await db.notes.count()).toBe(2);
  expect(await db.events.toArray()).toEqual(before.events);
  expect(await journal.list()).toHaveLength(0);
  cleanup.mockRestore();
});

it("restores only explicitly pending images, not originals deliberately removed from the document", async () => {
  const service = new CityService(db);
  const track = (await db.tracks.toArray())[0];
  const note = await service.createNote(track.id, track.id, epoch);
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE2cAAAAASUVORK5CYII=",
    "base64",
  );
  const image = (name: string): Attachment => ({
    id: id(),
    name,
    mime: "image/png",
    size: bytes.length,
    blob: new Blob([bytes], { type: "image/png" }),
  });
  const pending = image("pending.png"),
    removed = image("removed.png");
  await journal.put(
    id(),
    epoch,
    1,
    {
      kind: "note",
      label: note.title,
      note,
      pendingAttachmentIds: [pending.id],
    },
    [pending, removed],
  );
  const record = (await journal.list())[0];
  const restored = await restoreNoteDraft(db, record);
  const images = restored.doc.content
    ?.filter((n) => n.type === "attachmentImage")
    .map((n) => n.attrs?.attachmentId);
  expect(images).toEqual([pending.id]);
  expect(
    new Uint8Array(
      await (await db.attachments.get(pending.id))!.blob.arrayBuffer(),
    ),
  ).toEqual(new Uint8Array(bytes));
  expect(await journal.list()).toHaveLength(0);
  expect(await db.attachments.get(removed.id)).toBeUndefined();
});

it("reuses immutable image bytes across clean cycles and protects shared cache references", async () => {
  let writes = 0;
  db.recoveryAttachments.hook("creating", () => {
    writes++;
  });
  db.recoveryAttachments.hook("updating", () => {
    writes++;
  });
  const image: Attachment = {
    id: id(),
    name: "original.png",
    mime: "image/png",
    size: 4,
    blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" }),
  };
  const a = id(),
    b = id();
  await journal.put(a, epoch, 1, form("Первый ввод"), [image]);
  await journal.clearThrough(a, 2);
  await journal.put(a, epoch, 3, form("Следующий ввод"), [image]);
  await journal.put(b, epoch, 1, form("Другая вкладка"), [image]);
  expect(writes).toBe(1);
  await journal.clearThrough(a, 4);
  await journal.pruneCache();
  expect(await journal.attachments(b)).toHaveLength(1);
  await journal.clearThrough(b, 2);
  await journal.pruneCache();
  expect(await db.recoveryAttachments.count()).toBe(0);
});
