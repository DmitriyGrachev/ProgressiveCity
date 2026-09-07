import { useState } from "react";
import { labels, type Track, type TrackType } from "../domain/model";
import { service } from "../storage/service";
import { act, useUI } from "../app/ui";
export function TrackForm({
  track,
  onDone,
}: {
  track?: Track;
  onDone?: () => void;
}) {
  const [name, setName] = useState(track?.name ?? "");
  const [type, setType] = useState<TrackType>(track?.type ?? "skill");
  const [description, setDescription] = useState(track?.description ?? "");
  const [goal, setGoal] = useState(track?.goal ?? "");
  const [schedule, setSchedule] = useState(track?.schedule ?? "Ежедневно");
  const [unit, setUnit] = useState(track?.unit ?? "");
  const [limit, setLimit] = useState(track?.limit?.toString() ?? "");
  const [comparison, setComparison] = useState<"min" | "max">(
    track?.comparison ?? "min",
  );
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void act(async () => {
          const fields = {
            name,
            type,
            description,
            goal,
            schedule,
            unit,
            comparison,
            limit: limit === "" ? undefined : Number(limit),
          };
          if (track) await service.updateTrack({ ...track, ...fields });
          else {
            const created = await service.createTrack(fields);
            useUI.getState().set({ trackId: created.id, panel: "track" });
          }
          onDone?.();
        }).finally(() => setBusy(false));
      }}
    >
      <label>
        Название направления
        <input
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        Тип направления
        <select
          disabled={Boolean(track)}
          value={type}
          onChange={(e) => setType(e.target.value as TrackType)}
        >
          {Object.entries(labels.tracks).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Описание
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      {["habit", "reduce"].includes(type) && (
        <>
          <label>
            Моя цель
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Я сам определяю, что считаю выполнением"
            />
          </label>
          <label>
            Расписание
            <input
              maxLength={250}
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              placeholder="Например: пн, ср, пт"
            />
          </label>
          <div className="row">
            <label>
              Условие
              <select
                value={comparison}
                onChange={(e) => setComparison(e.target.value as "min" | "max")}
              >
                <option value="min">Не меньше</option>
                <option value="max">Не больше</option>
              </select>
            </label>
            <label>
              Граница
              <input
                type="number"
                step="any"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
              />
            </label>
            <label>
              Единица
              <input
                maxLength={80}
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              />
            </label>
          </div>
          <p className="hint">
            Расписание — ваш ориентир. Пропуски не снимают очки. Направление
            можно оставить без здания на карте.
          </p>
        </>
      )}
      <button className="primary" disabled={busy} type="submit">
        {track ? "Сохранить направление" : "Создать направление"}
      </button>
    </form>
  );
}
