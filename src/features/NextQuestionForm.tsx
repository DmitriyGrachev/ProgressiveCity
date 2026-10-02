import { useRef, useState } from "react";
import type { LearningObject } from "../domain/model";
import { service } from "../storage/service";

export function NextQuestionForm({
  object,
  epoch,
}: {
  object: LearningObject;
  epoch: string;
}) {
  const [base, setBase] = useState({ object, epoch });
  const [question, setQuestion] = useState(object.nextQuestion);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [skipped, setSkipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const invalidated = base.epoch !== epoch;
  const changed =
    invalidated ||
    base.object.name !== object.name ||
    base.object.nextQuestion !== object.nextQuestion;
  async function save() {
    if (working.current || invalidated) return;
    working.current = true;
    setBusy(true);
    setSaved(false);
    setError("");
    try {
      const updated = await service.updateLearningObject(
        { ...base.object, nextQuestion: question },
        base.epoch,
        base.object,
      );
      setBase({ object: updated, epoch: base.epoch });
      setSaved(true);
    } catch (e) {
      setError(
        `Вопрос не сохранён. ${e instanceof Error ? e.message : "Повторите сохранение."}`,
      );
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  if (skipped)
    return (
      <button onClick={() => setSkipped(false)}>
        Добавить следующий вопрос
      </button>
    );
  return (
    <section className="next-question" aria-label="Следующий шаг">
      <h3>Что проверить дальше?</h3>
      <p className="hint">
        Вопрос необязателен. Результат уже подтверждён; сохранение вопроса не
        начисляет очки.
      </p>
      <label>
        Следующий вопрос после результата
        <textarea
          maxLength={2000}
          value={question}
          disabled={busy || invalidated}
          onChange={(e) => {
            setQuestion(e.target.value);
            setSaved(false);
          }}
        />
      </label>
      <div className="row wrap">
        <button disabled={busy || invalidated} onClick={() => void save()}>
          Сохранить следующий вопрос
        </button>
        <button disabled={busy} onClick={() => setSkipped(true)}>
          Не сейчас
        </button>
      </div>
      {error && (
        <p role="alert" className="save-error">
          {error}
        </p>
      )}
      {saved && !changed && (
        <p role="status" className="success">
          Следующий вопрос сохранён
        </p>
      )}
      {changed && (
        <p className="notice">
          Исследование изменилось. Ваш вопрос остаётся в поле; скопируйте его
          перед загрузкой актуального.
          <button
            disabled={busy || invalidated}
            onClick={() => {
              setBase({ object, epoch });
              setQuestion(object.nextQuestion);
              setSaved(false);
              setError("");
            }}
          >
            Загрузить актуальный вопрос
          </button>
        </p>
      )}
    </section>
  );
}
