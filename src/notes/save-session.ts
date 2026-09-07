import type { Note } from "../domain/model";
export type SaveStatus =
  | "Сохранено"
  | "Есть изменения"
  | "Сохраняется…"
  | "Ошибка — повторите сохранение";
export class SaveSession {
  draft: Note;
  dirty = false;
  private version = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  constructor(
    note: Note,
    private save: (note: Note) => Promise<Note>,
    private status: (value: SaveStatus) => void,
  ) {
    this.draft = structuredClone(note);
  }
  update(patch: Partial<Note>) {
    this.draft = { ...this.draft, ...patch };
    this.dirty = true;
    this.version++;
    this.status("Есть изменения");
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush().catch(() => {});
    }, 500);
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.running) {
      await this.running;
      if (this.dirty) await this.flush();
      return;
    }
    if (!this.dirty) return;
    this.status("Сохраняется…");
    this.running = (async () => {
      try {
        while (this.dirty) {
          const version = this.version;
          const saved = await this.save(structuredClone(this.draft));
          this.draft.revision = saved.revision;
          this.draft.updatedAt = saved.updatedAt;
          this.dirty = this.version !== version;
        }
        this.status("Сохранено");
      } catch (error) {
        this.status("Ошибка — повторите сохранение");
        throw error;
      }
    })();
    try {
      await this.running;
    } finally {
      this.running = undefined;
    }
  }
  dispose() {
    clearTimeout(this.timer);
  }
  acceptSavedCopy(note: Note) {
    clearTimeout(this.timer);
    this.draft = structuredClone(note);
    this.dirty = false;
    this.version++;
    this.status("Сохранено");
  }
}
