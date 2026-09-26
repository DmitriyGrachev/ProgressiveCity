import { useId } from "react";
import { labels, type BuildingKind } from "../domain/model";
import { BuildingPreview } from "../city/BuildingPreview";

export function BuildingCatalog({
  kinds,
  kind,
  color,
  stage,
  onChange,
}: {
  kinds: BuildingKind[];
  kind: BuildingKind;
  color: string;
  stage: number;
  onChange: (kind: BuildingKind) => void;
}) {
  const group = useId();
  return (
    <div
      className="building-catalog"
      role="group"
      aria-label="Каталог объектов"
    >
      {kinds.map((value) => {
        const progress = ["workshop", "library", "pavilion"].includes(value);
        const size =
          progress || ["park", "plaza"].includes(value) ? "2 × 2" : "1 × 1";
        return (
          <label
            className={`catalog-card ${kind === value ? "selected" : ""}`}
            key={value}
          >
            <input
              type="radio"
              name={group}
              value={value}
              checked={kind === value}
              aria-label={`${labels.buildings[value]} · ${size} клетки`}
              onChange={() => onChange(value)}
            />
            <BuildingPreview
              kind={value}
              color={color}
              stage={progress ? stage : 1}
            />
            <b>{labels.buildings[value]}</b>
            <small>{size} клетки</small>
            <span className="catalog-choice" aria-hidden="true">
              {kind === value ? "✓ Выбрано" : "Выбрать"}
            </span>
          </label>
        );
      })}
    </div>
  );
}
