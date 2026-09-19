import { useEffect, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../storage/db";
import { useUI, act, navigate, reportError } from "../app/ui";
import { service } from "../storage/service";
import { CityEngine } from "./engine";
import { id } from "../domain/model";
import { LayoutControls, useLayoutHistory } from "./LayoutControls";
const cancelPlacement = () => useUI.getState().set({ placement: null });
export function CityCanvas() {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<CityEngine | null>(null);
  const selected = useUI((s) => s.buildingId);
  const placement = useUI((s) => s.placement);
  const repeatPlacement = useUI((s) => s.repeatPlacement);
  const history = useLayoutHistory();
  const snapshotId = useUI((s) => s.snapshotId);
  const sceneData = useLiveQuery(
    () =>
      db.transaction(
        "r",
        [
          db.cities,
          db.tracks,
          db.learningObjects,
          db.buildings,
          db.districts,
          db.snapshots,
          db.metadata,
        ],
        async () => ({
          data: {
            storageEpoch: (await db.metadata.get("epoch"))?.value ?? "",
            city: await db.cities.get("city"),
            tracks: await db.tracks.toArray(),
            learningObjects: await db.learningObjects.toArray(),
            buildings: await db.buildings.toArray(),
            districts: await db.districts.toArray(),
          },
          snapshot: snapshotId ? await db.snapshots.get(snapshotId) : undefined,
        }),
      ),
    [snapshotId],
  );
  const fit = useUI((s) => s.fit);
  const focus = useUI((s) => s.focus);
  useEffect(() => {
    const scene = new CityEngine(host.current!, {
      select: (b) => {
        void navigate({
          buildingId: b.id,
          trackId: b.trackId ?? null,
          objectId: b.learningObjectId ?? null,
          resultRequest: null,
          panel: b.trackId ? "track" : "build",
          noteId: null,
        });
      },
      place: (b) =>
        act(async () => {
          const tool = useUI.getState();
          if (
            tool.placement?.id !== b.id ||
            !tool.placementEpoch ||
            tool.snapshotId
          )
            return;
          const repeat = tool.repeatPlacement && !b.trackId;
          await service.placeBuilding(
            repeat ? { ...b, id: id() } : b,
            tool.placementEpoch,
          );
          if (!repeat && useUI.getState().placement === tool.placement)
            useUI.getState().set({
              placement: null,
              buildingId: b.id,
              trackId: b.trackId ?? null,
              objectId: b.learningObjectId ?? null,
              resultRequest: null,
            });
        }),
      road: (b, cells) =>
        act(async () => {
          const tool = useUI.getState();
          if (
            tool.placement?.id !== b.id ||
            !tool.placementEpoch ||
            !tool.repeatPlacement ||
            tool.snapshotId
          )
            return;
          await service.planning.placeRoad(b, cells, tool.placementEpoch);
        }),
      cancel: cancelPlacement,
    });
    engine.current = scene;
    void scene.init().catch(reportError);
    return () => {
      scene.destroy();
      engine.current = null;
    };
  }, []);
  useEffect(() => {
    if (!sceneData) return;
    service.planning.syncEpoch(sceneData.data.storageEpoch);
    const tool = useUI.getState();
    if (tool.placement && tool.placementEpoch !== sceneData.data.storageEpoch) {
      cancelPlacement();
      engine.current?.cancelGesture();
      return;
    }
    engine.current?.update({
      ...sceneData,
      selected,
      placement,
      repeatPlacement,
      busy: history.busy,
    });
  }, [sceneData, selected, placement, repeatPlacement, history.busy]);
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
        <h1>{sceneData?.data.city?.name}</h1>
      </div>
      <div ref={host} className="city-canvas" />
      <LayoutControls
        epoch={sceneData?.data.storageEpoch}
        cancel={cancelPlacement}
      />
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
          ? repeatPlacement && placement.kind === "road"
            ? "Проведите дорогу · зелёный — свободно · синий — уже дорога · красный — нельзя · Escape — завершить"
            : `Разместите «${placement.name}»${repeatPlacement ? " несколько раз" : ""} · зелёный — можно · Escape — завершить`
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
