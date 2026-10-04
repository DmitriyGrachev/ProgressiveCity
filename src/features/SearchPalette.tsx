import { useEffect, useMemo, useRef, useState } from "react";
import type { CityData } from "../domain/model";
import {
  createSearchIndex,
  searchCity,
  type SearchEntry,
} from "../domain/search";
import { openSearchResult } from "../app/search";
import { navigate, useUI } from "../app/ui";
export function SearchPalette({ data }: { data: CityData }) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [archived, setArchived] = useState(false),
    [selected, setSelected] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null),
    input = useRef<HTMLInputElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const readonly = useUI((s) => Boolean(s.snapshotId || s.comparison)),
    busy = useUI((s) => s.transitioning);
  const { tracks, learningObjects, notes } = data;
  const index = useMemo(
    () => createSearchIndex({ tracks, learningObjects, notes }),
    [tracks, learningObjects, notes],
  );
  const results = useMemo(
    () => searchCity(index, query, archived),
    [index, query, archived],
  );
  const active = Math.min(selected, Math.max(0, results.length - 1));
  useEffect(() => {
    if (open)
      dialog.current
        ?.querySelector(`#quick-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, active, results]);
  useEffect(() => {
    if (!open) return;
    const element = dialog.current,
      previous = document.activeElement;
    element?.showModal();
    input.current?.focus();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [open]);
  useEffect(() => {
    function shortcut(e: KeyboardEvent) {
      if (
        !(e.ctrlKey || e.metaKey) ||
        e.key.toLowerCase() !== "k" ||
        e.altKey ||
        readonly ||
        busy
      )
        return;
      if (
        e.target instanceof Element &&
        e.target.closest(
          "input,textarea,select,[contenteditable=true],[role=textbox],dialog[open]",
        )
      )
        return;
      e.preventDefault();
      setOpen(true);
    }
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, [readonly, busy]);
  function choose(
    entry: SearchEntry,
    mode: "open" | "continue" | "building" = "open",
  ) {
    setOpen(false);
    void openSearchResult(entry, data.storageEpoch, mode);
  }
  const item = results[active];
  return (
    <>
      <button
        ref={trigger}
        disabled={readonly || busy}
        title={
          readonly
            ? "Поиск доступен после выхода из истории и сравнения"
            : "Ctrl/Cmd+K вне текстового поля"
        }
        onClick={() => setOpen(true)}
      >
        Найти в городе
      </button>
      {readonly && (
        <span className="search-readonly hint">
          Поиск — после выхода из истории
        </span>
      )}
      <dialog
        ref={dialog}
        className="search-dialog"
        aria-labelledby="search-heading"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
          }
        }}
        onCancel={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
      >
        <div className="row spread">
          <h2 id="search-heading">Найти в городе</h2>
          <button aria-label="Закрыть поиск" onClick={() => setOpen(false)}>
            ×
          </button>
        </div>
        <label>
          Направление, исследование или материал
          <input
            ref={input}
            type="search"
            value={query}
            aria-controls="quick-results"
            aria-activedescendant={item ? `quick-${active}` : undefined}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setSelected(
                  Math.max(
                    0,
                    Math.min(
                      results.length - 1,
                      active + (e.key === "ArrowDown" ? 1 : -1),
                    ),
                  ),
                );
              }
              if (e.key === "Enter" && item) {
                e.preventDefault();
                choose(item);
              }
            }}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => {
              setArchived(e.target.checked);
              setSelected(0);
            }}
          />
          Включая архивные направления
        </label>
        <div role="listbox" id="quick-results" aria-label="Результаты поиска">
          {results.map((entry, i) => (
            <button
              key={`${entry.type}:${entry.id}`}
              id={`quick-${i}`}
              role="option"
              aria-selected={i === active}
              className={`list-row ${i === active ? "selected" : ""}`}
              onFocus={() => setSelected(i)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const next = Math.max(
                    0,
                    Math.min(
                      results.length - 1,
                      i + (e.key === "ArrowDown" ? 1 : -1),
                    ),
                  );
                  setSelected(next);
                  document.getElementById(`quick-${next}`)?.focus();
                }
              }}
              onClick={() => choose(entry)}
            >
              <span>
                <b>{entry.title}</b>
                <small>
                  {
                    {
                      track: "Направление",
                      object: "Исследование",
                      note: "Материал",
                    }[entry.type]
                  }
                  {entry.archived ? " · архив" : ""} · {entry.path}
                </small>
              </span>
            </button>
          ))}
        </div>
        {!results.length && (
          <p className="hint">
            {query.trim()
              ? "Ничего не найдено. Попробуйте другое слово или включите архив."
              : "Введите название, фразу из заметки или тег."}
          </p>
        )}
        {item && (
          <div className="row wrap search-actions">
            <button onClick={() => choose(item)}>
              {item.type === "note"
                ? "Открыть материал"
                : item.type === "object"
                  ? "Открыть исследование"
                  : "Открыть направление"}
            </button>
            {item.objectId && !item.archived && (
              <button onClick={() => choose(item, "continue")}>
                Продолжить исследование
              </button>
            )}
            {data.buildings.some(
              (b) =>
                b.trackId === item.trackId &&
                (item.objectId
                  ? b.learningObjectId === item.objectId
                  : !b.learningObjectId || b.learningObjectId === item.trackId),
            ) ? (
              <button onClick={() => choose(item, "building")}>
                Найти здание
              </button>
            ) : (
              <span className="hint">Постройки нет на карте</span>
            )}
          </div>
        )}
        <p className="hint">
          До 12 совпадений. Стрелки — выбор, Enter — открыть, Escape — закрыть.
        </p>
        <button
          onClick={() => {
            setOpen(false);
            void navigate({ panel: "library", noteId: null });
          }}
        >
          Открыть полную библиотеку
        </button>
      </dialog>
    </>
  );
}
