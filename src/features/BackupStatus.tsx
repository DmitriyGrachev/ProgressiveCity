import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../storage/db";
import { backupStatus } from "../storage/backup-status";
export function BackupStatus() {
  const status = useLiveQuery(() => backupStatus(db));
  if (!status)
    return <p className="hint">Проверяем состояние резервирования…</p>;
  return (
    <div
      className={status.current ? "hint" : "notice"}
      role="status"
      data-testid="backup-status"
    >
      {status.verifiedAt ? (
        <>
          <b>
            {status.current
              ? "Проверенная копия совпадает с сохранённым городом."
              : "После проверенной копии город изменился."}
          </b>
          <br />
          Файл проверен: {new Date(status.verifiedAt).toLocaleString("ru")}.
        </>
      ) : (
        <b>Для этого города ещё нет проверенной сохранённой копии.</b>
      )}
      <p>
        Скачайте архив, затем выберите сохранённый файл для проверки без замены.
        Передача загрузки браузеру не подтверждает сохранение на диске.
        Аварийные черновики хранятся отдельно.
      </p>
    </div>
  );
}
