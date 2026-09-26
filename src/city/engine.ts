import { Application, Container, Graphics, Point, Rectangle } from "pixi.js";
import type { Building, CityData, Rect, Snapshot } from "../domain/model";
import type { CityChange, ComparisonView } from "../domain/comparison";
import { comparisonArt } from "./comparison-art";
import { canPlace, gridToIso, isoToGrid, MAP_SIZE } from "../domain/rules";
import { buildingArt } from "./art";
import { extendRoad, roadCellState, type Cell } from "../domain/roads";
import { registerPreviewRenderer } from "./preview-cache";
import { CityLabels, type CityLabel, type LabelMode } from "./CityLabels";
import { fitBounds, type ScreenRect } from "./label-layout";
const MIN_ZOOM = 0.03;
export interface SceneInput {
  data: Pick<
    CityData,
    | "city"
    | "tracks"
    | "learningObjects"
    | "buildings"
    | "districts"
    | "storageEpoch"
  >;
  selected: string | null;
  placement: Building | null;
  repeatPlacement: boolean;
  busy: boolean;
  snapshot?: Snapshot;
  comparison?: {
    view: ComparisonView;
    changes: CityChange[];
    selectedKey?: string | null;
  };
}
export interface SceneCallbacks {
  select: (b: Building) => void;
  place: (b: Building) => Promise<void>;
  road: (b: Building, cells: Cell[]) => Promise<void>;
  cancel: () => void;
}
export class CityEngine {
  private app = new Application();
  private world = new Container();
  private ground = new Container();
  private objects = new Container();
  private preview = new Graphics();
  private ghostLayer = new Container();
  private ghostArt?: Container;
  private ghostKey = "";
  private previewStatus = document.createElement("div");
  private comparisonLayer = new Container();
  private normalCamera?: {
    x: number;
    y: number;
    zoom: number;
    width: number;
    height: number;
  };
  private input?: SceneInput;
  private hits: { b: Building; graphic: Graphics; container: Container }[] = [];
  private observer?: ResizeObserver;
  private camera = { x: 0, y: 0, zoom: 1 };
  private drag?: {
    x: number;
    y: number;
    cx: number;
    cy: number;
    moved: boolean;
    button: number;
    pointerId: number;
  };
  private initialized = false;
  private disposed = false;
  private animation?: number;
  private ghost?: Building;
  private stroke?: { cells: Map<string, Cell>; last: Cell };
  private saving = false;
  private unregisterPreviews?: () => void;
  private labels: CityLabels;
  private hovered: string | null = null;
  private pointer?: { clientX: number; clientY: number };
  private occupiedBounds: ScreenRect[] = [];
  private host: HTMLDivElement;
  private callbacks: SceneCallbacks;
  constructor(host: HTMLDivElement, callbacks: SceneCallbacks) {
    this.host = host;
    this.callbacks = callbacks;
    this.labels = new CityLabels(host, () => this.render());
  }
  async init() {
    await this.app.init({
      preference: "webgl",
      antialias: true,
      background: "#e6eee1",
      resolution: Math.min(devicePixelRatio, 2),
      autoDensity: true,
      autoStart: false,
      width: this.host.clientWidth,
      height: this.host.clientHeight,
    });
    if (this.disposed) {
      this.app.destroy(true, { children: true });
      return;
    }
    this.initialized = true;
    this.unregisterPreviews = registerPreviewRenderer(
      async ({ kind, color, stage }) => {
        const progress = ["workshop", "library", "pavilion"].includes(kind);
        const size = progress || ["park", "plaza"].includes(kind) ? 2 : 1;
        const art = buildingArt(
          {
            id: "preview",
            name: "",
            x: 0,
            y: 0,
            w: size,
            h: size,
            kind,
            color,
            ...(progress ? { trackId: "preview" } : {}),
          },
          stage,
          false,
        );
        try {
          return await this.app.renderer.extract.base64({
            target: art.container,
            frame: new Rectangle(-80, -100, 160, 170),
            resolution: 2,
            antialias: true,
          });
        } finally {
          art.container.destroy({ children: true, context: true });
        }
      },
    );
    this.host.appendChild(this.app.canvas);
    this.previewStatus.className = "placement-status";
    this.previewStatus.setAttribute("role", "status");
    this.previewStatus.setAttribute("data-testid", "placement-status");
    this.previewStatus.hidden = true;
    this.host.appendChild(this.previewStatus);
    this.app.canvas.setAttribute("aria-label", "Интерактивная карта города");
    this.app.canvas.tabIndex = 0;
    this.world.addChild(
      this.ground,
      this.objects,
      this.comparisonLayer,
      this.ghostLayer,
      this.preview,
    );
    this.app.stage.addChild(this.world);
    this.drawGround();
    this.observer = new ResizeObserver(() => {
      const width = this.host.clientWidth;
      const height = this.host.clientHeight;
      this.camera.x += (width - this.app.screen.width) / 2;
      this.camera.y += (height - this.app.screen.height) / 2;
      this.app.renderer.resize(width, height);
      this.render();
    });
    this.observer.observe(this.host);
    this.host.addEventListener("pointerdown", this.down);
    this.host.addEventListener("pointermove", this.move);
    this.host.addEventListener("pointerleave", this.leave);
    this.host.addEventListener("pointerup", this.up);
    this.host.addEventListener("pointercancel", this.pointerCancel);
    this.host.addEventListener("lostpointercapture", this.pointerCancel);
    this.host.addEventListener("wheel", this.wheel, { passive: false });
    this.host.addEventListener("contextmenu", this.context);
    this.host.addEventListener("keydown", this.key);
    if (this.input) this.update(this.input);
    this.focusAt(20, 20);
    this.render();
  }
  private drawGround() {
    const g = new Graphics();
    this.ground.addChild(g);
    for (let x = 0; x < MAP_SIZE; x++)
      for (let y = 0; y < MAP_SIZE; y++) {
        const p = gridToIso(x, y);
        g.poly([
          p.x,
          p.y,
          p.x + 32,
          p.y + 16,
          p.x,
          p.y + 32,
          p.x - 32,
          p.y + 16,
        ])
          .fill((x + y) % 2 ? "#c2d3ad" : "#bed0a8")
          .stroke({ color: "#b0c49c", width: 0.5 });
        if ((x * 7 + y * 11) % 43 === 0) {
          g.moveTo(p.x - 4, p.y + 15)
            .lineTo(p.x - 3, p.y + 12)
            .moveTo(p.x, p.y + 17)
            .lineTo(p.x + 1, p.y + 14)
            .stroke({ color: "#94b087", width: 1 });
        }
      }
    g.poly([0, 0, 1280, 640, 0, 1280, -1280, 640]).stroke({
      color: "#91af87",
      width: 2,
    });
  }
  update(input: SceneInput) {
    const old = this.input;
    this.input = input;
    if (!this.initialized) return;
    if (input.comparison && !old?.comparison) {
      this.normalCamera = {
        ...this.camera,
        width: this.app.screen.width,
        height: this.app.screen.height,
      };
      this.cancelGesture();
    } else if (!input.comparison && old?.comparison && this.normalCamera) {
      this.camera = {
        x:
          this.normalCamera.x +
          (this.app.screen.width - this.normalCamera.width) / 2,
        y:
          this.normalCamera.y +
          (this.app.screen.height - this.normalCamera.height) / 2,
        zoom: this.normalCamera.zoom,
      };
      this.normalCamera = undefined;
    }
    if (
      old?.placement !== input.placement ||
      old?.snapshot !== input.snapshot ||
      old?.data.storageEpoch !== input.data.storageEpoch
    )
      this.cancelGesture();
    this.objects
      .removeChildren()
      .forEach((c) => c.destroy({ children: true, context: true }));
    this.comparisonLayer
      .removeChildren()
      .forEach((c) => c.destroy({ children: true, context: true }));
    this.hits = [];
    this.occupiedBounds = [];
    const labels: CityLabel[] = [];
    const buildings = input.snapshot?.buildings ?? input.data.buildings;
    const districts = input.snapshot?.districts ?? input.data.districts;
    for (const d of districts) {
      const g = new Graphics();
      const points = [
        [d.x, d.y],
        [d.x + d.w, d.y],
        [d.x + d.w, d.y + d.h],
        [d.x, d.y + d.h],
      ].flatMap(([x, y]) => {
        const p = gridToIso(x, y);
        return [p.x, p.y];
      });
      g.poly(points)
        .fill({ color: d.color, alpha: 0.17 })
        .stroke({ color: d.color, width: 2, alpha: 0.65 });
      this.objects.addChild(g);
      const bounds = g.getLocalBounds();
      const rect = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      };
      this.occupiedBounds.push(rect);
      labels.push({
        id: `district:${d.id}`,
        entityId: d.id,
        name: d.name,
        bounds: rect,
        district: true,
      });
    }
    for (const b of [...buildings].sort(
      (a, b) => a.x + a.y + a.w + a.h - (b.x + b.y + b.w + b.h),
    )) {
      const stage =
        input.snapshot?.buildings.find((s) => s.id === b.id)?.stage ??
        (b.learningObjectId
          ? input.data.learningObjects.find((o) => o.id === b.learningObjectId)
              ?.stage
          : input.data.tracks.find((t) => t.id === b.trackId)?.stage) ??
        1;
      const art = buildingArt(b, stage, input.selected === b.id);
      this.objects.addChild(art.container);
      this.hits.push({ b, ...art });
      const local = art.graphic.getLocalBounds();
      const bounds = {
        x: local.x + art.container.x,
        y: local.y + art.container.y,
        width: local.width,
        height: local.height,
      };
      this.occupiedBounds.push(bounds);
      labels.push({
        id: `building:${b.id}`,
        entityId: b.id,
        name: b.name,
        bounds,
      });
    }
    if (input.comparison) {
      const annotations = comparisonArt(
        input.comparison.changes,
        input.comparison.view,
      );
      this.comparisonLayer.addChild(annotations.layer);
      for (const mark of annotations.labels) {
        const existing = labels.findIndex((label) => label.id === mark.id);
        if (existing >= 0)
          labels[existing] = { ...mark, bounds: labels[existing].bounds };
        else labels.push(mark);
      }
    }
    this.labels.set(labels);
    this.app.canvas.dataset.comparisonView = input.comparison?.view ?? "none";
    this.app.canvas.dataset.comparisonChanges = String(
      input.comparison?.changes.length ?? 0,
    );
    this.app.canvas.dataset.buildingStages = JSON.stringify(
      input.snapshot?.buildings.map((b) => ({ id: b.id, stage: b.stage })) ??
        [],
    );
    if (!input.placement) {
      this.preview.clear();
      this.ghost = undefined;
      this.clearGhost();
      this.placementMessage("");
    } else if (this.stroke) this.drawRoad([...this.stroke.cells.values()]);
    else if (this.ghost) this.drawPreview(this.ghost.x, this.ghost.y);
    this.render();
    if (
      old &&
      !old.snapshot &&
      !input.snapshot &&
      old.data.storageEpoch === input.data.storageEpoch &&
      !input.data.city?.reducedMotion &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      const upgraded = input.data.buildings.find((b) => {
        if (
          !b.trackId ||
          !old.data.buildings.some(
            (p) =>
              p.id === b.id &&
              p.trackId === b.trackId &&
              p.learningObjectId === b.learningObjectId,
          )
        )
          return false;
        if (b.learningObjectId) {
          const stage =
            input.data.learningObjects.find((o) => o.id === b.learningObjectId)
              ?.stage ?? 1;
          return (
            stage >
            (old.data.learningObjects.find((o) => o.id === b.learningObjectId)
              ?.stage ?? stage)
          );
        }
        const stage =
          input.data.tracks.find((t) => t.id === b.trackId)?.stage ?? 1;
        return (
          stage >
          (old.data.tracks.find((t) => t.id === b.trackId)?.stage ?? stage)
        );
      });
      if (upgraded) this.pulse(upgraded.id);
    }
  }
  private pulse(buildingId: string) {
    if (this.animation) cancelAnimationFrame(this.animation);
    const start = performance.now();
    const object = this.hits.find((h) => h.b.id === buildingId)?.container;
    if (!object) return;
    const frame = () => {
      if (object.destroyed || this.disposed) return;
      const progress = Math.min(1, (performance.now() - start) / 650);
      object.scale.set(1 + Math.sin(progress * Math.PI) * 0.08);
      this.render();
      if (progress < 1) this.animation = requestAnimationFrame(frame);
    };
    frame();
  }
  private render() {
    if (!this.initialized || this.disposed) return;
    this.world.position.set(this.camera.x, this.camera.y);
    this.world.scale.set(this.camera.zoom);
    const pointer = this.pointer ? this.point(this.pointer) : undefined;
    const hover =
      pointer &&
      !this.drag &&
      !this.input?.placement &&
      pointer.x >= 0 &&
      pointer.y >= 0 &&
      pointer.x <= this.host.clientWidth &&
      pointer.y <= this.host.clientHeight
        ? this.hitAt(pointer)
        : undefined;
    this.hovered = hover?.b.id ?? null;
    this.app.canvas.title = hover?.b.name ?? "";
    this.labels.update(
      this.camera,
      this.input?.selected ?? null,
      this.hovered,
      this.input?.comparison?.selectedKey,
    );
    this.app.canvas.dataset.camera = JSON.stringify(this.camera);
    this.app.canvas.dataset.buildingCount = String(this.hits.length);
    this.app.render();
  }
  focusAt(x: number, y: number) {
    const p = gridToIso(x, y);
    this.camera.x = this.host.clientWidth / 2 - p.x * this.camera.zoom;
    this.camera.y = this.host.clientHeight / 2 - p.y * this.camera.zoom + 20;
    this.render();
  }
  focusBuilding(id: string) {
    const b = this.hits.find((h) => h.b.id === id)?.b;
    if (b) {
      this.camera.zoom = 1.35;
      this.focusAt(b.x + b.w / 2, b.y + b.h / 2);
    }
  }
  fitAll() {
    this.camera.zoom = Math.min(
      this.host.clientWidth / 2700,
      this.host.clientHeight / 1400,
    );
    this.focusAt(20, 20);
  }
  setLabelMode(mode: LabelMode) {
    this.labels.setMode(mode);
    this.render();
  }
  refreshView() {
    this.render();
  }
  fitBuildings() {
    if (!this.occupiedBounds.length) {
      this.fitAll();
      return;
    }
    const bounds = this.occupiedBounds;
    const left = Math.min(...bounds.map((b) => b.x)),
      top = Math.min(...bounds.map((b) => b.y));
    const right = Math.max(...bounds.map((b) => b.x + b.width)),
      bottom = Math.max(...bounds.map((b) => b.y + b.height));
    this.camera = fitBounds(
      { x: left, y: top, width: right - left, height: bottom - top },
      this.labels.viewport(),
    );
    this.render();
  }
  focusChanges() {
    const rects: Rect[] = (this.input?.comparison?.changes ?? []).flatMap((c) =>
      [c.before, c.after].filter((v): v is NonNullable<typeof v> => Boolean(v)),
    );
    if (!rects.length) return;
    const points = rects
      .flatMap((r) => [
        [r.x, r.y],
        [r.x + r.w, r.y],
        [r.x + r.w, r.y + r.h],
        [r.x, r.y + r.h],
      ])
      .map(([x, y]) => gridToIso(x, y));
    const left = Math.min(...points.map((p) => p.x)) - 55,
      right = Math.max(...points.map((p) => p.x)) + 55;
    const top = Math.min(...points.map((p) => p.y)) - 135,
      bottom = Math.max(...points.map((p) => p.y)) + 70;
    this.camera.zoom = Math.max(
      MIN_ZOOM,
      Math.min(
        1.6,
        (this.host.clientWidth - 60) / (right - left),
        (this.host.clientHeight - 300) / (bottom - top),
      ),
    );
    this.camera.x =
      this.host.clientWidth / 2 - ((left + right) / 2) * this.camera.zoom;
    this.camera.y =
      this.host.clientHeight / 2 + 60 - ((top + bottom) / 2) * this.camera.zoom;
    this.render();
  }
  zoomBy(factor: number) {
    this.zoom(factor, this.host.clientWidth / 2, this.host.clientHeight / 2);
  }
  private zoom(factor: number, x: number, y: number) {
    const next = Math.max(MIN_ZOOM, Math.min(2.5, this.camera.zoom * factor));
    const ratio = next / this.camera.zoom;
    this.camera.x = x - (x - this.camera.x) * ratio;
    this.camera.y = y - (y - this.camera.y) * ratio;
    this.camera.zoom = next;
    this.render();
  }
  private point(e: { clientX: number; clientY: number }) {
    const r = this.host.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  private get roadTool() {
    return this.input?.repeatPlacement && this.input.placement?.kind === "road";
  }
  private cell(e: PointerEvent): Cell {
    const p = this.point(e);
    const cell = isoToGrid(
      (p.x - this.camera.x) / this.camera.zoom,
      (p.y - this.camera.y) / this.camera.zoom,
    );
    // Keep one ring of invalid cells visible without allocating unbounded routes.
    return {
      x: Math.max(-1, Math.min(MAP_SIZE, cell.x)),
      y: Math.max(-1, Math.min(MAP_SIZE, cell.y)),
    };
  }
  cancelGesture() {
    const pointerId = this.drag?.pointerId;
    this.drag = undefined;
    this.stroke = undefined;
    this.ghost = undefined;
    this.preview.clear();
    this.clearGhost();
    this.placementMessage("");
    if (pointerId !== undefined && this.host.hasPointerCapture(pointerId))
      this.host.releasePointerCapture(pointerId);
    if (this.initialized) {
      delete this.app.canvas.dataset.roadCells;
      delete this.app.canvas.dataset.placementValid;
      this.render();
    }
  }
  private pointerCancel = (e: PointerEvent) => {
    if (this.drag?.pointerId === e.pointerId) this.cancelGesture();
  };
  private down = (e: PointerEvent) => {
    if (e.button > 2 || this.drag || this.saving || this.input?.busy) return;
    this.host.setPointerCapture(e.pointerId);
    this.app.canvas.focus();
    this.drag = {
      ...this.point(e),
      cx: this.camera.x,
      cy: this.camera.y,
      moved: false,
      button: e.button,
      pointerId: e.pointerId,
    };
    this.pointer = { clientX: e.clientX, clientY: e.clientY };
    this.render();
    if (e.button === 0 && this.roadTool && !this.input?.snapshot) {
      this.stroke = { cells: new Map(), last: this.cell(e) };
      this.extendStroke(this.cell(e));
    }
  };
  private extendStroke(cell: Cell) {
    if (!this.stroke) return;
    for (const p of extendRoad([this.stroke.last], cell))
      this.stroke.cells.set(`${p.x},${p.y}`, p);
    this.stroke.last = cell;
    this.drawRoad([...this.stroke.cells.values()]);
  }
  private drawRoad(cells: Cell[]) {
    this.preview.clear();
    if (this.ghostArt) this.ghostArt.visible = false;
    let valid = true;
    for (const cell of cells) {
      const state = roadCellState(cell, this.input!.data.buildings);
      if (state === "blocked") valid = false;
      const p = gridToIso(cell.x, cell.y);
      const color =
        state === "blocked"
          ? "#c34f46"
          : state === "road"
            ? "#487a99"
            : "#317c60";
      this.preview
        .poly([p.x, p.y, p.x + 32, p.y + 16, p.x, p.y + 32, p.x - 32, p.y + 16])
        .fill({ color, alpha: 0.55 })
        .stroke({ color, width: 2 });
      if (state === "blocked") this.blockedCross(p.x, p.y + 16, 10);
    }
    this.placementMessage(
      valid
        ? `Дорога · ${cells.length} клеток · отпустите для сохранения`
        : "× Дорогу нельзя построить: место занято или край карты. Измените маршрут.",
    );
    this.app.canvas.dataset.placementValid = String(valid);
    this.app.canvas.dataset.roadCells = String(cells.length);
    this.render();
    return valid;
  }
  private move = (e: PointerEvent) => {
    if (this.drag && this.drag.pointerId !== e.pointerId) return;
    const p = this.point(e);
    this.pointer = { clientX: e.clientX, clientY: e.clientY };
    if (this.drag && (!this.input?.placement || this.drag.button !== 0)) {
      if (Math.hypot(p.x - this.drag.x, p.y - this.drag.y) > 4)
        this.drag.moved = true;
      if (this.drag.moved) {
        this.camera.x = this.drag.cx + p.x - this.drag.x;
        this.camera.y = this.drag.cy + p.y - this.drag.y;
        this.render();
      }
    }
    if (this.input?.placement && !this.input.snapshot) {
      if (this.stroke) this.extendStroke(this.cell(e));
      else {
        const cell = this.cell(e);
        this.drawPreview(cell.x, cell.y);
      }
    } else if (!this.drag) {
      const hit = this.hitAt(p);
      const hovered = hit?.b.id ?? null;
      this.app.canvas.title = hit?.b.name ?? "";
      if (hovered !== this.hovered) {
        this.hovered = hovered;
        this.render();
      }
    }
  };
  private leave = () => {
    this.pointer = undefined;
    if (this.hovered) {
      this.hovered = null;
      this.app.canvas.title = "";
      this.render();
    }
  };
  private hitAt(p: { x: number; y: number }) {
    const x = (p.x - this.camera.x) / this.camera.zoom,
      y = (p.y - this.camera.y) / this.camera.zoom;
    return [...this.hits]
      .reverse()
      .find((h) =>
        h.graphic.containsPoint(
          new Point(x - h.container.x, y - h.container.y),
        ),
      );
  }
  private commit(action: () => Promise<void>) {
    this.saving = true;
    void action().finally(() => {
      this.saving = false;
    });
  }
  private up = (e: PointerEvent) => {
    if (!this.drag || this.drag.pointerId !== e.pointerId) return;
    const drag = this.drag;
    if (this.stroke) this.extendStroke(this.cell(e));
    const cells = this.stroke ? [...this.stroke.cells.values()] : undefined;
    this.drag = undefined;
    this.stroke = undefined;
    if (this.host.hasPointerCapture(e.pointerId))
      this.host.releasePointerCapture(e.pointerId);
    this.pointer = { clientX: e.clientX, clientY: e.clientY };
    this.render();
    if (drag.moved || e.button !== 0 || this.saving || this.input?.busy) return;
    if (this.input?.placement && !this.input.snapshot) {
      if (cells) {
        if (this.drawRoad(cells))
          this.commit(() => this.callbacks.road(this.input!.placement!, cells));
      } else {
        const cell = this.cell(e);
        this.drawPreview(cell.x, cell.y);
        if (
          this.ghost &&
          canPlace(this.ghost, this.input.data.buildings, this.ghost.id)
        ) {
          const ghost = this.ghost;
          this.commit(() => this.callbacks.place(ghost));
        }
      }
      return;
    }
    const hit = this.hitAt(this.point(e));
    if (hit) this.callbacks.select(hit.b);
  };
  private drawPreview(x: number, y: number) {
    const b = this.input?.placement;
    if (!b) return;
    this.ghost = { ...b, x, y };
    if (this.roadTool) {
      this.drawRoad([{ x, y }]);
      return;
    }
    const valid = canPlace(this.ghost, this.input!.data.buildings, b.id);
    const p = gridToIso(x, y);
    const s = b.w * 32;
    const stage =
      (b.learningObjectId
        ? this.input!.data.learningObjects.find(
            (o) => o.id === b.learningObjectId,
          )?.stage
        : this.input!.data.tracks.find((t) => t.id === b.trackId)?.stage) ?? 1;
    const key = `${b.kind}:${b.color}:${b.w}:${b.h}:${Boolean(b.trackId)}:${stage}`;
    if (this.ghostKey !== key || !this.ghostArt) {
      this.clearGhost();
      this.ghostArt = buildingArt({ ...b, x: 0, y: 0 }, stage, false).container;
      this.ghostArt.alpha = 0.58;
      this.ghostArt.eventMode = "none";
      this.ghostLayer.addChild(this.ghostArt);
      this.ghostKey = key;
    }
    this.ghostArt.visible = true;
    this.ghostArt.position.set(p.x, p.y);
    this.preview
      .clear()
      .poly([
        p.x,
        p.y,
        p.x + s,
        p.y + s / 2,
        p.x,
        p.y + s,
        p.x - s,
        p.y + s / 2,
      ])
      .fill({ color: valid ? "#317c60" : "#c34f46", alpha: 0.12 })
      .stroke({ color: valid ? "#195b41" : "#a42e2a", width: 3 });
    if (!valid) this.blockedCross(p.x, p.y + s / 2, 15);
    const outside = x < 0 || y < 0 || x + b.w > MAP_SIZE || y + b.h > MAP_SIZE;
    this.placementMessage(
      `${b.trackId ? `Этап ${stage} · ` : ""}${valid ? "✓ Можно разместить · нажмите на карту" : outside ? "× За пределами карты" : "× Место занято"}`,
    );
    this.app.canvas.dataset.placementValid = String(valid);
    this.app.canvas.dataset.cell = `${x},${y}`;
    this.render();
  }
  private blockedCross(x: number, y: number, radius: number) {
    this.preview
      .moveTo(x - radius, y - radius / 2)
      .lineTo(x + radius, y + radius / 2)
      .moveTo(x + radius, y - radius / 2)
      .lineTo(x - radius, y + radius / 2)
      .stroke({ color: "#702a24", width: 4 });
  }
  private clearGhost() {
    this.ghostArt?.destroy({ children: true, context: true });
    this.ghostArt = undefined;
    this.ghostKey = "";
  }
  private placementMessage(text: string) {
    if (this.previewStatus.textContent !== text)
      this.previewStatus.textContent = text;
    this.previewStatus.hidden = !text;
  }
  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    if (this.stroke) return;
    const p = this.point(e);
    this.zoom(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
  };
  private context = (e: Event) => e.preventDefault();
  private key = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      this.cancelGesture();
      this.callbacks.cancel();
    }
    if (this.stroke) return;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      this.camera.x +=
        e.key === "ArrowLeft" ? 40 : e.key === "ArrowRight" ? -40 : 0;
      this.camera.y +=
        e.key === "ArrowUp" ? 40 : e.key === "ArrowDown" ? -40 : 0;
      this.render();
    }
    if (e.key === "+" || e.key === "=") this.zoomBy(1.2);
    if (e.key === "-") this.zoomBy(1 / 1.2);
  };
  destroy() {
    this.disposed = true;
    this.unregisterPreviews?.();
    this.previewStatus.remove();
    this.labels.destroy();
    this.observer?.disconnect();
    if (this.animation) cancelAnimationFrame(this.animation);
    this.host.removeEventListener("pointerdown", this.down);
    this.host.removeEventListener("pointermove", this.move);
    this.host.removeEventListener("pointerleave", this.leave);
    this.host.removeEventListener("pointerup", this.up);
    this.host.removeEventListener("pointercancel", this.pointerCancel);
    this.host.removeEventListener("lostpointercapture", this.pointerCancel);
    this.host.removeEventListener("wheel", this.wheel);
    this.host.removeEventListener("contextmenu", this.context);
    this.host.removeEventListener("keydown", this.key);
    if (this.initialized)
      this.app.destroy(true, { children: true, context: true });
  }
}
