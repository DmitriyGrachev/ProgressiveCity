import { Application, Container, Graphics, Point, Text } from "pixi.js";
import type { Building, CityData, Snapshot } from "../domain/model";
import { canPlace, gridToIso, isoToGrid, MAP_SIZE } from "../domain/rules";
import { buildingArt } from "./art";
export interface SceneInput {
  data: Pick<CityData, "city" | "tracks" | "buildings" | "districts">;
  selected: string | null;
  placement: Building | null;
  snapshot?: Snapshot;
}
export interface SceneCallbacks {
  select: (b: Building) => void;
  place: (b: Building) => void;
  cancel: () => void;
}
export class CityEngine {
  private app = new Application();
  private world = new Container();
  private ground = new Container();
  private objects = new Container();
  private preview = new Graphics();
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
  };
  private initialized = false;
  private disposed = false;
  private animation?: number;
  private ghost?: Building;
  private host: HTMLDivElement;
  private callbacks: SceneCallbacks;
  constructor(host: HTMLDivElement, callbacks: SceneCallbacks) {
    this.host = host;
    this.callbacks = callbacks;
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
    this.host.appendChild(this.app.canvas);
    this.app.canvas.setAttribute("aria-label", "Интерактивная карта города");
    this.app.canvas.tabIndex = 0;
    this.world.addChild(this.ground, this.objects, this.preview);
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
    this.host.addEventListener("pointerup", this.up);
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
    this.objects.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.hits = [];
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
      const p = gridToIso(d.x, d.y);
      const label = new Text({
        text: d.name,
        style: {
          fontFamily: "Segoe UI",
          fontSize: 14,
          fontWeight: "600",
          fill: d.color,
        },
      });
      label.position.set(p.x + 8, p.y + 8);
      this.objects.addChild(label);
    }
    for (const b of [...buildings].sort(
      (a, b) => a.x + a.y + a.w + a.h - (b.x + b.y + b.w + b.h),
    )) {
      const stage =
        input.snapshot?.buildings.find((s) => s.id === b.id)?.stage ??
        input.data.tracks.find((t) => t.id === b.trackId)?.stage ??
        1;
      const art = buildingArt(b, stage, input.selected === b.id);
      this.objects.addChild(art.container);
      this.hits.push({ b, ...art });
    }
    if (!input.placement) {
      this.preview.clear();
      this.ghost = undefined;
    } else if (this.ghost) this.drawPreview(this.ghost.x, this.ghost.y);
    this.render();
    if (
      old &&
      !input.snapshot &&
      !input.data.city?.reducedMotion &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      const upgraded = input.data.tracks.find(
        (t) =>
          t.stage >
          (old.data.tracks.find((p) => p.id === t.id)?.stage ?? t.stage),
      );
      if (upgraded) this.pulse(upgraded.id);
    }
  }
  private pulse(trackId: string) {
    if (this.animation) cancelAnimationFrame(this.animation);
    const start = performance.now();
    const object = this.hits.find((h) => h.b.trackId === trackId)?.container;
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
    for (const h of this.hits) {
      const label = h.container.getChildByLabel("building-label");
      if (label) label.visible = this.camera.zoom >= 0.6;
    }
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
  zoomBy(factor: number) {
    this.zoom(factor, this.host.clientWidth / 2, this.host.clientHeight / 2);
  }
  private zoom(factor: number, x: number, y: number) {
    const next = Math.max(0.18, Math.min(2.5, this.camera.zoom * factor));
    const ratio = next / this.camera.zoom;
    this.camera.x = x - (x - this.camera.x) * ratio;
    this.camera.y = y - (y - this.camera.y) * ratio;
    this.camera.zoom = next;
    this.render();
  }
  private point(e: PointerEvent | WheelEvent) {
    const r = this.host.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  private down = (e: PointerEvent) => {
    if (e.button > 2) return;
    this.host.setPointerCapture(e.pointerId);
    this.app.canvas.focus();
    const p = this.point(e);
    this.drag = {
      ...p,
      cx: this.camera.x,
      cy: this.camera.y,
      moved: false,
      button: e.button,
    };
  };
  private move = (e: PointerEvent) => {
    const p = this.point(e);
    if (this.drag && (!this.input?.placement || this.drag.button !== 0)) {
      if (Math.hypot(p.x - this.drag.x, p.y - this.drag.y) > 4)
        this.drag.moved = true;
      if (this.drag.moved) {
        this.camera.x = this.drag.cx + p.x - this.drag.x;
        this.camera.y = this.drag.cy + p.y - this.drag.y;
        this.render();
      }
    }
    if (this.input?.placement) {
      const cell = isoToGrid(
        (p.x - this.camera.x) / this.camera.zoom,
        (p.y - this.camera.y) / this.camera.zoom,
      );
      this.drawPreview(cell.x, cell.y);
    }
  };
  private up = (e: PointerEvent) => {
    if (!this.drag) return;
    const drag = this.drag;
    this.drag = undefined;
    if (this.host.hasPointerCapture(e.pointerId))
      this.host.releasePointerCapture(e.pointerId);
    if (drag.moved || e.button !== 0) return;
    const p = this.point(e);
    const world = {
      x: (p.x - this.camera.x) / this.camera.zoom,
      y: (p.y - this.camera.y) / this.camera.zoom,
    };
    if (this.input?.placement && !this.input.snapshot) {
      const cell = isoToGrid(world.x, world.y);
      this.drawPreview(cell.x, cell.y);
      if (
        this.ghost &&
        canPlace(this.ghost, this.input.data.buildings, this.ghost.id)
      )
        this.callbacks.place(this.ghost);
      return;
    }
    const hit = [...this.hits]
      .reverse()
      .find((h) =>
        h.graphic.containsPoint(
          new Point(world.x - h.container.x, world.y - h.container.y),
        ),
      );
    if (hit) this.callbacks.select(hit.b);
  };
  private drawPreview(x: number, y: number) {
    const b = this.input?.placement;
    if (!b) return;
    this.ghost = { ...b, x, y };
    const valid = canPlace(this.ghost, this.input!.data.buildings, b.id);
    const p = gridToIso(x, y);
    const s = b.w * 32;
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
      .fill({ color: valid ? "#317c60" : "#c34f46", alpha: 0.5 })
      .stroke({ color: valid ? "#195b41" : "#a42e2a", width: 3 });
    this.app.canvas.dataset.placementValid = String(valid);
    this.app.canvas.dataset.cell = `${x},${y}`;
    this.render();
  }
  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = this.point(e);
    this.zoom(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
  };
  private context = (e: Event) => e.preventDefault();
  private key = (e: KeyboardEvent) => {
    if (e.key === "Escape") this.callbacks.cancel();
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
    this.observer?.disconnect();
    if (this.animation) cancelAnimationFrame(this.animation);
    this.host.removeEventListener("pointerdown", this.down);
    this.host.removeEventListener("pointermove", this.move);
    this.host.removeEventListener("pointerup", this.up);
    this.host.removeEventListener("wheel", this.wheel);
    this.host.removeEventListener("contextmenu", this.context);
    this.host.removeEventListener("keydown", this.key);
    if (this.initialized) this.app.destroy(true, { children: true });
  }
}
