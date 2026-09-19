import { strToU8, zlibSync } from "fflate";
import type { Attachment } from "../../src/domain/model";
import { migrateV1 } from "../../src/storage/migrate";
import { dataSchema as legacySchema } from "../../src/storage/legacy-validation";
import { dataSchema } from "../../src/storage/validation";
import { archiveBytes, legacyCity } from "./legacy-city";

// A valid PNG with a private ancillary padding chunk before IEND.
// Generate a real one-pixel PNG, including chunk CRCs and its zlib image data.
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++)
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, content: Uint8Array) {
  const bytes = new Uint8Array(content.length + 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, content.length);
  bytes.set(strToU8(type), 4);
  bytes.set(content, 8);
  view.setUint32(bytes.length - 4, crc32(bytes.subarray(4, -4)));
  return bytes;
}
const header = new Uint8Array(13);
new DataView(header.buffer).setUint32(0, 1);
new DataView(header.buffer).setUint32(4, 1);
header[8] = 8;
header[9] = 2;
const pixel = Uint8Array.from([
  137,
  80,
  78,
  71,
  13,
  10,
  26,
  10,
  ...chunk("IHDR", header),
  ...chunk("IDAT", zlibSync(new Uint8Array(4))),
  ...chunk("IEND", new Uint8Array()),
]);
function paddedPng(size: number) {
  const bytes = new Uint8Array(size);
  const prefixLength = pixel.length - 12;
  bytes.set(pixel.subarray(0, prefixLength));
  const view = new DataView(bytes.buffer);
  view.setUint32(prefixLength, size - pixel.length - 12);
  bytes.set(strToU8("paDd"), prefixLength + 4);
  view.setUint32(size - 16, crc32(bytes.subarray(prefixLength + 4, size - 16)));
  bytes.set(pixel.subarray(-12), size - 12);
  return bytes;
}

/** Tune against actual fflate STORE output, independently of production size admission. */
export async function zipBoundary(target: number, version: 1 | 2 = 2) {
  const raw = legacyCity();
  raw.notes = Array.from({ length: 200 }, (_, i) => ({
    ...raw.notes[0],
    id: i === 0 ? "old-note" : `note-${i}`,
    title: `Материал ${i}`,
  }));
  const sizes = Array.from({ length: 13 }, (_, i) =>
    i < 12 ? 5 * 1024 * 1024 : 4 * 1024 * 1024,
  );
  const fullImage = paddedPng(sizes[0]);
  for (let attempt = 0; attempt < 4; attempt++) {
    raw.attachments = sizes.map((size, i) => ({
      id: i === 0 ? "photo-image" : `image-${i}`,
      name: `кадр-${i}.png`,
      mime: "image/png",
      size,
    }));
    const legacy = legacySchema.parse(raw);
    const migrated = dataSchema.parse(migrateV1(legacy));
    const images = Object.fromEntries(
      legacy.attachments.map((a, i) => [
        `attachments/${a.id}`,
        i < 12 ? fullImage : paddedPng(a.size),
      ]),
    );
    const zip = await archiveBytes(
      version === 1 ? legacy : migrated,
      version,
      images,
    );
    const delta = target - zip.size;
    if (delta === 0) {
      const attachments: Attachment[] = legacy.attachments.map((a) => ({
        ...a,
        blob: new Blob([images[`attachments/${a.id}`]], { type: a.mime }),
      }));
      return { legacy, migrated, attachments, images, zip };
    }
    sizes[12] += delta;
    if (sizes[12] > 5 * 1024 * 1024 || sizes[12] < pixel.length + 12)
      throw new Error("ZIP boundary image cannot fit");
  }
  throw new Error("ZIP boundary fixture did not converge");
}
