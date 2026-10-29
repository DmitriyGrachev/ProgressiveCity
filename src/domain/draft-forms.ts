import { z } from "zod";
import { dataSchema } from "../storage/validation";
const target = z
  .object({
    kind: z.enum(["activity", "research"]),
    trackId: z.string(),
    objectId: z.string().optional(),
    activityId: z.string().optional(),
    date: z.string().optional(),
  })
  .strict();
export const activityDraftFields = z
  .object({
    title: z.string(),
    result: z.string(),
    kind: z.enum(["explore", "verify", "apply"]),
    date: z.string(),
    duration: z.string(),
    value: z.string(),
    achieved: z.boolean(),
    noteIds: z.array(z.string()),
  })
  .strict();
export const activityDraftState = z
  .object({
    target,
    fields: activityDraftFields,
    baseline: activityDraftFields,
    expected: dataSchema.shape.activities.element.optional(),
    timezone: z.string().min(1),
  })
  .strict();
export const researchDraftState = z
  .object({
    target,
    fields: z.object({ name: z.string(), question: z.string() }).strict(),
    base: dataSchema.shape.learningObjects.element,
  })
  .strict();
export const formRecoveryTarget = target;
