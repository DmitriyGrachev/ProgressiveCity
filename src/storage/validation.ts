import { z } from "zod";
import {
  dataSchema as legacySchema,
  validateDocument,
} from "./legacy-validation";
import { canPlace, inside } from "../domain/rules";
import { isLearning } from "../domain/model";
export { validateDocument } from "./legacy-validation";

const identifier = legacySchema.shape.tracks.element.shape.id;
const objectLink = { learningObjectId: identifier.optional() };
const building = legacySchema.shape.buildings.element.extend(objectLink);
export const dataSchema = legacySchema.extend({
  city: legacySchema.shape.city.extend({
    rules: legacySchema.shape.city.shape.rules.extend({
      constructionCost: z.number().int().min(1).max(100),
    }),
  }),
  learningObjects: z
    .array(
      z
        .object({
          id: identifier,
          trackId: identifier,
          name: z.string().trim().min(1).max(250),
          nextQuestion: z.string().max(2000),
          stage: legacySchema.shape.tracks.element.shape.stage,
          built: z.boolean(),
          initial: z.boolean(),
          createdAt: z.string().datetime(),
        })
        .strict(),
    )
    .max(5000),
  buildings: z.array(building).max(1600),
  notes: z.array(legacySchema.shape.notes.element.extend(objectLink)).max(5000),
  activities: z
    .array(legacySchema.shape.activities.element.extend(objectLink))
    .max(20_000),
  events: z
    .array(
      legacySchema.shape.events.element.extend({
        ...objectLink,
        type: z.enum(["activity", "upgrade", "construction", "layout"]),
        sourceActivityId: identifier.optional(),
      }),
    )
    .max(50_000),
  snapshots: z
    .array(
      legacySchema.shape.snapshots.element.extend({
        buildings: z
          .array(
            legacySchema.shape.snapshots.element.shape.buildings.element.extend(
              objectLink,
            ),
          )
          .max(1600),
      }),
    )
    .max(1000),
});
export type ArchiveData = z.infer<typeof dataSchema>;

export function validateRelations(data: ArchiveData) {
  const fail = () => {
    throw new Error("Нарушены связи, этапы или геометрия данных архива.");
  };
  for (const list of [
    data.tracks,
    data.learningObjects,
    data.buildings,
    data.districts,
    data.notes,
    data.activities,
    data.events,
    data.snapshots,
    data.attachments,
  ])
    if (new Set(list.map((v) => v.id)).size !== list.length) fail();
  const tracks = new Map(data.tracks.map((t) => [t.id, t]));
  const objects = new Map(data.learningObjects.map((o) => [o.id, o]));
  const notes = new Map(data.notes.map((n) => [n.id, n]));
  const activities = new Map(data.activities.map((a) => [a.id, a]));
  const events = new Map(data.events.map((e) => [e.id, e]));
  const attachmentIds = new Set(data.attachments.map((a) => a.id));
  const validOwner = (
    trackId: string | undefined,
    objectId: string | undefined,
  ) => {
    if (!trackId) return !objectId;
    const track = tracks.get(trackId);
    return Boolean(
      track &&
      (isLearning(track)
        ? objectId && objects.get(objectId)?.trackId === trackId
        : !objectId),
    );
  };
  for (const o of data.learningObjects) {
    const track = tracks.get(o.trackId);
    if (
      !track ||
      !isLearning(track) ||
      (o.initial && (o.id !== o.trackId || !o.built))
    )
      fail();
    const ownEvents = data.events.filter((e) => e.learningObjectId === o.id);
    if (
      ownEvents.filter((e) => e.type === "upgrade").length !== o.stage - 1 ||
      ownEvents.filter((e) => e.type === "construction").length !==
        (o.initial || !o.built ? 0 : 1) ||
      (!o.built && o.stage !== 1)
    )
      fail();
  }
  const checkLayout = (
    bs: ArchiveData["buildings"],
    ds: ArchiveData["districts"],
  ) => {
    const placed = bs.flatMap((b) =>
      b.trackId
        ? [
            b.learningObjectId
              ? `object:${b.learningObjectId}`
              : `track:${b.trackId}`,
          ]
        : [],
    );
    if (
      new Set(placed).size !== placed.length ||
      new Set(bs.map((b) => b.id)).size !== bs.length ||
      new Set(ds.map((d) => d.id)).size !== ds.length
    )
      fail();
    for (const b of bs) {
      const progress = ["workshop", "library", "pavilion"].includes(b.kind);
      if (
        !inside(b) ||
        !canPlace(b, bs, b.id) ||
        !validOwner(b.trackId, b.learningObjectId) ||
        (b.learningObjectId && !objects.get(b.learningObjectId)?.built) ||
        progress !== Boolean(b.trackId) ||
        b.w !== (progress || ["park", "plaza"].includes(b.kind) ? 2 : 1) ||
        b.h !== b.w
      )
        fail();
    }
    for (const d of ds) if (!canPlace(d, ds, d.id)) fail();
  };
  checkLayout(data.buildings, data.districts);
  for (const snapshot of data.snapshots) {
    checkLayout(snapshot.buildings, snapshot.districts);
    for (const building of snapshot.buildings) {
      const currentStage = building.learningObjectId
        ? objects.get(building.learningObjectId)?.stage
        : (tracks.get(building.trackId ?? "")?.stage ?? 1);
      if (!currentStage || building.stage > currentStage) fail();
    }
  }
  for (const n of data.notes)
    if (
      !validOwner(n.trackId, n.learningObjectId) ||
      !validateDocument(n.doc, attachmentIds)
    )
      fail();
  for (const a of data.activities) {
    if (
      !validOwner(a.trackId, a.learningObjectId) ||
      a.noteIds.some((id) => {
        const n = notes.get(id);
        return (
          !n ||
          n.trackId !== a.trackId ||
          n.learningObjectId !== a.learningObjectId
        );
      })
    )
      fail();
    if (a.confirmed) {
      const track = tracks.get(a.trackId)!;
      const key = isLearning(track)
        ? `activity:${a.id}`
        : `habit:${a.trackId}:${a.date}`;
      if (events.get(key)?.type !== "activity") fail();
    }
  }
  for (const e of data.events) {
    if (!validOwner(e.trackId, e.learningObjectId)) fail();
    if (
      e.type === "layout" &&
      (e.amount !== 0 ||
        e.ruleVersion !== 0 ||
        e.activityId ||
        e.sourceActivityId)
    )
      fail();
    if (
      (e.type === "upgrade" || e.type === "construction") &&
      (!e.trackId || e.amount >= 0 || e.ruleVersion < 1 || e.activityId)
    )
      fail();
    if (e.type === "construction" && !e.learningObjectId) fail();
    if (e.sourceActivityId) {
      const source = activities.get(e.sourceActivityId);
      if (
        !source?.confirmed ||
        source.trackId !== e.trackId ||
        !["upgrade", "construction"].includes(e.type)
      )
        fail();
    }
    if (e.type === "activity") {
      const a = activities.get(e.activityId ?? "");
      if (
        !a?.confirmed ||
        a.trackId !== e.trackId ||
        a.learningObjectId !== e.learningObjectId ||
        e.amount < 0 ||
        e.ruleVersion < 1
      )
        fail();
      if (
        a &&
        e.id !==
          (isLearning(tracks.get(a.trackId)!)
            ? `activity:${a.id}`
            : `habit:${a.trackId}:${a.date}`)
      )
        fail();
    }
  }
  for (const t of data.tracks) {
    const ownEvents = data.events.filter((e) => e.trackId === t.id);
    if (ownEvents.reduce((sum, e) => sum + e.amount, 0) !== t.balance) fail();
    if (isLearning(t)) {
      if (
        t.stage !== 1 ||
        data.learningObjects.filter((o) => o.trackId === t.id && o.initial)
          .length !== 1
      )
        fail();
    } else if (
      ownEvents.filter((e) => e.type === "upgrade").length !==
      t.stage - 1
    )
      fail();
  }
}
