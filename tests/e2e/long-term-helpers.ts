import type { Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { paddedPng } from "../fixtures/zip-boundary";
import { dataSchema, validateRelations } from "../../src/storage/validation";

export async function largeLibraryArchive(path: string) {
  const base = unzipSync(
    await readFile(".tools/daily-legacy-v2.progresscity.zip"),
  );
  const data = dataSchema.parse(JSON.parse(strFromU8(base["data.json"])));
  data.city.name = "Большая синтетическая библиотека";
  const template = data.notes[0];
  for (const note of data.notes) {
    const text = `Синтетический материал ${note.title}`;
    note.text = text;
    note.doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    };
  }
  while (data.notes.length < 1000) {
    const index = data.notes.length,
      text = `Материал ${index}. ${"synthetic ".repeat(170)}`;
    data.notes.push({
      ...template,
      id: `long-term-note-${index}`,
      title: `Материал ${index}`,
      text,
      doc: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      },
    });
  }
  const files: Record<string, Uint8Array> = {};
  const hashes: Record<string, string> = {};
  data.attachments = Array.from({ length: 18 }, (_, index) => {
    const id = `long-term-image-${index}`,
      bytes = paddedPng(4 * 1024 * 1024, index);
    files[`attachments/${id}`] = bytes;
    hashes[id] = createHash("sha256").update(bytes).digest("hex");
    return {
      id,
      name: `original-${index}.png`,
      mime: "image/png",
      size: bytes.length,
    };
  });
  data.notes[0].doc = {
    type: "doc",
    content: [
      ...data.notes[0].doc.content!,
      ...data.attachments.map((a) => ({
        type: "attachmentImage",
        attrs: { attachmentId: a.id, alt: a.name },
      })),
      { type: "paragraph" },
    ],
  };
  validateRelations(data);
  files["data.json"] = strToU8(JSON.stringify(data));
  const manifest = {
    format: "progress-city",
    version: 3,
    exportedAt: new Date().toISOString(),
    files: Object.entries(files).map(([path, bytes]) => ({
      path,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    })),
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest));
  await writeFile(path, zipSync(files, { level: 0 }));
  return { hashes, buildings: data.buildings.length };
}

export async function habitGrowthArchive(path: string) {
  const base = unzipSync(
    await readFile(".tools/daily-legacy-v2.progresscity.zip"),
  );
  const data = dataSchema.parse(JSON.parse(strFromU8(base["data.json"]))),
    stamp = "2026-10-01T12:00:00.000Z";
  data.tracks = [
    {
      ...data.tracks[0],
      id: "growth-habit",
      name: "Прогулка",
      type: "habit",
      stage: 3,
      balance: 6,
    },
  ];
  data.learningObjects = [];
  data.notes = [];
  data.attachments = [];
  data.districts = [];
  data.activities = Array.from({ length: 5 }, (_, i) => ({
    id: `walk-${i}`,
    trackId: "growth-habit",
    title: `Прогулка ${i + 1}`,
    result: "Подтверждённый синтетический результат",
    kind: "apply",
    date: `2026-10-0${i + 1}`,
    timezone: data.city.timezone,
    noteIds: [],
    achieved: true,
    confirmed: true,
    archived: false,
    createdAt: stamp,
  }));
  data.events = data.activities.map((a) => ({
    id: `habit:${a.trackId}:${a.date}`,
    trackId: a.trackId,
    activityId: a.id,
    type: "activity",
    amount: 3,
    ruleVersion: 1,
    description: a.title,
    createdAt: stamp,
  }));
  data.events.push(
    ...[3, 6].map((cost, i) => ({
      id: `upgrade:growth-${i}`,
      trackId: "growth-habit",
      type: "upgrade" as const,
      amount: -cost,
      ruleVersion: 1,
      description: `Этап ${i + 2}`,
      createdAt: stamp,
    })),
  );
  data.buildings = [
    {
      id: "growth-house",
      trackId: "growth-habit",
      kind: "workshop",
      name: "Дом прогулки",
      color: "#bc7153",
      x: 19,
      y: 19,
      w: 2,
      h: 2,
    },
  ];
  data.snapshots = [
    {
      id: "growth-snapshot",
      name: "Привычка достигла этапа 3",
      createdAt: stamp,
      buildings: data.buildings.map((b) => ({ ...b, stage: 3 })),
      districts: [],
    },
  ];
  validateRelations(data);
  const bytes = strToU8(JSON.stringify(data));
  const manifest = {
    format: "progress-city",
    version: 3,
    exportedAt: stamp,
    files: [
      {
        path: "data.json",
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    ],
  };
  await writeFile(
    path,
    zipSync(
      {
        "data.json": bytes,
        "manifest.json": strToU8(JSON.stringify(manifest)),
      },
      { level: 0 },
    ),
  );
}

export async function imageHashes(page: Page) {
  return page.evaluate(
    () =>
      new Promise<Record<string, string>>((resolve, reject) => {
        const opening = indexedDB.open("progress-city-v1");
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const database = opening.result,
            request = database
              .transaction("attachments")
              .objectStore("attachments")
              .getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            database.close();
            void (async () => {
              const result: Record<string, string> = {};
              for (const image of request.result) {
                const hash = await crypto.subtle.digest(
                  "SHA-256",
                  await image.blob.arrayBuffer(),
                );
                result[image.id] = Array.from(new Uint8Array(hash), (b) =>
                  b.toString(16).padStart(2, "0"),
                ).join("");
              }
              resolve(result);
            })().catch(reject);
          };
        };
      }),
  );
}
