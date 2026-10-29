import { useState } from "react";
import { downloadBackup } from "../app/backup-actions";
import { loadBackup } from "../app/load-backup";
import { navigate, reportError, transition, useUI } from "../app/ui";
import { BackupStatus } from "./BackupStatus";
import { verifyBackupForCurrentCity } from "../storage/backup-status";
import { db } from "../storage/db";
export function QuickBackup() {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const disabled = useUI(
    (s) => s.transitioning || Boolean(s.snapshotId || s.comparison),
  );
  return (
    <details
      className="quick-backup"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Копия и проверка архива</summary>
      {open && <BackupStatus />}
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
              .then(async (archive) => {
                const current = await verifyBackupForCurrentCity(db, archive);
                setMessage(
                  `Архив проверен: «${archive.data.city.name}», ${archive.data.notes.length} заметок, ${archive.attachments.length} изображений. Текущий город не заменён. ${current ? "Подтверждена копия текущего сохранённого города." : "Архив отличается от текущего города; актуальная копия не подтверждена."}`,
                );
              })
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
        <p
          className="hint"
          role="status"
          aria-label="Результат проверки архива"
        >
          {busy ? "Проверка…" : message}
        </p>
      )}
    </details>
  );
}
