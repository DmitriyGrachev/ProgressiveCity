import {
  isLearning,
  type Activity,
  type CityData,
  type Note,
  type ProgressEvent,
} from "./model";

type ContextData = Pick<
  CityData,
  "tracks" | "learningObjects" | "notes" | "activities" | "events"
>;
export interface ResearchContext {
  latestNote?: Note;
  latestResult?: { activity: Activity; event: ProgressEvent };
  recent?: { at: string; kind: "note" | "result" };
}
// Lexical IDs provide an explicit tie-break independent of query order/locale.
const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byTime = (a: string, b: string) => Date.parse(a) - Date.parse(b);
const newer = (at: string, id: string, oldAt: string, oldId: string) =>
  byTime(at, oldAt) > 0 || (byTime(at, oldAt) === 0 && byId(id, oldId) < 0);
function contexts(data: ContextData) {
  const objects = new Map(data.learningObjects.map((o) => [o.id, o]));
  const result = new Map<string, ResearchContext>();
  const get = (id: string) => {
    let context = result.get(id);
    if (!context) {
      context = {};
      result.set(id, context);
    }
    return context;
  };
  for (const note of data.notes) {
    const object = note.learningObjectId && objects.get(note.learningObjectId);
    if (!object || object.trackId !== note.trackId) continue;
    const context = get(object.id),
      old = context.latestNote;
    if (!old || newer(note.updatedAt, note.id, old.updatedAt, old.id))
      context.latestNote = note;
  }
  const activities = new Map(data.activities.map((a) => [a.id, a]));
  for (const event of data.events) {
    if (
      event.type !== "activity" ||
      !event.activityId ||
      !event.learningObjectId
    )
      continue;
    const activity = activities.get(event.activityId),
      object = objects.get(event.learningObjectId);
    if (
      !object ||
      !activity?.confirmed ||
      activity.learningObjectId !== object.id ||
      activity.trackId !== object.trackId ||
      event.trackId !== object.trackId
    )
      continue;
    const context = get(object.id),
      old = context.latestResult;
    if (
      !old ||
      newer(event.createdAt, event.id, old.event.createdAt, old.event.id)
    )
      context.latestResult = { activity, event };
  }
  for (const context of result.values()) {
    const noteAt = context.latestNote?.updatedAt,
      resultAt = context.latestResult?.event.createdAt;
    // Confirmation wins when both persisted timestamps are identical.
    if (resultAt && (!noteAt || byTime(resultAt, noteAt) >= 0))
      context.recent = { at: resultAt, kind: "result" };
    else if (noteAt) context.recent = { at: noteAt, kind: "note" };
  }
  return result;
}
export function researchContext(
  data: ContextData,
  objectId: string,
): ResearchContext {
  return contexts(data).get(objectId) ?? {};
}
export function recentResearch(data: ContextData) {
  const index = contexts(data);
  const tracks = new Map(
    data.tracks
      .filter((t) => !t.archived && isLearning(t))
      .map((t) => [t.id, t]),
  );
  return data.learningObjects
    .flatMap((object) => {
      const track = tracks.get(object.trackId),
        context = index.get(object.id);
      return track && context?.recent
        ? [{ object, track, ...context, recent: context.recent }]
        : [];
    })
    .sort(
      (a, b) =>
        byTime(b.recent.at, a.recent.at) || byId(a.object.id, b.object.id),
    )
    .slice(0, 3);
}
