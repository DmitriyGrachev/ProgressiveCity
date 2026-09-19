import { useState } from "react";
import { id, labels, type CityData, type Track } from "../domain/model";
import { act, navigate, transition, useUI } from "../app/ui";
import { service } from "../storage/service";
import { NoteEditor } from "../notes/NoteEditor";
import { Activities } from "./ActivityForm";
import { TrackForm } from "./TrackForm";
import { DevelopmentChoice, ResearchDetails, ResearchPicker } from "./Research";
export function TrackPanel({ data, track }: { data: CityData; track: Track }) {
  const [tab, setTab] = useState<"notes" | "results" | "edit">("notes");
  const [busy, setBusy] = useState(false);
  const [upgradeId, setUpgradeId] = useState(id);
  const noteId = useUI((s) => s.noteId);
  const objectId = useUI((s) => s.objectId);
  const resultRequest = useUI((s) => s.resultRequest);
  const resultNoteId = resultRequest?.noteId;
  const [allMaterials, setAllMaterials] = useState(false);
  const object = data.learningObjects.find(
    (o) => o.trackId === track.id && o.id === (objectId ?? track.id),
  );
  const stage = object?.stage ?? track.stage;
  const readonly = useUI((s) => Boolean(s.snapshotId));
  const building = data.buildings.find(
    (b) => b.trackId === track.id && b.learningObjectId === object?.id,
  );
  const note = data.notes.find((n) => n.id === noteId);
  const activeTab = readonly ? "notes" : resultNoteId ? "results" : tab;
  const cost = data.city!.rules.costs[stage - 1];
  return (
    <>
      <span className="eyebrow">
        {labels.tracks[track.type]}
        {track.archived ? " · архив" : ""}
      </span>
      <h2>{track.name}</h2>
      {object && (
        <ResearchPicker
          data={data}
          track={track}
          object={object}
          readonly={readonly}
        />
      )}
      {readonly && (
        <p className="notice">
          Показаны текущие материалы. Снимок хранит прошлую планировку и этапы,
          а не прошлые редакции заметок.
        </p>
      )}
      <div className="progress-strip">
        <span data-testid="stage">
          Этап <b>{stage}</b> / 3
        </span>
        <span data-testid="balance">
          <b>{track.balance}</b> очков развития
        </span>
        <button
          disabled={
            readonly ||
            busy ||
            stage === 3 ||
            (object && !object.built) ||
            track.balance < cost ||
            track.archived
          }
          onClick={() => {
            setBusy(true);
            void act(async () => {
              if (object)
                await service.upgradeObject(
                  object.id,
                  upgradeId,
                  undefined,
                  data.storageEpoch,
                );
              else await service.upgrade(track.id, upgradeId);
              setUpgradeId(id());
            }).finally(() => setBusy(false));
          }}
        >
          Улучшить
        </button>
      </div>
      <p className="hint">
        {object && !object.built
          ? `Исследование начато. Постройка стоит ${data.city!.rules.constructionCost} очков; материалы доступны уже сейчас.`
          : stage === 3
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
        ) : object && !object.built ? (
          <span className="muted">Постройка ещё не оплачена</span>
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
      {object && (
        <ResearchDetails
          key={object.id}
          data={data}
          object={object}
          readonly={readonly}
        />
      )}
      {object && !object.built && activeTab !== "results" && !readonly && (
        <DevelopmentChoice data={data} track={track} />
      )}
      <div className="tabs">
        {(["notes", "results", "edit"] as const).map((value, i) => (
          <button
            disabled={readonly && value !== "notes"}
            className={activeTab === value ? "active" : ""}
            key={value}
            onClick={() =>
              void transition(async () => {
                setTab(value);
                useUI.getState().set({ resultRequest: null });
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
                const n = await service.createNote(track.id, object?.id);
                useUI.getState().set({ noteId: n.id });
              })
            }
          >
            Новая заметка
          </button>
          {object && (
            <label className="check">
              <input
                type="checkbox"
                checked={allMaterials}
                onChange={(e) => setAllMaterials(e.target.checked)}
              />
              Все материалы направления
            </label>
          )}
          <div className="note-list">
            {data.notes
              .filter(
                (n) =>
                  n.trackId === track.id &&
                  (allMaterials || n.learningObjectId === object?.id),
              )
              .map((n) => (
                <button
                  className={`list-row ${n.id === noteId ? "selected" : ""}`}
                  key={n.id}
                  aria-label={n.title}
                  onClick={() =>
                    void navigate({
                      noteId: n.id,
                      objectId: n.learningObjectId ?? null,
                    })
                  }
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
      {activeTab === "results" && (
        <Activities
          key={`${object?.id ?? track.id}-${resultNoteId ?? "manual"}`}
          data={data}
          track={track}
          object={object}
          initialRequest={resultRequest ?? undefined}
        />
      )}
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
