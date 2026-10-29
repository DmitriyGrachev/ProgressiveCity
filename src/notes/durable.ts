import { db, type CityDB } from "../storage/db";
import {
  RecoveryJournal,
  type RecoveryPayload,
} from "../storage/recovery-journal";
import type { Attachment } from "../domain/model";
import { useSyncExternalStore } from "react";

export type ProtectionStatus =
  | "Страховка сохраняется…"
  | "Черновик защищён на устройстве"
  | "Нет незавершённого ввода"
  | "Страховка не сохранена — выгрузите ввод"
  | "Не удалось убрать прежнюю аварийную копию";
const active = new Set<RecoveryWriter>();
const listeners = new Set<() => void>();
let generation = 0;
function changed() {
  generation++;
  for (const listener of listeners) listener();
}
export function useLiveRecoveryWriters() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => generation,
  );
}
export function isLiveRecoveryWriter(id: string) {
  return [...active].some((w) => w.id === id && !w.detached);
}
export class RecoveryWriter {
  readonly id = crypto.randomUUID();
  private sequence = 0;
  private tail: Promise<void> = Promise.resolve();
  private error: unknown;
  private journal: RecoveryJournal;
  detached = false;
  constructor(
    readonly epoch: string,
    private status: (status: ProtectionStatus) => void = () => {},
    database: CityDB = db,
  ) {
    this.journal = new RecoveryJournal(database);
  }
  connect(status: (status: ProtectionStatus) => void) {
    this.detached = false;
    this.status = status;
  }
  begin() {
    this.sequence++;
    this.status("Страховка сохраняется…");
  }
  update(
    payload: RecoveryPayload | null,
    attachments: readonly Attachment[] = [],
  ) {
    if (!active.has(this)) {
      active.add(this);
      queueMicrotask(changed);
    }
    const sequence = ++this.sequence;
    const snapshot = payload && structuredClone(payload);
    const images = [...attachments];
    this.status("Страховка сохраняется…");
    this.tail = this.tail
      .catch(() => {})
      .then(async () => {
        try {
          if (snapshot)
            await this.journal.put(
              this.id,
              this.epoch,
              sequence,
              snapshot,
              images,
            );
          else await this.journal.clearThrough(this.id, sequence);
          if (this.sequence === sequence) {
            this.error = undefined;
            this.status(
              snapshot
                ? "Черновик защищён на устройстве"
                : "Нет незавершённого ввода",
            );
            if (this.detached) {
              active.delete(this);
              changed();
            }
          }
        } catch (error) {
          if (this.sequence === sequence) {
            this.error = error;
            this.status("Страховка не сохранена — выгрузите ввод");
          }
        }
      });
  }
  async flush() {
    let pending: Promise<void>;
    do {
      pending = this.tail;
      await pending;
    } while (pending !== this.tail);
    if (this.error) throw this.error;
  }
  async discard() {
    await this.tail;
    await this.journal.clearThrough(this.id, ++this.sequence);
    this.error = undefined;
    active.delete(this);
    changed();
  }
  detach() {
    this.detached = true;
    this.status = () => {};
    changed();
    void this.flush().then(
      () => {
        active.delete(this);
        changed();
      },
      () => {},
    );
  }
}
export async function flushRecovery() {
  await Promise.all([...active].map((writer) => writer.flush()));
}
