import { CityDB } from "./db";
import { CityService } from "./service";
import { RecoveryJournal, type RecoveryRecord } from "./recovery-journal";
import { validateImage } from "./attachments";
import type { Note } from "../domain/model";
import { assertCityCapacity } from "./capacity";

const sameBody = (a: Note, b: Note) =>
  a.title === b.title &&
  JSON.stringify(a.doc) === JSON.stringify(b.doc) &&
  JSON.stringify(a.tags) === JSON.stringify(b.tags) &&
  a.trackId === b.trackId &&
  a.learningObjectId === b.learningObjectId;
/** Explicit recovery; the original epoch and base revision are never adopted silently. */
export async function restoreNoteDraft(
  db: CityDB,
  expected: RecoveryRecord,
  copy = false,
): Promise<Note> {
  if (expected.payload?.kind !== "note")
    throw new Error("Это не черновик заметки.");
  const journal = new RecoveryJournal(db);
  const attachments = await journal.attachments(expected.id);
  for (const attachment of attachments)
    await validateImage(attachment.blob, attachment.mime);
  const result = await db.transaction(
    "rw",
    [...db.cityTables, db.recovery, db.recoveryAttachments],
    async () => {
      const record = await db.recovery.get(expected.id);
      if (
        record?.sequence !== expected.sequence ||
        record.payload?.kind !== "note"
      )
        throw new Error("Черновик изменился. Откройте его новую версию.");
      if ((await db.metadata.get("epoch"))?.value !== record.epoch)
        throw new Error(
          "Черновик относится к прежнему городу. Выгрузите его для ручного переноса.",
        );
      let draft = structuredClone(record.payload.note);
      const referenced = new Set<string>();
      const visit = (node: typeof draft.doc) => {
        if (node.type === "attachmentImage")
          referenced.add(String(node.attrs?.attachmentId));
        for (const child of node.content ?? []) visit(child);
      };
      visit(draft.doc);
      const pending = (record.payload.pendingAttachmentIds ?? []).filter(
        (id) => !referenced.has(id),
      );
      const images = pending.map((id) => {
        const image = attachments.find((a) => a.id === id);
        if (!image)
          throw new Error(
            "Оригинал незавершённой загрузки не найден. Черновик оставлен.",
          );
        return {
          type: "attachmentImage",
          attrs: { attachmentId: id, alt: image.name },
        };
      });
      if (images.length)
        draft = {
          ...draft,
          doc: {
            ...draft.doc,
            content: [
              ...(draft.doc.content ?? []),
              ...images,
              { type: "paragraph" },
            ],
          },
        };
      const current = await db.notes.get(
        copy ? `recovered-${record.id}-${record.sequence}` : draft.id,
      );
      if (
        !copy &&
        (!current ||
          (current.revision !== draft.revision && !sameBody(current, draft)))
      )
        throw new Error(
          "Заметка уже изменена. Восстановите черновик отдельной копией.",
        );
      const needed = new Set([...referenced, ...pending]);
      let added = false;
      for (const attachment of attachments) {
        if (!needed.has(attachment.id)) continue;
        const existing = await db.attachments.get(attachment.id);
        if (
          existing &&
          (existing.size !== attachment.size ||
            existing.mime !== attachment.mime)
        )
          throw new Error(
            "Изображение с этим ID изменено. Выгрузите черновик.",
          );
        if (!existing) {
          await db.attachments.add(attachment);
          added = true;
        }
      }
      if (current && sameBody(current, draft)) {
        if (added) await assertCityCapacity(db);
        return current;
      }
      const service = new CityService(db);
      let target = draft;
      if (copy) {
        const created = await service.createNote(
          draft.trackId,
          draft.learningObjectId,
          record.epoch,
        );
        await db.notes.delete(created.id);
        target = {
          ...draft,
          id: `recovered-${record.id}-${record.sequence}`,
          revision: 0,
          createdAt: created.createdAt,
        };
        await db.notes.add({ ...created, id: target.id });
      }
      return service.saveNote(target, record.epoch);
    },
  );
  try {
    await journal.clearThrough(expected.id, expected.sequence);
  } catch (error) {
    throw new Error(
      `Заметка восстановлена, но аварийная копия не удалена. ${error instanceof Error ? error.message : "Повторите очистку копии."}`,
      { cause: error },
    );
  }
  return result;
}
