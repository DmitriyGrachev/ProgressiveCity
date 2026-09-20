import type { CityData } from "../domain/model";
import {
  changeLabels,
  relatedEvents,
  visibleChanges,
} from "../domain/comparison";
import { navigate, useUI } from "../app/ui";
import { exitComparison, refreshComparison } from "../app/comparison";
import { NoteEditor } from "../notes/NoteEditor";

export function ComparisonPanel({ data }: { data: CityData }) {
  const comparison = useUI((s) => s.comparison);
  const showDecor = useUI((s) => s.comparisonDecor);
  const selected = useUI((s) => s.comparisonSelection);
  const noteId = useUI((s) => s.noteId);
  const busy = useUI((s) => s.transitioning);
  if (!comparison || comparison.scene.storageEpoch !== data.storageEpoch)
    return null;
  const changes = visibleChanges(comparison.changes, showDecor);
  const change = changes.find((c) => c.key === selected);
  const owner =
    change?.entity === "building" ? (change.after ?? change.before) : undefined;
  const events = change ? relatedEvents(change, comparison) : [];
  const materials = data.notes.filter(
    (n) =>
      owner?.trackId &&
      (owner.learningObjectId
        ? n.learningObjectId === owner.learningObjectId
        : n.trackId === owner.trackId && !n.learningObjectId),
  );
  const sourceIds = new Set(
    events.flatMap((event) => {
      const activity = comparison.activities.find(
        (a) => a.id === (event.sourceActivityId ?? event.activityId),
      );
      return activity?.noteIds ?? [];
    }),
  );
  const note = data.notes.find(
    (n) =>
      n.id === noteId &&
      (materials.some((m) => m.id === n.id) || sourceIds.has(n.id)),
  );
  return (
    <>
      <span className="eyebrow">Мой путь · только чтение</span>
      <h2>Раньше и сейчас</h2>
      <div className="comparison-states">
        <p>
          <b>A · {comparison.before.name}</b>
          <small>
            {new Date(comparison.before.createdAt).toLocaleString("ru")}
          </small>
        </p>
        <p>
          <b>B · {comparison.after.name}</b>
          <small>
            {new Date(comparison.after.createdAt).toLocaleString("ru")}
          </small>
        </p>
      </div>
      {comparison.current && (
        <>
          <p className="hint">
            Текущий город зафиксирован на указанное время. Новые изменения
            появятся после обновления.
          </p>
          <button disabled={busy} onClick={() => void refreshComparison()}>
            Обновить текущее состояние
          </button>
        </>
      )}
      <button onClick={exitComparison}>Выйти из сравнения</button>
      <label className="check">
        <input
          type="checkbox"
          checked={showDecor}
          onChange={(e) =>
            useUI.getState().set({
              comparisonDecor: e.target.checked,
              comparisonSelection: null,
              noteId: null,
            })
          }
        />
        Показывать изменения декора
      </label>
      <p className="hint">
        Фильтр скрывает отметки и строки декора/районов. Полные виды A и B
        сохраняются. Появление на карте само по себе не означает новое освоенное
        знание.
      </p>
      <h3>Изменения · {changes.length}</h3>
      <div className="comparison-legend" aria-label="Легенда изменений">
        {Object.values(changeLabels).map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      {!changes.length && (
        <p className="empty">
          {comparison.changes.length
            ? "Все изменения относятся к скрытому декору."
            : "Между выбранными состояниями нет изменений планировки или этапов."}
        </p>
      )}
      <div className="comparison-list">
        {changes.map((c) => (
          <button
            className={`list-row ${c.key === selected ? "selected" : ""}`}
            key={c.key}
            aria-label={`Изменение: ${(c.after ?? c.before)!.name}`}
            onClick={() =>
              useUI.getState().set({ comparisonSelection: c.key, noteId: null })
            }
          >
            <span>
              <b>{(c.after ?? c.before)!.name}</b>
              <small>{c.flags.map((f) => changeLabels[f]).join(" · ")}</small>
            </span>
          </button>
        ))}
      </div>
      {change && (
        <section className="comparison-detail" aria-label="Выбранное изменение">
          <h3>{(change.after ?? change.before)!.name}</h3>
          {change.entity === "building" && !change.decorative && (
            <p className="notice" data-testid="comparison-stages">
              A:{" "}
              {change.before ? `этап ${change.before.stage}` : "нет на карте"} →
              B: {change.after ? `этап ${change.after.stage}` : "нет на карте"}
            </p>
          )}
          <p>{change.flags.map((f) => changeLabels[f]).join(" · ")}</p>
          {change.before && (
            <p className="hint">
              A: {change.before.name} · клетка {change.before.x},{" "}
              {change.before.y}
            </p>
          )}
          {change.after && (
            <p className="hint">
              B: {change.after.name} · клетка {change.after.x}, {change.after.y}
            </p>
          )}
          {owner?.trackId ? (
            <>
              <h3>Связанные события</h3>
              <p className="hint">
                Между датами A и B, по сохранённым связям. Геометрические
                изменения не являются результатами обучения.
              </p>
              {!events.length && (
                <p className="empty">
                  В этом промежутке связанных событий нет. Основание развития не
                  предполагается.
                </p>
              )}
              {events.map((event) => {
                const source = comparison.activities.find(
                  (a) => a.id === (event.sourceActivityId ?? event.activityId),
                );
                return (
                  <article className="comparison-event" key={event.id}>
                    <b>{event.description}</b>
                    <small>
                      {new Date(event.createdAt).toLocaleString("ru")} ·{" "}
                      {event.amount > 0 ? "+" : ""}
                      {event.amount} · правило v{event.ruleVersion}
                    </small>
                    {source ? (
                      <p>Связанный результат: {source.title}</p>
                    ) : (
                      <p className="hint">Связь с результатом не сохранена.</p>
                    )}
                    {source?.noteIds.map((id) => {
                      const n = data.notes.find((n) => n.id === id);
                      return n ? (
                        <button
                          key={id}
                          onClick={() => void navigate({ noteId: id })}
                        >
                          {n.title} · материал результата
                        </button>
                      ) : (
                        <p key={id} className="hint">
                          Связанный материал недоступен.
                        </p>
                      );
                    })}
                  </article>
                );
              })}
              <h3>Материалы · текущая редакция</h3>
              {!materials.length && (
                <p className="empty">
                  У этой постройки нет связанных материалов.
                </p>
              )}
              {materials.map((n) => (
                <button
                  className="list-row"
                  key={n.id}
                  onClick={() => void navigate({ noteId: n.id })}
                >
                  {n.title}
                </button>
              ))}
              {note && (
                <>
                  <p className="notice">
                    Текущая редакция заметки ·{" "}
                    {new Date(note.updatedAt).toLocaleString("ru")}. Снимки не
                    хранят прошлые тексты.
                  </p>
                  <NoteEditor
                    key={`${data.storageEpoch}:${note.id}:${note.revision}`}
                    note={note}
                    epoch={data.storageEpoch}
                  />
                </>
              )}
            </>
          ) : (
            <p className="hint">
              Это оформление города. Учебные материалы к нему не привязаны.
            </p>
          )}
        </section>
      )}
    </>
  );
}
