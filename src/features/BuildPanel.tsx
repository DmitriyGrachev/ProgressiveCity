import { useState } from "react";
import {
  id,
  labels,
  palettes,
  type Building,
  type BuildingKind,
  type CityData,
} from "../domain/model";
import { service } from "../storage/service";
import { act, useUI } from "../app/ui";
export function BuildPanel({
  data,
  building,
}: {
  data: CityData;
  building?: Building;
}) {
  const currentTrackId = useUI((s) => s.trackId);
  const readonly = useUI((s) => Boolean(s.snapshotId));
  const placement = useUI((s) => s.placement);
  const [kind, setKind] = useState<BuildingKind>(building?.kind ?? "workshop");
  const [trackId, setTrackId] = useState(
    building?.trackId ?? currentTrackId ?? "",
  );
  const [name, setName] = useState(building?.name ?? "");
  const [color, setColor] = useState(building?.color ?? palettes[0]);
  const [x, setX] = useState(building?.x ?? 20);
  const [y, setY] = useState(building?.y ?? 20);
  const [buildingId] = useState(building?.id ?? id);
  const progress = ["workshop", "library", "pavilion"].includes(kind);
  const available = data.tracks.filter(
    (t) =>
      !t.archived &&
      !data.buildings.some((b) => b.trackId === t.id && b.id !== building?.id),
  );
  const candidate = (): Building => {
    if (progress && !trackId)
      throw new Error("Выберите направление для здания.");
    return {
      id: buildingId,
      kind,
      name:
        name.trim() ||
        (progress ? data.tracks.find((t) => t.id === trackId)?.name : "") ||
        labels.buildings[kind],
      color,
      x,
      y,
      w: progress || ["park", "plaza"].includes(kind) ? 2 : 1,
      h: progress || ["park", "plaza"].includes(kind) ? 2 : 1,
      ...(progress ? { trackId } : {}),
    };
  };
  return (
    <>
      <span className="eyebrow">Свободная планировка</span>
      <h2>{building ? building.name : "Обустроить город"}</h2>
      {readonly && (
        <p className="notice">
          Исторический вид открыт только для чтения. Вернитесь в текущий город
          для изменений.
        </p>
      )}
      <fieldset disabled={readonly}>
        <legend>Архитектура и оформление</legend>
        <label>
          Тип объекта
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as BuildingKind)}
          >
            {Object.entries(labels.buildings)
              .filter(
                ([k]) =>
                  !building ||
                  Boolean(building.trackId) ===
                    ["workshop", "library", "pavilion"].includes(k),
              )
              .map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        {progress && (
          <label>
            Направление здания
            <select
              value={trackId}
              disabled={Boolean(building)}
              onChange={(e) => setTrackId(e.target.value)}
            >
              <option value="">Выберите направление</option>
              {available.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Имя объекта
          <input
            maxLength={120}
            value={name}
            placeholder={
              progress
                ? data.tracks.find((t) => t.id === trackId)?.name
                : labels.buildings[kind]
            }
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Палитра
          <select value={color} onChange={(e) => setColor(e.target.value)}>
            {palettes.map((c, i) => (
              <option key={c} value={c}>
                {["Терракота", "Шалфей", "Синий сланец", "Охра", "Вереск"][i]}
              </option>
            ))}
          </select>
        </label>
        <div className="swatches">
          {palettes.map((c) => (
            <button
              type="button"
              key={c}
              aria-label={`Цвет ${c}`}
              aria-pressed={color === c}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <button
          className="primary wide"
          onClick={() =>
            void act(async () => {
              useUI.getState().set({ placement: candidate() });
            })
          }
        >
          {building ? "Перенести на карте" : "Выбрать место на карте"}
        </button>
        <p className="hint">
          Объект занимает{" "}
          {progress || ["park", "plaza"].includes(kind) ? "2 × 2" : "1 × 1"}{" "}
          клетки. Дороги, парки, площади и деревья бесплатны.
        </p>
        <details>
          <summary>Точное размещение по клеткам</summary>
          <div className="row">
            <label>
              X
              <input
                type="number"
                min="0"
                max="39"
                value={x}
                onChange={(e) => setX(Number(e.target.value))}
              />
            </label>
            <label>
              Y
              <input
                type="number"
                min="0"
                max="39"
                value={y}
                onChange={(e) => setY(Number(e.target.value))}
              />
            </label>
          </div>
          <button
            onClick={() =>
              void act(async () => {
                const b = candidate();
                await service.placeBuilding(b);
                useUI.getState().set({ buildingId: b.id, placement: null });
              })
            }
          >
            Разместить по координатам
          </button>
        </details>
        {building && (
          <>
            <button
              className="wide"
              onClick={() =>
                void act(() =>
                  service.placeBuilding({
                    ...candidate(),
                    x: building.x,
                    y: building.y,
                  }),
                )
              }
            >
              Сохранить оформление
            </button>
            <button
              className="danger-text wide"
              onClick={() =>
                void act(async () => {
                  await service.removeBuilding(building.id);
                  useUI.getState().set({ buildingId: null, placement: null });
                })
              }
            >
              Снять с карты
            </button>
          </>
        )}
      </fieldset>
      {placement && (
        <div className="notice">
          Выбран инструмент размещения. Нажмите на свободную клетку.
          <button onClick={() => useUI.getState().set({ placement: null })}>
            Отменить размещение
          </button>
        </div>
      )}
      <p className="hint">
        Перестройка не начисляет очки. Снятие здания сохраняет направление,
        заметки и историю. Этап развития принадлежит направлению.
      </p>
    </>
  );
}
