import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../storage/db";
import { archiveLimits, DATA_LIMIT, MANIFEST_LIMIT } from "../storage/limits";

export function BackupUsage() {
  const usage = useLiveQuery(() =>
    db.transaction("r", db.cityTables, async () => {
      const { storageEpoch, ...data } = await db.read();
      void storageEpoch;
      const attachments = (await db.attachments.toArray()).map(
        ({ id, name, mime, size }) => ({ id, name, mime, size }),
      );
      const text = new TextEncoder().encode(
        JSON.stringify({ ...data, attachments }),
      ).length;
      return { text, images: attachments.reduce((sum, a) => sum + a.size, 0) };
    }),
  );
  if (!usage) return null;
  const near =
    usage.text >= DATA_LIMIT * 0.8 ||
    usage.text + usage.images + MANIFEST_LIMIT >= archiveLimits(3).zip * 0.8;
  const mib = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
  return (
    <p className={near ? "notice" : "hint"} role="status">
      Данные: {mib(usage.text)} / 32 MiB UTF-8. Изображения: {mib(usage.images)}{" "}
      MiB. Новый ZIP v3 — до 256 MiB, включая служебные данные. Текст
      учитывается и в документе, и в поисковом представлении.
      {near &&
        " Близок предел резервирования. Экспортируйте город сейчас; дальнейшее увеличение может сделать полный экспорт невозможным. Ничего автоматически не удаляется."}
    </p>
  );
}
