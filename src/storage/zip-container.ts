import { strFromU8 } from "fflate";

interface ZipEntry {
  size: number;
  crc: number;
}
const invalid = () =>
  new Error("ZIP неполный или его каталог не согласован с содержимым.");

// Validate the container before bounded streaming inflation; never allocate declared sizes.
export function readZipDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const range = (at: number, length: number, end = bytes.length) => {
    if (at < 0 || length < 0 || at + length > end) throw invalid();
  };
  const u16 = (at: number) => {
    range(at, 2);
    return view.getUint16(at, true);
  };
  const u32 = (at: number) => {
    range(at, 4);
    return view.getUint32(at, true);
  };
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557)) {
    if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === bytes.length)
      break;
    end--;
  }
  if (end < Math.max(0, bytes.length - 65557)) throw invalid();
  const count = u16(end + 10),
    start = u32(end + 16),
    length = u32(end + 12);
  if (
    u16(end + 4) ||
    u16(end + 6) ||
    count !== u16(end + 8) ||
    count < 2 ||
    count > 1002 ||
    start + length !== end
  )
    throw invalid();
  const entries = new Map<string, ZipEntry>();
  const spans: { start: number; end: number }[] = [];
  let cursor = start;
  for (let i = 0; i < count; i++) {
    range(cursor, 46, end);
    if (u32(cursor) !== 0x02014b50 || u16(cursor + 34)) throw invalid();
    const flags = u16(cursor + 8),
      method = u16(cursor + 10);
    const crc = u32(cursor + 16),
      compressed = u32(cursor + 20),
      size = u32(cursor + 24);
    const nameLength = u16(cursor + 28),
      extraLength = u16(cursor + 30),
      commentLength = u16(cursor + 32);
    const local = u32(cursor + 42);
    range(cursor, 46 + nameLength + extraLength + commentLength, end);
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = strFromU8(nameBytes);
    if (
      entries.has(name) ||
      !/^(manifest\.json|data\.json|attachments\/[a-zA-Z0-9_-]{1,180})$/.test(
        name,
      )
    )
      throw invalid();
    if (
      flags & (1 | 64 | 8192) ||
      (method !== 0 && method !== 8) ||
      compressed === 0xffffffff ||
      size === 0xffffffff
    )
      throw new Error(
        "Зашифрованный, многотомный ZIP или ZIP64 не поддерживается.",
      );
    range(local, 30, start);
    if (
      u32(local) !== 0x04034b50 ||
      u16(local + 6) !== flags ||
      u16(local + 8) !== method ||
      u16(local + 26) !== nameLength
    )
      throw invalid();
    const payload = local + 30 + nameLength + u16(local + 28);
    range(local, payload - local + compressed, start);
    if (nameBytes.some((byte, index) => byte !== bytes[local + 30 + index]))
      throw invalid();
    let entryEnd = payload + compressed;
    if (flags & 8) {
      const descriptor = (at: number) =>
        at + 12 <= start &&
        u32(at) === crc &&
        u32(at + 4) === compressed &&
        u32(at + 8) === size;
      if (
        entryEnd + 16 <= start &&
        u32(entryEnd) === 0x08074b50 &&
        descriptor(entryEnd + 4)
      )
        entryEnd += 16;
      else if (descriptor(entryEnd)) entryEnd += 12;
      else throw invalid();
      // Streaming writers may leave zero placeholders or repeat the final values.
      if (
        (u32(local + 14) !== 0 && u32(local + 14) !== crc) ||
        (u32(local + 18) !== 0 && u32(local + 18) !== compressed) ||
        (u32(local + 22) !== 0 && u32(local + 22) !== size)
      )
        throw invalid();
    } else if (
      u32(local + 14) !== crc ||
      u32(local + 18) !== compressed ||
      u32(local + 22) !== size
    )
      throw invalid();
    spans.push({ start: local, end: entryEnd });
    entries.set(name, { size, crc });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== end) throw invalid();
  spans.sort((a, b) => a.start - b.start);
  let next = 0;
  for (const span of spans) {
    if (span.start !== next) throw invalid();
    next = span.end;
  }
  if (next !== start) throw invalid();
  return entries;
}

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let value = i;
  for (let bit = 0; bit < 8; bit++)
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  crcTable[i] = value;
}
export function verifyZipEntry(bytes: Uint8Array, entry: ZipEntry | undefined) {
  if (!entry || bytes.length !== entry.size) throw invalid();
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  if ((crc ^ 0xffffffff) >>> 0 !== entry.crc) throw invalid();
}
