import { useState } from "react";
import { useCityData } from "./use-city-data";
import { service } from "../storage/service";
import { act, navigate, useUI, type Panel } from "./ui";
import { CityCanvas } from "../city/CityCanvas";
import { TrackPanel } from "../features/TrackPanel";
import { TrackForm } from "../features/TrackForm";
import { Library } from "../features/Library";
import { BuildPanel } from "../features/BuildPanel";
import { Districts } from "../features/Districts";
import { History } from "../features/History";
import { Settings } from "../features/Settings";
import { InitialRestore } from "../features/InitialRestore";
import { RecoveryTray } from "../notes/recovery";

function Onboarding() {
  const [name, setName] = useState("Мой город");
  const [track, setTrack] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="onboarding">
      <div className="welcome-art" aria-hidden="true">
        <svg viewBox="0 0 300 260">
          <path d="M150 120 280 185 150 250 20 185Z" fill="#b6cda6" />
          <path d="m83 116 70 35 0 73-70-35Z" fill="#eeddbb" />
          <path d="m153 151 65-33v73l-65 33Z" fill="#bcb39a" />
          <path d="m68 122 61-79 104 67-80 46Z" fill="#bb7355" />
          <path d="m129 43 18 11 86 56-80 46Z" fill="#a86149" />
          <path
            d="m99 146 17 8v22l-17-8Zm74 22 16-8v23l-16 8Z"
            fill="#487780"
          />
          <path d="m131 183 15 7v30l-15-7Z" fill="#78664e" />
          <path d="M238 173v38" stroke="#887255" strokeWidth="5" />
          <ellipse cx="238" cy="165" rx="19" ry="32" fill="#5e9472" />
        </svg>
      </div>
      <section className="welcome-copy">
        <span className="eyebrow">Progress City</span>
        <h1>
          Большой путь
          <br />
          начинается с малого.
        </h1>
        <p>
          Сохраняйте свои открытия. Развивайте мастерскую из реальных
          результатов. Постройте город, в который хочется возвращаться.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void act(() => service.initialize(name, track)).finally(() =>
              setBusy(false),
            );
          }}
        >
          <label>
            Название города
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Первое направление
            <input
              required
              maxLength={120}
              value={track}
              placeholder="Что вам интересно исследовать?"
              onChange={(e) => setTrack(e.target.value)}
            />
          </label>
          <button className="primary" disabled={busy}>
            Создать город
          </button>
        </form>
        <p className="hint">
          Одна мастерская. Никакого выдуманного прошлого.
          <br />
          Данные сохраняются локально в этом браузере.
        </p>
        <InitialRestore />
      </section>
    </main>
  );
}
const navigation: { panel: Panel; title: string; symbol: string }[] = [
  { panel: "build", title: "Строить", symbol: "build" },
  { panel: "library", title: "Библиотека", symbol: "book" },
  { panel: "districts", title: "Районы", symbol: "grid" },
  { panel: "history", title: "История", symbol: "clock" },
  { panel: "settings", title: "Настройки", symbol: "settings" },
];
function Icon({ kind }: { kind: string }) {
  const paths: Record<string, string> = {
    build: "M3 11 12 3l9 8M5 10v11h14V10M10 21v-7h4v7",
    book: "M12 5v16M12 5C8 2 4 3 2 4v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-4-1-7-1-10 1Z",
    grid: "M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z",
    clock: "M12 7v6l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
    settings: "M4 7h16M4 17h16M8 4v6M16 14v6",
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[kind]} />
    </svg>
  );
}
export function App() {
  const data = useCityData();
  const panel = useUI((s) => s.panel);
  const trackId = useUI((s) => s.trackId);
  const buildingId = useUI((s) => s.buildingId);
  const error = useUI((s) => s.error);
  const [archived, setArchived] = useState(false);
  const errorBanner = error && (
    <div className="error-banner" role="alert">
      <span>{error}</span>
      <button
        aria-label="Закрыть сообщение"
        onClick={() => useUI.getState().set({ error: "" })}
      >
        Закрыть
      </button>
    </div>
  );
  if (!data)
    return (
      <main className="loading">
        Открываем локальный город…{errorBanner}
        <RecoveryTray />
      </main>
    );
  if (!data.city)
    return (
      <>
        {errorBanner}
        <RecoveryTray />
        <Onboarding />
      </>
    );
  const track = data.tracks.find((t) => t.id === trackId);
  const building = data.buildings.find((b) => b.id === buildingId);
  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="brand"
          onClick={() => void navigate({ panel: null, noteId: null })}
        >
          <Icon kind="build" />
          <span>Progress City</span>
        </button>
        <span className="topbar-subtitle">Место для того, чему вы учитесь</span>
        <span className="local-badge">
          <span />
          Сохранение на устройстве
        </span>
      </header>
      {errorBanner}
      <RecoveryTray />
      <div className={`workspace ${panel ? "panel-open" : ""}`}>
        <aside className="sidebar">
          <nav aria-label="Основная навигация">
            {navigation.map((n) => (
              <button
                className={panel === n.panel ? "active" : ""}
                key={n.panel}
                onClick={() =>
                  void navigate({
                    panel: n.panel,
                    noteId: null,
                    ...(n.panel === "build" ? { buildingId: null } : {}),
                  })
                }
              >
                <Icon kind={n.symbol} />
                <span>{n.title}</span>
              </button>
            ))}
          </nav>
          <div className="track-heading">
            <span className="eyebrow">Направления</span>
            <button
              aria-label="Новое направление"
              title="Новое направление"
              onClick={() =>
                void navigate({
                  panel: "track",
                  trackId: null,
                  noteId: null,
                  buildingId: null,
                })
              }
            >
              +
            </button>
          </div>
          <div className="track-nav">
            {data.tracks
              .filter((t) => archived || !t.archived)
              .map((t) => (
                <button
                  className={
                    t.id === trackId && panel === "track" ? "active" : ""
                  }
                  key={t.id}
                  onClick={() =>
                    void navigate({
                      panel: "track",
                      trackId: t.id,
                      noteId: null,
                      buildingId:
                        data.buildings.find((b) => b.trackId === t.id)?.id ??
                        null,
                    })
                  }
                >
                  <span className="track-initial" aria-hidden="true">
                    {t.name.slice(0, 1).toLocaleUpperCase()}
                  </span>
                  <span>{t.name}</span>
                  {t.archived && <small>архив</small>}
                </button>
              ))}
          </div>
          <label className="check archive-toggle">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
            Архив направлений
          </label>
          <div className="sidebar-footer">
            <span>Ваши материалы — ваш путь.</span>
            <button
              className="text-button"
              onClick={() => void navigate({ panel: "settings", noteId: null })}
            >
              Не забудьте резервную копию
            </button>
          </div>
        </aside>
        <CityCanvas />
        {panel && (
          <aside className="detail-panel" aria-label="Панель города">
            <button
              className="close-panel"
              aria-label="Закрыть панель"
              onClick={() => void navigate({ panel: null, noteId: null })}
            >
              ×
            </button>
            {panel === "track" &&
              (track ? (
                <TrackPanel key={track.id} data={data} track={track} />
              ) : (
                <>
                  <h2>Новое направление</h2>
                  <TrackForm />
                </>
              ))}
            {panel === "library" && <Library data={data} />}
            {panel === "build" && (
              <BuildPanel
                key={building?.id ?? `new-${trackId}`}
                data={data}
                building={building}
              />
            )}
            {panel === "districts" && <Districts data={data} />}
            {panel === "history" && <History data={data} />}
            {panel === "settings" && <Settings data={data} />}
          </aside>
        )}
      </div>
    </div>
  );
}
