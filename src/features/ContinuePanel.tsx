import { useMemo, useState } from "react";
import type { CityData } from "../domain/model";
import { recentResearch } from "../domain/continuation";
import { continueResearch } from "../app/research";
import { useUI } from "../app/ui";

export function ContinuePanel({
  data,
  hidden,
}: {
  data: CityData;
  hidden: boolean;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const busy = useUI((s) => s.transitioning);
  const { tracks, learningObjects, notes, activities, events } = data;
  const recent = useMemo(
    () =>
      recentResearch({ tracks, learningObjects, notes, activities, events }),
    [tracks, learningObjects, notes, activities, events],
  );
  if (hidden) return null;
  return (
    <section className="continue-panel" aria-label="Продолжить">
      <div className="row spread">
        <h2>Продолжить</h2>
        <button
          aria-expanded={!collapsed}
          aria-controls="continue-research-list"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? "Развернуть продолжение" : "Свернуть продолжение"}
        </button>
      </div>
      {collapsed &&
        (recent.length ? (
          <div className="daily-quick-actions">
            <button
              disabled={busy}
              title={recent[0].object.name}
              onClick={() =>
                void continueResearch(recent[0].object.id, data.storageEpoch)
              }
            >
              <span className="daily-quick-name">
                Продолжить «{recent[0].object.name}»
              </span>
            </button>
            {recent.length > 1 && (
              <small>Ещё {recent.length - 1} — в полном списке</small>
            )}
          </div>
        ) : (
          <p className="hint">Учебной работы пока нет. Начните с материала.</p>
        ))}
      <div id="continue-research-list" hidden={collapsed}>
        {!recent.length ? (
          <p className="hint">
            Пока нет сохранённой учебной работы. Откройте направление в городе и
            начните с материала.
          </p>
        ) : (
          <div className="continue-cards">
            {recent.map((item) => (
              <article key={item.object.id}>
                <small>{item.track.name}</small>
                <h3>{item.object.name}</h3>
                <p className="continue-date">
                  {item.recent.kind === "note"
                    ? "Сохранена заметка"
                    : "Подтверждён результат"}{" "}
                  ·{" "}
                  <time dateTime={item.recent.at}>
                    {new Date(item.recent.at).toLocaleString("ru")}
                  </time>
                </p>
                <p className="continue-excerpt">
                  <b>Результат:</b>{" "}
                  {item.latestResult?.activity.result ??
                    "Ещё нет подтверждённого результата"}
                </p>
                <p className="continue-excerpt">
                  <b>Следующий вопрос:</b>{" "}
                  {item.object.nextQuestion || "Пока не задан"}
                </p>
                <button
                  disabled={busy}
                  onClick={() =>
                    void continueResearch(item.object.id, data.storageEpoch)
                  }
                >
                  Продолжить «{item.object.name}»
                </button>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
