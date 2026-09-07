import { useState } from "react";
import { id, labels, type CityData, type Track } from "../domain/model";
import { act, navigate, transition, useUI } from "../app/ui";
import { service } from "../storage/service";
import { NoteEditor } from "../notes/NoteEditor";
import { Activities } from "./ActivityForm";
import { TrackForm } from "./TrackForm";
export function TrackPanel({ data, track }: { data: CityData; track: Track }) {
  const [tab, setTab] = useState<"notes" | "results" | "edit">("notes");
  const [busy, setBusy] = useState(false);
  const [upgradeId, setUpgradeId] = useState(id);
  const noteId = useUI((s) => s.noteId);
  const readonly = useUI((s) => Boolean(s.snapshotId));
  const building = data.buildings.find((b) => b.trackId === track.id);
  const note = data.notes.find((n) => n.id === noteId);
  const activeTab = readonly ? "notes" : tab;
  const cost = data.city!.rules.costs[track.stage - 1];
  return (
    <>
      <span className="eyebrow">
        {labels.tracks[track.type]}
        {track.archived ? " · архив" : ""}
      </span>
      <h2>{track.name}</h2>
      {readonly && (
        <p className="notice">
          Показаны текущие материалы. Снимок хранит прошлую планировку и этапы,
          а не прошлые редакции заметок.
        </p>
      )}
      <div className="progress-strip">
        <span data-testid="stage">
          Этап <b>{track.stage}</b> / 3
        </span>
        <span data-testid="balance">
          <b>{track.balance}</b> очков развития
        </span>
        <button
          disabled={
            readonly ||
            busy ||
            track.stage === 3 ||
            track.balance < cost ||
            track.archived
          }
          onClick={() => {
            setBusy(true);
            void act(async () => {
              await service.upgrade(track.id, upgradeId);
              setUpgradeId(id());
            }).finally(() => setBusy(false));
          }}
        >
          Улучшить
        </button>
      </div>
      <p className="hint">
        {track.stage === 3
          ? "Все три этапа открыты. Материалы и новые результаты остаются с вами."
          : `Следующий этап стоит ${cost} очков. Развитие выбираете вы.`}
      </p>
      <div className="row wrap">
        {building ? (
          <>
            <button onClick={() => void navigate({ focus: building.id })}>
              Найти на карте
            </button>
            <button
              disabled={readonly}
              onClick={() =>
                void navigate({
                  panel: "build",
                  buildingId: building.id,
                  noteId: null,
                })
              }
            >
              Оформление и перенос
            </button>
          </>
        ) : (
          <>
            <span className="muted">Здание снято с карты</span>
            <button
              disabled={readonly || track.archived}
              onClick={() =>
                void navigate({
                  panel: "build",
                  buildingId: null,
                  noteId: null,
                })
              }
            >
              Поставить здание
            </button>
          </>
        )}
      </div>
      <div className="tabs">
        {(["notes", "results", "edit"] as const).map((value, i) => (
          <button
            disabled={readonly && value !== "notes"}
            className={activeTab === value ? "active" : ""}
            key={value}
            onClick={() =>
              void transition(async () => {
                setTab(value);
              })
            }
          >
            {["Материалы", "Результаты", "Направление"][i]}
          </button>
        ))}
      </div>
      {activeTab === "notes" && (
        <>
          <button
            className="primary"
            disabled={readonly}
            onClick={() =>
              void transition(async () => {
                const n = await service.createNote(track.id);
                useUI.getState().set({ noteId: n.id });
              })
            }
          >
            Новая заметка
          </button>
          <div className="note-list">
            {data.notes
              .filter((n) => n.trackId === track.id)
              .map((n) => (
                <button
                  className={`list-row ${n.id === noteId ? "selected" : ""}`}
                  key={n.id}
                  aria-label={n.title}
                  onClick={() => void navigate({ noteId: n.id })}
                >
                  <span>
                    {n.title}
                    <small>
                      {n.tags.join(" · ") ||
                        new Date(n.updatedAt).toLocaleDateString("ru")}
                    </small>
                  </span>
                </button>
              ))}
          </div>
          {note ? (
            <NoteEditor key={note.id} note={note} epoch={data.storageEpoch} />
          ) : (
            <p className="empty">
              Здесь останутся ваши вопросы, эксперименты и выводы. Создайте
              заметку или откройте сохранённую.
            </p>
          )}
        </>
      )}
      {activeTab === "results" && <Activities data={data} track={track} />}
      {activeTab === "edit" && (
        <>
          <TrackForm track={track} />
          <hr />
          <button
            onClick={() =>
              void act(() =>
                service.updateTrack({ ...track, archived: !track.archived }),
              )
            }
          >
            {track.archived
              ? "Вернуть направление из архива"
              : "Архивировать направление"}
          </button>
          <p className="hint">
            Архивирование не удаляет заметки, здания, прогресс и историю.
          </p>
        </>
      )}
    </>
  );
}
