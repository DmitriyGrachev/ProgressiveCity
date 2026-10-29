import { useEffect, useState } from "react";
import type { CityData } from "../domain/model";
import { habitDay } from "../domain/habits";
import { localDate } from "../domain/rules";
import { useUI } from "../app/ui";
import { openHabitDay } from "../app/habits";
export function TodayPanel({
  data,
  hidden,
}: {
  data: CityData;
  hidden: boolean;
}) {
  const [collapsed, setCollapsed] = useState(true),
    [all, setAll] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const busy = useUI((s) => s.transitioning);
  useEffect(() => {
    const refresh = () => setClock(new Date());
    const timer = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  const tracks = data.tracks
    .filter((t) => !t.archived && (t.type === "habit" || t.type === "reduce"))
    .sort(
      (a, b) => a.name.localeCompare(b.name, "ru") || a.id.localeCompare(b.id),
    );
  const date = localDate(data.city!.timezone, clock);
  async function open(trackId: string) {
    await openHabitDay(trackId, date, data.storageEpoch);
  }
  if (hidden) return null;
  return (
    <section className="today-panel" aria-label="Привычки сегодня">
      <div className="row spread">
        <h2>
          Привычки сегодня <small>{date}</small>
        </h2>
        <button
          aria-expanded={!collapsed}
          aria-controls="today-list"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? "Развернуть привычки" : "Свернуть привычки"}
        </button>
      </div>
      {collapsed && (
        <div className="daily-quick-actions">
          {tracks.slice(0, 3).map((track) => {
            const day = habitDay(data, track.id, date);
            const status = {
              none: "Нет записи",
              draft: "Есть черновик",
              zero: "Подтверждено без награды",
              reward: `Подтверждено: +${day.event?.amount ?? 0}`,
            }[day.status];
            return (
              <button
                key={track.id}
                disabled={busy}
                title={`${track.name}: ${status}`}
                aria-label={`${day.activity ? "Открыть" : "Отметить"} «${track.name}»`}
                onClick={() => void open(track.id)}
              >
                <span className="daily-quick-name">{track.name}</span>
                <span aria-hidden="true">
                  {day.status === "reward"
                    ? `✓ +${day.event!.amount}`
                    : day.status === "zero"
                      ? "✓ 0"
                      : day.status === "draft"
                        ? "⋯"
                        : "○"}
                </span>
              </button>
            );
          })}
          {!tracks.length && (
            <p className="hint">Активных привычек пока нет.</p>
          )}
        </div>
      )}
      <p className="hint">
        {data.city!.timezone}. Расписание — ваши записи, а не список
        обязательств.
      </p>
      <div id="today-list" hidden={collapsed}>
        {!tracks.length && (
          <p className="hint">
            Активных привычек пока нет. Их можно добавить через «Новое
            направление».
          </p>
        )}
        <div className="today-cards">
          {tracks.slice(0, all ? tracks.length : 3).map((track) => {
            const day = habitDay(data, track.id, date);
            return (
              <article key={track.id}>
                <div>
                  <b>{track.name}</b>
                  <small>
                    {track.goal || "Цель задаёте вы"}
                    {track.limit !== undefined
                      ? ` · ${track.comparison === "max" ? "не больше" : "не меньше"} ${track.limit} ${track.unit}`
                      : ""}{" "}
                    · {track.schedule || "Без расписания"}
                  </small>
                  <small>
                    {
                      {
                        none: "Нет записи",
                        draft: "Есть черновик",
                        zero: "Подтверждено без награды",
                        reward: "Подтверждено с наградой",
                      }[day.status]
                    }
                    {day.event?.amount ? ` · +${day.event.amount}` : ""}
                  </small>
                </div>
                <button
                  disabled={busy}
                  onClick={() => void open(track.id)}
                  aria-label={`${day.activity ? "Открыть" : "Отметить"} «${track.name}»`}
                >
                  {day.activity ? "Открыть" : "Отметить"}
                </button>
              </article>
            );
          })}
        </div>
        {tracks.length > 3 && (
          <button aria-expanded={all} onClick={() => setAll(!all)}>
            {all ? "Показать три" : `Остальные привычки (${tracks.length - 3})`}
          </button>
        )}
      </div>
    </section>
  );
}
