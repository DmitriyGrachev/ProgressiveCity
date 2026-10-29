import type { CityData, Track } from "../domain/model";
import { useEffect, useRef } from "react";
import { habitDay } from "../domain/habits";
import { navigate, useUI } from "../app/ui";

export function HabitReceipt({
  data,
  track,
  date,
  activityId,
  onDevelopment,
  focusAfterSave,
}: {
  data: CityData;
  track: Track;
  date: string;
  activityId?: string;
  onDevelopment?: () => void;
  focusAfterSave: boolean;
}) {
  const workView = useUI((s) => s.workView);
  const event = habitDay(data, track.id, date).event;
  const receipt = useRef<HTMLElement>(null);
  const eventId = event?.id;
  useEffect(() => {
    if (focusAfterSave && eventId) {
      receipt.current?.focus({ preventScroll: true });
      receipt.current?.scrollIntoView({ block: "nearest" });
    }
  }, [focusAfterSave, eventId]);
  const building = data.buildings.find(
    (b) => b.trackId === track.id && !b.learningObjectId && !b.habitAdditionId,
  );
  if (!event)
    return (
      <p role="status">
        Подтверждение сохранено. Получаем сведения о начислении…
      </p>
    );
  const cost = data.city!.rules.costs[track.stage - 1];
  return (
    <section
      ref={receipt}
      tabIndex={-1}
      className="habit-receipt"
      data-testid="habit-receipt"
      aria-label="Сохранённая запись дня"
    >
      <p role="status">
        <b>Запись подтверждена.</b> За {date} учтено{" "}
        {event.amount > 0 ? `+${event.amount}` : "0"} очков.
      </p>
      <p className="hint">
        Правило версии {event.ruleVersion}.{" "}
        {event.activityId !== activityId
          ? "За эту дату уже было начисление. Повторно очки не начислялись."
          : "Редактирование и повторное открытие не меняют это начисление."}
      </p>
      <p>
        {track.stage === 3
          ? "Все три этапа открыты. Накопленные очки можно вложить в сад, двор или павильон — в развитии привычки."
          : track.balance >= cost
            ? `Доступно улучшение за ${cost} очков. Развитие выбираете вы.`
            : `Для следующего этапа нужно ${cost} очков. Сейчас: ${track.balance}.`}
      </p>
      <div className="row wrap">
        {onDevelopment && (
          <button onClick={onDevelopment}>К развитию здания</button>
        )}
        {building ? (
          <button
            onClick={() =>
              void navigate({
                panel: null,
                noteId: null,
                resultRequest: null,
                focus: building.id,
              })
            }
          >
            Показать место
          </button>
        ) : (
          <button
            disabled={track.archived}
            onClick={() =>
              void navigate({
                panel: "build",
                buildingId: null,
                trackId: track.id,
                objectId: null,
                noteId: null,
                resultRequest: null,
              })
            }
          >
            Выбрать место для здания
          </button>
        )}
        {!workView && (
          <button
            onClick={() =>
              void navigate({ panel: null, noteId: null, resultRequest: null })
            }
          >
            Вернуться в город
          </button>
        )}
      </div>
    </section>
  );
}
