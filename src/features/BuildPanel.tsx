import { useState } from "react";
import {
  id,
  isLearning,
  labels,
  palettes,
  type Building,
  type BuildingKind,
  type CityData,
} from "../domain/model";
import { service } from "../storage/service";
import { act, useUI } from "../app/ui";
import { BuildingCatalog } from "./BuildingCatalog";
import { BuildingPreview } from "../city/BuildingPreview";
export function BuildPanel({
  data,
  building,
}: {
  data: CityData;
  building?: Building;
}) {
  const currentTrackId = useUI((s) => s.trackId);
  const currentObjectId = useUI((s) => s.objectId);
  const readonly = useUI((s) => Boolean(s.snapshotId || s.comparison));
  const placement = useUI((s) => s.placement);
  const [kind, setKind] = useState<BuildingKind>(building?.kind ?? "workshop");
  const [trackId, setTrackId] = useState(
    building?.trackId ?? currentTrackId ?? "",
  );
  const [name, setName] = useState(building?.name ?? "");
  const [objectId, setObjectId] = useState(
    building?.learningObjectId ?? currentObjectId ?? "",
  );
  const [color, setColor] = useState(building?.color ?? palettes[0]);
  const [colorText, setColorText] = useState(building?.color ?? palettes[0]);
  const [previewStage, setPreviewStage] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [x, setX] = useState(building?.x ?? 20);
  const [y, setY] = useState(building?.y ?? 20);
  const [buildingId] = useState(building?.id ?? id);
  const progress = ["workshop", "library", "pavilion"].includes(kind);
  const available = data.tracks.filter(
    (t) =>
      !t.archived &&
      (isLearning(t)
        ? data.learningObjects.some(
            (o) =>
              o.trackId === t.id &&
              o.built &&
              !data.buildings.some(
                (b) => b.learningObjectId === o.id && b.id !== building?.id,
              ),
          )
        : !data.buildings.some(
            (b) => b.trackId === t.id && b.id !== building?.id,
          )),
  );
  const objects = data.learningObjects.filter(
    (o) =>
      o.trackId === trackId &&
      o.built &&
      !data.buildings.some(
        (b) => b.learningObjectId === o.id && b.id !== building?.id,
      ),
  );
  const selectedObject = objects.find((o) => o.id === objectId) ?? objects[0];
  const actualStage = progress
    ? (selectedObject?.stage ??
      data.tracks.find((t) => t.id === trackId)?.stage ??
      1)
    : 1;
  const viewedStage = progress ? (previewStage ?? actualStage) : 1;
  const validColor = /^#[0-9a-f]{6}$/i.test(colorText.trim());
  const kinds = (Object.keys(labels.buildings) as BuildingKind[]).filter(
    (k) =>
      !building ||
      Boolean(building.trackId) ===
        ["workshop", "library", "pavilion"].includes(k),
  );
  function changeDraft() {
    setMessage("");
    useUI.getState().set({ placement: null });
  }
  function chooseColor(value: string) {
    changeDraft();
    setColorText(value);
    if (/^#[0-9a-f]{6}$/i.test(value.trim()))
      setColor(value.trim().toLowerCase());
  }
  function chooseKind(value: BuildingKind) {
    changeDraft();
    setKind(value);
  }
  async function save(b: Building, text: string) {
    setMessage("");
    setBusy(true);
    try {
      await service.placeBuilding(b, data.storageEpoch);
      useUI
        .getState()
        .set({
          buildingId: b.id,
          objectId: b.learningObjectId ?? null,
          trackId: b.trackId ?? null,
          placement: null,
        });
      setMessage(text);
    } finally {
      setBusy(false);
    }
  }
  const candidate = (): Building => {
    if (!validColor)
      throw new Error("Введите акцентный цвет в формате #RRGGBB.");
    if (progress && !trackId)
      throw new Error("Выберите направление для здания.");
    const track = data.tracks.find((t) => t.id === trackId);
    if (progress && track && isLearning(track) && !selectedObject)
      throw new Error(
        "Нет доступного здания: начните исследование и оплатите его строительство из направления.",
      );
    return {
      id: buildingId,
      kind,
      name:
        name.trim() ||
        (progress
          ? (selectedObject?.name ??
            data.tracks.find((t) => t.id === trackId)?.name)
          : "") ||
        labels.buildings[kind],
      color,
      x,
      y,
      w: progress || ["park", "plaza"].includes(kind) ? 2 : 1,
      h: progress || ["park", "plaza"].includes(kind) ? 2 : 1,
      ...(progress
        ? {
            trackId,
            ...(selectedObject ? { learningObjectId: selectedObject.id } : {}),
          }
        : {}),
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
      <fieldset disabled={readonly || busy}>
        <legend>Архитектура и оформление</legend>
        <BuildingCatalog
          kinds={kinds}
          kind={kind}
          color={color}
          stage={viewedStage}
          onChange={chooseKind}
        />
        <section
          className="building-preview"
          data-testid="building-preview"
          aria-label="Примерка выбранного варианта"
        >
          <BuildingPreview kind={kind} color={color} stage={viewedStage} />
          <b>
            {labels.buildings[kind]} ·{" "}
            {progress ? `этап ${viewedStage}` : "декор"}
          </b>
          {progress && (
            <>
              <div
                className="stage-picker"
                role="group"
                aria-label="Просмотр этапов"
              >
                {[1, 2, 3].map((stage) => (
                  <button
                    type="button"
                    key={stage}
                    aria-label={`Посмотреть этап ${stage}`}
                    aria-pressed={viewedStage === stage}
                    onClick={() => setPreviewStage(stage)}
                  >
                    {stage}
                  </button>
                ))}
              </div>
              <p
                className={viewedStage > actualStage ? "future-stage" : "hint"}
              >
                {viewedStage > actualStage
                  ? `Будущий этап ${viewedStage} · только просмотр`
                  : `Просмотр этапа ${viewedStage}`}
              </p>
              <small>
                На карте — заработанный этап {actualStage}. Примерка не меняет
                прогресс.
              </small>
            </>
          )}
        </section>
        <label>
          Тип объекта
          <select
            value={kind}
            onChange={(e) => chooseKind(e.target.value as BuildingKind)}
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
              onChange={(e) => {
                changeDraft();
                setTrackId(e.target.value);
                setPreviewStage(null);
              }}
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
        {progress && objects.length > 0 && (
          <label>
            Исследование для здания
            <select
              value={selectedObject?.id ?? ""}
              disabled={Boolean(building)}
              onChange={(e) => {
                changeDraft();
                setObjectId(e.target.value);
                setPreviewStage(null);
              }}
            >
              {objects.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} · этап {o.stage}
                </option>
              ))}
            </select>
          </label>
        )}
        {progress && available.length === 0 && (
          <p className="hint">
            Все доступные здания уже на карте. Откройте направление и начните
            новое исследование для расширения.
          </p>
        )}
        <label>
          Имя объекта
          <input
            maxLength={120}
            value={name}
            placeholder={
              progress
                ? (selectedObject?.name ??
                  data.tracks.find((t) => t.id === trackId)?.name)
                : labels.buildings[kind]
            }
            onChange={(e) => {
              changeDraft();
              setName(e.target.value);
            }}
          />
        </label>
        <label>
          Палитра
          <select
            value={palettes.includes(color) ? color : "custom"}
            onChange={(e) => {
              if (e.target.value !== "custom") chooseColor(e.target.value);
            }}
          >
            {!palettes.includes(color) && (
              <option value="custom">Свой акцент</option>
            )}
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
              onClick={() => chooseColor(c)}
            />
          ))}
        </div>
        <label>
          Свой акцент #RRGGBB
          <input
            value={colorText}
            maxLength={7}
            spellCheck={false}
            aria-invalid={!validColor}
            aria-describedby="accent-help"
            onChange={(e) => chooseColor(e.target.value)}
          />
        </label>
        <p id="accent-help" className={validColor ? "hint" : "field-error"}>
          {validColor
            ? "Примерка цвета не сохраняется автоматически."
            : "Нужны # и шесть цифр 0–9 или букв A–F. Например, #327A91."}
        </p>
        <button
          type="button"
          className="text-button"
          onClick={() => {
            changeDraft();
            setKind(building?.kind ?? "workshop");
            setName(building?.name ?? "");
            setColor(building?.color ?? palettes[0]);
            setColorText(building?.color ?? palettes[0]);
            setPreviewStage(null);
            setX(building?.x ?? 20);
            setY(building?.y ?? 20);
          }}
        >
          Сбросить примерку
        </button>
        <button
          className="primary wide"
          disabled={!validColor}
          onClick={() =>
            void act(async () => {
              useUI.getState().set({
                placement: candidate(),
                repeatPlacement: !building && !progress,
                placementEpoch: data.storageEpoch,
              });
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
            disabled={!validColor}
            onClick={() =>
              void act(async () => {
                const b = candidate();
                await save(b, "Размещение сохранено. Прогресс не изменён.");
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
              disabled={!validColor}
              onClick={() =>
                void act(() =>
                  save(
                    {
                      ...candidate(),
                      x: building.x,
                      y: building.y,
                    },
                    "Оформление сохранено. Прогресс не изменён.",
                  ),
                )
              }
            >
              Сохранить оформление
            </button>
            <button
              className="danger-text wide"
              onClick={() =>
                void act(async () => {
                  await service.removeBuilding(building.id, data.storageEpoch);
                  useUI.getState().set({ buildingId: null, placement: null });
                })
              }
            >
              Снять с карты
            </button>
          </>
        )}
      </fieldset>
      {busy && <p role="status">Сохраняем планировку…</p>}
      {message && (
        <p role="status" className="success">
          {message}
        </p>
      )}
      {placement && (
        <div className="notice">
          Выбран инструмент размещения.{" "}
          {!building && placement.kind === "road"
            ? "Проведите мышью маршрут и отпустите. Красные клетки блокируют всю дорогу; синие уже построены."
            : "Нажмите на свободную клетку."}
          {!building &&
            !progress &&
            " Можно размещать несколько раз. Escape завершает инструмент; правая кнопка мыши двигает карту."}
          <button onClick={() => useUI.getState().set({ placement: null })}>
            Отменить размещение
          </button>
        </div>
      )}
      <p className="hint">
        Перестройка не начисляет очки. Снятие здания сохраняет направление,
        заметки и историю. У каждого учебного объекта свой этап; повторное
        размещение бесплатно.
      </p>
    </>
  );
}
