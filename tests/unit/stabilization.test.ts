import { afterEach, beforeEach, expect, it } from "vitest";
import { Zip, ZipDeflate, ZipPassThrough, unzipSync, zipSync } from "fflate";
import { CityDB } from "../../src/storage/db";
import { CityService } from "../../src/storage/service";
import {
  exportCity,
  inspectArchive,
  replaceCity,
} from "../../src/storage/backup";

let db: CityDB;
let service: CityService;
beforeEach(async () => {
  db = new CityDB(`stabilization-${crypto.randomUUID()}`);
  service = new CityService(db);
  await service.initialize("Проверка сохранности", "Оптика");
});
afterEach(async () => {
  await db.delete();
});

it("refuses stale direction fields from another connection without losing saved text", async () => {
  const data = await db.read(),
    base = data.tracks[0];
  const peerDB = new CityDB(db.name),
    peer = new CityService(peerDB);
  try {
    await service.updateTrack(
      { ...base, description: "Описание первой вкладки" },
      data.storageEpoch,
      base,
    );
    await expect(
      peer.updateTrack(
        { ...base, name: "Имя второй вкладки" },
        data.storageEpoch,
        base,
      ),
    ).rejects.toThrow(/другой вкладке/);
    expect(await db.tracks.get(base.id)).toMatchObject({
      name: base.name,
      description: "Описание первой вкладки",
    });
  } finally {
    peerDB.close();
  }
});
it("refuses direction changes from a replaced epoch even when IDs match", async () => {
  const data = await db.read(),
    base = data.tracks[0];
  await db.metadata.put({ id: "epoch", value: "replacement" });
  await expect(
    service.updateTrack(
      { ...base, name: "Старый ввод" },
      data.storageEpoch,
      base,
    ),
  ).rejects.toThrow(/Город/);
  expect(await db.tracks.get(base.id)).toEqual(base);
});
it("can save a direction twice while preserving earned progress and newer archive state", async () => {
  const data = await db.read(),
    base = data.tracks[0];
  await db.tracks.update(base.id, { balance: 7, stage: 2 });
  await service.updateTrack(
    { ...base, description: "Первое сохранение" },
    data.storageEpoch,
    base,
  );
  const saved = (await db.tracks.get(base.id))!;
  await service.updateTrack(
    { ...saved, description: "Второе сохранение" },
    data.storageEpoch,
    saved,
  );
  const current = (await db.tracks.get(base.id))!;
  await service.updateTrack(
    { ...current, archived: true },
    data.storageEpoch,
    current,
  );
  await expect(
    service.updateTrack(
      { ...current, name: "Устаревший заголовок" },
      data.storageEpoch,
      current,
    ),
  ).rejects.toThrow(/другой вкладке/);
  expect(await db.tracks.get(base.id)).toMatchObject({
    description: "Второе сохранение",
    archived: true,
    balance: 7,
    stage: 2,
  });
});

const mutations = [
  "end-byte",
  "end-record",
  "directory",
  "count",
  "directory-offset",
  "disk",
  "central-signature",
  "local-name",
  "method",
  "crc",
  "crc-both",
  "local-offset",
] as const;
it.each(mutations)(
  "rejects incomplete or inconsistent ZIP (%s) before replacement",
  async (mutation) => {
    let bytes = new Uint8Array(await (await exportCity(db)).arrayBuffer());
    const end = bytes.length - 22,
      view = new DataView(bytes.buffer);
    const central = view.getUint32(end + 16, true);
    if (mutation === "end-byte") bytes = bytes.slice(0, -1);
    if (mutation === "end-record") bytes = bytes.slice(0, -22);
    if (mutation === "directory") bytes = bytes.slice(0, central);
    if (mutation === "count") view.setUint16(end + 10, 1, true);
    if (mutation === "directory-offset")
      view.setUint32(end + 16, central + 1, true);
    if (mutation === "disk") view.setUint16(end + 4, 1, true);
    if (mutation === "central-signature") bytes[central] ^= 1;
    if (mutation === "local-name") bytes[30] ^= 1;
    if (mutation === "method") view.setUint16(central + 10, 8, true);
    if (mutation === "crc") bytes[central + 16] ^= 1;
    if (mutation === "crc-both") {
      bytes[central + 16] ^= 1;
      bytes[14] ^= 1;
    }
    if (mutation === "local-offset") view.setUint32(central + 42, 1, true);
    const before = await db.read();
    await expect(
      (async () => replaceCity(db, await inspectArchive(new Blob([bytes]))))(),
    ).rejects.toThrow();
    expect(await db.read()).toEqual(before);
  },
);
it.each([0, 6] as const)(
  "keeps complete STORE/DEFLATE archives importable (level %i)",
  async (level) => {
    const archive = await exportCity(db),
      files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    const inspected = await inspectArchive(
      new Blob([zipSync(files, { level })]),
    );
    expect(inspected.data.tracks[0].name).toBe("Оптика");
  },
);
it.each([false, true])(
  "keeps streaming ZIP data descriptors importable and rejects damaged descriptors (deflate: %s)",
  async (deflate) => {
    const files = unzipSync(
      new Uint8Array(await (await exportCity(db)).arrayBuffer()),
    );
    const chunks: Uint8Array[] = [];
    const zip = new Zip((error, bytes) => {
      if (error) throw error;
      chunks.push(bytes);
    });
    for (const [name, bytes] of Object.entries(files)) {
      const entry = deflate ? new ZipDeflate(name) : new ZipPassThrough(name);
      zip.add(entry);
      entry.push(bytes, true);
    }
    zip.end();
    const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.length;
    }
    expect((await inspectArchive(new Blob([bytes]))).data.tracks[0].name).toBe(
      "Оптика",
    );
    const view = new DataView(bytes.buffer),
      central = view.getUint32(bytes.length - 6, true);
    const descriptor =
      30 +
      view.getUint16(26, true) +
      view.getUint16(28, true) +
      view.getUint32(central + 20, true);
    bytes[descriptor + 4] ^= 1;
    const before = await db.read();
    await expect(inspectArchive(new Blob([bytes]))).rejects.toThrow();
    expect(await db.read()).toEqual(before);
  },
);
it("accepts a complete ZIP with its declared end comment", async () => {
  const original = new Uint8Array(await (await exportCity(db)).arrayBuffer());
  const bytes = new Uint8Array([...original, 65, 66, 67]);
  new DataView(bytes.buffer).setUint16(original.length - 2, 3, true);
  expect((await inspectArchive(new Blob([bytes]))).data.city.name).toBe(
    "Проверка сохранности",
  );
});
