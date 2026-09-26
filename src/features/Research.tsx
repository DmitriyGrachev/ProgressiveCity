import { useRef, useState } from "react";
import type { CityData, LearningObject, Track } from "../domain/model";
import { id } from "../domain/model";
import { act, navigate, transition, useUI } from "../app/ui";
import { service } from "../storage/service";

export function ResearchPicker({
  data,
  track,
  object,
  readonly,
}: {
  data: CityData;
  track: Track;
  object: LearningObject;
  readonly: boolean;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <label>
        Учебный объект
        <select
          value={object.id}
          onChange={(e) =>
            void navigate({
              objectId: e.target.value,
              resultRequest: null,
              noteId: null,
              buildingId:
                data.buildings.find(
                  (b) => b.learningObjectId === e.target.value,
                )?.id ?? null,
            })
          }
        >
          {data.learningObjects
            .filter((o) => o.trackId === track.id)
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} · {o.built ? `этап ${o.stage}` : "исследование"}
              </option>
            ))}
        </select>
      </label>
      {!readonly && (
        <details className="research-create">
          <summary>Новое исследование в этом направлении</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              void transition(async () => {
                const created = await service.createLearningObject(
                  track.id,
                  name,
                  data.storageEpoch,
                );
                useUI.getState().set({
                  objectId: created.id,
                  resultRequest: null,
                  noteId: null,
                  buildingId: null,
                });
              }).finally(() => setBusy(false));
            }}
          >
            <label>
              Название исследования
              <input
                required
                maxLength={250}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Например, студия света"
              />
            </label>
            <button disabled={busy || track.archived}>
              Начать исследование
            </button>
            <p className="hint">
              Материалы можно собирать сразу. Новая постройка —{" "}
              {data.city!.rules.constructionCost} очков из общего баланса
              направления.
            </p>
          </form>
        </details>
      )}
    </>
  );
}

export function ResearchDetails({
  data,
  object,
  readonly,
}: {
  data: CityData;
  object: LearningObject;
  readonly: boolean;
}) {
  const [name, setName] = useState(object.name);
  const [question, setQuestion] = useState(object.nextQuestion);
  const [saved, setSaved] = useState(false);
  const [base, setBase] = useState({ object, epoch: data.storageEpoch });
  const [busy, setBusy] = useState(false);
  const invalidated = base.epoch !== data.storageEpoch;
  const changed =
    invalidated ||
    base.object.name !== object.name ||
    base.object.nextQuestion !== object.nextQuestion;
  const latest = data.activities
    .filter((a) => a.learningObjectId === object.id && a.confirmed)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const growth = data.events
    .filter(
      (e) =>
        e.learningObjectId === object.id &&
        ["construction", "upgrade"].includes(e.type),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <section className="research-details">
      {latest && (
        <p className="hint">
          <b>Последний результат:</b> {latest.result}
        </p>
      )}
      {object.nextQuestion && (
        <p className="hint">
          <b>Следующий вопрос:</b> {object.nextQuestion}
        </p>
      )}
      <details>
        <summary>Вопрос и название исследования</summary>
        {changed && (
          <p className="notice">
            Сохранённое исследование изменилось в другой вкладке. Ваши поля
            остались здесь. Скопируйте нужный текст, затем загрузите актуальные
            поля.
          </p>
        )}
        <fieldset disabled={readonly}>
          <label>
            Имя исследования
            <input
              maxLength={250}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSaved(false);
              }}
            />
          </label>
          <label>
            Следующий вопрос
            <textarea
              maxLength={2000}
              value={question}
              onChange={(e) => {
                setQuestion(e.target.value);
                setSaved(false);
              }}
            />
          </label>
          <button
            disabled={busy || invalidated}
            onClick={() => {
              setBusy(true);
              void act(async () => {
                const updated = await service.updateLearningObject(
                  { ...object, name, nextQuestion: question },
                  base.epoch,
                  base.object,
                );
                setBase({ object: updated, epoch: base.epoch });
                setSaved(true);
              }).finally(() => setBusy(false));
            }}
          >
            Сохранить исследование
          </button>
          {saved && <span role="status"> Исследование сохранено</span>}
          {changed && (
            <button
              disabled={busy}
              onClick={() => {
                setName(object.name);
                setQuestion(object.nextQuestion);
                setBase({ object, epoch: data.storageEpoch });
                setSaved(false);
              }}
            >
              Загрузить актуальные поля
            </button>
          )}
        </fieldset>
      </details>
      {growth.length > 0 && (
        <details>
          <summary>Почему выросла постройка</summary>
          {growth.map((event) => {
            const source = data.activities.find(
              (a) => a.id === event.sourceActivityId,
            );
            return (
              <div className="growth-event" key={event.id}>
                <p>
                  {event.description} · {event.amount} очков · правила{" "}
                  {event.ruleVersion}
                </p>
                {source ? (
                  <>
                    <p className="hint">Основание: {source.result}</p>
                    {source.noteIds.map((noteId) => {
                      const note = data.notes.find((n) => n.id === noteId);
                      return (
                        note && (
                          <button
                            className="text-button"
                            key={noteId}
                            onClick={() =>
                              void navigate({
                                panel: "library",
                                noteId: note.id,
                                resultRequest: null,
                              })
                            }
                          >
                            Открыть материал «{note.title}»
                          </button>
                        )
                      );
                    })}
                  </>
                ) : (
                  <p className="hint">
                    Из накопленного баланса направления. У старого события
                    ссылка на конкретный результат не записывалась.
                  </p>
                )}
              </div>
            );
          })}
        </details>
      )}
    </section>
  );
}

export function DevelopmentChoice({
  data,
  track,
  sourceActivityId,
}: {
  data: CityData;
  track: Track;
  sourceActivityId?: string;
}) {
  const commands = useRef(new Map<string, string>());
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [message, setMessage] = useState("");
  const objects = data.learningObjects.filter((o) => o.trackId === track.id);
  async function develop(object: LearningObject) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setMessage("");
    const key = `${object.id}:${object.built ? object.stage : "construction"}`;
    const command = commands.current.get(key) ?? id();
    commands.current.set(key, command);
    await act(async () => {
      if (object.built) {
        await service.upgradeObject(
          object.id,
          command,
          sourceActivityId,
          data.storageEpoch,
        );
        setMessage(`«${object.name}»: следующий этап сохранён.`);
      } else {
        await service.construct(
          object.id,
          command,
          sourceActivityId,
          data.storageEpoch,
        );
        await navigate({
          panel: "build",
          trackId: track.id,
          objectId: object.id,
          buildingId: null,
          noteId: null,
          resultRequest: null,
        });
      }
    });
    working.current = false;
    setBusy(false);
  }
  return (
    <section className="development-choice">
      <h3>Как продолжить развитие?</h3>
      <p className="hint">
        Общий баланс направления: {track.balance}. Улучшите существующий объект
        или выделите исследованию отдельное место.
      </p>
      {objects.map((object) => {
        const cost = object.built
          ? data.city!.rules.costs[object.stage - 1]
          : data.city!.rules.constructionCost;
        return (
          <div className="growth-option" key={object.id}>
            <span>
              {object.name}
              <small>
                {object.built
                  ? object.stage === 3
                    ? "Все этапы открыты"
                    : `Этап ${object.stage + 1} · ${cost} очков`
                  : `Новая постройка · ${cost} очков`}
              </small>
            </span>
            <button
              disabled={
                busy ||
                track.archived ||
                (object.built && object.stage === 3) ||
                track.balance < cost
              }
              onClick={() => void develop(object)}
            >
              {object.built
                ? `Развить «${object.name}»`
                : `Построить «${object.name}»`}
            </button>
          </div>
        );
      })}
      {objects.every((o) => o.built) && (
        <p className="hint">
          Для расширения начните новое исследование в этом направлении — выше,
          под выбором учебного объекта.
        </p>
      )}
      {message && (
        <p role="status" className="success">
          {message}
        </p>
      )}
      <p className="hint">
        Этапы отражают ваши зафиксированные действия, а не объективный уровень
        знаний.
      </p>
    </section>
  );
}
