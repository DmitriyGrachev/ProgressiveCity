import { db } from "../storage/db";
import { isLearning } from "../domain/model";
import { researchContext } from "../domain/continuation";
import { transition, useUI } from "./ui";

const historical = () =>
  Boolean(useUI.getState().snapshotId || useUI.getState().comparison);
export async function continueResearch(objectId: string, epoch: string) {
  if (historical()) return;
  await transition(async () => {
    const target = await db.transaction(
      "r",
      [db.metadata, db.tracks, db.learningObjects, db.notes, db.buildings],
      async () => {
        if ((await db.metadata.get("epoch"))?.value !== epoch)
          throw new Error("Город заменён. Выберите исследование заново.");
        const object = await db.learningObjects.get(objectId);
        const track = object && (await db.tracks.get(object.trackId));
        if (!object || !track || track.archived || !isLearning(track))
          throw new Error(
            "Исследование недоступно в активном учебном направлении.",
          );
        const notes = await db.notes
          .where("learningObjectId")
          .equals(object.id)
          .toArray();
        const { latestNote } = researchContext(
          {
            learningObjects: [object],
            tracks: [track],
            notes,
            activities: [],
            events: [],
          },
          object.id,
        );
        const building = await db.buildings
          .where("learningObjectId")
          .equals(object.id)
          .first();
        return {
          trackId: track.id,
          objectId: object.id,
          noteId: latestNote?.id ?? null,
          buildingId: building?.id ?? null,
        };
      },
    );
    if (historical() || (await db.metadata.get("epoch"))?.value !== epoch)
      return;
    useUI
      .getState()
      .set({
        ...target,
        panel: "track",
        workView: true,
        resultRequest: null,
        focus: null,
        placement: null,
        error: "",
      });
  });
}
export async function setWorkView(expanded: boolean, epoch: string) {
  if (historical()) return;
  await transition(async () => {
    if ((await db.metadata.get("epoch"))?.value !== epoch)
      throw new Error("Город заменён. Откройте материал заново.");
    if (!historical())
      useUI.getState().set({ workView: expanded, placement: null, error: "" });
  });
}
