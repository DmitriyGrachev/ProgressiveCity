import type { CityDB } from "./db";
import { dataSchema } from "./validation";
import { prepareArchive } from "./archive-format";
import { ArchiveLimitError } from "./limits";

export async function captureArchiveData(db: CityDB) {
  return db.transaction("r", db.cityTables, async () => {
    const { storageEpoch, city, ...content } = await db.read();
    if (!city) throw new Error("Нет города для резервирования.");
    const attachments = await db.attachments.toArray();
    return {
      epoch: storageEpoch,
      data: {
        city,
        ...content,
        attachments: attachments.map(({ id, name, mime, size }) => ({
          id,
          name,
          mime,
          size,
        })),
      },
      attachments,
    };
  });
}
export async function assertCityCapacity(
  db: CityDB,
  allowShrinkingOversize = false,
) {
  if (!(await db.cities.count())) return;
  const captured = await captureArchiveData(db);
  const parsed = dataSchema.parse(captured.data);
  try {
    prepareArchive(parsed, captured.attachments, 3);
  } catch (error) {
    if (!allowShrinkingOversize || !(error instanceof ArchiveLimitError))
      throw error;
  }
}
