import type { SearchEntry } from "../domain/search";
import { researchContext } from "../domain/continuation";
import { db } from "../storage/db";
import { transition, useUI } from "./ui";
export async function openSearchResult(
  entry: SearchEntry,
  epoch: string,
  mode: "open" | "continue" | "building" = "open",
) {
  await transition(async () => {
    const target = await db.transaction(
      "r",
      [db.metadata, db.tracks, db.learningObjects, db.notes, db.buildings],
      async () => {
        if ((await db.metadata.get("epoch"))?.value !== epoch)
          throw new Error("Город заменён. Повторите поиск.");
        const track = await db.tracks.get(entry.trackId);
        const object = entry.objectId
          ? await db.learningObjects.get(entry.objectId)
          : undefined;
        const note =
          entry.type === "note" ? await db.notes.get(entry.id) : undefined;
        if (
          !track ||
          (entry.objectId && object?.trackId !== track.id) ||
          (entry.type === "note" &&
            (!note ||
              note.trackId !== track.id ||
              note.learningObjectId !== object?.id))
        )
          throw new Error("Результат поиска изменился. Повторите поиск.");
        if (mode === "continue" && (!object || track.archived))
          throw new Error("Продолжение доступно для активного исследования.");
        const building = (
          await db.buildings.where("trackId").equals(track.id).toArray()
        ).find(
          (b) =>
            b.learningObjectId ===
              (object?.id ?? (entry.type === "track" ? track.id : undefined)) ||
            (!object && !b.learningObjectId),
        );
        let noteId = note?.id ?? null;
        if (mode === "continue" && object)
          noteId =
            researchContext(
              {
                learningObjects: [object],
                tracks: [track],
                notes: await db.notes
                  .where("learningObjectId")
                  .equals(object.id)
                  .toArray(),
                activities: [],
                events: [],
              },
              object.id,
            ).latestNote?.id ?? null;
        if (mode === "building" && !building)
          throw new Error(
            "Постройки нет на карте. Материалы доступны через исследование.",
          );
        return {
          trackId: track.id,
          objectId: object?.id ?? null,
          noteId,
          buildingId: building?.id ?? null,
        };
      },
    );
    if (
      useUI.getState().snapshotId ||
      useUI.getState().comparison ||
      (await db.metadata.get("epoch"))?.value !== epoch
    )
      return;
    useUI.getState().set({
      ...target,
      panel:
        mode === "building"
          ? null
          : entry.type === "note" && mode === "open"
            ? "library"
            : "track",
      focus: mode === "building" ? target.buildingId : null,
      workView: mode === "continue",
      resultRequest: null,
      dayRequest: null,
      placement: null,
    });
  });
}
