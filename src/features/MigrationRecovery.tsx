import { useState } from "react";
import { exportLegacyCity } from "../storage/backup";
import { db } from "../storage/db";

export function MigrationRecovery() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function download() {
    setBusy(true);
    setError("");
    try {
      const blob = await exportLegacyCity(db.name);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `city-v1-${new Date().toISOString().slice(0, 10)}.progresscity.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Не удалось скачать старый город. Повторите попытку.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Сохранение старого города">
      <p>
        Архив сохранит заметки, изображения и историю в прежнем формате v1.
        Новая версия сможет принять его после уменьшения объёма данных в прежнем
        приложении. Не очищайте данные браузера.
      </p>
      <button
        className="primary"
        disabled={busy}
        onClick={() => void download()}
      >
        {busy ? "Готовим архив…" : "Скачать старый город"}
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
