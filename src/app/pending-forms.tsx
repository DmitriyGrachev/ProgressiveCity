import { useEffect, useId, useRef, useState } from "react";
import { create } from "zustand";
import { RecoveryWriter, type ProtectionStatus } from "../notes/durable";
import { RecoveryJournal } from "../storage/recovery-journal";
import { db } from "../storage/db";
import { useFormRecovery } from "./form-recovery";

interface PendingForm {
  label: string;
  epoch: string;
  dirty: boolean;
  text: string;
  save: () => Promise<void>;
  discard: () => void;
  recovery?: {
    context: string;
    state: Record<string, unknown>;
    restore: (state: Record<string, unknown>) => void;
  };
}
interface RecoveredForm {
  id: string;
  label: string;
  text: string;
  forget: () => Promise<void>;
}
const forms = new Map<string, () => PendingForm>();
const usePending = create<{ labels: string[]; recovered: RecoveredForm[] }>(
  () => ({ labels: [], recovered: [] }),
);
export function useMemoryRecoveredForms() {
  return usePending((s) => s.recovered);
}
let decision: ((choice: "save" | "stay" | "discard") => void) | undefined;
function decide(choice: "save" | "stay" | "discard") {
  const resolve = decision;
  decision = undefined;
  usePending.setState({ labels: [] });
  resolve?.(choice);
}

/** Form fields stay in their owning component. Only recovery copies live here. */
export function usePendingForm(form: PendingForm) {
  const key = useId();
  const current = useRef(form);
  current.current = form;
  const [protection, setProtection] = useState<ProtectionStatus>(
    "Нет незавершённого ввода",
  );
  const [writer] = useState(() => new RecoveryWriter(form.epoch));
  const parent = useRef<{ id: string; sequence: number } | null>(null);
  const request = useFormRecovery((s) => s.request);
  const serialized = JSON.stringify({
    kind: "form",
    label: form.label,
    text: form.text,
    context: form.recovery?.context,
    state: form.recovery?.state,
  });
  useEffect(() => {
    writer.connect(setProtection);
    return () => writer.detach();
  }, [writer]);
  useEffect(() => {
    writer.update(form.dirty ? JSON.parse(serialized) : null);
    const source = parent.current;
    if (form.dirty && source) {
      void writer
        .flush()
        .then(() =>
          new RecoveryJournal(db).clearThrough(source.id, source.sequence),
        )
        .then(() => {
          if (parent.current === source) parent.current = null;
        })
        .catch(() =>
          setProtection("Не удалось убрать прежнюю аварийную копию"),
        );
    }
  }, [serialized, form.dirty, writer]);
  useEffect(() => {
    const recovery = current.current.recovery;
    if (
      !recovery ||
      !request ||
      useFormRecovery.getState().request?.id !== request.id ||
      request.epoch !== current.current.epoch ||
      request.payload?.kind !== "form" ||
      request.payload.context !== recovery.context ||
      !request.payload.state
    )
      return;
    recovery.restore(request.payload.state);
    parent.current = { id: request.id, sequence: request.sequence };
    useFormRecovery.setState({ request: null });
  }, [request]);
  useEffect(() => {
    forms.set(key, () => current.current);
    return () => {
      const last = current.current;
      if (last.dirty) {
        usePending.setState((state) => ({
          recovered: [
            ...state.recovered,
            {
              id: writer.id,
              label: last.label,
              text: last.text,
              forget: () => writer.discard(),
            },
          ],
        }));
        decide("stay");
      }
      forms.delete(key);
    };
  }, [key, writer]);
  const clean = () => {
    current.current = { ...current.current, dirty: false };
    writer.update(null);
    if (parent.current) {
      const { id, sequence } = parent.current;
      void new RecoveryJournal(db)
        .clearThrough(id, sequence)
        .then(() => {
          if (parent.current?.id === id && parent.current.sequence === sequence)
            parent.current = null;
        })
        .catch(() =>
          setProtection("Не удалось убрать прежнюю аварийную копию"),
        );
    }
  };
  return { clean, protection };
}

/** Called only after the single note editor has successfully flushed. */
export async function resolvePendingForms(): Promise<boolean> {
  const pending = [...forms.entries()].filter(([, get]) => get().dirty);
  if (!pending.length) return true;
  const choice = await new Promise<"save" | "stay" | "discard">((resolve) => {
    decision = resolve;
    usePending.setState({ labels: pending.map(([, get]) => get().label) });
  });
  if (choice === "stay") return false;
  const saved: string[] = [];
  for (const [key, get] of pending) {
    if (forms.get(key) !== get) return false;
    const form = get();
    if (!form.dirty) continue;
    try {
      if (choice === "save") {
        await form.save();
        saved.push(form.label);
      } else form.discard();
    } catch (error) {
      throw new Error(
        `${saved.length ? `Сохранено: ${saved.join(", ")}. ` : ""}Не сохранено: ${form.label}. ${error instanceof Error ? error.message : "Повторите попытку."}`,
        { cause: error },
      );
    }
  }
  return true;
}

export function PendingFormsUI() {
  const { labels, recovered } = usePending();
  const [recoveryError, setRecoveryError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const stay = useRef<HTMLButtonElement>(null);
  const open = labels.length > 0;
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (
        [...forms.values()].some((get) => get().dirty) ||
        usePending.getState().recovered.length
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    stay.current?.focus();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [open]);
  return (
    <>
      <dialog
        ref={dialog}
        className="pending-dialog"
        aria-labelledby="pending-heading"
        onCancel={(e) => {
          e.preventDefault();
          decide("stay");
        }}
      >
        <h2 id="pending-heading">Незавершённые формы</h2>
        <p>Перед переходом остались изменения:</p>
        <ul>
          {labels.map((label, i) => (
            <li key={i}>{label}</li>
          ))}
        </ul>
        <p className="hint">
          Новый результат будет сохранён как черновик, без подтверждения и
          награды. «Не сохранять» относится только к этим формам.
        </p>
        <div className="row wrap">
          <button onClick={() => decide("save")}>Сохранить и продолжить</button>
          <button ref={stay} onClick={() => decide("stay")}>
            Остаться
          </button>
          <button onClick={() => decide("discard")}>Не сохранять</button>
        </div>
      </dialog>
      {recovered.length > 0 && (
        <aside
          className="form-recovery"
          aria-label="Сохранённые тексты незавершённых форм"
        >
          <h2>Незавершённые формы прежнего города</h2>
          {recoveryError && <p role="alert">{recoveryError}</p>}
          <p>
            Переход или импорт закрыл форму. Текст доступен для копирования; в
            новый город он не записан. Сохраните нужное до закрытия страницы.
          </p>
          {recovered.map((form) => (
            <details key={form.id}>
              <summary>{form.label}</summary>
              <textarea
                readOnly
                aria-label={`Текст: ${form.label}`}
                value={form.text}
              />
              <button
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([form.text], { type: "text/plain;charset=utf-8" }),
                  );
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "progress-city-form.txt";
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                Скачать текст
              </button>
              <button
                onClick={() =>
                  void form
                    .forget()
                    .then(() => {
                      setRecoveryError("");
                      usePending.setState((state) => ({
                        recovered: state.recovered.filter(
                          (item) => item.id !== form.id,
                        ),
                      }));
                    })
                    .catch(() =>
                      setRecoveryError(
                        "Не удалось удалить аварийную копию. Текст остаётся доступен.",
                      ),
                    )
                }
              >
                Убрать сохранённый текст
              </button>
            </details>
          ))}
        </aside>
      )}
    </>
  );
}
