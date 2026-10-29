import { useRef, useState } from "react";
import {
  id,
  type CityData,
  type ProgressEvent,
  type Track,
} from "../domain/model";
import { service } from "../storage/service";
import { act, navigate } from "../app/ui";
import { openHabitDay } from "../app/habits";
import { BuildingPreview } from "../city/BuildingPreview";

export const additionNames = {
  park: "сад",
  plaza: "двор",
  pavilion: "павильон",
};
export function HabitAdditions({
  data,
  track,
  readonly,
}: {
  data: CityData;
  track: Track;
  readonly: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const commands = useRef(new Map<string, string>());
  const cost = data.city!.rules.constructionCost;
  const purchases = data.events
    .filter((e) => e.type === "habitAddition" && e.trackId === track.id)
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
  function open(purchase: ProgressEvent) {
    const building = data.buildings.find(
      (b) => b.habitAdditionId === purchase.id,
    );
    void navigate({
      panel: "build",
      trackId: track.id,
      objectId: null,
      noteId: null,
      buildingId: building?.id ?? null,
      additionId: purchase.id,
    });
  }
  return (
    <section aria-label="Дополнения привычки" className="habit-additions">
      <h3>Свой квартал</h3>
      <p className="hint">
        Третий этап сохраняется. Дополнения приобретаются за очки этой привычки;
        снятие с карты сохраняет владение. Бесплатный декор остаётся в каталоге.
      </p>
      <div className="building-catalog">
        {(["park", "plaza", "pavilion"] as const).map((kind) => (
          <div className="catalog-card" key={kind}>
            <BuildingPreview kind={kind} stage={1} color="#578b7c" owned />
            <b>{additionNames[kind]}</b>
            <small>2 × 2 клетки · {cost} очков</small>
            <button
              disabled={
                readonly || busy || track.archived || track.balance < cost
              }
              onClick={() => {
                if (busy) return;
                setBusy(true);
                setMessage("");
                const command = commands.current.get(kind) ?? id();
                commands.current.set(kind, command);
                void act(async () => {
                  await service.buyHabitAddition(
                    track.id,
                    kind,
                    command,
                    data.storageEpoch,
                  );
                  commands.current.delete(kind);
                  setMessage("Приобретено. Выберите место в удобное время.");
                }).finally(() => setBusy(false));
              }}
            >
              Приобрести {additionNames[kind]} · {cost} очка
            </button>
          </div>
        ))}
      </div>
      {message && <p role="status">{message}</p>}
      {purchases.map((purchase) => {
        const kind = purchase.additionKind!,
          building = data.buildings.find(
            (b) => b.habitAdditionId === purchase.id,
          ),
          source = data.activities.find(
            (a) => a.id === purchase.sourceActivityId,
          );
        return (
          <article key={purchase.id} className="notice">
            <b>
              {additionNames[kind]} ·{" "}
              {building ? "на карте" : "ожидает размещения"}
            </b>
            <p className="hint">
              Приобретено за {-purchase.amount} очков ·{" "}
              {new Date(purchase.createdAt).toLocaleString("ru")}. Правило v
              {purchase.ruleVersion}.
            </p>
            <button
              disabled={readonly || track.archived}
              onClick={() => open(purchase)}
            >
              {building ? "Оформить" : "Разместить"} {additionNames[kind]}
            </button>
            {source && (
              <button
                disabled={readonly || track.archived}
                onClick={() =>
                  void openHabitDay(
                    track.id,
                    source.date,
                    data.storageEpoch,
                    source.id,
                  )
                }
              >
                Основание: {source.title}
              </button>
            )}
            {building && (
              <button
                onClick={() =>
                  void navigate({ focus: building.id, panel: null })
                }
              >
                Показать {additionNames[kind]}
              </button>
            )}
          </article>
        );
      })}
      {track.balance < cost && (
        <p className="hint">
          Следующее дополнение стоит {cost} очков. Сейчас: {track.balance}.
        </p>
      )}
    </section>
  );
}
