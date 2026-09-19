import { strToU8 } from "fflate";
import type { Attachment } from "../domain/model";
import {
  ARCHIVE_LIMIT,
  EXPANDED_LIMIT,
  ArchiveLimitError,
  archiveFileLimit,
  encodeArchiveData,
} from "./limits";

type AttachmentMetadata = Pick<Attachment, "id" | "name" | "mime" | "size">;
export interface ManifestFile {
  path: string;
  size: number;
  sha256: string;
}

/** Shared manifest encoding keeps admission and the actual writer in agreement. */
export function encodeManifest(
  files: ManifestFile[],
  version: 1 | 2,
  exportedAt: string,
) {
  // The archive schema uses four-digit years. A fixed-width timestamp makes the
  // admission result valid for later exports too; hashes always have 64 digits.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(exportedAt))
    throw new Error("Дата экспорта не поддерживается форматом архива.");
  return strToU8(
    JSON.stringify({ format: "progress-city", version, exportedAt, files }),
  );
}

/** Synchronous: safe inside a Dexie versionchange transaction. No Blob reads or hashing. */
export function prepareArchive(
  data: { attachments: AttachmentMetadata[] },
  attachments: readonly Attachment[],
  version: 1 | 2,
) {
  const dataBytes = encodeArchiveData(data);
  const metadata = new Map(data.attachments.map((a) => [a.id, a]));
  if (
    metadata.size !== attachments.length ||
    new Set(attachments.map((a) => a.id)).size !== attachments.length
  )
    throw new Error("Неполные вложения или повторяющиеся идентификаторы.");
  for (const a of attachments) {
    const declared = metadata.get(a.id);
    if (
      !declared ||
      declared.size !== a.blob.size ||
      a.size !== a.blob.size ||
      declared.name !== a.name ||
      declared.mime !== a.mime
    )
      throw new Error("Метаданные вложения не совпадают с исходными данными.");
  }
  const exportedAt = new Date().toISOString();
  const files = [
    { path: "data.json", size: dataBytes.length },
    ...attachments.map((a) => ({
      path: `attachments/${a.id}`,
      size: a.blob.size,
    })),
  ];
  const manifestBytes = encodeManifest(
    files.map((f) => ({ ...f, sha256: "0".repeat(64) })),
    version,
    exportedAt,
  );
  const entries = [
    ...files,
    { path: "manifest.json", size: manifestBytes.length },
  ];
  if (entries.length > 1002)
    throw new ArchiveLimitError("Архив содержит больше 1002 файлов.");
  let expandedSize = 0;
  let zipSize = 22; // End of central directory, without an archive comment.
  for (const { path, size } of entries) {
    if (size > archiveFileLimit(path))
      throw new ArchiveLimitError(
        "Файл превышает допустимый размер в резервном архиве.",
      );
    expandedSize += size;
    // fflate zipSync({level: 0}), no extras/comments/descriptors/ZIP64:
    // local header 30 + central-directory header 46 + UTF-8 name twice.
    zipSize += size + 76 + 2 * strToU8(path).length;
  }
  if (expandedSize > EXPANDED_LIMIT)
    throw new ArchiveLimitError("Распакованный архив превышает 128 MiB.");
  if (zipSize > ARCHIVE_LIMIT)
    throw new ArchiveLimitError(
      "Общий ZIP с изображениями и служебными данными превышает 64 MiB.",
    );
  return { dataBytes, exportedAt, zipSize };
}
