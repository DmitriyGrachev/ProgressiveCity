import Dexie from "dexie";
import type { CityDB } from "./db";
import type { ValidatedArchive } from "./backup";
import { captureArchiveData } from "./capacity";
import type { CityData, City, Attachment } from "../domain/model";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, v]) => [key, canonical(v)]),
    );
  return value;
}
async function digest(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function contentDigest(
  data: Omit<CityData, "storageEpoch" | "city"> & {
    city: City;
    attachments: Pick<Attachment, "id" | "name" | "mime" | "size">[];
  },
) {
  const normalized = Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      Array.isArray(value)
        ? [...value].sort((a: { id: string }, b: { id: string }) =>
            a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
          )
        : value,
    ]),
  );
  return digest(
    new TextEncoder().encode(JSON.stringify(canonical(normalized))),
  );
}
interface VerifiedBackup {
  epoch: string;
  contentDigest: string;
  verifiedAt: string;
  exportedAt?: string;
}
const stampKey = (epoch: string) => `backup:${epoch}`;
export async function backupStatus(db: CityDB) {
  const captured = await db.transaction(
    "r",
    [...db.cityTables, db.clientState],
    async () => {
      const current = await captureArchiveData(db);
      const stamp = (await db.clientState.get(stampKey(current.epoch)))
        ?.value as VerifiedBackup | undefined;
      return { ...current, stamp };
    },
  );
  const fingerprint = await contentDigest(captured.data);
  return {
    verifiedAt: captured.stamp?.verifiedAt,
    exportedAt: captured.stamp?.exportedAt,
    current:
      captured.stamp?.epoch === captured.epoch &&
      captured.stamp.contentDigest === fingerprint,
  };
}
/** A download is not evidence of a saved file: this receives an inspected user-selected archive. */
export async function verifyBackupForCurrentCity(
  db: CityDB,
  archive: ValidatedArchive,
) {
  const captured = await captureArchiveData(db);
  const fingerprint = await contentDigest(archive.data);
  if ((await contentDigest(captured.data)) !== fingerprint) return false;
  const originals = new Map(captured.attachments.map((a) => [a.id, a]));
  for (const image of archive.attachments) {
    const original = originals.get(image.id);
    if (
      !original ||
      (await digest(new Uint8Array(await original.blob.arrayBuffer()))) !==
        (await digest(new Uint8Array(await image.blob.arrayBuffer())))
    )
      return false;
  }
  return db.transaction("rw", [...db.cityTables, db.clientState], async () => {
    const current = await captureArchiveData(db);
    if (
      current.epoch !== captured.epoch ||
      (await Dexie.waitFor(contentDigest(current.data))) !== fingerprint
    )
      return false;
    await db.clientState.put({
      id: stampKey(current.epoch),
      value: {
        epoch: current.epoch,
        contentDigest: fingerprint,
        verifiedAt: new Date().toISOString(),
        exportedAt: archive.exportedAt,
      } satisfies VerifiedBackup,
    });
    return true;
  });
}
