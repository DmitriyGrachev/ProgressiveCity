import { useRef, useState } from "react";
import {
  id,
  labels,
  type Activity,
  type CityData,
  type ResultKind,
  type Track,
  type LearningObject,
} from "../domain/model";
import { localDate } from "../domain/rules";
import { service } from "../storage/service";
import { act, flushNotes, type ResultRequest } from "../app/ui";
import { DevelopmentChoice } from "./Research";
export function ActivityForm({
  data,
  track,
  activity,
  object,
  initialRequest,
  fresh,
}: {
  data: CityData;
  track: Track;
  activity?: Activity;
  object?: LearningObject;
  initialRequest?: ResultRequest;
  fresh: () => void;
}) {
  const initialNote = data.notes.find(
    (n) =>
      n.id === initialRequest?.noteId &&
      n.trackId === track.id &&
      n.learningObjectId === object?.id,
  );
  const [title, setTitle] = useState(
    activity?.title ?? (initialNote ? initialRequest?.title : undefined) ?? "",
  );
  const [result, setResult] = useState(activity?.result ?? "");
  const [kind, setKind] = useState<ResultKind>(activity?.kind ?? "explore");
  const [date, setDate] = useState(
    activity?.date ?? localDate(data.city!.timezone),
  );
  const [duration, setDuration] = useState(
    activity?.duration?.toString() ?? "",
  );
  const [value, setValue] = useState(activity?.value?.toString() ?? "");
  const [achieved, setAchieved] = useState(activity?.achieved ?? false);
  const [noteIds, setNoteIds] = useState(
    activity?.noteIds ?? (initialNote ? [initialNote.id] : []),
  );
  const savedId = useRef(activity?.id);
  const [confirmed, setConfirmed] = useState(activity?.confirmed ?? false);
  const [saved, setSaved] = useState(Boolean(activity));
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [initialEpoch] = useState(initialRequest?.epoch ?? data.storageEpoch);
  const invalidated = initialEpoch !== data.storageEpoch;
  const habit = ["habit", "reduce"].includes(track.type);
  async function save(confirm: boolean) {
    if (working.current || invalidated) return;
    working.current = true;
    setBusy(true);
    await act(async () => {
      await flushNotes();
      const a = await service.saveActivity(
        {
          id: savedId.current,
          trackId: track.id,
          ...(object ? { learningObjectId: object.id } : {}),
          title,
          result,
          kind,
          date,
          noteIds,
          achieved: habit ? achieved : true,
          duration: duration === "" ? undefined : Number(duration),
          value: value === "" ? undefined : Number(value),
        },
        initialEpoch,
      );
      savedId.current = a.id;
      setSaved(true);
      if (confirm) {
        await service.confirmActivity(a.id, initialEpoch);
        setConfirmed(true);
      }
    });
    setBusy(false);
    working.current = false;
  }
  return (
    <section>
      {invalidated && (
        <p role="alert">
          Город восстановлен в другой вкладке. Скопируйте свой вывод перед
          обновлением страницы.
        </p>
      )}
      <div className="row spread">
        <h3>
          {confirmed
            ? "Подтверждённая запись"
            : saved
              ? "Сохранённый черновик"
              : habit
                ? "Запись дня"
                : "Новый результат"}
        </h3>
        <button disabled={busy} onClick={fresh}>
          Новая запись
        </button>
      </div>
      {object && (
        <p className="hint">
          {track.name} → {object.name}
          {initialNote
            ? ` → ${initialRequest?.title ?? initialNote.title}`
            : ""}
        </p>
      )}
      {habit && (
        <p className="hint">
          {track.goal || "Цель задаёте вы"} · {track.schedule}
          {track.limit !== undefined
            ? ` · ${track.comparison === "max" ? "не больше" : "не меньше"} ${track.limit} ${track.unit}`
            : ""}
        </p>
      )}
      <label>
        Название результата
        <input
          maxLength={250}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <div className="row">
        <label>
          Дата результата
          <input
            type="date"
            disabled={saved}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label>
          Минуты, необязательно
          <input
            type="number"
            min="0"
            max="1440"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </label>
      </div>
      <label>
        Что получилось
        <textarea
          value={result}
          onChange={(e) => setResult(e.target.value)}
          placeholder="Что попробовали, заметили или применили?"
        />
      </label>
      <label>
        Тип результата
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as ResultKind)}
        >
          {Object.entries(labels.results).map(([v, label], i) => (
            <option key={v} value={v}>
              {label} · +{data.city!.rules.rewards[i]}
            </option>
          ))}
        </select>
      </label>
      {habit && (
        <>
          <label>
            Значение ({track.unit || "по желанию"})
            <input
              type="number"
              step="any"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={achieved}
              onChange={(e) => setAchieved(e.target.checked)}
            />
            Я считаю свою цель выполненной
          </label>
          <p className="hint">
            Без отметки — запись без награды. Не более одной награды за дату.
            Часовой пояс: {activity?.timezone ?? data.city!.timezone}.
          </p>
        </>
      )}
      {data.notes.some(
        (n) => n.trackId === track.id && n.learningObjectId === object?.id,
      ) && (
        <fieldset>
          <legend>Связанные материалы</legend>
          {data.notes
            .filter(
              (n) =>
                n.trackId === track.id && n.learningObjectId === object?.id,
            )
            .map((n) => (
              <label className="check" key={n.id}>
                <input
                  type="checkbox"
                  checked={noteIds.includes(n.id)}
                  onChange={(e) =>
                    setNoteIds(
                      e.target.checked
                        ? [...noteIds, n.id]
                        : noteIds.filter((v) => v !== n.id),
                    )
                  }
                />
                {n.id === initialRequest?.noteId
                  ? initialRequest.title
                  : n.title}
              </label>
            ))}
        </fieldset>
      )}
      <div className="row wrap">
        <button disabled={busy || invalidated} onClick={() => void save(false)}>
          {confirmed ? "Сохранить дополнение" : "Сохранить черновик"}
        </button>
        <button
          className="primary"
          disabled={busy || invalidated || confirmed || track.archived}
          onClick={() => void save(true)}
        >
          Подтвердить результат
        </button>
      </div>
      {confirmed && (
        <p className="hint success">
          Запись подтверждена. Дополнения и архивирование сохраняют прежнее
          начисление.
        </p>
      )}
      {confirmed && object && !invalidated && (
        <DevelopmentChoice
          data={data}
          track={track}
          sourceActivityId={savedId.current}
        />
      )}
      {saved && (
        <button
          className="text-button"
          disabled={busy || invalidated}
          onClick={() =>
            void act(async () => {
              const a = await service.db.activities.get(savedId.current!);
              if (a)
                await service.saveActivity(
                  { ...a, archived: !a.archived },
                  initialEpoch,
                );
            })
          }
        >
          {activity?.archived
            ? "Вернуть запись из архива"
            : "Архивировать запись"}
        </button>
      )}
    </section>
  );
}
export function Activities({
  data,
  track,
  object,
  initialRequest,
}: {
  data: CityData;
  track: Track;
  object?: LearningObject;
  initialRequest?: ResultRequest;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [key, setKey] = useState(id);
  const [archived, setArchived] = useState(false);
  const [prefill, setPrefill] = useState(initialRequest);
  const a = data.activities.find((a) => a.id === selected);
  return (
    <>
      <ActivityForm
        key={key}
        data={data}
        track={track}
        activity={a}
        object={object}
        initialRequest={prefill}
        fresh={() => {
          setSelected(null);
          setPrefill(undefined);
          setKey(id());
        }}
      />
      <hr />
      <h3>{object ? "Результаты исследования" : "Записи направления"}</h3>
      <label className="check">
        <input
          type="checkbox"
          checked={archived}
          onChange={(e) => setArchived(e.target.checked)}
        />
        Показывать архив
      </label>
      {data.activities
        .filter(
          (a) =>
            a.trackId === track.id &&
            a.learningObjectId === object?.id &&
            (archived || !a.archived),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((a) => (
          <button
            className="list-row"
            key={a.id}
            onClick={() => {
              setSelected(a.id);
              setPrefill(undefined);
              setKey(id());
            }}
          >
            <span>
              {a.title}
              <small>
                {a.date} · {a.confirmed ? "подтверждено" : "черновик"}
                {a.archived ? " · архив" : ""}
              </small>
            </span>
          </button>
        ))}
    </>
  );
}
