import { create } from "zustand";
import type { Building } from "../domain/model";
export type Panel =
  "track" | "library" | "build" | "districts" | "history" | "settings";
interface UI {
  panel: Panel | null;
  trackId: string | null;
  noteId: string | null;
  buildingId: string | null;
  placement: Building | null;
  snapshotId: string | null;
  fit: number;
  focus: string | null;
  error: string;
  transitioning: boolean;
  set: (patch: Partial<Omit<UI, "set">>) => void;
}
export const useUI = create<UI>((set) => ({
  panel: null,
  trackId: null,
  noteId: null,
  buildingId: null,
  placement: null,
  snapshotId: null,
  fit: 0,
  focus: null,
  error: "",
  transitioning: false,
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
  await transition(async () => {
    useUI.getState().set({ ...patch, error: "" });
  });
}
export async function transition(action: () => Promise<void>) {
  if (useUI.getState().transitioning) return;
  useUI.getState().set({ transitioning: true });
  try {
    await flushEditor?.();
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
  useUI
    .getState()
    .set({
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
