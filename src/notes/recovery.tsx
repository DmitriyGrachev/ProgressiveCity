import { create } from "zustand";
import { useEffect } from "react";
import { strToU8, zipSync } from "fflate";
import type { Attachment, Note } from "../domain/model";
import type { SaveSession } from "./save-session";
import { act } from "../app/ui";
import { DurableRecoveryTray } from "./DurableRecoveryTray";

export interface LocalDraft {
  id: string;
  session: SaveSession;
  attachments: Map<string, Attachment>;
  wait: () => Promise<unknown>;
  forget?: () => Promise<void>;
}
const useRecovery = create<{ drafts: LocalDraft[] }>(() => ({ drafts: [] }));
export function retainDraft(draft: LocalDraft) {
  useRecovery.setState((s) => ({
    drafts: [...s.drafts.filter((d) => d.id !== draft.id), draft],
  }));
}
export async function exportDraft(draft: LocalDraft) {
  await draft.wait();
  return exportRecoveredNote(draft.session.draft, [
    ...draft.attachments.values(),
  ]);
}
export async function exportRecoveredNote(
  source: Note,
  attachments: readonly Attachment[],
) {
  const note = structuredClone(source);
  const files: Record<string, Uint8Array> = {
    "note.json": strToU8(JSON.stringify(note, null, 2)),
    "note.txt": strToU8(`${note.title}\n\n${note.text}`),
    "README.txt": strToU8(
      "Локальный черновик до замены города. Это не резервная копия города для импорта. Текст можно перенести вручную; оригинальные изображения находятся в attachments. Соответствие ID и имён — attachments.json.",
    ),
    "attachments.json": strToU8(
      JSON.stringify(
        attachments.map(({ id, name, mime }) => ({
          id,
          name,
          mime,
        })),
        null,
        2,
      ),
    ),
  };
  for (const a of attachments) {
    const extension =
      a.mime === "image/png" ? "png" : a.mime === "image/webp" ? "webp" : "jpg";
    files[`attachments/${a.id}.${extension}`] = new Uint8Array(
      await a.blob.arrayBuffer(),
    );
  }
  return new Blob([zipSync(files)], { type: "application/zip" });
}
export function RecoveryTray() {
  const drafts = useRecovery((s) => s.drafts);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (!drafts.length) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [drafts]);
  return (
    <>
      <DurableRecoveryTray excludeIds={drafts.map((d) => d.id)} />
      {drafts.length > 0 && <MemoryRecovery drafts={drafts} />}
    </>
  );
}
function MemoryRecovery({ drafts }: { drafts: LocalDraft[] }) {
  return (
    <section className="recovery-tray" aria-label="Локальные черновики">
      <h2>Несохранённый материал</h2>
      <p>
        Город изменился, но локальный черновик и его изображения остаются в этой
        вкладке. Выгрузите их перед закрытием. Они не записываются автоматически
        в новый город.
      </p>
      {drafts.map((draft) => (
        <div key={draft.id}>
          <strong>{draft.session.draft.title}</strong>
          <div className="row wrap">
            <button
              className="primary"
              onClick={() =>
                void act(async () => {
                  const blob = await exportDraft(draft);
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "local-note-recovery.zip";
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 30_000);
                })
              }
            >
              Выгрузить черновик с изображениями
            </button>
            <button
              onClick={() => {
                if (
                  window.confirm(
                    "Убрать локальный черновик из памяти? Убедитесь, что вы сохранили и открыли выгруженный ZIP.",
                  )
                )
                  void act(async () => {
                    await draft.forget?.();
                    useRecovery.setState((s) => ({
                      drafts: s.drafts.filter((d) => d.id !== draft.id),
                    }));
                  });
              }}
            >
              Убрать после выгрузки
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
