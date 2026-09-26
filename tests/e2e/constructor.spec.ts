import { test, expect } from "@playwright/test";
import { createCity, rows, clickCell, gridPoint } from "./helpers";
import type { Building } from "../../src/domain/model";
import { readFile } from "node:fs/promises";
import type { Application, Container, Graphics } from "pixi.js";

type InspectedEngine = {
  app: Application;
  hits: { graphic: Graphics }[];
  ghostArt?: Container;
};
type ConstructorProbe = {
  constructorEngine: InspectedEngine;
  constructorContexts: Set<RenderingContext>;
  previousGhost?: Container;
  previousGhostContext?: Graphics["context"];
};

test("shared constructor art matches card, large preview, map and ghost without extra WebGL contexts", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    const contexts = new Set<RenderingContext>();
    Object.assign(window, { constructorContexts: contexts });
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      options?: unknown,
    ) {
      const result = Reflect.apply(original, this, [
        kind,
        options,
      ]) as RenderingContext | null;
      if ((kind === "webgl" || kind === "webgl2") && result)
        contexts.add(result);
      return result;
    } as typeof original;
  });
  await createCity(page);
  const contextCount = await page.evaluate(
    () => (window as unknown as ConstructorProbe).constructorContexts.size,
  );
  await page.evaluate(async () => {
    const path = "/src/city/engine.ts";
    const { CityEngine } = (await import(
      path
    )) as typeof import("../../src/city/engine");
    const original = CityEngine.prototype.update;
    CityEngine.prototype.update = function (...args) {
      Object.assign(window, { constructorEngine: this });
      return original.apply(this, args);
    };
  });
  await page.getByRole("button", { name: "Акварель", exact: true }).click();
  await page.getByRole("button", { name: "Оформление и перенос" }).click();
  for (const kind of ["Мастерская", "Библиотека", "Павильон"]) {
    await page
      .getByRole("radio", { name: `${kind} · 2 × 2 клетки`, exact: true })
      .check();
    for (const stage of [1, 2, 3]) {
      await page
        .getByRole("button", { name: `Посмотреть этап ${stage}`, exact: true })
        .click();
      const image = page.getByTestId("building-preview").locator("img");
      await expect(image).toBeVisible();
      const card = page.locator(".catalog-card").filter({
        has: page.getByRole("radio", {
          name: `${kind} · 2 × 2 клетки`,
          exact: true,
        }),
      });
      await expect(card.locator("img")).toHaveAttribute(
        "src",
        (await image.getAttribute("src"))!,
      );
    }
  }
  await page
    .getByRole("radio", { name: "Мастерская · 2 × 2 клетки", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Посмотреть этап 1", exact: true })
    .click();
  const image = page.getByTestId("building-preview").locator("img");
  await expect(image).toBeVisible();
  const expectedImage = await image.getAttribute("src");
  // Clear selection only: map pixels should match the same unhighlighted catalog variant.
  await page.evaluate(async () => {
    const path = "/src/app/ui.ts";
    const { useUI } = (await import(path)) as typeof import("../../src/app/ui");
    useUI.getState().set({ buildingId: null });
  });
  const extract = async (source: "map" | "ghost") =>
    page.evaluate(async (source) => {
      const engine = (window as unknown as ConstructorProbe).constructorEngine;
      const actual =
        source === "map"
          ? engine.hits[0].graphic
          : (engine.ghostArt!.children[0] as Graphics);
      const graphic = actual.clone(true);
      const frame = graphic.getLocalBounds().rectangle.clone();
      Object.assign(frame, { x: -80, y: -100, width: 160, height: 170 });
      try {
        return await engine.app.renderer.extract.base64({
          target: graphic,
          frame,
          resolution: 2,
          antialias: true,
        });
      } finally {
        graphic.destroy({ context: true });
      }
    }, source);
  await expect.poll(() => extract("map")).toBe(expectedImage);
  await page.getByRole("button", { name: "Акварель", exact: true }).click();
  await page.getByRole("button", { name: "Оформление и перенос" }).click();
  await page
    .getByRole("button", { name: "Перенести на карте", exact: true })
    .click();
  const p = await gridPoint(page, 23.5, 18.5);
  await page.mouse.move(p.x, p.y);
  await expect(page.getByTestId("placement-status")).toContainText("Этап 1");
  expect(await extract("ghost")).toBe(expectedImage);
  expect(
    await page.evaluate(() => {
      const probe = window as unknown as ConstructorProbe;
      probe.previousGhost = probe.constructorEngine.ghostArt!;
      probe.previousGhostContext = (
        probe.previousGhost.children[0] as Graphics
      ).context;
      return probe.previousGhost.alpha;
    }),
  ).toBe(0.58);
  await page.mouse.move(p.x + 30, p.y + 30, { steps: 8 });
  expect(
    await page.evaluate(() => {
      const probe = window as unknown as ConstructorProbe;
      return probe.previousGhost === probe.constructorEngine.ghostArt;
    }),
  ).toBe(true);
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate(() => {
      const probe = window as unknown as ConstructorProbe;
      return (
        probe.previousGhost?.destroyed && probe.previousGhostContext?.destroyed
      );
    }),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => (window as unknown as ConstructorProbe).constructorContexts.size,
    ),
  ).toBe(contextCount);
});

test("visual constructor offers keyboard cards, real images and a local future-stage preview", async ({
  page,
}) => {
  await createCity(page);
  await page.getByRole("button", { name: "Акварель", exact: true }).click();
  await page.getByRole("button", { name: "Оформление и перенос" }).click();
  const before = await rows<Building>(page, "buildings");
  const library = page.getByRole("radio", {
    name: "Библиотека · 2 × 2 клетки",
    exact: true,
  });
  await expect(library).toBeVisible();
  await library.focus();
  await page.keyboard.press("Space");
  await expect(library).toBeChecked();
  await expect(
    page.getByTestId("building-preview").locator("img"),
  ).toHaveAttribute("src", /^data:image\/png/);
  await page
    .getByRole("button", { name: "Посмотреть этап 3", exact: true })
    .click();
  await expect(
    page.getByText("Будущий этап 3 · только просмотр", { exact: true }),
  ).toBeVisible();
  expect(await rows<Building>(page, "buildings")).toEqual(before);
});

test("visual constructor saves custom color through undo reload and ZIP but never a viewed future stage", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await createCity(page);
  const protectedTables = ["tracks", "learningObjects", "notes", "activities"];
  const original = await Promise.all(
    protectedTables.map((table) => rows(page, table)),
  );
  const initial = (await rows<Building>(page, "buildings"))[0];
  await page.getByRole("button", { name: "Акварель", exact: true }).click();
  await page.getByRole("button", { name: "Оформление и перенос" }).click();
  await page
    .getByRole("radio", { name: "Библиотека · 2 × 2 клетки", exact: true })
    .check();
  await page.getByLabel("Свой акцент #RRGGBB", { exact: true }).fill("#oops");
  await expect(
    page.getByRole("button", { name: "Сохранить оформление", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Свой акцент #RRGGBB", { exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Свой акцент #RRGGBB", { exact: true }).fill("#147AbC");
  await page
    .getByRole("button", { name: "Посмотреть этап 3", exact: true })
    .click();
  const futureImage = await page
    .getByTestId("building-preview")
    .locator("img")
    .getAttribute("src");
  await expect(
    page.getByText("Будущий этап 3 · только просмотр", { exact: true }),
  ).toBeVisible();
  expect((await rows<Building>(page, "buildings"))[0]).toEqual(initial);
  await page.locator(".detail-panel").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({
    path: "docs/review-evidence/constructor-catalog.png",
  });
  await page
    .getByRole("button", { name: "Перенести на карте", exact: true })
    .click();
  await clickCell(page, 23, 18);
  await expect
    .poll(async () => (await rows<Building>(page, "buildings"))[0])
    .toMatchObject({ kind: "library", color: "#147abc", x: 23, y: 18 });
  await expect(page.getByTestId("placement-status")).toBeHidden();
  await page
    .getByRole("button", { name: "Отменить планировку", exact: true })
    .click();
  await expect
    .poll(async () => (await rows<Building>(page, "buildings"))[0])
    .toEqual(initial);
  await page
    .getByRole("button", { name: "Повторить планировку", exact: true })
    .click();
  await expect
    .poll(async () => (await rows<Building>(page, "buildings"))[0].color)
    .toBe("#147abc");
  expect(
    await Promise.all(protectedTables.map((table) => rows(page, table))),
  ).toEqual(original);
  await page.reload();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "1",
  );
  await page.getByRole("button", { name: "Акварель", exact: true }).click();
  await expect(page.getByTestId("stage")).toContainText("1");
  await page.getByRole("button", { name: "Оформление и перенос" }).click();
  await expect(
    page.getByLabel("Свой акцент #RRGGBB", { exact: true }),
  ).toHaveValue("#147abc");
  await expect(
    page.getByTestId("building-preview").locator("img"),
  ).toHaveAttribute("src", /^data:image\/png/);
  expect(
    await page
      .getByTestId("building-preview")
      .locator("img")
      .getAttribute("src"),
  ).not.toBe(futureImage);
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Экспортировать город", exact: true })
    .click();
  const zip = await readFile((await (await download).path())!);
  const oldEpoch = await rows(page, "metadata");
  await page.getByLabel("Архив для восстановления").setInputFiles({
    name: "accent.zip",
    mimeType: "application/zip",
    buffer: zip,
  });
  await Promise.all([
    page.waitForEvent("load"),
    page
      .getByRole("button", { name: "Заменить текущий город", exact: true })
      .click(),
  ]);
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "1",
  );
  await expect.poll(() => rows(page, "metadata")).not.toEqual(oldEpoch);
  expect((await rows<Building>(page, "buildings"))[0]).toMatchObject({
    kind: "library",
    color: "#147abc",
    x: 23,
    y: 18,
  });
  expect(
    await Promise.all(protectedTables.map((table) => rows(page, table))),
  ).toEqual(original);
  await page.getByRole("button", { name: "Акварель", exact: true }).click();
  await page.getByRole("button", { name: "Оформление и перенос" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("radio", { name: "Павильон · 2 × 2 клетки", exact: true })
    .focus();
  await page.keyboard.press("Space");
  await page.getByTestId("building-preview").scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "docs/review-evidence/constructor-mobile.png",
  });
  await page
    .getByRole("button", { name: "Сбросить примерку", exact: true })
    .click();
  await expect(
    page.getByRole("radio", { name: "Библиотека · 2 × 2 клетки", exact: true }),
  ).toBeChecked();
  expect(errors).toEqual([]);
});

test("placement ghost uses earned stage, rejects obstacles and does not rebuild the city on pointer movement", async ({
  page,
}) => {
  await createCity(page);
  await page.getByRole("button", { name: "Акварель", exact: true }).click();
  await page.getByRole("button", { name: "Оформление и перенос" }).click();
  await page
    .getByRole("button", { name: "Посмотреть этап 3", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Перенести на карте", exact: true })
    .click();
  await page.evaluate(async () => {
    const path = "/src/city/engine.ts";
    const { CityEngine } = (await import(
      path
    )) as typeof import("../../src/city/engine");
    const original = CityEngine.prototype.update;
    Object.assign(window, { movementUpdates: 0 });
    CityEngine.prototype.update = function (...args) {
      (window as unknown as { movementUpdates: number }).movementUpdates++;
      return original.apply(this, args);
    };
  });
  const before = await rows<Building>(page, "buildings");
  const p = await gridPoint(page, 23.5, 18.5);
  await page.mouse.move(p.x, p.y, { steps: 10 });
  await expect(page.getByTestId("placement-status")).toContainText("Этап 1");
  await page.screenshot({ path: "docs/review-evidence/constructor-ghost.png" });
  expect(await rows<Building>(page, "buildings")).toEqual(before);
  expect(
    await page.evaluate(
      () => (window as unknown as { movementUpdates: number }).movementUpdates,
    ),
  ).toBe(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("placement-status")).toBeHidden();
  expect(await rows<Building>(page, "buildings")).toEqual(before);
  await page.getByRole("button", { name: "Строить", exact: true }).click();
  await page.getByLabel("Тип объекта").selectOption("tree");
  await page
    .getByRole("button", { name: "Выбрать место на карте", exact: true })
    .click();
  await clickCell(page, 19, 19);
  await expect(page.getByTestId("placement-status")).toContainText(
    "Место занято",
  );
  await page.screenshot({
    path: "docs/review-evidence/constructor-blocked.png",
  });
  expect(await rows<Building>(page, "buildings")).toEqual(before);
});

test("layout, undo, import and comparison never trigger the growth effect", async ({
  page,
}) => {
  await createCity(page);
  await page.evaluate(async () => {
    const path = "/src/city/engine.ts";
    const { CityEngine } = (await import(
      path
    )) as typeof import("../../src/city/engine");
    const proto = CityEngine.prototype as unknown as {
      pulse: (id: string) => void;
    };
    const original = proto.pulse;
    Object.assign(window, { growthEffects: 0 });
    proto.pulse = function (id) {
      (window as unknown as { growthEffects: number }).growthEffects++;
      return original.call(this, id);
    };
  });
  await page.getByRole("button", { name: "Строить", exact: true }).click();
  await page.getByLabel("Тип объекта").selectOption("tree");
  await page
    .getByRole("button", { name: "Выбрать место на карте", exact: true })
    .click();
  await clickCell(page, 23, 20);
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "2",
  );
  expect(
    await page.evaluate(
      () => (window as unknown as { growthEffects: number }).growthEffects,
    ),
  ).toBe(0);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Отменить планировку", exact: true })
    .click();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "1",
  );
  await page
    .getByRole("button", { name: "Повторить планировку", exact: true })
    .click();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "2",
  );
  await page.getByRole("button", { name: "История", exact: true }).click();
  await page
    .getByRole("button", { name: "Сравнить город", exact: true })
    .click();
  for (const name of ["Было", "Стало", "Показать изменения"])
    await page.getByRole("button", { name, exact: true }).click();
  await page
    .getByRole("button", { name: "Выйти из сравнения", exact: true })
    .click();
  await page.evaluate(async () => {
    const path = "/src/storage/backup.ts",
      storagePath = "/src/storage/db.ts";
    const { exportCity, inspectArchive, replaceCity } = (await import(
      path
    )) as typeof import("../../src/storage/backup");
    const { db } = (await import(
      storagePath
    )) as typeof import("../../src/storage/db");
    await replaceCity(db, await inspectArchive(await exportCity(db)));
  });
  await expect(
    page.getByRole("button", { name: "Отменить планировку", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => (window as unknown as { growthEffects: number }).growthEffects,
    ),
  ).toBe(0);
});

test("failed improvements show neither success nor growth, successful ones respect reduced motion", async ({
  page,
}) => {
  await createCity(page);
  await page.evaluate(async () => {
    const path = "/src/storage/service.ts",
      enginePath = "/src/city/engine.ts";
    const { service } = (await import(
      path
    )) as typeof import("../../src/storage/service");
    const track = (await service.db.tracks.toArray())[0];
    for (let i = 0; i < 3; i++) {
      const a = await service.saveActivity({
        trackId: track.id,
        title: `Пример ${i}`,
        result: "Синтетическая проверка",
        kind: "apply",
        date: "2026-09-26",
        noteIds: [],
        achieved: true,
      });
      await service.confirmActivity(a.id);
    }
    const { CityEngine } = (await import(
      enginePath
    )) as typeof import("../../src/city/engine");
    const proto = CityEngine.prototype as unknown as {
      pulse: (id: string) => void;
    };
    const original = proto.pulse;
    const state = { effects: 0, fail: true };
    Object.assign(window, { upgradeCheck: state });
    proto.pulse = function (id) {
      state.effects++;
      original.call(this, id);
    };
    service.db.events.hook("creating", (_key, event) => {
      if (event.type === "upgrade" && state.fail)
        throw new Error("Synthetic improvement write failure");
    });
  });
  await page.getByRole("button", { name: "Акварель", exact: true }).click();
  const develop = page.getByRole("button", {
    name: "Развить «Акварель»",
    exact: true,
  });
  await page.getByRole("button", { name: "Результаты", exact: true }).click();
  await page.getByRole("button", { name: /^Пример 2/ }).click();
  const before = await Promise.all(
    ["tracks", "learningObjects", "events", "snapshots"].map((table) =>
      rows(page, table),
    ),
  );
  await develop.click();
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic improvement write failure",
  );
  await expect(page.getByText(/следующий этап сохранён/)).toHaveCount(0);
  expect(
    await Promise.all(
      ["tracks", "learningObjects", "events", "snapshots"].map((table) =>
        rows(page, table),
      ),
    ),
  ).toEqual(before);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { upgradeCheck: { effects: number } })
          .upgradeCheck.effects,
    ),
  ).toBe(0);
  await page.evaluate(() => {
    (
      window as unknown as { upgradeCheck: { fail: boolean } }
    ).upgradeCheck.fail = false;
  });
  await develop.click();
  await expect(page.getByTestId("stage")).toContainText("2");
  await expect(page.getByText(/следующий этап сохранён/)).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { upgradeCheck: { effects: number } })
            .upgradeCheck.effects,
      ),
    )
    .toBe(1);
  await page.evaluate(() => {
    (
      window as unknown as { upgradeCheck: { fail: boolean } }
    ).upgradeCheck.fail = true;
  });
  await develop.click();
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic improvement write failure",
  );
  await expect(page.getByText(/следующий этап сохранён/)).toHaveCount(0);
  await expect(page.getByTestId("stage")).toContainText("2");
  await expect(page.getByTestId("balance")).toContainText("6");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    (
      window as unknown as { upgradeCheck: { fail: boolean } }
    ).upgradeCheck.fail = false;
  });
  await develop.click();
  await expect(page.getByTestId("stage")).toContainText("3");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { upgradeCheck: { effects: number } })
          .upgradeCheck.effects,
    ),
  ).toBe(1);
});
