import {
  arrangeLabels,
  overlaps,
  type LabelPosition,
  type ScreenRect,
} from "./label-layout";

export interface CityLabel {
  id: string;
  name: string;
  bounds: ScreenRect;
  entityId?: string;
  changeKey?: string;
  detail?: string;
  historical?: boolean;
  district?: boolean;
}
export type LabelMode = "auto" | "focused";
type Item = CityLabel & {
  element: HTMLDivElement;
  width: number;
  height: number;
};

/** Passive screen-space labels. Geometry and pointer hit testing stay in Pixi. */
export class CityLabels {
  private root = document.createElement("div");
  private items: Item[] = [];
  private previous = new Map<string, LabelPosition>();
  private width = 0;
  private mode: LabelMode = "auto";
  private observer: ResizeObserver;
  constructor(
    private host: HTMLDivElement,
    refresh: () => void,
  ) {
    this.root.className = "city-labels";
    this.root.setAttribute("aria-hidden", "true");
    this.host.appendChild(this.root);
    this.observer = new ResizeObserver(refresh);
  }
  setMode(mode: LabelMode) {
    this.mode = mode;
  }
  set(labels: CityLabel[]) {
    this.root.replaceChildren();
    this.items = labels.map((label) => {
      const element = document.createElement("div");
      element.className = `map-label${label.historical ? " historical" : ""}${label.district ? " district" : ""}`;
      element.dataset.labelId = label.id;
      element.dataset.entityId = label.entityId ?? "";
      element.dataset.changeKey = label.changeKey ?? "";
      const name = document.createElement("span");
      name.className = "map-label-name";
      name.textContent = label.name;
      element.appendChild(name);
      if (label.detail) {
        const detail = document.createElement("span");
        detail.className = "map-label-detail";
        detail.textContent = label.detail;
        element.appendChild(detail);
      }
      this.root.appendChild(element);
      return { ...label, element, width: 0, height: 0 };
    });
    this.width = 0;
    this.observer.disconnect();
    for (const el of this.host.parentElement!.querySelectorAll(
      ".map-heading,.comparison-controls,.map-controls,.layout-controls,.map-help",
    ))
      this.observer.observe(el);
  }
  viewport(): ScreenRect {
    const host = this.host.getBoundingClientRect();
    let top = 12,
      bottom = host.height - 12,
      right = host.width - 12;
    for (const el of this.host.parentElement!.querySelectorAll<HTMLElement>(
      ".map-heading,.comparison-controls,.map-controls,.layout-controls,.map-help,.return-present",
    )) {
      if (
        getComputedStyle(el).visibility === "hidden" ||
        !el.getClientRects().length
      )
        continue;
      const r = el.getBoundingClientRect();
      if (el.matches(".map-heading,.comparison-controls"))
        top = Math.max(top, r.bottom - host.top + 12);
      else bottom = Math.min(bottom, r.top - host.top - 12);
    }
    const panel = this.host
      .closest(".app-shell")
      ?.querySelector(".detail-panel");
    if (panel) {
      const r = panel.getBoundingClientRect();
      if (r.left < host.right && r.right > host.left)
        right = Math.min(right, r.left - host.left - 12);
    }
    return {
      x: 12,
      y: top,
      width: Math.max(0, right - 12),
      height: Math.max(0, bottom - top),
    };
  }
  update(
    camera: { x: number; y: number; zoom: number },
    selected: string | null,
    hovered: string | null,
    selectedChange?: string | null,
  ) {
    const viewport = this.viewport();
    const maxWidth = Math.min(220, viewport.width);
    if (this.width !== maxWidth) {
      // Measure the real styled DOM boxes only when content/available width changes.
      for (const item of this.items) {
        item.element.style.maxWidth = `${Math.max(1, maxWidth)}px`;
        item.element.hidden = false;
      }
      for (const item of this.items) {
        item.width = item.element.offsetWidth;
        item.height = item.element.offsetHeight;
      }
      this.width = maxWidth;
    }
    const candidates = this.items.map((item) => {
      const chosen = Boolean(
        (selected && item.entityId === selected) ||
        (selectedChange && item.changeKey === selectedChange),
      );
      const hover = Boolean(hovered && item.entityId === hovered);
      const priority = chosen
        ? item.historical
          ? 4
          : 5
        : hover
          ? 3
          : item.district
            ? 0
            : 1;
      item.element.dataset.priority = String(priority);
      item.element.classList.toggle("selected", chosen);
      const bounds = {
        x: item.bounds.x * camera.zoom + camera.x,
        y: item.bounds.y * camera.zoom + camera.y,
        width: item.bounds.width * camera.zoom,
        height: item.bounds.height * camera.zoom,
      };
      return {
        id: item.id,
        x: bounds.x + bounds.width / 2,
        below: bounds.y + bounds.height + 6,
        above: bounds.y - 6,
        width: item.width,
        height: item.height,
        priority,
        obstacle: !item.historical && !item.district ? bounds : undefined,
        objectVisible: overlaps(bounds, {
          x: 0,
          y: 0,
          width: viewport.x + viewport.width,
          height: this.host.clientHeight,
        }),
        eligible:
          chosen ||
          hover ||
          (this.mode === "auto" &&
            camera.zoom >= (this.previous.has(item.id) ? 0.48 : 0.56)),
      };
    });
    const next = arrangeLabels(candidates, viewport, this.previous);
    for (const item of this.items) {
      const box = next.get(item.id);
      item.element.hidden = !box;
      if (box)
        item.element.style.transform = `translate(${box.x}px, ${box.y}px)`;
    }
    this.previous = next;
  }
  destroy() {
    this.observer.disconnect();
    this.root.remove();
  }
}
