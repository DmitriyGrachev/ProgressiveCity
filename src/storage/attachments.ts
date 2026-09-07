import { id } from "../domain/model";
import type { Attachment } from "../domain/model";
import { CityDB } from "./db";
export const IMAGE_LIMIT = 5 * 1024 * 1024;
export async function validateImage(blob: Blob, mime: string) {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(mime) ||
    blob.size < 12 ||
    blob.size > IMAGE_LIMIT
  )
    throw new Error("Допустимы PNG, JPEG и WebP до 5 MiB.");
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const text = String.fromCharCode(...bytes);
  const valid =
    mime === "image/png"
      ? bytes[0] === 137 &&
        text.slice(1, 4) === "PNG" &&
        bytes[4] === 13 &&
        bytes[5] === 10 &&
        bytes[6] === 26 &&
        bytes[7] === 10
      : mime === "image/jpeg"
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : text.startsWith("RIFF") && text.slice(8, 12) === "WEBP";
  if (!valid)
    throw new Error("Содержимое файла не соответствует формату изображения.");
}
export async function addAttachment(
  db: CityDB,
  file: File,
): Promise<Attachment> {
  await validateImage(file, file.type);
  const attachment = {
    id: id(),
    name: file.name.slice(0, 250),
    mime: file.type,
    size: file.size,
    blob: new Blob([await file.arrayBuffer()], { type: file.type }),
  };
  await db.attachments.add(attachment);
  return attachment;
}
