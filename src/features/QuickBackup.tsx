import { useState } from "react";
import { downloadBackup } from "../app/backup-actions";
import { loadBackup } from "../app/load-backup";
import { navigate, reportError, transition, useUI } from "../app/ui";
export function QuickBackup() {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const disabled = useUI(
    (s) => s.transitioning || Boolean(s.snapshotId || s.comparison),
  );
  return (
    <details className="quick-backup">
      <summary>Копия и проверка архива</summary>
      <button
        disabled={busy || disabled}
        onClick={() => {
          setMessage("");
          void transition(async () => {
            await downloadBackup();
            setMessage(
              "Архив города передан браузеру. Проверьте загрузки и сохраните файл.",
            );
          });
        }}
      >
        Скачать полную копию
      </button>
      <label className="upload-button">
        Проверить город без замены
        <input
          aria-label="Проверить архив без замены"
          type="file"
          accept=".zip,.progresscity.zip"
          disabled={busy || disabled}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setBusy(true);
            setMessage("");
            void loadBackup()
              .then(({ inspectArchive }) => inspectArchive(file))
              .then((archive) =>
                setMessage(
                  `Архив проверен: «${archive.data.city.name}», ${archive.data.notes.length} заметок, ${archive.attachments.length} изображений. Текущий город не заменён.`,
                ),
              )
              .catch(reportError)
              .finally(() => setBusy(false));
          }}
        />
      </label>
      <button
        disabled={busy || disabled}
        onClick={() => void navigate({ panel: "settings", noteId: null })}
      >
        Открыть восстановление города
      </button>
      {(busy || message) && (
        <p className="hint" role="status">
          {busy ? "Проверка…" : message}
        </p>
      )}
    </details>
  );
}
