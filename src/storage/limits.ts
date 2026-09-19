import { strToU8 } from "fflate";

export const ARCHIVE_LIMIT = 64 * 1024 * 1024;
export const EXPANDED_LIMIT = 128 * 1024 * 1024;
export const DATA_LIMIT = 32 * 1024 * 1024;
export const MANIFEST_LIMIT = 1024 * 1024;
export const IMAGE_LIMIT = 5 * 1024 * 1024;

export class DataLimitError extends Error {
  constructor() {
    super(
      "Данные города превышают 32 MiB UTF-8. Операция отменена без изменения базы: такой архив нельзя восстановить.",
    );
    this.name = "DataLimitError";
  }
}

export class MigrationLimitError extends Error {
  constructor(cause: DataLimitError) {
    super(
      "Обновление остановлено: после перехода на новую версию данные превысят 32 MiB UTF-8. Старый город сохранён без изменений. Скачайте его архив и откройте в прежней версии приложения, чтобы освободить место перед повторным обновлением.",
      { cause },
    );
    this.name = "MigrationLimitError";
  }
}

export function migrationLimitMessage(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  while (error && typeof error === "object" && !seen.has(error)) {
    seen.add(error);
    if (
      "name" in error &&
      error.name === "MigrationLimitError" &&
      "message" in error
    )
      return String(error.message);
    // Dexie wraps upgrade failures in OpenFailedError.inner.
    const inner: unknown = "inner" in error ? error.inner : undefined;
    error = inner ?? ("cause" in error ? error.cause : undefined);
  }
  return undefined;
}

/** Use the same serialized bytes for export, import and migration admission. */
export function encodeArchiveData(data: unknown) {
  const bytes = strToU8(JSON.stringify(data));
  if (bytes.length > DATA_LIMIT) throw new DataLimitError();
  return bytes;
}

export function archiveFileLimit(path: string) {
  return path === "data.json"
    ? DATA_LIMIT
    : path === "manifest.json"
      ? MANIFEST_LIMIT
      : IMAGE_LIMIT;
}
