import { useEffect, useState } from "react";
import type { CityData } from "../domain/model";
import { habitDay } from "../domain/habits";
import { localDate } from "../domain/rules";
import { db } from "../storage/db";
import { transition, useUI } from "../app/ui";
export function TodayPanel({
  data,
  hidden,
}: {
  data: CityData;
  hidden: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false),
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
    await transition(async () => {
      const request = await db.transaction(
        "r",
        [db.metadata, db.tracks, db.activities, db.events],
        async () => {
          if ((await db.metadata.get("epoch"))?.value !== data.storageEpoch)
            throw new Error("Город заменён. Выберите привычку заново.");
          const track = await db.tracks.get(trackId);
          if (
            !track ||
            track.archived ||
            !["habit", "reduce"].includes(track.type)
          )
            throw new Error("Привычка недоступна.");
          const day = habitDay(
            {
              activities: await db.activities
                .where("trackId")
                .equals(trackId)
                .toArray(),
              events: await db.events
                .where("trackId")
                .equals(trackId)
                .toArray(),
            },
            trackId,
            date,
          );
          return {
            trackId,
            date,
            epoch: data.storageEpoch,
            activityId: day.activity?.id,
          };
        },
      );
      if (
        useUI.getState().comparison ||
        useUI.getState().snapshotId ||
        (await db.metadata.get("epoch"))?.value !== data.storageEpoch
      )
        return;
      useUI.getState().set({
        panel: "track",
        trackId,
        objectId: null,
        noteId: null,
        buildingId: null,
        resultRequest: null,
        dayRequest: request,
        workView: false,
        placement: null,
      });
    });
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
      <div id="today-list" hidden={collapsed}>
        <p className="hint">
          {data.city!.timezone}. Расписание — ваши записи, а не список
          обязательств.
        </p>
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
