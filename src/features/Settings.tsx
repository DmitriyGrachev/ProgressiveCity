import { useState } from "react";
import type { CityData } from "../domain/model";
import { act, flushNotes, reportError } from "../app/ui";
import { db } from "../storage/db";
import { service } from "../storage/service";
import { BackupUsage } from "./BackupUsage";
import {
  exportCity,
  inspectArchive,
  replaceCity,
  type ValidatedArchive,
} from "../storage/backup";
export async function downloadBackup() {
  await flushNotes();
  const blob = await exportCity(db);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `city-${new Date().toISOString().slice(0, 10)}.progresscity.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export function Settings({ data }: { data: CityData }) {
  const city = data.city!;
  const [name, setName] = useState(city.name);
  const [timezone, setTimezone] = useState(city.timezone);
  const [motion, setMotion] = useState(city.reducedMotion);
  const [rewards, setRewards] = useState(city.rules.rewards);
  const [costs, setCosts] = useState(city.rules.costs);
  const [archive, setArchive] = useState<ValidatedArchive | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <>
      <span className="eyebrow">Под ваши правила</span>
      <h2>Настройки и сохранность</h2>
      <label>
        Имя города
        <input
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        Часовой пояс
        <input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={motion}
          onChange={(e) => setMotion(e.target.checked)}
        />
        Уменьшить движение
      </label>
      <button
        onClick={() =>
          void act(async () => {
            await service.updateSettings({
              name,
              timezone,
              reducedMotion: motion,
            });
            setMessage("Настройки сохранены");
          })
        }
      >
        Сохранить настройки
      </button>
      <p className="hint">
        Часовой пояс применяется к новым записям. Даты и часовые пояса
        сохранённых записей закреплены. Системная настройка уменьшения движения
        также учитывается.
      </p>
      <hr />
      <h3>Правила развития · версия {city.rules.version}</h3>
      <p className="hint">
        Награды 1–10, стоимость этапов 1–100. Изменения действуют только на
        будущие события.
      </p>
      {["Исследование", "Проверка", "Применение"].map((label, i) => (
        <label className="inline-label" key={label}>
          {label}
          <input
            type="number"
            min="1"
            max="10"
            value={rewards[i]}
            onChange={(e) => {
              const next = [...rewards] as typeof rewards;
              next[i] = Number(e.target.value);
              setRewards(next);
            }}
          />
        </label>
      ))}
      {costs.map((_, i) => (
        <label className="inline-label" key={i}>
          Стоимость этапа {i + 2}
          <input
            type="number"
            min="1"
            max="100"
            value={costs[i]}
            onChange={(e) => {
              const next = [...costs] as typeof costs;
              next[i] = Number(e.target.value);
              setCosts(next);
            }}
          />
        </label>
      ))}
      <button
        onClick={() =>
          void act(async () => {
            await service.updateRules(rewards, costs);
            setMessage(
              "Новая версия правил сохранена. Прошлые события не изменены.",
            );
          })
        }
      >
        Сохранить правила
      </button>
      <hr />
      <h3>Резервная копия</h3>
      <BackupUsage />
      <p>
        Город хранится в этом браузере. Регулярно экспортируйте архив: очистка
        данных браузера удаляет локальную базу.
      </p>
      <div className="row wrap">
        <button
          className="primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void act(downloadBackup).finally(() => setBusy(false));
          }}
        >
          Экспортировать город
        </button>
        <label className="upload-button">
          Проверить архив
          <input
            aria-label="Архив для восстановления"
            type="file"
            accept=".zip,.progresscity.zip"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setArchive(null);
              setBusy(true);
              void inspectArchive(file)
                .then(setArchive)
                .catch(reportError)
                .finally(() => setBusy(false));
            }}
          />
        </label>
      </div>
      <p className="hint">
        Архив до 64 MiB; распакованные данные до 128 MiB. Изображения включены.
        Данные не зашифрованы и не отправляются в облако.
      </p>
      <button
        onClick={() =>
          void act(async () => {
            const granted = await navigator.storage?.persist?.();
            setMessage(
              granted
                ? "Браузер предоставил постоянное хранение. Экспорт всё равно необходим."
                : "Браузер не предоставил постоянное хранение. Сохраняйте резервные копии.",
            );
          })
        }
      >
        Запросить постоянное хранение
      </button>
      <p className="hint" role="status">
        {busy ? "Обработка…" : message}
      </p>
      {archive && (
        <section
          className="import-confirm"
          role="alertdialog"
          aria-label="Подтверждение замены города"
        >
          <h3>Архив проверен</h3>
          <p>
            «{archive.data.city.name}»: {archive.data.notes.length} заметок,{" "}
            {archive.attachments.length} изображений,{" "}
            {archive.data.buildings.length} объектов.
          </p>
          <p>
            Замена удалит текущий город «{city.name}» из этого браузера. Сначала
            сохраните его резервную копию.
          </p>
          <button onClick={() => void act(downloadBackup)}>
            Экспортировать текущий город перед заменой
          </button>
          <div className="row">
            <button
              disabled={busy}
              className="danger"
              onClick={() => {
                setBusy(true);
                void act(async () => {
                  await replaceCity(db, archive);
                  window.location.reload();
                }).finally(() => setBusy(false));
              }}
            >
              Заменить текущий город
            </button>
            <button disabled={busy} onClick={() => setArchive(null)}>
              Отмена
            </button>
          </div>
        </section>
      )}
    </>
  );
}
