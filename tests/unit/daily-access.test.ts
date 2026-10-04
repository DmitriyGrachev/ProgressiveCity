import { afterEach, beforeEach, expect, it } from "vitest";
import { CityDB } from "../../src/storage/db";
import { CityService } from "../../src/storage/service";
import { createSearchIndex, searchCity } from "../../src/domain/search";
import { habitDay } from "../../src/domain/habits";
import { localDate } from "../../src/domain/rules";
let db: CityDB;
let service: CityService;
beforeEach(async () => {
  db = new CityDB(`daily-${crypto.randomUUID()}`);
  service = new CityService(db);
  await service.initialize("Город", "Свет");
});
afterEach(async () => {
  await db.delete();
});
it("search ranks titles before contents, preserves stable ties, tags and archive ownership", async () => {
  const track = (await db.tracks.toArray())[0];
  for (const [title, text, tags] of [
    ["Свет", "", []],
    ["Свет лампы", "", []],
    ["Опыт", "свет", ["LatinTag"]],
  ] as const) {
    const note = await service.createNote(track.id);
    await service.saveNote({
      ...note,
      title,
      tags: [...tags],
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            ...(text ? { content: [{ type: "text", text }] } : {}),
          },
        ],
      },
    });
  }
  const data = await db.read();
  const index = createSearchIndex(data);
  expect(
    searchCity(index, " свет ", false)
      .filter((x) => x.type === "note")
      .map((x) => x.title),
  ).toEqual(["Свет", "Свет лампы", "Опыт"]);
  expect(searchCity(index, "latintag", false).map((x) => x.title)).toEqual([
    "Опыт",
  ]);
  expect(searchCity(index, "missing", false)).toEqual([]);
  expect(searchCity(index, "", false)).toEqual([]);
  expect(searchCity(index, "свет", false)).toEqual(
    searchCity(
      createSearchIndex({ ...data, notes: [...data.notes].reverse() }),
      "свет",
      false,
    ),
  );
  await service.updateTrack({ ...track, archived: true });
  const archived = createSearchIndex(await db.read());
  expect(searchCity(archived, "свет", false)).toEqual([]);
  expect(
    searchCity(archived, "свет", true).every(
      (x) => x.archived && x.path.includes("Свет"),
    ),
  ).toBe(true);
});
it("habit day uses the real event, not duplicate drafts or achieved flags", async () => {
  const track = await service.createTrack({
    name: "Прогулка",
    type: "habit",
    description: "",
    goal: "Пройтись",
    schedule: "по желанию",
    unit: "мин",
    comparison: "min",
  });
  const date = "2026-10-04";
  expect(habitDay(await db.read(), track.id, date).status).toBe("none");
  const a = await service.saveActivity({
    trackId: track.id,
    title: "День",
    result: "Наблюдение",
    kind: "apply",
    date,
    noteIds: [],
    achieved: false,
  });
  expect(habitDay(await db.read(), track.id, date).status).toBe("draft");
  await service.confirmActivity(a.id);
  const duplicate = await service.saveActivity({
    ...a,
    id: undefined,
    achieved: true,
  });
  await service.confirmActivity(duplicate.id);
  const day = habitDay(await db.read(), track.id, date);
  expect(day.status).toBe("zero");
  expect(day.activity?.id).toBe(a.id);
  expect((await db.tracks.get(track.id))!.balance).toBe(0);
  expect(await db.events.count()).toBe(1);
  expect(localDate("Europe/Chisinau", new Date("2026-10-04T21:05:00Z"))).toBe(
    "2026-10-05",
  );
  expect(
    localDate("America/Los_Angeles", new Date("2026-10-04T00:05:00Z")),
  ).toBe("2026-10-03");
});
it("activity expected fields reject a concurrent edit without changing the stored result", async () => {
  const track = (await db.tracks.toArray())[0];
  const a = await service.saveActivity({
    trackId: track.id,
    title: "Опыт",
    result: "Исходный",
    kind: "explore",
    date: "2026-10-04",
    noteIds: [],
    achieved: true,
  });
  await service.saveActivity({ ...a, result: "Другой вкладки" }, undefined, a);
  await expect(
    service.saveActivity({ ...a, result: "Устаревший" }, undefined, a),
  ).rejects.toThrow("другой вкладке");
  expect((await db.activities.get(a.id))!.result).toBe("Другой вкладки");
});
