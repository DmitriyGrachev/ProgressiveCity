import { db } from "../storage/db";
import { readComparison } from "../storage/comparison";
import { service } from "../storage/service";
import { transition, useUI } from "./ui";

export async function startComparison(
  beforeId: string,
  afterId: string | null,
  epoch: string,
) {
  useUI.getState().set({ placement: null });
  await transition(async () => {
    await service.planning.whenIdle();
    const comparison = await readComparison(db, beforeId, afterId, epoch);
    if ((await db.metadata.get("epoch"))?.value !== epoch)
      throw new Error(
        "Город заменён. Выберите состояния для сравнения заново.",
      );
    useUI.getState().set({
      comparison,
      snapshotId: null,
      comparisonView: "changes",
      comparisonSelection: null,
      noteId: null,
      panel: "history",
      placement: null,
      error: "",
    });
  });
}
export function exitComparison() {
  useUI.getState().set({
    comparison: null,
    comparisonSelection: null,
    noteId: null,
    snapshotId: null,
    placement: null,
    panel: "history",
  });
}
export async function refreshComparison() {
  const active = useUI.getState().comparison;
  if (!active?.current) return;
  await transition(async () => {
    const comparison = await readComparison(
      db,
      active.before.id,
      null,
      active.scene.storageEpoch,
    );
    const epoch = (await db.metadata.get("epoch"))?.value;
    if (
      useUI.getState().comparison !== active ||
      epoch !== active.scene.storageEpoch
    )
      return;
    useUI
      .getState()
      .set({ comparison, comparisonSelection: null, noteId: null });
  });
}
