import { z } from "zod";
import type { JSONContent } from "@tiptap/core";
import { canPlace, inside, safeUrl, validDate } from "../domain/rules";
import { noteSchema } from "../notes/schema";

const identifier = z
  .string()
  .min(1)
  .max(180)
  .regex(/^[a-zA-Z0-9:_-]+$/);
const name = z.string().max(250);
const text = z.string().max(200_000);
const timestamp = z.string().datetime();
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const rect = {
  x: z.number().int().min(0).max(39),
  y: z.number().int().min(0).max(39),
  w: z.number().int().min(1).max(40),
  h: z.number().int().min(1).max(40),
};
const stage = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const buildingShape = {
  id: identifier,
  trackId: identifier.optional(),
  kind: z.enum([
    "workshop",
    "library",
    "pavilion",
    "road",
    "park",
    "plaza",
    "tree",
  ]),
  name,
  color,
  ...rect,
};
const building = z.object(buildingShape).strict();
const district = z.object({ id: identifier, name, color, ...rect }).strict();
export function validateDocument(
  value: unknown,
  attachmentIds?: Set<string>,
): value is JSONContent {
  let count = 0;
  function node(value: unknown, depth: number): boolean {
    if (
      ++count > 20_000 ||
      depth > 30 ||
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    )
      return false;
    const v = value as Record<string, unknown>;
    if (
      Object.keys(v).some(
        (k) => !["type", "text", "content", "attrs", "marks"].includes(k),
      )
    )
      return false;
    if (
      ![
        "doc",
        "paragraph",
        "heading",
        "text",
        "bulletList",
        "orderedList",
        "listItem",
        "blockquote",
        "codeBlock",
        "hardBreak",
        "horizontalRule",
        "attachmentImage",
      ].includes(String(v.type))
    )
      return false;
    if (
      v.text !== undefined &&
      (v.type !== "text" ||
        typeof v.text !== "string" ||
        v.text.length > 200_000)
    )
      return false;
    if (v.attrs !== undefined) {
      if (!v.attrs || typeof v.attrs !== "object" || Array.isArray(v.attrs))
        return false;
      const attrs = v.attrs as Record<string, unknown>;
      const allowed =
        v.type === "attachmentImage"
          ? ["attachmentId", "alt"]
          : v.type === "heading"
            ? ["level"]
            : v.type === "orderedList"
              ? ["start", "type"]
              : v.type === "codeBlock"
                ? ["language"]
                : [];
      if (Object.keys(attrs).some((k) => !allowed.includes(k))) return false;
      if (
        Object.values(attrs).some(
          (a) => a !== null && typeof a !== "string" && typeof a !== "number",
        )
      )
        return false;
      if (
        v.type === "heading" &&
        ![1, 2, 3, 4, 5, 6].includes(Number(attrs.level))
      )
        return false;
      if (
        v.type === "attachmentImage" &&
        (typeof attrs.attachmentId !== "string" ||
          (attachmentIds && !attachmentIds.has(attrs.attachmentId)))
      )
        return false;
    } else if (v.type === "attachmentImage") return false;
    if (v.marks !== undefined) {
      if (!Array.isArray(v.marks) || v.marks.length > 8) return false;
      for (const mark of v.marks) {
        if (
          !mark ||
          typeof mark !== "object" ||
          !["bold", "italic", "strike", "code", "underline", "link"].includes(
            mark.type,
          )
        )
          return false;
        if (Object.keys(mark).some((k) => !["type", "attrs"].includes(k)))
          return false;
        if (mark.type === "link") {
          if (
            !mark.attrs ||
            typeof mark.attrs.href !== "string" ||
            !safeUrl(mark.attrs.href)
          )
            return false;
          if (
            Object.keys(mark.attrs).some(
              (k) => !["href", "target", "rel", "class", "title"].includes(k),
            )
          )
            return false;
          if (
            Object.values(mark.attrs).some(
              (a) => a !== null && typeof a !== "string",
            )
          )
            return false;
        } else if (mark.attrs && Object.keys(mark.attrs).length) return false;
      }
    }
    return (
      v.content === undefined ||
      (Array.isArray(v.content) &&
        v.content.every((child) => node(child, depth + 1)))
    );
  }
  if (!node(value, 0) || (value as JSONContent).type !== "doc") return false;
  try {
    noteSchema.nodeFromJSON(value).check();
    return true;
  } catch {
    return false;
  }
}
const doc = z.custom<JSONContent>(
  (v) => validateDocument(v),
  "Недопустимый документ заметки",
);
export const dataSchema = z
  .object({
    city: z
      .object({
        id: z.literal("city"),
        name,
        timezone: z
          .string()
          .max(100)
          .refine((v) => {
            try {
              new Intl.DateTimeFormat("en", { timeZone: v });
              return true;
            } catch {
              return false;
            }
          }),
        reducedMotion: z.boolean(),
        createdAt: timestamp,
        rules: z
          .object({
            version: z.number().int().positive(),
            rewards: z.tuple([
              z.number().int().min(1).max(10),
              z.number().int().min(1).max(10),
              z.number().int().min(1).max(10),
            ]),
            costs: z.tuple([
              z.number().int().min(1).max(100),
              z.number().int().min(1).max(100),
            ]),
          })
          .strict(),
      })
      .strict(),
    tracks: z
      .array(
        z
          .object({
            id: identifier,
            name,
            type: z.enum(["skill", "project", "habit", "reduce"]),
            description: text,
            goal: text,
            schedule: name,
            unit: name,
            limit: z.number().optional(),
            comparison: z.enum(["min", "max"]),
            archived: z.boolean(),
            balance: z.number().int().nonnegative().max(1e9),
            stage,
            createdAt: timestamp,
          })
          .strict(),
      )
      .max(1000),
    buildings: z.array(building).max(1600),
    districts: z.array(district).max(200),
    notes: z
      .array(
        z
          .object({
            id: identifier,
            trackId: identifier,
            title: name,
            doc,
            text,
            tags: z.array(name).max(100),
            createdAt: timestamp,
            updatedAt: timestamp,
            revision: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(5000),
    activities: z
      .array(
        z
          .object({
            id: identifier,
            trackId: identifier,
            title: name,
            result: text,
            kind: z.enum(["explore", "verify", "apply"]),
            date: z.string().refine(validDate),
            timezone: name,
            noteIds: z.array(identifier).max(5000),
            duration: z.number().min(0).max(1440).optional(),
            value: z.number().optional(),
            achieved: z.boolean(),
            confirmed: z.boolean(),
            archived: z.boolean(),
            createdAt: timestamp,
          })
          .strict(),
      )
      .max(20_000),
    events: z
      .array(
        z
          .object({
            id: identifier,
            type: z.enum(["activity", "upgrade", "layout"]),
            trackId: identifier.optional(),
            activityId: identifier.optional(),
            amount: z.number().int().min(-100).max(10),
            ruleVersion: z.number().int().nonnegative(),
            description: text,
            createdAt: timestamp,
          })
          .strict(),
      )
      .max(50_000),
    snapshots: z
      .array(
        z
          .object({
            id: identifier,
            name,
            createdAt: timestamp,
            buildings: z
              .array(z.object({ ...buildingShape, stage }).strict())
              .max(1600),
            districts: z.array(district).max(200),
          })
          .strict(),
      )
      .max(1000),
    attachments: z
      .array(
        z
          .object({
            id: identifier,
            name,
            mime: z.enum(["image/png", "image/jpeg", "image/webp"]),
            size: z
              .number()
              .int()
              .min(12)
              .max(5 * 1024 * 1024),
          })
          .strict(),
      )
      .max(1000),
  })
  .strict();
export type ArchiveData = z.infer<typeof dataSchema>;
export function validateRelations(data: ArchiveData) {
  const fail = () => {
    throw new Error("Нарушены связи или геометрия данных архива.");
  };
  for (const list of [
    data.tracks,
    data.buildings,
    data.districts,
    data.notes,
    data.activities,
    data.events,
    data.snapshots,
    data.attachments,
  ]) {
    if (new Set(list.map((v) => v.id)).size !== list.length) fail();
  }
  const trackIds = new Set(data.tracks.map((t) => t.id));
  const attachmentIds = new Set(data.attachments.map((a) => a.id));
  const checkLayout = (
    bs: ArchiveData["buildings"],
    ds: ArchiveData["districts"],
  ) => {
    const placed = bs.flatMap((b) => (b.trackId ? [b.trackId] : []));
    if (new Set(placed).size !== placed.length) fail();
    for (const b of bs) {
      if (
        !inside(b) ||
        !canPlace(b, bs, b.id) ||
        (b.trackId && !trackIds.has(b.trackId))
      )
        fail();
      const progress = ["workshop", "library", "pavilion"].includes(b.kind);
      if (
        progress !== Boolean(b.trackId) ||
        b.w !== (progress || ["park", "plaza"].includes(b.kind) ? 2 : 1) ||
        b.h !== b.w
      )
        fail();
    }
    for (const d of ds) if (!canPlace(d, ds, d.id)) fail();
  };
  checkLayout(data.buildings, data.districts);
  for (const s of data.snapshots) checkLayout(s.buildings, s.districts);
  for (const n of data.notes)
    if (!trackIds.has(n.trackId) || !validateDocument(n.doc, attachmentIds))
      fail();
  for (const a of data.activities)
    if (
      !trackIds.has(a.trackId) ||
      a.noteIds.some(
        (n) =>
          !data.notes.some(
            (note) => note.id === n && note.trackId === a.trackId,
          ),
      )
    )
      fail();
  for (const a of data.activities.filter((a) => a.confirmed)) {
    const track = data.tracks.find((t) => t.id === a.trackId)!;
    const key = ["habit", "reduce"].includes(track.type)
      ? `habit:${a.trackId}:${a.date}`
      : `activity:${a.id}`;
    if (!data.events.some((e) => e.id === key && e.type === "activity")) fail();
  }
  for (const e of data.events) {
    if (e.trackId && !trackIds.has(e.trackId)) fail();
    if (e.type === "layout" && (e.amount !== 0 || e.ruleVersion !== 0)) fail();
    if (
      e.type === "upgrade" &&
      (!e.trackId || e.amount >= 0 || e.ruleVersion < 1)
    )
      fail();
    if (e.type === "activity") {
      const a = data.activities.find((a) => a.id === e.activityId);
      if (
        !a ||
        !a.confirmed ||
        a.trackId !== e.trackId ||
        e.amount < 0 ||
        e.ruleVersion < 1
      )
        fail();
      if (a) {
        const t = data.tracks.find((t) => t.id === a.trackId)!;
        if (
          e.id !==
          (["habit", "reduce"].includes(t.type)
            ? `habit:${t.id}:${a.date}`
            : `activity:${a.id}`)
        )
          fail();
      }
    }
  }
  for (const t of data.tracks) {
    const events = data.events.filter((e) => e.trackId === t.id);
    if (
      events.reduce((total, e) => total + e.amount, 0) !== t.balance ||
      events.filter((e) => e.type === "upgrade").length !== t.stage - 1
    )
      fail();
  }
}
