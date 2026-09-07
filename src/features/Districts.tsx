import { useState } from "react";
import { id, type CityData, type District } from "../domain/model";
import { act, useUI } from "../app/ui";
import { service } from "../storage/service";
const freshDistrict = (): District => ({
  id: id(),
  name: "",
  color: "#507d78",
  x: 16,
  y: 16,
  w: 10,
  h: 10,
});
export function Districts({ data }: { data: CityData }) {
  const [draft, setDraft] = useState(freshDistrict);
  const readonly = useUI((s) => Boolean(s.snapshotId));
  return (
    <>
      <span className="eyebrow">Свой смысл каждому месту</span>
      <h2>Районы</h2>
      <p className="hint">
        Прямоугольные зоны не пересекаются. Здание относится к району,
        содержащему его опорную клетку X, Y.
      </p>
      <fieldset disabled={readonly}>
        <legend>Зона района</legend>
        <label>
          Имя района
          <input
            value={draft.name}
            maxLength={120}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label>
          Цвет района
          <input
            type="color"
            value={draft.color}
            onChange={(e) => setDraft({ ...draft, color: e.target.value })}
          />
        </label>
        <div className="coordinates">
          {(["x", "y", "w", "h"] as const).map((key, i) => (
            <label key={key}>
              {["X района", "Y района", "Ширина", "Глубина"][i]}
              <input
                type="number"
                min={i < 2 ? 0 : 1}
                max={i < 2 ? 39 : 40}
                value={draft[key]}
                onChange={(e) =>
                  setDraft({ ...draft, [key]: Number(e.target.value) })
                }
              />
            </label>
          ))}
        </div>
        <div className="row">
          <button
            className="primary"
            onClick={() =>
              void act(async () => {
                await service.saveDistrict(draft);
                setDraft(freshDistrict());
              })
            }
          >
            Сохранить район
          </button>
          <button onClick={() => setDraft(freshDistrict())}>Новый район</button>
        </div>
      </fieldset>
      {data.districts.map((d) => (
        <div className="district-row" key={d.id}>
          <button className="list-row" onClick={() => setDraft(d)}>
            <span className="color-dot" style={{ background: d.color }} />
            <span>
              {d.name}
              <small>
                {d.w} × {d.h} · от {d.x}, {d.y} · объектов:{" "}
                {
                  data.buildings.filter(
                    (b) =>
                      b.x >= d.x &&
                      b.x < d.x + d.w &&
                      b.y >= d.y &&
                      b.y < d.y + d.h,
                  ).length
                }
              </small>
            </span>
          </button>
          <button
            disabled={readonly}
            aria-label={`Удалить район ${d.name}`}
            onClick={() => void act(() => service.removeDistrict(d.id))}
          >
            Удалить
          </button>
        </div>
      ))}
      <p className="hint">
        Удаление района убирает только зону. Его здания и материалы остаются.
      </p>
    </>
  );
}
