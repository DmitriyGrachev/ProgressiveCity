import { useState } from "react";
import {
  inspectArchive,
  replaceCity,
  type ValidatedArchive,
} from "../storage/backup";
import { db } from "../storage/db";
import { act, reportError } from "../app/ui";
export function InitialRestore() {
  const [archive, setArchive] = useState<ValidatedArchive | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <details className="initial-restore">
      <summary>Уже есть город? Восстановить архив</summary>
      <p className="hint">
        Проверим архив и изображения перед восстановлением. До 64 MiB.
      </p>
      <label className="upload-button">
        Выбрать резервную копию
        <input
          type="file"
          accept=".zip,.progresscity.zip"
          aria-label="Архив для восстановления"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setBusy(true);
            setArchive(null);
            void inspectArchive(file)
              .then(setArchive)
              .catch(reportError)
              .finally(() => setBusy(false));
          }}
        />
      </label>
      {busy && <p role="status">Проверка архива…</p>}
      {archive && (
        <section
          className="import-confirm"
          role="alertdialog"
          aria-label="Подтверждение восстановления"
        >
          <h3>Архив проверен</h3>
          <p>
            «{archive.data.city.name}» · {archive.data.notes.length} заметок ·{" "}
            {archive.attachments.length} изображений
          </p>
          <div className="row">
            <button
              disabled={busy}
              className="primary"
              onClick={() => {
                setBusy(true);
                void act(async () => {
                  // Refuse to replace a city concurrently created in another tab through the initial screen.
                  await db.transaction("rw", db.tables, async () => {
                    if (await db.cities.count())
                      throw new Error(
                        "Город уже создан в другой вкладке. Откройте настройки для подтверждённой замены.",
                      );
                    await replaceCity(db, archive);
                  });
                  location.reload();
                }).finally(() => setBusy(false));
              }}
            >
              Восстановить город
            </button>
            <button disabled={busy} onClick={() => setArchive(null)}>
              Отмена
            </button>
          </div>
        </section>
      )}
    </details>
  );
}
