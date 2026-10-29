import type { CityDB } from "./db";
import { validateDocument } from "./validation";
import { RecoveryJournal, withAttachmentCleanupLock } from "./recovery-journal";

export interface CleanupPlan {
  epoch: string;
  candidates: { id: string; name: string; mime: string; size: number }[];
  bytes: number;
}
export async function scanUnusedAttachments(
  db: CityDB,
  epoch: string,
): Promise<CleanupPlan> {
  return db.transaction(
    "r",
    [
      db.metadata,
      db.notes,
      db.attachments,
      db.recovery,
      db.recoveryAttachments,
    ],
    async () => {
      if ((await db.metadata.get("epoch"))?.value !== epoch)
        throw new Error("Город изменён. Повторите просмотр очистки.");
      const originals = await db.attachments.toArray();
      const available = new Set(originals.map((a) => a.id)),
        referenced = new Set<string>();
      const visit = (node: {
        type?: string;
        attrs?: Record<string, unknown>;
        content?: unknown[];
      }) => {
        if (node.type === "attachmentImage")
          referenced.add(String(node.attrs?.attachmentId));
        for (const child of node.content ?? []) visit(child as typeof node);
      };
      for (const note of await db.notes.toArray()) {
        if (!validateDocument(note.doc, available))
          throw new Error(
            "Документ или ссылка на изображение повреждены. Очистка остановлена без удаления.",
          );
        visit(note.doc);
      }
      const journal = new RecoveryJournal(db);
      for (const record of await journal.list())
        if (record.epoch === epoch)
          for (const original of await journal.attachments(record.id))
            referenced.add(original.id);
      const candidates = originals
        .filter((a) => !referenced.has(a.id))
        .map(({ id, name, mime, size }) => ({ id, name, mime, size }));
      return {
        epoch,
        candidates,
        bytes: candidates.reduce((n, a) => n + a.size, 0),
      };
    },
  );
}
export async function removeUnusedAttachments(db: CityDB, plan: CleanupPlan) {
  return withAttachmentCleanupLock(db.name, () =>
    db.transaction(
      "rw",
      [...db.cityTables, db.recovery, db.recoveryAttachments, db.clientState],
      async () => {
        const current = await scanUnusedAttachments(db, plan.epoch);
        const unused = new Map(current.candidates.map((a) => [a.id, a]));
        if (
          plan.candidates.some(
            (a) => JSON.stringify(unused.get(a.id)) !== JSON.stringify(a),
          )
        )
          throw new Error(
            "План очистки изменён: изображение уже используется или изменено. Повторите просмотр.",
          );
        await db.attachments.bulkDelete(plan.candidates.map((a) => a.id));
        const cacheBytes = await new RecoveryJournal(db).pruneCache();
        return {
          removed: plan.candidates.length,
          bytes: plan.bytes,
          cacheBytes,
        };
      },
    ),
  );
}
