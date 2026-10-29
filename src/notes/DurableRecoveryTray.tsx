import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../storage/db";
import {
  RecoveryJournal,
  type RecoveryRecord,
} from "../storage/recovery-journal";
import { act, navigate, transition, useUI } from "../app/ui";
import { downloadFile } from "../app/download";
import { exportRecoveredNote } from "./recovery";
import { restoreNoteDraft } from "../storage/restore-draft";
import { isLiveRecoveryWriter, useLiveRecoveryWriters } from "./durable";
import { useMemoryRecoveredForms } from "../app/pending-forms";
import { useFormRecovery } from "../app/form-recovery";
import {
  formRecoveryTarget,
  activityDraftState,
  researchDraftState,
} from "../domain/draft-forms";
const journal = new RecoveryJournal(db);

export function DurableRecoveryTray({ excludeIds }: { excludeIds: string[] }) {
  const records = useLiveQuery(() => journal.list());
  const epoch = useLiveQuery(() => db.metadata.get("epoch"));
  const memory = useMemoryRecoveredForms();
  useLiveRecoveryWriters();
  const [busy, setBusy] = useState(false);
  const readonly = useUI(
    (s) => Boolean(s.comparison || s.snapshotId) || s.transitioning,
  );
  const visible = (records ?? []).filter(
    (r) =>
      !isLiveRecoveryWriter(r.id) &&
      !excludeIds.includes(r.id) &&
      !memory.some((m) => m.id === r.id),
  );
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await act(action);
    } finally {
      setBusy(false);
    }
  }
  async function restore(record: RecoveryRecord, copy = false) {
    await transition(async () => {
      const note = await restoreNoteDraft(db, record, copy);
      useUI.getState().set({
        panel: "track",
        trackId: note.trackId,
        objectId: note.learningObjectId ?? null,
        noteId: note.id,
        resultRequest: null,
        dayRequest: null,
      });
    });
  }
  async function resume(record: RecoveryRecord) {
    if (record.payload?.kind !== "form") return;
    const target = formRecoveryTarget.parse(record.payload.state?.target);
    if (target.kind === "activity")
      activityDraftState.parse(record.payload.state);
    else researchDraftState.parse(record.payload.state);
    await transition(async () => {
      if (
        (await db.metadata.get("epoch"))?.value !== record.epoch ||
        (await db.recovery.get(record.id))?.sequence !== record.sequence
      )
        throw new Error(
          "Город или черновик изменён. Выберите актуальную запись.",
        );
      useFormRecovery.setState({ request: record });
      useUI.getState().set({
        panel: "track",
        trackId: target.trackId,
        objectId: target.objectId ?? null,
        noteId: null,
        resultRequest: null,
        dayRequest:
          target.kind === "activity"
            ? {
                requestId: crypto.randomUUID(),
                trackId: target.trackId,
                date: target.date!,
                activityId: target.activityId,
                epoch: record.epoch,
              }
            : null,
      });
    });
  }
  if (!visible.length) return null;
  return (
    <section className="durable-recovery" aria-label="Аварийные черновики">
      <details>
        <summary>Аварийные черновики ({visible.length})</summary>
        <p>
          Копии ввода сохранены на устройстве. Выберите восстановление явно;
          результат не подтверждается автоматически. Копия в браузере не
          заменяет внешний архив.
        </p>
        {visible
          .sort(
            (a, b) =>
              b.updatedAt.localeCompare(a.updatedAt) ||
              a.id.localeCompare(b.id),
          )
          .map((record) => {
            const payload = record.payload!;
            const current = record.epoch === epoch?.value;
            return (
              <article key={record.id}>
                <h3>{payload.label}</h3>
                <small>
                  {new Date(record.updatedAt).toLocaleString("ru")}
                  {!current ? " · прежний город" : ""}
                </small>
                <textarea
                  readOnly
                  aria-label={`Аварийный текст: ${payload.label}`}
                  value={
                    payload.kind === "note" ? payload.note.text : payload.text
                  }
                />
                {payload.kind === "note" &&
                  Boolean(payload.pendingAttachmentIds?.length) && (
                    <p className="hint">
                      Есть незавершённая загрузка. При восстановлении
                      подготовленные изображения добавятся в конец заметки;
                      намеренно удалённые изображения не вставляются.
                    </p>
                  )}
                <div className="row wrap">
                  {payload.kind === "note" ? (
                    <>
                      <button
                        disabled={busy || readonly || !current}
                        onClick={() => void run(() => restore(record))}
                      >
                        Восстановить заметку
                      </button>
                      <button
                        disabled={busy || readonly || !current}
                        onClick={() => void run(() => restore(record, true))}
                      >
                        Восстановить отдельной копией
                      </button>
                    </>
                  ) : (
                    <button
                      disabled={
                        busy || readonly || !current || !payload.context
                      }
                      onClick={() => void run(() => resume(record))}
                    >
                      Продолжить форму
                    </button>
                  )}
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const blob =
                          payload.kind === "note"
                            ? await exportRecoveredNote(
                                payload.note,
                                await journal.attachments(record.id),
                              )
                            : new Blob(
                                [
                                  JSON.stringify(
                                    { epoch: record.epoch, ...payload },
                                    null,
                                    2,
                                  ),
                                ],
                                { type: "application/json;charset=utf-8" },
                              );
                        downloadFile(
                          blob,
                          payload.kind === "note"
                            ? "recovered-note.zip"
                            : "recovered-form.json",
                        );
                      })
                    }
                  >
                    Выгрузить аварийную копию
                  </button>
                  <button
                    disabled={busy || readonly}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Удалить только эту аварийную копию? Сохранённые материалы города не удаляются. Сначала проверьте нужную выгрузку.",
                        )
                      )
                        void run(() =>
                          journal.discard(record.id, record.sequence),
                        );
                    }}
                  >
                    Убрать аварийную копию
                  </button>
                </div>
              </article>
            );
          })}
        <button
          disabled={busy || readonly}
          onClick={() => void navigate({ panel: "settings", noteId: null })}
        >
          К резервированию
        </button>
      </details>
    </section>
  );
}
