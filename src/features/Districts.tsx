import { useState } from "react";
import { id, type CityData, type District } from "../domain/model";
import { act, navigate, useUI } from "../app/ui";
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
  const [base, setBase] = useState<{ district?: District; epoch: string }>({
    epoch: data.storageEpoch,
  });
  const [busy, setBusy] = useState(false);
  const current = data.districts.find((d) => d.id === base.district?.id);
  const invalidated = base.epoch !== data.storageEpoch;
  const changed = Boolean(
    base.district && JSON.stringify(base.district) !== JSON.stringify(current),
  );
  function select(district?: District) {
    setDraft(district ?? freshDistrict());
    setBase({ district, epoch: data.storageEpoch });
  }
  const readonly = useUI((s) => Boolean(s.snapshotId || s.comparison));
  return (
    <>
      <span className="eyebrow">Свой смысл каждому месту</span>
      <h2>Районы</h2>
      <p className="hint">
        Прямоугольные зоны не пересекаются. Здание относится к району,
        содержащему его опорную клетку X, Y.
      </p>
      {(changed || invalidated) && (
        <div className="notice">
          <p>
            Сохранённый район изменился или город заменён. Ваши поля остались в
            форме. Скопируйте нужный текст перед загрузкой актуальных полей.
          </p>
          <button disabled={busy || !current} onClick={() => select(current)}>
            Загрузить актуальные поля
          </button>
          {base.district && !current && (
            <p>Район удалён. Выберите другой район или создайте новый.</p>
          )}
        </div>
      )}
      <fieldset
        disabled={
          readonly || busy || invalidated || Boolean(base.district && !current)
        }
      >
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
            onClick={() => {
              setBusy(true);
              void act(async () => {
                await service.saveDistrict(draft, base.epoch, base.district);
                select();
              }).finally(() => setBusy(false));
            }}
          >
            Сохранить район
          </button>
        </div>
      </fieldset>
      <button disabled={readonly || busy} onClick={() => select()}>
        Новый район
      </button>
      {data.districts.map((d) => (
        <div className="district-row" key={d.id}>
          <button
            className="list-row"
            disabled={busy}
            onClick={() => select(d)}
          >
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
            onClick={() =>
              void navigate({ focusDistrict: d.id, panel: null, noteId: null })
            }
            aria-label={`Показать район «${d.name}»`}
          >
            На карте
          </button>
          <button
            disabled={readonly}
            aria-label={`Удалить район ${d.name}`}
            onClick={() =>
              void act(() => service.removeDistrict(d.id, data.storageEpoch))
            }
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
