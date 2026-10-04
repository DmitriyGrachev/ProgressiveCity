import { db } from "../storage/db";
import { flushNotes } from "./ui";
import { downloadFile } from "./download";
import { loadBackup } from "./load-backup";
export async function downloadBackup() {
  await flushNotes();
  const epoch = (await db.metadata.get("epoch"))?.value;
  const { exportCity } = await loadBackup();
  const blob = await exportCity(db);
  if ((await db.metadata.get("epoch"))?.value !== epoch)
    throw new Error(
      "Город заменён во время экспорта. Повторите создание копии.",
    );
  downloadFile(
    blob,
    `city-${new Date().toISOString().slice(0, 10)}.progresscity.zip`,
  );
}
