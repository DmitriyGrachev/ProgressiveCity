import { useEffect, useRef } from "react";
import type { CityData } from "../domain/model";
import { useUI, act, navigate, reportError } from "../app/ui";
import { service } from "../storage/service";
import { CityEngine } from "./engine";
export function CityCanvas({ data }: { data: CityData }) {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<CityEngine | null>(null);
  const selected = useUI((s) => s.buildingId);
  const placement = useUI((s) => s.placement);
  const snapshotId = useUI((s) => s.snapshotId);
  const fit = useUI((s) => s.fit);
  const focus = useUI((s) => s.focus);
  useEffect(() => {
    const scene = new CityEngine(host.current!, {
      select: (b) => {
        void navigate({
          buildingId: b.id,
          trackId: b.trackId ?? null,
          panel: b.trackId ? "track" : "build",
          noteId: null,
        });
      },
      place: (b) => {
        void act(async () => {
          await service.placeBuilding(b);
          useUI
            .getState()
            .set({
              placement: null,
              buildingId: b.id,
              trackId: b.trackId ?? null,
            });
        });
      },
      cancel: () => useUI.getState().set({ placement: null }),
    });
    engine.current = scene;
    void scene.init().catch(reportError);
    return () => {
      scene.destroy();
      engine.current = null;
    };
  }, []);
  useEffect(() => {
    engine.current?.update({
      data,
      selected,
      placement,
      snapshot: data.snapshots.find((s) => s.id === snapshotId),
    });
  }, [data, selected, placement, snapshotId]);
  useEffect(() => {
    if (fit) engine.current?.fitAll();
  }, [fit]);
  useEffect(() => {
    if (focus) {
      engine.current?.focusBuilding(focus);
      useUI.getState().set({ focus: null });
    }
  }, [focus]);
  return (
    <div className="map-wrap">
      <div className="map-heading">
        <span className="eyebrow">
          {snapshotId
            ? "Исторический город · только просмотр"
            : "Место для вашего следующего открытия"}
        </span>
        <h1>{data.city?.name}</h1>
      </div>
      <div ref={host} className="city-canvas" />
      <div className="map-controls">
        <button
          aria-label="Приблизить"
          onClick={() => engine.current?.zoomBy(1.25)}
        >
          +
        </button>
        <button
          aria-label="Отдалить"
          onClick={() => engine.current?.zoomBy(0.8)}
        >
          −
        </button>
        <button onClick={() => engine.current?.fitAll()}>
          Показать весь город
        </button>
      </div>
      <div className="map-help">
        {placement
          ? `Разместите «${placement.name}» · зелёный — можно · Escape — отмена`
          : "Перетаскивание — камера · колесо — масштаб · нажатие на здание — материалы"}
      </div>
      {snapshotId && (
        <button
          className="return-present primary"
          onClick={() => useUI.getState().set({ snapshotId: null })}
        >
          Вернуться в текущий город
        </button>
      )}
    </div>
  );
}
