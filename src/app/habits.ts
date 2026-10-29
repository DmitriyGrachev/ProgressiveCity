import { db } from "../storage/db";
import { id } from "../domain/model";
import { habitDay } from "../domain/habits";
import { transition, useUI } from "./ui";

export async function openHabitDay(
  trackId: string,
  date: string,
  epoch: string,
) {
  await transition(async () => {
    const request = await db.transaction(
      "r",
      [db.metadata, db.tracks, db.activities, db.events],
      async () => {
        if ((await db.metadata.get("epoch"))?.value !== epoch)
          throw new Error("Город заменён. Выберите привычку заново.");
        const track = await db.tracks.get(trackId);
        if (
          !track ||
          track.archived ||
          !["habit", "reduce"].includes(track.type)
        )
          throw new Error("Привычка недоступна.");
        const day = habitDay(
          {
            activities: await db.activities
              .where("trackId")
              .equals(trackId)
              .toArray(),
            events: await db.events.where("trackId").equals(trackId).toArray(),
          },
          trackId,
          date,
        );
        return {
          requestId: id(),
          trackId,
          date,
          epoch,
          activityId: day.activity?.id,
        };
      },
    );
    if (
      useUI.getState().comparison ||
      useUI.getState().snapshotId ||
      (await db.metadata.get("epoch"))?.value !== epoch
    )
      return;
    useUI.getState().set({
      panel: "track",
      trackId,
      objectId: null,
      noteId: null,
      buildingId: null,
      resultRequest: null,
      dayRequest: request,
      workView: false,
      placement: null,
    });
  });
}
