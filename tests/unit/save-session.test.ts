import { expect, it, vi } from "vitest";
import { SaveSession } from "../../src/notes/save-session";
import type { Note } from "../../src/domain/model";
const note: Note = {
  id: "n",
  trackId: "t",
  title: "Заметка",
  doc: { type: "doc", content: [{ type: "paragraph" }] },
  text: "",
  tags: [],
  createdAt: "",
  updatedAt: "",
  revision: 0,
};
it("journals the latest draft with its advanced base revision when the next main save fails", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const observed: { note: Note; dirty: boolean }[] = [];
  const session = new SaveSession(
    note,
    async (n) => {
      if (++calls === 1) {
        await gate;
        return { ...n, revision: 1 };
      }
      throw new Error("Synthetic write failure");
    },
    () => {},
    (draft, dirty) => observed.push({ note: structuredClone(draft), dirty }),
  );
  session.update({ text: "Первый ввод" });
  const saving = session.flush();
  session.update({ text: "Самый новый ввод" });
  release();
  await expect(saving).rejects.toThrow("Synthetic");
  expect(observed.at(-1)).toMatchObject({
    note: { text: "Самый новый ввод", revision: 1 },
    dirty: true,
  });
  session.dispose();
});

it("keeps newer draft edits dirty when an older conflicting copy finishes", async () => {
  const written: Note[] = [];
  const session = new SaveSession(
    note,
    async (n) => {
      written.push(n);
      return { ...n, revision: n.revision + 1 };
    },
    () => {},
  );
  session.update({ text: "At copy click" });
  const copiedDraft = session.draft;
  session.update({ text: "At copy click + latest sentence" });
  session.acceptSavedCopy(
    { ...copiedDraft, id: "copy", revision: 1 },
    copiedDraft,
  );
  expect(session.draft.text).toBe("At copy click + latest sentence");
  expect(session.dirty).toBe(true);
  await session.flush();
  expect(written[0]).toMatchObject({
    id: "copy",
    revision: 1,
    text: "At copy click + latest sentence",
  });
  session.dispose();
});
it("flushes the newest edit even if it arrives while a previous write is pending", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const written: Note[] = [];
  const session = new SaveSession(
    note,
    async (n) => {
      written.push(n);
      if (written.length === 1) await pending;
      return { ...n, revision: n.revision + 1 };
    },
    () => {},
  );
  session.update({ text: "Первый текст" });
  const flushing = session.flush();
  session.update({ text: "Последний текст" });
  release();
  await flushing;
  expect(written.map((n) => n.text)).toEqual([
    "Первый текст",
    "Последний текст",
  ]);
  expect(written[1].revision).toBe(1);
  expect(session.dirty).toBe(false);
  session.dispose();
});
it("keeps the draft and reports failure, then retries without losing it", async () => {
  let failing = true;
  const states: string[] = [];
  const session = new SaveSession(
    note,
    async (n) => {
      if (failing) throw new Error("QuotaExceededError");
      return { ...n, revision: n.revision + 1 };
    },
    (v) => states.push(v),
  );
  session.update({ text: "Не терять" });
  await expect(session.flush()).rejects.toThrow();
  expect(session.draft.text).toBe("Не терять");
  expect(states.at(-1)).toMatch(/^Ошибка/);
  expect(session.dirty).toBe(true);
  failing = false;
  await session.flush();
  expect(states.at(-1)).toBe("Сохранено");
  session.dispose();
});
it("navigation flush cancels a pending debounce", async () => {
  vi.useFakeTimers();
  let saves = 0;
  const session = new SaveSession(
    note,
    async (n) => {
      saves++;
      return { ...n, revision: n.revision + 1 };
    },
    () => {},
  );
  session.update({ title: "Быстрое изменение" });
  await session.flush();
  await vi.advanceTimersByTimeAsync(600);
  expect(saves).toBe(1);
  session.dispose();
  vi.useRealTimers();
});
