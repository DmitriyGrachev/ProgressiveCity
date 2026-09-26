import { test, expect, type Page } from "@playwright/test";
import { createCity, rows, clickCell, gridPoint } from "./helpers";
import type { Building, Snapshot } from "../../src/domain/model";
import type { Graphics, Container } from "pixi.js";
import type { ScreenRect } from "../../src/city/label-layout";

type Probe = {
  sceneUpdates: number;
  savedGraphic?: Graphics;
  readabilityEngine: {
    hits: { b: Building; graphic: Graphics; container: Container }[];
    occupiedBounds: ScreenRect[];
    labels: { viewport(): ScreenRect };
    camera: { x: number; y: number; zoom: number };
    hitAt(point: { x: number; y: number }): { b: Building } | undefined;
  };
};
async function probe(page: Page) {
  await page.evaluate(async () => {
    const path = "/src/city/engine.ts";
    const { CityEngine } = (await import(
      path
    )) as typeof import("../../src/city/engine");
    const original = CityEngine.prototype.update;
    Object.assign(window, { sceneUpdates: 0 });
    CityEngine.prototype.update = function (...args) {
      Object.assign(window, { readabilityEngine: this });
      (window as unknown as Probe).sceneUpdates++;
      return original.apply(this, args);
    };
  });
}
async function denseCity(page: Page) {
  await createCity(
    page,
    "Исследование 1 — длинное название мастерской и сохранённых материалов",
  );
  await probe(page);
  await page.evaluate(async () => {
    const path = "/src/storage/service.ts";
    const { service } = (await import(
      path
    )) as typeof import("../../src/storage/service");
    const initial = (await service.db.buildings.toArray())[0];
    await service.removeBuilding(initial.id);
    for (let i = 0; i < 9; i++) {
      const track =
        i === 0
          ? (await service.db.tracks.toArray())[0]
          : await service.createTrack({
              name: `Исследование ${i + 1} — длинное название мастерской и сохранённых материалов`,
              type: "skill",
              description: "Синтетический город",
              goal: "",
              schedule: "",
              unit: "",
              comparison: "min",
            });
      await service.placeBuilding({
        id: `readable-${i}`,
        trackId: track.id,
        name: track.name,
        kind: (["workshop", "library", "pavilion"] as const)[i % 3],
        color: "#578b7c",
        x: 14 + (i % 3) * 2,
        y: 14 + Math.floor(i / 3) * 2,
        w: 2,
        h: 2,
      });
    }
    await service.snapshot("Квартал до изменений");
  });
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "9",
  );
  await page
    .getByRole("button", { name: "Показать застройку", exact: true })
    .click();
}
async function database(page: Page) {
  return Promise.all(
    [
      "cities",
      "buildings",
      "districts",
      "tracks",
      "learningObjects",
      "notes",
      "activities",
      "events",
      "snapshots",
      "metadata",
    ].map((t) => rows(page, t)),
  );
}
async function assertFit(page: Page) {
  const boxes = await page.evaluate(() => {
    const e = (window as unknown as Probe).readabilityEngine,
      c = e.camera;
    return {
      viewport: e.labels.viewport(),
      boxes: e.occupiedBounds.map((b) => ({
        x: b.x * c.zoom + c.x,
        y: b.y * c.zoom + c.y,
        width: b.width * c.zoom,
        height: b.height * c.zoom,
      })),
    };
  });
  for (const b of boxes.boxes) {
    expect(b.x).toBeGreaterThanOrEqual(boxes.viewport.x + 15);
    expect(b.y).toBeGreaterThanOrEqual(boxes.viewport.y + 15);
    expect(b.x + b.width).toBeLessThanOrEqual(
      boxes.viewport.x + boxes.viewport.width - 15,
    );
    expect(b.y + b.height).toBeLessThanOrEqual(
      boxes.viewport.y + boxes.viewport.height - 15,
    );
  }
}

async function readable(page: Page) {
  const boxes = await page
    .locator(".map-label:visible")
    .evaluateAll((elements) =>
      elements.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          id: (el as HTMLElement).dataset.labelId,
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
        };
      }),
    );
  const canvas = (await page.locator("canvas").boundingBox())!;
  for (const a of boxes) {
    expect(a.x).toBeGreaterThanOrEqual(canvas.x);
    expect(a.y).toBeGreaterThanOrEqual(canvas.y);
    expect(a.x + a.width).toBeLessThanOrEqual(canvas.x + canvas.width + 0.1);
    expect(a.y + a.height).toBeLessThanOrEqual(canvas.y + canvas.height + 0.1);
  }
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i],
        b = boxes[j];
      expect(
        a.x < b.x + b.width &&
          a.x + a.width > b.x &&
          a.y < b.y + b.height &&
          a.y + a.height > b.y,
        `${a.id} intersects ${b.id}`,
      ).toBe(false);
    }
  return boxes;
}

test("readable city: single workshop, display controls and selection survive zoom and narrow resize", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await createCity(
    page,
    "Мастерская длинного названия для проверки читаемого города",
  );
  const initial = await rows<Building>(page, "buildings");
  await page
    .getByRole("button", { name: "Показать застройку", exact: true })
    .click();
  await expect(page.locator(".map-label:visible")).toHaveCount(1);
  await readable(page);
  const fitted = JSON.parse(
    (await page.locator("canvas").getAttribute("data-camera"))!,
  );
  await page
    .getByRole("button", { name: "Показать весь город", exact: true })
    .click();
  expect(
    JSON.parse((await page.locator("canvas").getAttribute("data-camera"))!)
      .zoom,
  ).toBeLessThan(fitted.zoom);
  await page
    .getByRole("button", {
      name: "Мастерская длинного названия для проверки читаемого города",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Закрыть панель", exact: true })
    .click();
  await expect(page.locator(".map-label.selected:visible")).toHaveCount(1);
  await page.getByLabel("Подписи на карте").selectOption("focused");
  await expect(page.locator(".map-label.selected:visible")).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Показать застройку", exact: true })
    .click();
  await readable(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(await rows<Building>(page, "buildings")).toEqual(initial);
  await page.screenshot({
    path: "docs/review-evidence/readability-mobile.png",
  });
  expect(errors).toEqual([]);
});

test("dense names avoid real overlaps and remain stable without rebuilding graphics or writing data", async ({
  page,
}) => {
  await denseCity(page);
  await assertFit(page);
  const before = await database(page);
  const stack = await page.evaluate(async () => {
    const path = "/src/storage/service.ts";
    const { service } = (await import(
      path
    )) as typeof import("../../src/storage/service");
    return service.planning.getSnapshot();
  });
  for (let i = 0; i < 3; i++)
    await page.getByRole("button", { name: "Отдалить", exact: true }).click();
  const first = await readable(page);
  expect(first.length).toBeGreaterThan(0);
  expect(first.length).toBeLessThan(9);
  await page.screenshot({ path: "docs/review-evidence/readability-dense.png" });
  await page.evaluate(() => {
    const p = window as unknown as Probe;
    p.sceneUpdates = 0;
    p.savedGraphic = p.readabilityEngine.hits[0].graphic;
  });
  const canvas = (await page.locator("canvas").boundingBox())!;
  const x = canvas.x + 20,
    y = canvas.y + canvas.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(x + 6, y + 1, { steps: 3 });
  await page.mouse.up({ button: "right" });
  expect((await readable(page)).map((b) => b.id)).toEqual(
    first.map((b) => b.id),
  );
  await page.getByRole("button", { name: "Отдалить", exact: true }).click();
  await readable(page);
  await page.getByRole("button", { name: "Приблизить", exact: true }).click();
  await readable(page);
  await page.getByLabel("Подписи на карте").selectOption("focused");
  await expect(page.locator(".map-label:visible")).toHaveCount(0);
  expect(
    await page.evaluate(() => {
      const p = window as unknown as Probe;
      return {
        updates: p.sceneUpdates,
        same: p.savedGraphic === p.readabilityEngine.hits[0].graphic,
      };
    }),
  ).toEqual({ updates: 0, same: true });
  // Even a hidden name remains hittable through its actual building graphics.
  await clickCell(page, 19, 19);
  await expect(
    page.locator('.map-label[data-entity-id="readable-8"].selected'),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Исследование 9 — длинное название мастерской и сохранённых материалов",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Закрыть панель", exact: true })
    .click();
  await page.getByLabel("Подписи на карте").selectOption("auto");
  await readable(page);
  expect(await database(page)).toEqual(before);
  expect(
    await page.evaluate(async () => {
      const path = "/src/storage/service.ts";
      const { service } = (await import(
        path
      )) as typeof import("../../src/storage/service");
      return service.planning.getSnapshot();
    }),
  ).toEqual(stack);
  await page.setViewportSize({ width: 1024, height: 700 });
  await page
    .getByRole("button", { name: "Показать застройку", exact: true })
    .click();
  await readable(page);
  await assertFit(page);
});

test("hover follows the real building under a stationary pointer after keyboard pan and zoom", async ({
  page,
}) => {
  await denseCity(page);
  await page.getByLabel("Подписи на карте").selectOption("focused");
  const p = await gridPoint(page, 19.5, 19.5);
  await page.mouse.move(p.x, p.y);
  await expect(page.locator("canvas")).toHaveAttribute(
    "title",
    /Исследование 9/,
  );
  await page.locator("canvas").focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
  await expect(page.locator("canvas")).toHaveAttribute("title", "");
  await page.mouse.wheel(0, 200);
  const expected = await page.evaluate((p) => {
    const box = document.querySelector("canvas")!.getBoundingClientRect();
    return (
      (window as unknown as Probe).readabilityEngine.hitAt({
        x: p.x - box.x,
        y: p.y - box.y,
      })?.b.name ?? ""
    );
  }, p);
  await expect(page.locator("canvas")).toHaveAttribute("title", expected);
  await readable(page);
});

test("real roof and district bounds fit distant neighborhoods and the empty city", async ({
  page,
}) => {
  await createCity(page);
  await probe(page);
  await page.evaluate(async () => {
    const path = "/src/storage/service.ts";
    const { service } = (await import(
      path
    )) as typeof import("../../src/storage/service");
    const b = (await service.db.buildings.toArray())[0];
    for (let i = 0; i < 3; i++) {
      const a = await service.saveActivity({
        trackId: b.trackId!,
        title: "Синтетический результат",
        result: "Проверка крыши",
        kind: "apply",
        date: "2026-09-26",
        noteIds: [],
        achieved: true,
      });
      await service.confirmActivity(a.id);
    }
    await service.upgrade(b.trackId!, crypto.randomUUID());
    await service.upgrade(b.trackId!, crypto.randomUUID());
    await service.placeBuilding({ ...b, kind: "library", x: 38, y: 0 });
    await service.placeBuilding({
      id: "far-park",
      name: "Удалённый парк",
      kind: "park",
      color: "#578b7c",
      x: 0,
      y: 38,
      w: 2,
      h: 2,
    });
    await service.saveDistrict({
      id: "west",
      name: "Западный удалённый район",
      color: "#578b7c",
      x: 0,
      y: 36,
      w: 4,
      h: 4,
    });
    await service.saveDistrict({
      id: "east",
      name: "Восточный удалённый район",
      color: "#647ba3",
      x: 36,
      y: 0,
      w: 4,
      h: 4,
    });
  });
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "2",
  );
  for (const size of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await page
      .getByRole("button", { name: "Показать застройку", exact: true })
      .click();
    await assertFit(page);
    await readable(page);
  }
  await page.screenshot({
    path: "docs/review-evidence/readability-distant.png",
  });
  await page.evaluate(async () => {
    const path = "/src/storage/service.ts";
    const { service } = (await import(
      path
    )) as typeof import("../../src/storage/service");
    for (const b of await service.db.buildings.toArray())
      await service.removeBuilding(b.id);
    for (const d of await service.db.districts.toArray())
      await service.removeDistrict(d.id);
  });
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "0",
  );
  await page
    .getByRole("button", { name: "Показать застройку", exact: true })
    .click();
  await expect(page.locator(".map-label:visible")).toHaveCount(0);
  expect(
    JSON.parse((await page.locator("canvas").getAttribute("data-camera"))!)
      .zoom,
  ).toBeGreaterThan(0);
});

test("comparison labels preserve full changes, selected history, read-only and the normal camera", async ({
  page,
}) => {
  await denseCity(page);
  const a = (await rows<Snapshot>(page, "snapshots")).find(
    (s) => s.name === "Квартал до изменений",
  )!;
  await page.evaluate(async () => {
    const path = "/src/storage/service.ts";
    const { service } = (await import(
      path
    )) as typeof import("../../src/storage/service");
    const all = await service.db.buildings.toArray();
    await service.removeBuilding("readable-8");
    for (let i = 0; i < 3; i++)
      await service.placeBuilding({
        ...all[i],
        x: 23,
        y: 14 + i * 2,
        color: "#147abc",
      });
    await service.placeBuilding({
      id: "new-tree",
      name: "Новое дерево",
      kind: "tree",
      color: "#578b7c",
      x: 18,
      y: 18,
      w: 1,
      h: 1,
    });
  });
  await page.getByRole("button", { name: "История", exact: true }).click();
  await page.getByLabel("A — было").selectOption(a.id);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const normalCamera = JSON.parse(
    (await page.locator("canvas").getAttribute("data-camera"))!,
  );
  await page
    .getByRole("button", { name: "Сравнить город", exact: true })
    .click();
  const before = await database(page);
  await page
    .getByRole("button", { name: "Фокус на изменениях", exact: true })
    .click();
  expect((await readable(page)).length).toBeGreaterThan(0);
  await page
    .getByRole("button", {
      name: "Изменение: Исследование 9 — длинное название мастерской и сохранённых материалов",
      exact: true,
    })
    .click();
  const historical = page.locator(".map-label.historical.selected");
  await expect(historical).toBeVisible();
  await expect(historical).toHaveAttribute("data-priority", "4");
  await page.screenshot({
    path: "docs/review-evidence/readability-comparison.png",
  });
  await page.getByLabel("Показывать изменения декора").uncheck();
  await expect(
    page.getByRole("button", { name: "Изменение: Новое дерево", exact: true }),
  ).toHaveCount(0);
  for (const name of ["Было", "Стало", "Показать изменения"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await readable(page);
  }
  await page
    .getByRole("button", {
      name: "Изменение: Исследование 9 — длинное название мастерской и сохранённых материалов",
      exact: true,
    })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Закрыть панель", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Фокус на изменениях", exact: true })
    .click();
  await expect(historical).toBeVisible();
  await readable(page);
  await page.screenshot({
    path: "docs/review-evidence/readability-comparison-mobile.png",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Список изменений", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Строить", exact: true }),
  ).toBeDisabled();
  expect(await database(page)).toEqual(before);
  await page
    .getByRole("button", { name: "Выйти из сравнения", exact: true })
    .click();
  await expect
    .poll(async () =>
      JSON.parse((await page.locator("canvas").getAttribute("data-camera"))!),
    )
    .toEqual(normalCamera);
  // The snapshot return action occupies its own grid row, including a narrow viewport.
  await page
    .getByRole("button", { name: /Квартал до изменений.*объектов/ })
    .click();
  await page
    .getByRole("button", { name: "Закрыть панель", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  const buttons = await page
    .locator(".map-controls button")
    .evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
      }),
    );
  for (let i = 0; i < buttons.length; i++)
    for (let j = i + 1; j < buttons.length; j++)
      expect(
        buttons[i].x < buttons[j].right &&
          buttons[i].right > buttons[j].x &&
          buttons[i].y < buttons[j].bottom &&
          buttons[i].bottom > buttons[j].y,
      ).toBe(false);
  const returnContrast = await page
    .getByRole("button", { name: "Вернуться в текущий город", exact: true })
    .evaluate((el) => {
      const style = getComputedStyle(el);
      const luminance = (color: string) =>
        color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((n) => n / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      const a = luminance(style.color),
        b = luminance(style.backgroundColor);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
  expect(returnContrast).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({
    path: "docs/review-evidence/readability-snapshot-mobile.png",
  });
  await page
    .getByRole("button", { name: "Вернуться в текущий город", exact: true })
    .click();
});
