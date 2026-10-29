import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { CityDB } from "../../src/storage/db";
import { CityService } from "../../src/storage/service";
import { RecoveryJournal } from "../../src/storage/recovery-journal";
import {
  scanUnusedAttachments,
  removeUnusedAttachments,
} from "../../src/storage/maintenance";
import {
  exportCity,
  inspectArchive,
  replaceCity,
} from "../../src/storage/backup";
import {
  backupStatus,
  verifyBackupForCurrentCity,
} from "../../src/storage/backup-status";
import { id, type Attachment } from "../../src/domain/model";
let db: CityDB, service: CityService, epoch: string;
const image = (): Attachment => {
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE2cAAAAASUVORK5CYII=",
    "base64",
  );
  return {
    id: id(),
    name: "test.png",
    mime: "image/png",
    size: bytes.length,
    blob: new Blob([bytes], { type: "image/png" }),
  };
};
beforeEach(async () => {
  db = new CityDB(`maintenance-${id()}`);
  service = new CityService(db);
  await service.initialize("Город", "Свет");
  epoch = (await db.metadata.get("epoch"))!.value;
  vi.stubGlobal("navigator", {
    locks: {
      request: async (
        name: string,
        _options: LockOptions,
        callback: (lock: {
          name: string;
          mode: "exclusive";
        }) => Promise<unknown>,
      ) => callback({ name, mode: "exclusive" }),
    },
  });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await db.delete();
});
it("protects current notes and recovery originals, rechecks a stale deletion plan, and rolls back failures", async () => {
  const [used, draft, unused] = [image(), image(), image()];
  await db.attachments.bulkAdd([used, draft, unused]);
  const track = (await db.tracks.toArray())[0];
  const note = await service.createNote(track.id, track.id, epoch);
  const doc = {
    type: "doc",
    content: [
      {
        type: "attachmentImage",
        attrs: { attachmentId: used.id, alt: used.name },
      },
      { type: "paragraph" },
    ],
  };
  const saved = await service.saveNote({ ...note, doc }, epoch);
  await new RecoveryJournal(db).put(
    id(),
    epoch,
    1,
    {
      kind: "note",
      label: "Не вставлено",
      note: saved,
      pendingAttachmentIds: [draft.id],
    },
    [draft],
  );
  const plan = await scanUnusedAttachments(db, epoch);
  expect(plan.candidates.map((a) => a.id)).toEqual([unused.id]);
  await service.saveNote(
    {
      ...saved,
      doc: {
        ...doc,
        content: [
          ...doc.content,
          {
            type: "attachmentImage",
            attrs: { attachmentId: unused.id, alt: unused.name },
          },
        ],
      },
    },
    epoch,
  );
  await expect(removeUnusedAttachments(db, plan)).rejects.toThrow(
    /измен|использ/,
  );
  expect(await db.attachments.count()).toBe(3);
  const spare = image();
  await db.attachments.add(spare);
  const fresh = await scanUnusedAttachments(db, epoch);
  const before = await db.read();
  const failure = vi
    .spyOn(db.attachments, "bulkDelete")
    .mockRejectedValueOnce(new Error("Synthetic deletion failure"));
  await expect(removeUnusedAttachments(db, fresh)).rejects.toThrow("Synthetic");
  failure.mockRestore();
  expect(await db.attachments.count()).toBe(4);
  expect(await db.read()).toEqual(before);
  await removeUnusedAttachments(db, fresh);
  expect(await db.attachments.count()).toBe(3);
  expect(await db.read()).toEqual(before);
});
it("only a checked matching file marks a backup current, data changes and a new epoch invalidate it", async () => {
  const archive = await inspectArchive(await exportCity(db));
  expect((await backupStatus(db)).verifiedAt).toBeUndefined();
  expect(await verifyBackupForCurrentCity(db, archive)).toBe(true);
  expect((await backupStatus(db)).current).toBe(true);
  await service.updateSettings({
    name: "Новое имя",
    timezone: "Europe/Chisinau",
    reducedMotion: false,
  });
  expect((await backupStatus(db)).current).toBe(false);
  expect(await verifyBackupForCurrentCity(db, archive)).toBe(false);
  const next = await inspectArchive(await exportCity(db));
  await verifyBackupForCurrentCity(db, next);
  expect((await backupStatus(db)).current).toBe(true);
  await replaceCity(db, next);
  expect((await backupStatus(db)).current).toBe(false);
  expect(await db.clientState.count()).toBeGreaterThan(0);
});
