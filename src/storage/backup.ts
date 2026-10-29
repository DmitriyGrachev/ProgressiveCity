import {
  strFromU8,
  Unzip,
  UnzipInflate,
  zipSync,
  Zip,
  ZipPassThrough,
} from "fflate";
import { z } from "zod";
import Dexie from "dexie";
import { CityDB } from "./db";
import { validateImage } from "./attachments";
import { dataSchema, validateRelations, type ArchiveData } from "./validation";
import {
  dataSchema as v2Schema,
  validateRelations as validateV2Relations,
} from "./validation-v2";
import {
  dataSchema as legacySchema,
  validateRelations as validateLegacyRelations,
  type ArchiveData as LegacyArchiveData,
} from "./legacy-validation";
import { migrateV1 } from "./migrate";
import type { Attachment } from "../domain/model";

import {
  ARCHIVE_LIMIT,
  EXPANDED_LIMIT,
  archiveFileLimit,
  archiveLimits,
  type ArchiveVersion,
} from "./limits";
import { encodeManifest, prepareArchive } from "./archive-format";
import { readZipDirectory, verifyZipEntry } from "./zip-container";
export { ARCHIVE_LIMIT, EXPANDED_LIMIT } from "./limits";
const manifestSchema = z
  .object({
    format: z.literal("progress-city"),
    version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
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
    db.cityTables,
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
  return createArchive(parsed, attachments, 3);
}

/** Read the preserved v1 without registering or running an upgrade. */
export async function exportLegacyCity(name: string): Promise<Blob> {
  const legacy = new Dexie(name, { autoOpen: false });
  try {
    await legacy.open();
    if (legacy.verno !== 1)
      throw new Error(
        "Старая версия города недоступна. Повторите загрузку приложения.",
      );
    const { data, attachments } = await legacy.transaction(
      "r",
      legacy.tables,
      async () => {
        const attachments = await legacy
          .table<Attachment>("attachments")
          .toArray();
        const records = await Promise.all(
          [
            "tracks",
            "buildings",
            "districts",
            "notes",
            "activities",
            "events",
            "snapshots",
          ].map(
            async (key) =>
              [key, await legacy.table<unknown>(key).toArray()] as const,
          ),
        );
        return {
          data: legacySchema.parse({
            city: await legacy.table<unknown>("cities").get("city"),
            ...Object.fromEntries(records),
            attachments: attachments.map(({ id, name, mime, size }) => ({
              id,
              name,
              mime,
              size,
            })),
          }),
          attachments,
        };
      },
    );
    validateLegacyRelations(data);
    return await createArchive(data, attachments, 1);
  } finally {
    legacy.close();
  }
}

async function createArchive(
  data: ArchiveData | LegacyArchiveData,
  attachments: Attachment[],
  version: ArchiveVersion,
): Promise<Blob> {
  const { dataBytes, exportedAt, zipSize } = prepareArchive(
    data,
    attachments,
    version,
  );
  if (version === 3)
    return streamArchive(dataBytes, attachments, exportedAt, zipSize);
  const files: Record<string, Uint8Array> = {
    "data.json": dataBytes,
  };
  for (const a of attachments) {
    if (a.size !== a.blob.size)
      throw new Error("Размер вложения не совпадает с данными.");
    await validateImage(a.blob, a.mime);
    files[`attachments/${a.id}`] = new Uint8Array(await a.blob.arrayBuffer());
  }
  const manifestFiles = await Promise.all(
    Object.entries(files).map(async ([path, bytes]) => ({
      path,
      size: bytes.length,
      sha256: await hash(bytes),
    })),
  );
  files["manifest.json"] = encodeManifest(manifestFiles, version, exportedAt);
  const zip = zipSync(files, { level: 0 });
  if (zip.length > ARCHIVE_LIMIT)
    throw new Error(
      "Архив превышает 64 MiB. Экспорт отменён без изменения данных.",
    );
  if (zip.length !== zipSize)
    throw new Error(
      "Размер ZIP не совпал с проверенным форматом. Экспорт отменён без изменения данных.",
    );
  return new Blob([zip], { type: "application/zip" });
}
async function streamArchive(
  data: Uint8Array,
  attachments: Attachment[],
  exportedAt: string,
  expectedSize: number,
) {
  const parts: Blob[] = [];
  let size = 0,
    ended = false;
  const zip = new Zip((error, chunk, final) => {
    if (error) throw error;
    size += chunk.length;
    if (size > archiveLimits(3).zip)
      throw new Error("Архив превышает 256 MiB.");
    parts.push(new Blob([new Uint8Array(chunk)]));
    ended = final;
  });
  const files: { path: string; size: number; sha256: string }[] = [];
  const append = async (path: string, bytes: Uint8Array) => {
    const entry = new ZipPassThrough(path);
    zip.add(entry);
    if (!bytes.length) entry.push(bytes, true);
    for (let offset = 0; offset < bytes.length; offset += 512 * 1024) {
      entry.push(
        bytes.subarray(offset, offset + 512 * 1024),
        offset + 512 * 1024 >= bytes.length,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  };
  try {
    files.push({
      path: "data.json",
      size: data.length,
      sha256: await hash(data),
    });
    await append("data.json", data);
    for (const attachment of attachments) {
      await validateImage(attachment.blob, attachment.mime);
      const bytes = new Uint8Array(await attachment.blob.arrayBuffer());
      const path = `attachments/${attachment.id}`;
      files.push({ path, size: bytes.length, sha256: await hash(bytes) });
      await append(path, bytes);
    }
    await append("manifest.json", encodeManifest(files, 3, exportedAt));
    zip.end();
    if (!ended || size !== expectedSize)
      throw new Error(
        "Размер ZIP не совпал с проверенным форматом. Экспорт отменён без изменения данных.",
      );
    return new Blob(parts, { type: "application/zip" });
  } catch (error) {
    zip.terminate();
    throw error;
  }
}
async function unpack(
  bytes: Uint8Array,
  version: ArchiveVersion,
  manifestOnly = false,
) {
  const directory = readZipDirectory(bytes);
  const limits = archiveLimits(version);
  let declared = 0;
  for (const [name, entry] of directory) {
    if (entry.size > archiveFileLimit(name))
      throw new Error("Превышен лимит распаковки: размер файла.");
    declared += entry.size;
  }
  if (declared > limits.expanded) throw new Error("Превышен лимит распаковки.");
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
      (file.originalSize ?? 0) > limits.expanded ||
      (file.size ?? 0) > limits.zip
    )
      throw new Error("Превышен размер файла.");
    if (manifestOnly && file.name !== "manifest.json") return;
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (error, chunk, final) => {
      if (error) throw error;
      size += chunk.length;
      total += chunk.length;
      const limit = archiveFileLimit(file.name);
      if (size > limit || total > limits.expanded) {
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
        verifyZipEntry(result, directory.get(file.name));
        files[file.name] = result;
        completed++;
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let i = 0; i < bytes.length; i += 1024) {
    unzip.push(bytes.subarray(i, i + 1024), i + 1024 >= bytes.length);
    if (i && i % (256 * 1024) === 0)
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (
    (!manifestOnly && (completed !== count || completed !== directory.size)) ||
    !files["manifest.json"] ||
    (!manifestOnly && !files["data.json"])
  )
    throw new Error("Архив неполный.");
  return files;
}
export interface ValidatedArchive {
  data: ArchiveData;
  attachments: Attachment[];
  version?: ArchiveVersion;
  exportedAt?: string;
}
export async function inspectArchive(blob: Blob): Promise<ValidatedArchive> {
  if (blob.size > archiveLimits(3).zip || blob.size < 22)
    throw new Error("Некорректный архив или размер больше 256 MiB.");
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const first = await unpack(bytes, 3, true);
    const manifest = manifestSchema.parse(
      JSON.parse(strFromU8(first["manifest.json"])),
    );
    if (blob.size > archiveLimits(manifest.version).zip)
      throw new Error(
        `Архив версии ${manifest.version} превышает ${archiveLimits(manifest.version).zip / 1024 / 1024} MiB.`,
      );
    const files = await unpack(bytes, manifest.version);
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
    let raw: unknown = JSON.parse(strFromU8(files["data.json"]));
    if (manifest.version === 1) {
      const legacy = legacySchema.parse(raw);
      validateLegacyRelations(legacy);
      raw = migrateV1(legacy);
    }
    if (manifest.version < 3) {
      const legacy = v2Schema.parse(raw);
      validateV2Relations(legacy);
      raw = legacy;
    }
    const data = dataSchema.parse(raw);
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
    prepareArchive(data, attachments, manifest.version < 3 ? 2 : 3);
    return {
      data,
      attachments,
      version: manifest.version,
      exportedAt: manifest.exportedAt,
    };
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
  prepareArchive(data, archive.attachments, (archive.version ?? 3) < 3 ? 2 : 3);
  if (archive.attachments.length !== data.attachments.length)
    throw new Error("Неполные вложения.");
  await db.transaction("rw", db.cityTables, async () => {
    for (const table of db.cityTables) await table.clear();
    await db.metadata.add({ id: "epoch", value: crypto.randomUUID() });
    await db.cities.add(data.city);
    await db.tracks.bulkAdd(data.tracks);
    await db.learningObjects.bulkAdd(data.learningObjects);
    await db.buildings.bulkAdd(data.buildings);
    await db.districts.bulkAdd(data.districts);
    await db.notes.bulkAdd(data.notes);
    await db.activities.bulkAdd(data.activities);
    await db.events.bulkAdd(data.events);
    await db.snapshots.bulkAdd(data.snapshots);
    await db.attachments.bulkAdd(archive.attachments);
  });
}
