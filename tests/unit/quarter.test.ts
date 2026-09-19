import Dexie from "dexie";
import { afterEach, expect, it } from "vitest";
import { CityDB } from "../../src/storage/db";
import { CityService } from "../../src/storage/service";
import {
  exportCity,
  inspectArchive,
  replaceCity,
} from "../../src/storage/backup";
import {
  archiveBytes,
  legacyCity,
  legacyStores,
  pixel,
} from "../fixtures/legacy-city";

const databases: Dexie[] = [];
function database() {
  const db = new CityDB(`quarter-${crypto.randomUUID()}`);
  databases.push(db);
  return db;
}
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete();
});

async function earn(
  service: CityService,
  trackId: string,
  learningObjectId?: string,
  noteIds: string[] = [],
) {
  const activity = await service.saveActivity({
    trackId,
    learningObjectId,
    title: "Опыт со светом",
    result: "Сравнил три варианта",
    kind: "apply",
    date: "2026-09-19",
    noteIds,
    achieved: true,
  });
  await service.confirmActivity(activity.id);
  return activity;
}

it("construction and upgrading compete for the same balance across connections", async () => {
  const db = database();
  const service = new CityService(db);
  await service.initialize("Квартал", "Свет");
  const track = (await db.tracks.toArray())[0];
  const research = await service.createLearningObject(track.id, "Новый объект");
  await earn(service, track.id);
  const peer = new CityDB(db.name);
  try {
    const results = await Promise.allSettled([
      service.construct(research.id, "competing-build"),
      new CityService(peer).upgradeObject(track.id, "competing-upgrade"),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect((await db.tracks.get(track.id))!.balance).toBe(0);
    expect(
      (await db.events.toArray()).filter((e) => e.amount < 0),
    ).toHaveLength(1);
    await inspectArchive(await exportCity(db));
  } finally {
    peer.close();
  }
});

it("upgrades only the selected object, preserves note ownership and past construction prices", async () => {
  const db = database();
  const service = new CityService(db);
  await service.initialize("Квартал", "Свет");
  const track = (await db.tracks.toArray())[0];
  const research = await service.createLearningObject(track.id, "Студия");
  const note = await service.createNote(track.id, research.id);
  const activity = await earn(service, track.id, research.id, [note.id]);
  await earn(service, track.id, research.id);
  await service.construct(research.id, "build", activity.id);
  await service.upgradeObject(research.id, "advance", activity.id);
  expect((await db.learningObjects.get(research.id))!.stage).toBe(2);
  expect((await db.learningObjects.get(track.id))!.stage).toBe(1);
  expect((await db.tracks.get(track.id))!.balance).toBe(0);
  await service.saveNote({ ...note, learningObjectId: track.id });
  expect((await db.notes.get(note.id))!.learningObjectId).toBe(research.id);
  expect(
    (await service.copyNote((await db.notes.get(note.id))!)).learningObjectId,
  ).toBe(research.id);
  await expect(
    service.saveActivity({ ...activity, learningObjectId: track.id }),
  ).rejects.toThrow(/закреплены/);
  await expect(earn(service, track.id, track.id, [note.id])).rejects.toThrow(
    /другому/,
  );
  await service.updateRules([1, 2, 3], [3, 6], 5);
  await earn(service, track.id);
  await earn(service, track.id);
  const next = await service.createLearningObject(track.id, "Проект");
  await service.construct(next.id, "build-next");
  expect((await db.events.get("construction:build"))!).toMatchObject({
    amount: -3,
    ruleVersion: 1,
    sourceActivityId: activity.id,
  });
  expect((await db.events.get("construction:build-next"))!).toMatchObject({
    amount: -5,
    ruleVersion: 2,
  });
  expect((await db.tracks.get(track.id))!.balance).toBe(1);
  await expect(service.construct(next.id, "build")).rejects.toThrow(
    /другому объекту/,
  );
  await inspectArchive(await exportCity(db));
});

it("does not spend a stale form against a restored city with the same IDs", async () => {
  const db = database();
  const service = new CityService(db);
  await service.initialize("Город", "Исследование");
  const track = (await db.tracks.toArray())[0];
  const research = await service.createLearningObject(track.id, "Новый объект");
  await earn(service, track.id);
  const epoch = (await db.read()).storageEpoch;
  await replaceCity(db, await inspectArchive(await exportCity(db)));
  await expect(
    service.construct(research.id, "stale", undefined, epoch),
  ).rejects.toThrow(/восстановлен/);
  expect((await db.tracks.get(track.id))!.balance).toBe(3);
  expect((await db.learningObjects.get(research.id))!.built).toBe(false);
});

it("migrates a real v1 database without losing stages, images, rewards or past layout", async () => {
  const db = database();
  const old = new Dexie(db.name);
  old.version(1).stores(legacyStores);
  const legacy = legacyCity();
  await old.table("cities").add(legacy.city);
  for (const [key, rows] of Object.entries(legacy)) {
    if (key === "city" || key === "attachments") continue;
    await old.table(key).bulkAdd(rows as object[]);
  }
  await old.table("attachments").add({
    ...legacy.attachments[0],
    blob: new Blob([pixel], { type: "image/png" }),
  });
  await old.table("metadata").add({ id: "epoch", value: "original-epoch" });
  old.close();
  const data = await db.read();
  expect(data.learningObjects).toEqual([
    {
      id: "photo",
      trackId: "photo",
      name: "Фотография",
      nextQuestion: "",
      stage: 2,
      built: true,
      initial: true,
      createdAt: legacy.tracks[0].createdAt,
    },
  ]);
  expect(data.tracks[0].balance).toBe(3);
  expect(data.buildings[0].learningObjectId).toBe("photo");
  expect(data.notes[0]).toMatchObject({
    id: "old-note",
    learningObjectId: "photo",
    revision: 2,
  });
  expect(
    data.events.find((e) => e.id === "upgrade:old")?.learningObjectId,
  ).toBe("photo");
  expect(data.snapshots[0].buildings[0].stage).toBe(1);
  expect(data.storageEpoch).toBe("original-epoch");
  expect(
    new Uint8Array(
      await (await db.attachments.get("photo-image"))!.blob.arrayBuffer(),
    ),
  ).toEqual(pixel);
  await new CityService(db).confirmActivity("first");
  expect((await db.tracks.get("photo"))!.balance).toBe(3);
  await inspectArchive(await exportCity(db));
});

it("reads v1 ZIP and round trips independently developed objects in v2", async () => {
  const db = database();
  await replaceCity(
    db,
    await inspectArchive(
      await archiveBytes(legacyCity(), 1, { "attachments/photo-image": pixel }),
    ),
  );
  const service = new CityService(db);
  const research = await service.createLearningObject("photo", "Студия света");
  const note = await service.createNote("photo", research.id);
  await service.construct(research.id, "purchase", "second");
  await service.placeBuilding({
    id: "studio",
    trackId: "photo",
    learningObjectId: research.id,
    kind: "pavilion",
    name: "Студия",
    color: "#647ba3",
    x: 23,
    y: 19,
    w: 2,
    h: 2,
  });
  await service.updateLearningObject({
    ...research,
    nextQuestion: "Как изменится тень?",
  });
  const restored = database();
  const archive = await inspectArchive(await exportCity(db));
  await replaceCity(restored, archive);
  expect((await restored.read()).learningObjects).toEqual(
    (await db.read()).learningObjects,
  );
  expect((await restored.notes.get(note.id))!.learningObjectId).toBe(
    research.id,
  );
  expect((await restored.learningObjects.get("photo"))!.stage).toBe(2);
  expect((await restored.learningObjects.get(research.id))!.stage).toBe(1);
  expect((await restored.learningObjects.get(research.id))!.built).toBe(true);
  await new CityService(restored).construct(research.id, "purchase", "second");
  expect((await restored.tracks.get("photo"))!.balance).toBe(0);
  await service.removeBuilding("studio");
  expect(await db.notes.get(note.id)).toBeDefined();
  expect((await db.learningObjects.get(research.id))!.built).toBe(true);
});

it("serializes construction against upgrades, prevents free placement and rolls failed spending back", async () => {
  const db = database();
  await replaceCity(
    db,
    await inspectArchive(
      await archiveBytes(legacyCity(), 1, { "attachments/photo-image": pixel }),
    ),
  );
  const service = new CityService(db);
  const research = await service.createLearningObject("photo", "Обработка");
  const building = {
    id: "new-building",
    trackId: "photo",
    learningObjectId: research.id,
    kind: "library" as const,
    name: "Обработка",
    color: "#647ba3",
    x: 1,
    y: 1,
    w: 2,
    h: 2,
  };
  await expect(service.placeBuilding(building)).rejects.toThrow(/строительств/);
  const fail = () => {
    throw new Error("QuotaExceededError test");
  };
  db.events.hook("creating", fail);
  await expect(service.construct(research.id, "retry")).rejects.toThrow(
    "QuotaExceededError",
  );
  expect((await db.tracks.get("photo"))!.balance).toBe(3);
  expect((await db.learningObjects.get(research.id))!.built).toBe(false);
  db.events.hook("creating").unsubscribe(fail);
  const peer = new CityDB(db.name);
  try {
    await Promise.all([
      service.construct(research.id, "retry"),
      new CityService(peer).construct(research.id, "retry"),
    ]);
    expect((await db.tracks.get("photo"))!.balance).toBe(0);
    expect(await db.events.where("type").equals("construction").count()).toBe(
      1,
    );
    await expect(service.upgradeObject(research.id, "upgrade")).rejects.toThrow(
      /очков/,
    );
    await service.placeBuilding(building);
    await expect(
      service.placeBuilding({ ...building, id: "duplicate", x: 4 }),
    ).rejects.toThrow();
  } finally {
    peer.close();
  }
});

it("rejects broken object ownership, stages and duplicated construction before replacing a city", async () => {
  const db = database();
  await replaceCity(
    db,
    await inspectArchive(
      await archiveBytes(legacyCity(), 1, { "attachments/photo-image": pixel }),
    ),
  );
  const archive = await inspectArchive(await exportCity(db));
  for (const mutate of [
    (data: typeof archive.data) => {
      data.notes[0].learningObjectId = "missing";
    },
    (data: typeof archive.data) => {
      data.learningObjects[0].stage = 3;
    },
    (data: typeof archive.data) => {
      data.learningObjects[0].built = false;
    },
    (data: typeof archive.data) => {
      data.snapshots[0].buildings[0].stage = 3;
    },
  ]) {
    const data = structuredClone(archive.data);
    mutate(data);
    await expect(replaceCity(db, { ...archive, data })).rejects.toThrow();
    expect((await db.read()).notes[0].title).toBe("Первый свет");
  }
});
