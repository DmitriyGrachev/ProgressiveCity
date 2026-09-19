import { id, isLearning, now, type LearningObject } from "../domain/model";
import type { CityDB } from "./db";
import { dataSchema } from "./validation";

/** Call within the service's write transaction. */
export async function createResearch(
  db: CityDB,
  trackId: string,
  name: string,
) {
  const track = await db.tracks.get(trackId);
  if (!track || !isLearning(track) || track.archived)
    throw new Error("Исследования доступны в активном учебном направлении.");
  const object: LearningObject = {
    id: id(),
    trackId,
    name: name.trim(),
    nextQuestion: "",
    stage: 1,
    built: false,
    initial: false,
    createdAt: now(),
  };
  dataSchema.shape.learningObjects.element.parse(object);
  await db.learningObjects.add(object);
  return object;
}

/** Spending and its persistent event share the caller's transaction. */
export async function spendOnObject(
  db: CityDB,
  objectId: string,
  kind: "upgrade" | "construction",
  commandId: string,
  sourceActivityId?: string,
) {
  const eventId = `${kind}:${commandId}`;
  const existing = await db.events.get(eventId);
  if (existing) {
    if (existing.type !== kind || existing.learningObjectId !== objectId)
      throw new Error("Команда уже относится к другому объекту.");
    return;
  }
  const object = await db.learningObjects.get(objectId);
  if (!object) throw new Error("Учебный объект не найден.");
  const track = await db.tracks.get(object.trackId);
  const city = await db.cities.get("city");
  if (!track || !isLearning(track) || track.archived || !city)
    throw new Error("Верните направление из архива перед развитием.");
  if (kind === "construction" && object.built) return;
  if (kind === "upgrade" && (!object.built || object.stage >= 3))
    throw new Error(
      object.built
        ? "Достигнут последний этап."
        : "Сначала оплатите строительство объекта.",
    );
  const cost =
    kind === "construction"
      ? city.rules.constructionCost
      : city.rules.costs[object.stage - 1];
  if (track.balance < cost) throw new Error(`Нужно ${cost} очков развития.`);
  const source = sourceActivityId
    ? await db.activities.get(sourceActivityId)
    : (await db.activities.where("trackId").equals(track.id).toArray())
        .filter((a) => a.confirmed)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (sourceActivityId && (!source?.confirmed || source.trackId !== track.id))
    throw new Error(
      "Основание развития должно быть подтверждённым результатом этого направления.",
    );
  const event = {
    id: eventId,
    type: kind,
    trackId: track.id,
    learningObjectId: object.id,
    ...(source ? { sourceActivityId: source.id } : {}),
    amount: -cost,
    ruleVersion: city.rules.version,
    description: `${object.name}: ${kind === "construction" ? "строительство" : `этап ${object.stage + 1}`}`,
    createdAt: now(),
  };
  dataSchema.shape.events.element.parse(event);
  await db.tracks.update(track.id, { balance: track.balance - cost });
  await db.learningObjects.update(
    object.id,
    kind === "construction"
      ? { built: true }
      : { stage: (object.stage + 1) as 2 | 3 },
  );
  await db.events.add(event);
  return event.description;
}
