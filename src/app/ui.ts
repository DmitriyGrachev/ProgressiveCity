import { create } from "zustand";
import { resolvePendingForms } from "./pending-forms";
import { db } from "../storage/db";
import { id, type Building } from "../domain/model";
import type { ComparisonSession, ComparisonView } from "../domain/comparison";
export type Panel =
  "track" | "library" | "build" | "districts" | "history" | "settings";
export interface ResultRequest {
  noteId: string;
  title: string;
  epoch: string;
}
export interface DayRequest {
  requestId: string;
  trackId: string;
  date: string;
  activityId?: string;
  epoch: string;
}
interface UI {
  panel: Panel | null;
  trackId: string | null;
  objectId: string | null;
  additionId: string | null;
  resultRequest: ResultRequest | null;
  dayRequest: DayRequest | null;
  noteId: string | null;
  buildingId: string | null;
  buildRequestId: string;
  placement: Building | null;
  repeatPlacement: boolean;
  placementEpoch: string | null;
  placementExpected: Building | null;
  snapshotId: string | null;
  comparison: ComparisonSession | null;
  comparisonView: ComparisonView;
  comparisonDecor: boolean;
  comparisonSelection: string | null;
  fit: number;
  focus: string | null;
  focusDistrict: string | null;
  error: string;
  transitioning: boolean;
  workView: boolean;
  set: (patch: Partial<Omit<UI, "set">>) => void;
}
export const useUI = create<UI>((set) => ({
  panel: null,
  trackId: null,
  objectId: null,
  additionId: null,
  resultRequest: null,
  dayRequest: null,
  noteId: null,
  buildingId: null,
  buildRequestId: "",
  placement: null,
  repeatPlacement: false,
  placementEpoch: null,
  placementExpected: null,
  snapshotId: null,
  comparison: null,
  comparisonView: "changes",
  comparisonDecor: true,
  comparisonSelection: null,
  fit: 0,
  focus: null,
  focusDistrict: null,
  error: "",
  transitioning: false,
  workView: false,
  set,
}));
let flushEditor: (() => Promise<void>) | null = null;
export function registerEditor(flush: () => Promise<void>) {
  flushEditor = flush;
  return () => {
    if (flushEditor === flush) flushEditor = null;
  };
}
export async function navigate(patch: Partial<Omit<UI, "set">>) {
  if (
    useUI.getState().comparison &&
    ((patch.panel && patch.panel !== "history") || patch.snapshotId)
  )
    return;
  await transition(async () => {
    const leaveWork =
      patch.snapshotId ||
      (patch.panel !== undefined &&
        patch.panel !== "track" &&
        patch.panel !== "library");
    useUI.getState().set({
      dayRequest: null,
      additionId: null,
      ...patch,
      ...(patch.panel === "build"
        ? { buildRequestId: id(), placement: null, placementExpected: null }
        : {}),
      ...(leaveWork ? { workView: false } : {}),
      error: "",
    });
  });
}
export async function transition(
  action: () => Promise<void>,
  options: { forms?: boolean } = {},
) {
  if (useUI.getState().transitioning) return;
  useUI.getState().set({ transitioning: true });
  try {
    const epoch = (await db.metadata.get("epoch"))?.value;
    await flushEditor?.();
    if (options.forms !== false && !(await resolvePendingForms())) return;
    if ((await db.metadata.get("epoch"))?.value !== epoch)
      throw new Error(
        "Город заменён во время перехода. Выберите действие заново; прежние черновики доступны для восстановления.",
      );
    await action();
  } catch (e) {
    reportError(e);
  } finally {
    useUI.getState().set({ transitioning: false });
  }
}
export async function flushNotes() {
  await flushEditor?.();
}
export function reportError(e: unknown) {
  useUI.getState().set({
    error:
      e instanceof Error
        ? e.message
        : "Не удалось сохранить. Попробуйте ещё раз.",
  });
}
export async function act(action: () => Promise<unknown>) {
  try {
    await action();
    useUI.getState().set({ error: "" });
  } catch (e) {
    reportError(e);
  }
}
