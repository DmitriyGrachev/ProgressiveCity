import { useEffect, useSyncExternalStore } from "react";
import { act, useUI } from "../app/ui";
import { service } from "../storage/service";

export function useLayoutHistory() {
  return useSyncExternalStore(
    service.planning.subscribe,
    service.planning.getSnapshot,
  );
}
export function LayoutControls({
  epoch,
  cancel,
}: {
  epoch?: string;
  cancel: () => void;
}) {
  const history = useLayoutHistory();
  const readonly = useUI((s) => Boolean(s.snapshotId || s.comparison));
  const placement = useUI((s) => s.placement);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cancel();
        return;
      }
      if (
        e.defaultPrevented ||
        e.isComposing ||
        e.altKey ||
        !(e.ctrlKey || e.metaKey)
      )
        return;
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest(
          "input, textarea, select, [contenteditable]:not([contenteditable=false]), [role=textbox]",
        )
      )
        return;
      if (!epoch || readonly) return;
      const z = e.code === "KeyZ",
        y = e.code === "KeyY";
      if (!z && !y) return;
      const redo = y || e.shiftKey;
      if (!(redo ? history.redoLabel : history.undoLabel)) return;
      e.preventDefault();
      if (history.busy || e.repeat) return;
      cancel();
      void act(() =>
        redo ? service.planning.redo(epoch) : service.planning.undo(epoch),
      );
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [epoch, readonly, history, cancel]);
  return (
    <div className="layout-controls" aria-label="История планировки">
      <div className="row">
        <button
          aria-label="Отменить планировку"
          title={`Ctrl/Cmd+Z · ${history.undoLabel ?? "Нет действий"}`}
          disabled={readonly || history.busy || !epoch || !history.undoLabel}
          onClick={() => {
            cancel();
            void act(() => service.planning.undo(epoch!));
          }}
        >
          ↶ Отменить
        </button>
        <button
          aria-label="Повторить планировку"
          title={`Ctrl/Cmd+Shift+Z / Ctrl+Y · ${history.redoLabel ?? "Нет действий"}`}
          disabled={readonly || history.busy || !epoch || !history.redoLabel}
          onClick={() => {
            cancel();
            void act(() => service.planning.redo(epoch!));
          }}
        >
          ↷ Повторить
        </button>
      </div>
      <span className="layout-status" role="status">
        {history.busy
          ? "Сохраняем планировку…"
          : history.undoLabel
            ? `Отменить: ${history.undoLabel}`
            : "Отмена планировки · в этой вкладке"}
      </span>
      {placement && (
        <button onClick={cancel}>Завершить инструмент · Escape</button>
      )}
    </div>
  );
}
