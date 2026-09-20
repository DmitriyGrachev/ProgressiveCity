import { useUI } from "../app/ui";
import { exitComparison } from "../app/comparison";
import { visibleChanges, type ComparisonView } from "../domain/comparison";

export function ComparisonControls({ focus }: { focus: () => void }) {
  const comparison = useUI((s) => s.comparison);
  const view = useUI((s) => s.comparisonView);
  const showDecor = useUI((s) => s.comparisonDecor);
  if (!comparison) return null;
  const changes = visibleChanges(comparison.changes, showDecor);
  return (
    <div className="comparison-controls">
      <span className="eyebrow">Мой путь · только чтение</span>
      <div className="comparison-states">
        <span>
          <b>A · {comparison.before.name}</b>
          <small>
            {new Date(comparison.before.createdAt).toLocaleString("ru")}
          </small>
        </span>
        <span>
          <b>B · {comparison.after.name}</b>
          <small>
            {new Date(comparison.after.createdAt).toLocaleString("ru")}
          </small>
        </span>
      </div>
      <div className="row wrap">
        {(["before", "after", "changes"] as ComparisonView[]).map((v, i) => (
          <button
            key={v}
            aria-pressed={view === v}
            className={view === v ? "primary" : ""}
            onClick={() => useUI.getState().set({ comparisonView: v })}
          >
            {["Было", "Стало", "Показать изменения"][i]}
          </button>
        ))}
      </div>
      <div className="row wrap">
        <button disabled={!changes.length} onClick={focus}>
          Фокус на изменениях
        </button>
        <button onClick={() => useUI.getState().set({ panel: "history" })}>
          Список изменений
        </button>
        <button
          aria-label="Закончить сравнение на карте"
          onClick={exitComparison}
        >
          Закончить сравнение
        </button>
      </div>
      {!changes.length && (
        <p className="hint" role="status">
          {comparison.changes.length
            ? "Изменения есть только в скрытом декоре."
            : "В выбранных состояниях изменений нет."}
        </p>
      )}
    </div>
  );
}
