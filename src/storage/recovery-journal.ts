import { z } from "zod";
import type { CityDB } from "./db";
import type { Attachment, Note } from "../domain/model";
import { dataSchema } from "./legacy-validation";

export type RecoveryPayload =
  | { kind: "note"; label: string; note: Note; pendingAttachmentIds?: string[] }
  | {
      kind: "form";
      label: string;
      text: string;
      context?: string;
      state?: Record<string, unknown>;
    };
export interface RecoveryRecord {
  id: string;
  epoch: string;
  sequence: number;
  updatedAt: string;
  bytes: number;
  attachmentKeys: string[];
  payload: RecoveryPayload | null;
}
export interface RecoveryAttachment {
  id: string;
  epoch: string;
  attachment: Attachment;
}
export interface ClientState {
  id: string;
  value: unknown;
}
const payloadSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("note"),
      label: z.string().max(250),
      note: dataSchema.shape.notes.element.extend({
        learningObjectId: z.string().optional(),
      }),
      pendingAttachmentIds: z.array(z.string()).max(1000).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("form"),
      label: z.string().max(250),
      text: z.string().max(500_000),
      context: z.string().max(250).optional(),
      state: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
]);
const usageSchema = z.object({
  bytes: z.number().nonnegative(),
  branches: z.number().int().nonnegative(),
});

/** Per-writer monotonic records: a late save cannot erase a newer draft. */
export class RecoveryJournal {
  constructor(private db: CityDB) {}
  async put(
    id: string,
    epoch: string,
    sequence: number,
    payload: RecoveryPayload,
    attachments: readonly Attachment[] = [],
  ) {
    if (!id || !epoch || !Number.isSafeInteger(sequence) || sequence < 1)
      throw new Error("Некорректная версия аварийного черновика.");
    const safe = structuredClone(
      payloadSchema.parse(payload),
    ) as RecoveryPayload;
    const originals = [...attachments];
    return this.db.transaction(
      "rw",
      [this.db.recovery, this.db.recoveryAttachments, this.db.clientState],
      async () => {
        const previous = await this.db.recovery.get(id);
        if (previous && sequence <= previous.sequence) return;
        if (previous?.epoch && previous.epoch !== epoch)
          throw new Error("Исходный город черновика изменён.");
        const keys = new Set(previous?.attachmentKeys ?? []);
        for (const attachment of originals)
          keys.add(`${epoch}:${attachment.id}`);
        if (keys.size > 1000)
          throw new Error("В черновике больше 1000 оригиналов изображений.");
        const stored = await this.db.recoveryAttachments.bulkGet([...keys]);
        const known = new Map(
          stored.flatMap((a) => (a ? [[a.id, a] as const] : [])),
        );
        const added: RecoveryAttachment[] = [];
        for (const attachment of originals) {
          const cacheId = `${epoch}:${attachment.id}`;
          const existing = known.get(cacheId);
          if (existing) {
            if (
              existing.attachment.size !== attachment.size ||
              existing.attachment.mime !== attachment.mime
            )
              throw new Error("Оригинал изображения в страховке изменён.");
            continue;
          }
          if (
            attachment.size !== attachment.blob.size ||
            attachment.size > 5 * 1024 * 1024 ||
            !["image/png", "image/jpeg", "image/webp"].includes(attachment.mime)
          )
            throw new Error("Некорректное изображение аварийного черновика.");
          const row = { id: cacheId, epoch, attachment };
          added.push(row);
          known.set(cacheId, row);
        }
        if ([...keys].some((key) => !known.has(key)))
          throw new Error(
            "Не найден оригинал изображения аварийного черновика.",
          );
        const bytes = new TextEncoder().encode(JSON.stringify(safe)).length;
        const imagesSize = added.reduce((n, a) => n + a.attachment.size, 0);
        let usage = usageSchema.parse(
          (await this.db.clientState.get("recovery-usage"))?.value ?? {
            bytes: 0,
            branches: 0,
          },
        );
        if (
          usage.bytes - (previous?.bytes ?? 0) + bytes + imagesSize >
          512 * 1024 * 1024
        ) {
          await this.pruneCache(keys);
          usage = usageSchema.parse(
            (await this.db.clientState.get("recovery-usage"))!.value,
          );
        }
        const next = {
          bytes: usage.bytes - (previous?.bytes ?? 0) + bytes + imagesSize,
          branches: usage.branches + (previous?.payload ? 0 : 1),
        };
        if (next.bytes > 512 * 1024 * 1024 || next.branches > 100)
          throw new Error(
            "Журнал восстановления заполнен. Выгрузите и уберите ненужные аварийные копии; текущий ввод остаётся в редакторе.",
          );
        await this.db.recovery.put({
          id,
          epoch,
          sequence,
          payload: safe,
          bytes,
          attachmentKeys: [...keys],
          updatedAt: new Date().toISOString(),
        });
        await this.db.recoveryAttachments.bulkAdd(added);
        await this.db.clientState.put({ id: "recovery-usage", value: next });
      },
    );
  }
  async clearThrough(id: string, sequence: number) {
    return this.db.transaction(
      "rw",
      [this.db.recovery, this.db.recoveryAttachments, this.db.clientState],
      async () => {
        const previous = await this.db.recovery.get(id);
        if (previous && previous.sequence > sequence) return;
        const usage = usageSchema.parse(
          (await this.db.clientState.get("recovery-usage"))?.value ?? {
            bytes: 0,
            branches: 0,
          },
        );
        await this.db.recovery.put({
          id,
          epoch: previous?.epoch ?? "",
          sequence,
          payload: null,
          bytes: 0,
          attachmentKeys: [],
          updatedAt: new Date().toISOString(),
        });
        await this.db.clientState.put({
          id: "recovery-usage",
          value: {
            bytes: usage.bytes - (previous?.bytes ?? 0),
            branches: usage.branches - (previous?.payload ? 1 : 0),
          },
        });
      },
    );
  }
  async discard(id: string, expectedSequence: number) {
    return this.db.transaction(
      "rw",
      [this.db.recovery, this.db.recoveryAttachments, this.db.clientState],
      async () => {
        const previous = await this.db.recovery.get(id);
        if (previous?.sequence !== expectedSequence)
          throw new Error(
            "Черновик изменился. Проверьте новую версию перед удалением.",
          );
        await this.clearThrough(id, expectedSequence);
      },
    );
  }
  async list() {
    return (await this.db.recovery.toArray()).filter((r) => r.payload !== null);
  }
  async attachments(id: string) {
    return this.db.transaction(
      "r",
      [this.db.recovery, this.db.recoveryAttachments],
      async () => {
        const record = await this.db.recovery.get(id);
        const originals = await this.db.recoveryAttachments.bulkGet(
          record?.attachmentKeys ?? [],
        );
        if (originals.some((a) => !a))
          throw new Error("Не найден оригинал аварийного черновика.");
        return originals.flatMap((r) => (r ? [r.attachment] : []));
      },
    );
  }
  async pruneCache(additional: ReadonlySet<string> = new Set()) {
    return this.db.transaction(
      "rw",
      [this.db.recovery, this.db.recoveryAttachments, this.db.clientState],
      async () => {
        const referenced = new Set(additional);
        for (const record of await this.db.recovery.toArray())
          for (const key of record.attachmentKeys) referenced.add(key);
        const unused = (await this.db.recoveryAttachments.toArray()).filter(
          (a) => !referenced.has(a.id),
        );
        const freed = unused.reduce((n, a) => n + a.attachment.size, 0);
        const usage = usageSchema.parse(
          (await this.db.clientState.get("recovery-usage"))?.value ?? {
            bytes: 0,
            branches: 0,
          },
        );
        if (usage.bytes < freed)
          throw new Error(
            "Счётчик страховочного хранилища повреждён. Автоматическая очистка остановлена.",
          );
        await this.db.recoveryAttachments.bulkDelete(unused.map((a) => a.id));
        await this.db.clientState.put({
          id: "recovery-usage",
          value: { ...usage, bytes: usage.bytes - freed },
        });
        return freed;
      },
    );
  }
}
const name = (database: string) => `progress-city:images:${database}`;
export function holdAttachmentLock(database: string) {
  let release = () => {};
  const untilRelease = new Promise<void>((resolve) => {
    release = resolve;
  });
  const controller = new AbortController();
  const locks = globalThis.navigator?.locks;
  if (!locks) return { ready: Promise.resolve(), release };
  let granted!: () => void, failed!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    granted = resolve;
    failed = reject;
  });
  void locks
    .request(
      name(database),
      { mode: "shared", signal: controller.signal },
      async () => {
        granted();
        await untilRelease;
      },
    )
    .catch((error) => {
      if (controller.signal.aborted) granted();
      else failed(error);
    });
  return {
    ready,
    release: () => {
      controller.abort();
      release();
    },
  };
}
export async function withAttachmentCleanupLock<T>(
  database: string,
  action: () => Promise<T>,
): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (!locks)
    throw new Error(
      "Браузер не поддерживает безопасную межвкладочную блокировку. Очистка изображений недоступна.",
    );
  return locks.request(
    name(database),
    { mode: "exclusive", ifAvailable: true },
    async (lock) => {
      if (!lock)
        throw new Error(
          "Закройте редакторы заметок во всех вкладках перед очисткой изображений.",
        );
      return action();
    },
  );
}
