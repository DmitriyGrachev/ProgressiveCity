import { strFromU8, strToU8, Unzip, UnzipInflate, zipSync } from "fflate";
import { z } from "zod";
import { CityDB } from "./db";
import { validateImage } from "./attachments";
import { dataSchema, validateRelations, type ArchiveData } from "./validation";
import type { Attachment } from "../domain/model";

import {
  ARCHIVE_LIMIT,
  EXPANDED_LIMIT,
  DATA_LIMIT,
  archiveFileLimit,
} from "./limits";
export { ARCHIVE_LIMIT, EXPANDED_LIMIT } from "./limits";
const manifestSchema = z
  .object({
    format: z.literal("progress-city"),
    version: z.literal(1),
    exportedAt: z.string().datetime(),
    files: z
      .array(
        z
          .object({
            path: z.string().max(240),
            size: z.number().int().nonnegative().max(EXPANDED_LIMIT),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .max(1001),
  })
  .strict();
async function hash(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function exportCity(db: CityDB): Promise<Blob> {
  const { data, attachments } = await db.transaction(
    "r",
    db.tables,
    async () => ({
      data: await db.read(),
      attachments: await db.attachments.toArray(),
    }),
  );
  if (!data.city) throw new Error("Нет города для экспорта.");
  const { storageEpoch, ...content } = data;
  void storageEpoch;
  const payload = {
    ...content,
    attachments: attachments.map(({ id, mime, size, name }) => ({
      id,
      mime,
      size,
      name,
    })),
  };
  const parsed = dataSchema.parse(payload);
  validateRelations(parsed);
  const files: Record<string, Uint8Array> = {
    "data.json": strToU8(JSON.stringify(parsed)),
  };
  if (files["data.json"].length > DATA_LIMIT)
    throw new Error(
      "Данные города превышают 32 MiB UTF-8. Экспорт отменён без изменения базы: такой архив нельзя восстановить.",
    );
  for (const a of attachments) {
    if (a.size !== a.blob.size)
      throw new Error("Размер вложения не совпадает с данными.");
    await validateImage(a.blob, a.mime);
    files[`attachments/${a.id}`] = new Uint8Array(await a.blob.arrayBuffer());
  }
  const manifest = {
    format: "progress-city",
    version: 1,
    exportedAt: new Date().toISOString(),
    files: await Promise.all(
      Object.entries(files).map(async ([path, bytes]) => ({
        path,
        size: bytes.length,
        sha256: await hash(bytes),
      })),
    ),
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest));
  let total = 0;
  for (const [path, bytes] of Object.entries(files)) {
    total += bytes.length;
    if (bytes.length > archiveFileLimit(path) || total > EXPANDED_LIMIT)
      throw new Error(
        "Город превышает лимит резервного архива. Экспорт отменён без изменения базы.",
      );
  }
  const zip = zipSync(files, { level: 0 });
  if (zip.length > ARCHIVE_LIMIT)
    throw new Error(
      "Архив превышает 64 MiB. Экспорт отменён без изменения данных.",
    );
  return new Blob([zip], { type: "application/zip" });
}
function unpack(bytes: Uint8Array) {
  const files: Record<string, Uint8Array> = Object.create(null) as Record<
    string,
    Uint8Array
  >;
  let total = 0;
  let count = 0;
  let completed = 0;
  const paths = new Set<string>();
  const unzip = new Unzip((file) => {
    if (
      ++count > 1002 ||
      paths.has(file.name) ||
      !/^(manifest\.json|data\.json|attachments\/[a-zA-Z0-9_-]{1,180})$/.test(
        file.name,
      )
    )
      throw new Error("Недопустимый путь, дубликат или число файлов в архиве.");
    paths.add(file.name);
    if (
      (file.originalSize ?? 0) > EXPANDED_LIMIT ||
      (file.size ?? 0) > ARCHIVE_LIMIT
    )
      throw new Error("Превышен размер файла.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (error, chunk, final) => {
      if (error) throw error;
      size += chunk.length;
      total += chunk.length;
      const limit = archiveFileLimit(file.name);
      if (size > limit || total > EXPANDED_LIMIT) {
        file.terminate();
        throw new Error("Превышен лимит распаковки.");
      }
      chunks.push(chunk);
      if (final) {
        const result = new Uint8Array(size);
        let offset = 0;
        for (const c of chunks) {
          result.set(c, offset);
          offset += c.length;
        }
        files[file.name] = result;
        completed++;
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let i = 0; i < bytes.length; i += 1024)
    unzip.push(bytes.subarray(i, i + 1024), i + 1024 >= bytes.length);
  if (completed !== count || !files["manifest.json"] || !files["data.json"])
    throw new Error("Архив неполный.");
  return files;
}
export interface ValidatedArchive {
  data: ArchiveData;
  attachments: Attachment[];
}
export async function inspectArchive(blob: Blob): Promise<ValidatedArchive> {
  if (blob.size > ARCHIVE_LIMIT || blob.size < 22)
    throw new Error("Некорректный архив или размер больше 64 MiB.");
  try {
    const files = unpack(new Uint8Array(await blob.arrayBuffer()));
    const manifest = manifestSchema.parse(
      JSON.parse(strFromU8(files["manifest.json"])),
    );
    if (
      manifest.files.length + 1 !== Object.keys(files).length ||
      new Set(manifest.files.map((f) => f.path)).size !== manifest.files.length
    )
      throw new Error("Неполный manifest.");
    for (const f of manifest.files)
      if (
        !files[f.path] ||
        f.size !== files[f.path].length ||
        (await hash(files[f.path])) !== f.sha256
      )
        throw new Error("Контрольная сумма или размер не совпадают.");
    const data = dataSchema.parse(JSON.parse(strFromU8(files["data.json"])));
    validateRelations(data);
    if (data.attachments.length + 2 !== Object.keys(files).length)
      throw new Error("Лишние или недостающие вложения.");
    const attachments: Attachment[] = [];
    for (const a of data.attachments) {
      const bytes = files[`attachments/${a.id}`];
      if (!bytes || a.size !== bytes.length)
        throw new Error("Отсутствует вложение.");
      const blob = new Blob([new Uint8Array(bytes)], { type: a.mime });
      await validateImage(blob, a.mime);
      attachments.push({ ...a, blob });
    }
    return { data, attachments };
  } catch (error) {
    throw new Error(
      `Импорт отклонён. Текущий город сохранён. ${error instanceof z.ZodError ? "Неверный формат или версия данных." : error instanceof Error ? error.message : "Повреждённый архив."}`,
      { cause: error },
    );
  }
}
export async function replaceCity(db: CityDB, archive: ValidatedArchive) {
  // Revalidate immediately before entering the atomic replacement transaction.
  const data = dataSchema.parse(archive.data);
  validateRelations(data);
  if (archive.attachments.length !== data.attachments.length)
    throw new Error("Неполные вложения.");
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
    await db.metadata.add({ id: "epoch", value: crypto.randomUUID() });
    await db.cities.add(data.city);
    await db.tracks.bulkAdd(data.tracks);
    await db.buildings.bulkAdd(data.buildings);
    await db.districts.bulkAdd(data.districts);
    await db.notes.bulkAdd(data.notes);
    await db.activities.bulkAdd(data.activities);
    await db.events.bulkAdd(data.events);
    await db.snapshots.bulkAdd(data.snapshots);
    await db.attachments.bulkAdd(archive.attachments);
  });
}
