import { useState } from "react";
import type { CityData } from "../domain/model";
import { act, navigate, useUI } from "../app/ui";
import { service } from "../storage/service";
export function History({ data }: { data: CityData }) {
  const [name, setName] = useState("");
  const [layout, setLayout] = useState(false);
  const snapshotId = useUI((s) => s.snapshotId);
  return (
    <>
      <span className="eyebrow">Накопленный путь</span>
      <h2>История города</h2>
      <p className="notice">
        Снимок сохраняет планировку, оформление и этапы. Текст заметок всегда
        открывается в текущей редакции.
      </p>
      <div className="row">
        <input
          aria-label="Название снимка"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Например: первая неделя"
          maxLength={250}
        />
        <button
          disabled={Boolean(snapshotId)}
          onClick={() =>
            void act(async () => {
              await service.snapshot(name);
              setName("");
            })
          }
        >
          Сделать снимок
        </button>
      </div>
      <div className="note-list">
        {[...data.snapshots]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((s) => (
            <button
              className={`list-row ${snapshotId === s.id ? "selected" : ""}`}
              key={s.id}
              onClick={() =>
                void navigate({ snapshotId: s.id, placement: null })
              }
            >
              <span>
                {s.name}
                <small>
                  {new Date(s.createdAt).toLocaleString("ru")} ·{" "}
                  {s.buildings.length} объектов
                </small>
              </span>
            </button>
          ))}
      </div>
      {snapshotId && (
        <button
          className="primary"
          onClick={() => useUI.getState().set({ snapshotId: null })}
        >
          Текущий город
        </button>
      )}
      <hr />
      <h3>События и основания</h3>
      <label className="check">
        <input
          type="checkbox"
          checked={layout}
          onChange={(e) => setLayout(e.target.checked)}
        />
        Показывать декоративные перестройки
      </label>
      <div className="timeline">
        {[...data.events]
          .filter((e) => layout || e.type !== "layout")
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((e) => (
            <article key={e.id}>
              <span className={`event-amount ${e.type}`}>
                {e.amount > 0 ? "+" : ""}
                {e.amount}
              </span>
              <div>
                {e.description}
                <small>
                  {e.type === "layout"
                    ? "Оформление · без прогресса"
                    : `${e.type === "upgrade" ? "Улучшение" : "Результат"} · правило v${e.ruleVersion}`}{" "}
                  · {new Date(e.createdAt).toLocaleString("ru")}
                </small>
              </div>
            </article>
          ))}
      </div>
      {!data.events.length && (
        <p className="empty">
          Пока нет событий. Первый подтверждённый результат начнёт вашу историю.
        </p>
      )}
    </>
  );
}
