import { expect, it } from "vitest";
import { CityDB } from "../../src/storage/db";
import { CityService } from "../../src/storage/service";
import { researchContext, recentResearch } from "../../src/domain/continuation";
import type {
  Activity,
  CityData,
  LearningObject,
  Note,
  ProgressEvent,
  Track,
} from "../../src/domain/model";

const date = (n: number) =>
  `2026-10-${String(n).padStart(2, "0")}T10:00:00.000Z`;
const track = (
  id: string,
  archived = false,
  type: Track["type"] = "skill",
): Track => ({
  id,
  archived,
  type,
  name: id,
  description: "",
  goal: "",
  schedule: "",
  unit: "",
  comparison: "min",
  balance: 0,
  stage: 1,
  createdAt: date(1),
});
const object = (id: string, trackId = id): LearningObject => ({
  id,
  trackId,
  name: id,
  nextQuestion: "Почему?",
  stage: 1,
  built: false,
  initial: false,
  createdAt: date(1),
});
const note = (id: string, learningObjectId: string, day: number): Note => ({
  id,
  learningObjectId,
  trackId: learningObjectId,
  title: id,
  doc: { type: "doc", content: [{ type: "paragraph" }] },
  text: "",
  tags: [],
  revision: 1,
  createdAt: date(1),
  updatedAt: date(day),
});
const activity = (
  id: string,
  learningObjectId: string,
  confirmed = true,
): Activity => ({
  id,
  learningObjectId,
  trackId: learningObjectId,
  title: id,
  result: `Вывод ${id}`,
  kind: "explore",
  date: "2026-10-01",
  timezone: "UTC",
  noteIds: [],
  confirmed,
  archived: false,
  achieved: true,
  createdAt: date(1),
});
const event = (a: Activity, day: number): ProgressEvent => ({
  id: `activity:${a.id}`,
  type: "activity",
  activityId: a.id,
  learningObjectId: a.learningObjectId,
  trackId: a.trackId,
  createdAt: date(day),
  amount: 1,
  ruleVersion: 1,
  description: a.title,
});
function data(): CityData {
  return {
    storageEpoch: "test",
    tracks: [
      track("a"),
      track("b"),
      track("c"),
      track("d"),
      track("e", true),
      track("h", false, "habit"),
    ],
    learningObjects: ["a", "b", "c", "d", "e", "h"].map((id) => object(id)),
    notes: [],
    activities: [],
    events: [],
    snapshots: [],
    buildings: [],
    districts: [],
  };
}

it("offers no invented work for a fresh city or research without materials", () => {
  expect(recentResearch(data())).toEqual([]);
  expect(researchContext(data(), "a").latestNote).toBeUndefined();
});
it("ranks at most three active learning objects by saved note or confirmation, never layout", () => {
  const d = data();
  d.notes = [
    note("a-note", "a", 2),
    note("b-note", "b", 3),
    note("c-note", "c", 4),
    note("d-note", "d", 5),
    note("archived", "e", 20),
    note("habit", "h", 21),
  ];
  const a = activity("a-result", "a");
  d.activities = [a];
  d.events = [event(a, 6), { ...event(a, 22), id: "layout", type: "layout" }];
  const before = structuredClone(d);
  expect(
    recentResearch(d).map((r) => [r.object.id, r.recent?.kind, r.recent?.at]),
  ).toEqual([
    ["a", "result", date(6)],
    ["d", "note", date(5)],
    ["c", "note", date(4)],
  ]);
  expect(d).toEqual(before);
});
it("uses confirmation time rather than creation or activity date and excludes drafts and broken links", () => {
  const d = data();
  const older = activity("old-draft", "a");
  const newer = { ...activity("new-record", "a"), createdAt: date(5) };
  const draft = { ...activity("unconfirmed", "a", false), createdAt: date(20) };
  d.activities = [older, newer, draft];
  d.events = [
    event(older, 10),
    event(newer, 6),
    event(draft, 21),
    { ...event(newer, 22), activityId: "missing" },
    { ...event(newer, 23), learningObjectId: "b" },
  ];
  expect(researchContext(d, "a").latestResult?.activity.id).toBe("old-draft");
  expect(recentResearch(d).map((r) => r.object.id)).toEqual(["a"]);
});
it("breaks timestamp ties by stable IDs independent of input order, including latest note", () => {
  const d = data();
  d.notes = [note("z", "a", 2), note("a", "a", 2), note("b", "b", 2)];
  expect(researchContext(d, "a").latestNote?.id).toBe("a");
  const expected = recentResearch(d);
  d.notes.reverse();
  d.learningObjects.reverse();
  d.tracks.reverse();
  expect(recentResearch(d)).toEqual(expected);
  expect(expected.map((r) => r.object.id)).toEqual(["a", "b"]);
});
it("a later saved note becomes the continuation target without requiring a building", () => {
  const d = data();
  d.notes = [note("old", "a", 2), note("new", "a", 3)];
  expect(recentResearch(d)[0].latestNote?.id).toBe("new");
  d.notes[0].updatedAt = date(4);
  expect(recentResearch(d)[0].latestNote?.id).toBe("old");
});

it("refuses explicit note creation from an obsolete city even when owner IDs match", async () => {
  const db = new CityDB(`continuation-${crypto.randomUUID()}`);
  try {
    const service = new CityService(db);
    await service.initialize("Тест", "Свет");
    const data = await db.read();
    await db.metadata.put({ id: "epoch", value: "replacement" });
    await expect(
      service.createNote(
        data.tracks[0].id,
        data.learningObjects[0].id,
        data.storageEpoch,
      ),
    ).rejects.toThrow(/Город/);
    expect(await db.notes.count()).toBe(0);
  } finally {
    await db.delete();
  }
});

it("compares valid imported ISO timestamps by time rather than fractional formatting", () => {
  const d = data();
  d.notes = [
    { ...note("old", "a", 2), updatedAt: "2026-10-02T10:00:00Z" },
    { ...note("new", "a", 2), updatedAt: "2026-10-02T10:00:00.500Z" },
    { ...note("b", "b", 2), updatedAt: "2026-10-02T10:00:00.600Z" },
  ];
  const a = activity("a-result", "a"),
    b = activity("b-result", "a");
  d.activities = [a, b];
  d.events = [
    { ...event(a, 2), createdAt: "2026-10-02T10:00:00Z" },
    { ...event(b, 2), createdAt: "2026-10-02T10:00:00.100Z" },
  ];
  expect(researchContext(d, "a").latestNote?.id).toBe("new");
  expect(researchContext(d, "a").latestResult?.activity.id).toBe("b-result");
  expect(recentResearch(d).map((r) => r.object.id)).toEqual(["b", "a"]);
  d.notes[0].updatedAt = "2026-10-02T10:00:00.500Z";
  d.notes[1].updatedAt = "2026-10-02T10:00:00.5000Z";
  expect(researchContext(d, "a").latestNote?.id).toBe("new");
});
