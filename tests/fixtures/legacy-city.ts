import { strToU8, zipSync } from "fflate";

export const legacyStores = {
  cities: "id",
  tracks: "id",
  buildings: "id,&trackId",
  districts: "id",
  notes: "id,trackId,updatedAt,*tags",
  attachments: "id",
  activities: "id,trackId,date",
  events: "id,type,trackId,createdAt",
  snapshots: "id,createdAt",
  metadata: "id",
};
export const pixel = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE2cAAAAASUVORK5CYII=",
  ),
  (c) => c.charCodeAt(0),
);
export function legacyCity() {
  const createdAt = "2026-09-01T10:00:00.000Z";
  const building = {
    id: "old-building",
    trackId: "photo",
    kind: "workshop",
    name: "Фотография",
    color: "#bc7153",
    x: 19,
    y: 19,
    w: 2,
    h: 2,
  };
  return {
    city: {
      id: "city",
      name: "Старый город",
      timezone: "Europe/Chisinau",
      reducedMotion: false,
      createdAt,
      rules: { version: 1, rewards: [1, 2, 3], costs: [3, 6] },
    },
    tracks: [
      {
        id: "photo",
        name: "Фотография",
        type: "skill",
        description: "",
        goal: "",
        schedule: "",
        unit: "",
        comparison: "min",
        archived: false,
        balance: 3,
        stage: 2,
        createdAt,
      },
    ],
    buildings: [building],
    districts: [],
    notes: [
      {
        id: "old-note",
        trackId: "photo",
        title: "Первый свет",
        text: "Мой материал",
        tags: ["свет"],
        revision: 2,
        createdAt,
        updatedAt: createdAt,
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Мой материал" }],
            },
            {
              type: "attachmentImage",
              attrs: { attachmentId: "photo-image", alt: "Свет" },
            },
          ],
        },
      },
    ],
    activities: ["first", "second"].map((id) => ({
      id,
      trackId: "photo",
      title: id,
      result: "Проверил свет",
      kind: "apply",
      date: "2026-09-01",
      timezone: "Europe/Chisinau",
      noteIds: ["old-note"],
      achieved: true,
      confirmed: true,
      archived: false,
      createdAt,
    })),
    events: [
      ...["first", "second"].map((id) => ({
        id: `activity:${id}`,
        type: "activity",
        trackId: "photo",
        activityId: id,
        amount: 3,
        ruleVersion: 1,
        description: "Свет",
        createdAt,
      })),
      {
        id: "upgrade:old",
        type: "upgrade",
        trackId: "photo",
        amount: -3,
        ruleVersion: 1,
        description: "Фотография: этап 2",
        createdAt,
      },
    ],
    snapshots: [
      {
        id: "old-snapshot",
        name: "До улучшения",
        createdAt,
        buildings: [{ ...building, stage: 1 }],
        districts: [],
      },
    ],
    attachments: [
      {
        id: "photo-image",
        name: "light.png",
        mime: "image/png",
        size: pixel.length,
      },
    ],
  };
}
export async function archiveBytes(
  data: unknown,
  version: number,
  images: Record<string, Uint8Array> = {},
) {
  const files = { "data.json": strToU8(JSON.stringify(data)), ...images };
  const manifest = {
    format: "progress-city",
    version,
    exportedAt: "2026-09-19T10:00:00.000Z",
    files: await Promise.all(
      Object.entries(files).map(async ([path, bytes]) => ({
        path,
        size: bytes.length,
        sha256: Array.from(
          new Uint8Array(
            await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
          ),
          (b) => b.toString(16).padStart(2, "0"),
        ).join(""),
      })),
    ),
  };
  return new Blob([
    zipSync(
      { ...files, "manifest.json": strToU8(JSON.stringify(manifest)) },
      { level: 0 },
    ),
  ]);
}
