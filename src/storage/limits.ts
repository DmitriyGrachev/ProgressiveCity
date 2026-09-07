export const ARCHIVE_LIMIT = 64 * 1024 * 1024;
export const EXPANDED_LIMIT = 128 * 1024 * 1024;
export const DATA_LIMIT = 32 * 1024 * 1024;
export const MANIFEST_LIMIT = 1024 * 1024;
export const IMAGE_LIMIT = 5 * 1024 * 1024;

export function archiveFileLimit(path: string) {
  return path === "data.json"
    ? DATA_LIMIT
    : path === "manifest.json"
      ? MANIFEST_LIMIT
      : IMAGE_LIMIT;
}
