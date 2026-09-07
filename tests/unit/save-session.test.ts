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
