import { useState } from "react";
import type { CityData } from "../domain/model";
import { navigate, useUI } from "../app/ui";
import { NoteEditor } from "../notes/NoteEditor";
export function Library({ data }: { data: CityData }) {
  const [query, setQuery] = useState("");
  const [trackId, setTrackId] = useState("");
  const [tag, setTag] = useState("");
  const noteId = useUI((s) => s.noteId);
  const note = data.notes.find((n) => n.id === noteId);
  const notes = data.notes.filter(
    (n) =>
      (!trackId || n.trackId === trackId) &&
      (!tag || n.tags.includes(tag)) &&
      `${n.title} ${n.text}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  const building =
    note && data.buildings.find((b) => b.trackId === note.trackId);
  return (
    <>
      <span className="eyebrow">Вернуться к изученному</span>
      <h2>Библиотека</h2>
      <label>
        Поиск материалов
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Название или слова из заметки"
        />
      </label>
      <div className="row">
        <label>
          Направление библиотеки
          <select value={trackId} onChange={(e) => setTrackId(e.target.value)}>
            <option value="">Все направления</option>
            {data.tracks.map((t) => (
              <option value={t.id} key={t.id}>
                {t.name}
                {t.archived ? " (архив)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Тег
          <select value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">Все теги</option>
            {Array.from(new Set(data.notes.flatMap((n) => n.tags))).map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted">
        Найдено: {notes.length}. Материалы доступны и без здания.
      </p>
      <div className="note-list">
        {notes.map((n) => (
          <button
            className={`list-row ${n.id === noteId ? "selected" : ""}`}
            key={n.id}
            aria-label={n.title}
            onClick={() => void navigate({ noteId: n.id })}
          >
            <span>
              {n.title}
              <small>
                {data.tracks.find((t) => t.id === n.trackId)?.name} ·{" "}
                {n.tags.join(", ")}
              </small>
            </span>
          </button>
        ))}
      </div>
      {!notes.length && (
        <p className="empty">
          Пока ничего не найдено. Создавайте материалы через направление в
          городе.
        </p>
      )}
      {note && (
        <>
          <div className="row">
            {building ? (
              <button
                onClick={() =>
                  void navigate({ focus: building.id, buildingId: building.id })
                }
              >
                К зданию
              </button>
            ) : (
              <span className="muted">Здание снято с карты</span>
            )}
          </div>
          <NoteEditor key={note.id} note={note} epoch={data.storageEpoch} />
        </>
      )}
    </>
  );
}
