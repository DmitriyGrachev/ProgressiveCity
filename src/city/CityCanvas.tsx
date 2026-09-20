import { useEffect, useMemo, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../storage/db";
import { useUI, act, navigate, reportError } from "../app/ui";
import { service } from "../storage/service";
import { CityEngine } from "./engine";
import { id } from "../domain/model";
import { LayoutControls, useLayoutHistory } from "./LayoutControls";
import { buildingKey, visibleChanges } from "../domain/comparison";
import { ComparisonControls } from "./ComparisonControls";
import { exitComparison } from "../app/comparison";
const cancelPlacement = () => useUI.getState().set({ placement: null });
export function CityCanvas() {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<CityEngine | null>(null);
  const selected = useUI((s) => s.buildingId);
  const placement = useUI((s) => s.placement);
  const repeatPlacement = useUI((s) => s.repeatPlacement);
  const history = useLayoutHistory();
  const snapshotId = useUI((s) => s.snapshotId);
  const comparison = useUI((s) => s.comparison);
  const view = useUI((s) => s.comparisonView);
  const showDecor = useUI((s) => s.comparisonDecor);
  const comparisonSelection = useUI((s) => s.comparisonSelection);
  const transitioning = useUI((s) => s.transitioning);
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
        const state = useUI.getState();
        if (state.comparison) {
          const key = buildingKey(b);
          if (
            visibleChanges(
              state.comparison.changes,
              state.comparisonDecor,
            ).some((c) => c.key === key)
          )
            state.set({
              comparisonSelection: key,
              panel: "history",
              noteId: null,
            });
          return;
        }
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
            tool.snapshotId ||
            tool.comparison ||
            tool.transitioning
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
            tool.snapshotId ||
            tool.comparison ||
            tool.transitioning
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
  const comparisonScene = useMemo(() => {
    if (!comparison) return undefined;
    const snapshot = view === "before" ? comparison.before : comparison.after;
    const change = comparison.changes.find(
      (c) => c.key === comparisonSelection,
    );
    const target = view === "before" ? change?.before : change?.after;
    return {
      data: comparison.scene,
      snapshot,
      comparison: {
        view,
        changes: visibleChanges(comparison.changes, showDecor),
      },
      selected: target?.id ?? null,
    };
  }, [comparison, view, showDecor, comparisonSelection]);
  const rendering = comparisonScene ?? sceneData;
  const epoch = sceneData?.data.storageEpoch;
  useEffect(() => {
    if (!epoch) return;
    service.planning.syncEpoch(epoch);
    const tool = useUI.getState();
    if (tool.comparison && tool.comparison.scene.storageEpoch !== epoch)
      exitComparison();
    if (tool.placement && tool.placementEpoch !== epoch) {
      cancelPlacement();
      engine.current?.cancelGesture();
    }
  }, [epoch]);
  useEffect(() => {
    if (!rendering) return;
    engine.current?.update({
      ...rendering,
      selected: comparisonScene ? comparisonScene.selected : selected,
      placement: comparisonScene ? null : placement,
      repeatPlacement,
      busy: history.busy || transitioning,
    });
  }, [
    rendering,
    comparisonScene,
    selected,
    placement,
    repeatPlacement,
    history.busy,
    transitioning,
  ]);
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
      {comparison ? (
        <ComparisonControls focus={() => engine.current?.focusChanges()} />
      ) : (
        <div className="map-heading">
          <span className="eyebrow">
            {snapshotId
              ? "Исторический город · только просмотр"
              : "Место для вашего следующего открытия"}
          </span>
          <h1>{sceneData?.data.city?.name}</h1>
        </div>
      )}
      <div ref={host} className="city-canvas" />
      {!comparison && (
        <LayoutControls
          epoch={sceneData?.data.storageEpoch}
          cancel={cancelPlacement}
        />
      )}
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
        {comparison
          ? "Только чтение · + появилось · − снято (контур A) · Э этап · ↔ перенос · ◐ оформление"
          : placement
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
