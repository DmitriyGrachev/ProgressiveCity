import { useState } from "react";
import { db } from "../storage/db";
import {
  scanUnusedAttachments,
  removeUnusedAttachments,
  type CleanupPlan,
} from "../storage/maintenance";
import { flushRecovery } from "../notes/durable";
import { act, useUI } from "../app/ui";
export function LibraryMaintenance({ epoch }: { epoch: string }) {
  const [plan, setPlan] = useState<CleanupPlan | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const readonly = useUI(
    (s) => Boolean(s.snapshotId || s.comparison) || s.transitioning,
  );
  const supported = Boolean(navigator.locks);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await act(action);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="library-maintenance" aria-label="Очистка библиотеки">
      <h3>Неиспользуемые изображения</h3>
      <p className="hint">
        Удаляются только выбранные оригиналы без ссылок из сохранённых заметок и
        аварийных копий. Закройте редакторы заметок во всех вкладках. Материалы,
        результаты, балансы и снимки не удаляются.
      </p>
      <button
        disabled={busy || readonly}
        onClick={() =>
          void run(async () => {
            await flushRecovery();
            setPlan(await scanUnusedAttachments(db, epoch));
          })
        }
      >
        Найти неиспользуемые изображения
      </button>
      {plan && (
        <>
          <p>
            {plan.candidates.length} изображений ·{" "}
            {(plan.bytes / 1024 / 1024).toFixed(2)} MiB. Это предпросмотр; пока
            ничего не удалено.
          </p>
          <ul>
            {plan.candidates.map((a) => (
              <li key={a.id}>
                {a.name} · {(a.size / 1024).toFixed(1)} KiB
              </li>
            ))}
          </ul>
          <button
            disabled={busy || readonly || !supported}
            onClick={() => {
              if (
                window.confirm(
                  `Удалить ${plan.candidates.length} показанных неиспользуемых изображений и освободить незанятый страховочный кэш? Перед удалением ссылки будут проверены повторно. Это действие не отменяется планировкой.`,
                )
              )
                void run(async () => {
                  await flushRecovery();
                  const result = await removeUnusedAttachments(db, plan);
                  setMessage(
                    `Удалено ${result.removed} изображений, освобождено ${((result.bytes + result.cacheBytes) / 1024 / 1024).toFixed(2)} MiB вместе с незанятым кэшем.`,
                  );
                  setPlan(null);
                });
            }}
          >
            Очистить по предпросмотру
          </button>
        </>
      )}
      {!supported && (
        <p className="notice">
          Без Web Locks безопасная очистка между вкладками недоступна. Экспорт и
          редактирование продолжают работать.
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
