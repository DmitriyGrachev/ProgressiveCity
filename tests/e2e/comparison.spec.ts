import { test, expect, type Page } from "@playwright/test";
import { createCity, clickCell, gridPoint, rows } from "./helpers";
import type { Building, Snapshot } from "../../src/domain/model";
import { readFile } from "node:fs/promises";

async function history(page: Page) {
  await page.getByRole("button", { name: "История", exact: true }).click();
}
async function capture(page: Page, name: string) {
  await history(page);
  await page.getByLabel("Название снимка").fill(name);
  await page
    .getByRole("button", { name: "Сделать снимок", exact: true })
    .click();
  await expect
    .poll(async () =>
      (await rows<Snapshot>(page, "snapshots")).some((s) => s.name === name),
    )
    .toBe(true);
  return (await rows<Snapshot>(page, "snapshots")).find(
    (s) => s.name === name,
  )!;
}
async function tree(page: Page, x: number, y: number) {
  await page.getByRole("button", { name: "Строить", exact: true }).click();
  await page.getByLabel("Тип объекта").selectOption("tree");
  await page
    .getByRole("button", { name: "Выбрать место на карте", exact: true })
    .click();
  await clickCell(page, x, y);
  await expect
    .poll(async () =>
      (await rows<Building>(page, "buildings")).some(
        (b) => b.kind === "tree" && b.x === x && b.y === y,
      ),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
}
async function database(page: Page) {
  return Promise.all(
    [
      "cities",
      "tracks",
      "learningObjects",
      "buildings",
      "districts",
      "notes",
      "activities",
      "events",
      "snapshots",
      "metadata",
    ].map((table) => rows(page, table)),
  );
}

test("comparison focus fits distant changes on a narrow screen", async ({
  page,
}) => {
  await createCity(page);
  const position = async (x: number, y: number) => {
    await page.getByRole("button", { name: "Акварель", exact: true }).click();
    await page
      .getByRole("button", { name: "Оформление и перенос", exact: true })
      .click();
    await page
      .getByText("Точное размещение по клеткам", { exact: true })
      .click();
    await page.getByLabel("X", { exact: true }).fill(String(x));
    await page.getByLabel("Y", { exact: true }).fill(String(y));
    await page
      .getByRole("button", { name: "Разместить по координатам", exact: true })
      .click();
    await expect
      .poll(async () => (await rows<Building>(page, "buildings"))[0].x)
      .toBe(x);
  };
  await position(0, 38);
  const a = await capture(page, "У западного края");
  await position(38, 0);
  await history(page);
  await page.getByLabel("A — было").selectOption(a.id);
  await page
    .getByRole("button", { name: "Сравнить город", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Закрыть панель", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Фокус на изменениях", exact: true })
    .click();
  const box = (await page.locator("canvas").boundingBox())!;
  for (const [x, y] of [
    [0, 38],
    [2, 40],
    [38, 0],
    [40, 2],
  ]) {
    const p = await gridPoint(page, x, y);
    expect(p.x).toBeGreaterThanOrEqual(box.x);
    expect(p.x).toBeLessThanOrEqual(box.x + box.width);
    expect(p.y).toBeGreaterThanOrEqual(box.y);
    expect(p.y).toBeLessThanOrEqual(box.y + box.height);
  }
  const beforeZoom = JSON.parse(
    (await page.locator("canvas").getAttribute("data-camera"))!,
  ).zoom as number;
  await page.getByRole("button", { name: "Отдалить", exact: true }).click();
  const afterZoom = JSON.parse(
    (await page.locator("canvas").getAttribute("data-camera"))!,
  ).zoom as number;
  expect(afterZoom).toBeLessThan(beforeZoom);
});

test("leaving during a delayed refresh cannot reopen comparison", async ({
  page,
}) => {
  await createCity(page);
  await history(page);
  await page
    .getByRole("button", { name: "Сравнить город", exact: true })
    .click();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-comparison-view",
    "changes",
  );
  await page.evaluate(async () => {
    const path = "/src/storage/db.ts";
    const { db } = (await import(
      path
    )) as typeof import("../../src/storage/db");
    const original = db.metadata.get.bind(db.metadata);
    let calls = 0;
    const controls = { waiting: false, release: () => {} };
    Object.assign(window, { comparisonRefresh: controls });
    Object.defineProperty(db.metadata, "get", {
      configurable: true,
      value: async (key: "epoch") => {
        const result = await original(key);
        if (++calls === 2) {
          controls.waiting = true;
          await new Promise<void>((resolve) => {
            controls.release = () => {
              delete (db.metadata as unknown as { get?: unknown }).get;
              resolve();
            };
          });
        }
        return result;
      },
    });
  });
  await page
    .getByRole("button", { name: "Обновить текущее состояние", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { comparisonRefresh: { waiting: boolean } })
            .comparisonRefresh.waiting,
      ),
    )
    .toBe(true);
  await page
    .getByRole("button", { name: "Выйти из сравнения", exact: true })
    .click();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-comparison-view",
    "none",
  );
  await page.evaluate(async () => {
    (
      window as unknown as { comparisonRefresh: { release: () => void } }
    ).comparisonRefresh.release();
    const path = "/src/app/ui.ts";
    const { useUI } = (await import(path)) as typeof import("../../src/app/ui");
    await new Promise<void>((resolve) => {
      if (!useUI.getState().transitioning) {
        resolve();
        return;
      }
      const off = useUI.subscribe((s) => {
        if (!s.transitioning) {
          off();
          resolve();
        }
      });
    });
  });
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-comparison-view",
    "none",
  );
});

test("failed note save blocks comparison entry and preserves the editable draft", async ({
  page,
}) => {
  await createCity(page);
  await page.getByRole("button", { name: "Акварель", exact: true }).click();
  await page
    .getByRole("button", { name: "Новая заметка", exact: true })
    .click();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    Object.assign(window, {
      restoreComparisonWrites: () => {
        IDBObjectStore.prototype.put = put;
      },
    });
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === "notes")
        throw new DOMException(
          "Comparison draft write failure",
          "QuotaExceededError",
        );
      return put.call(this, value, key);
    };
  });
  await page.locator(".tiptap").fill("Черновик перед сравнением");
  await page
    .getByRole("button", { name: "Сохранить заметку", exact: true })
    .click();
  await expect(page.getByTestId("save-status")).toContainText("Ошибка");
  await history(page);
  await expect(page.locator(".tiptap")).toHaveAttribute(
    "contenteditable",
    "true",
  );
  await expect(page.locator(".tiptap")).toContainText(
    "Черновик перед сравнением",
  );
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-comparison-view",
    "none",
  );
  await page.evaluate(async () => {
    const path = "/src/app/comparison.ts",
      dbPath = "/src/storage/db.ts";
    const { startComparison } = (await import(
      path
    )) as typeof import("../../src/app/comparison");
    const { db } = (await import(
      dbPath
    )) as typeof import("../../src/storage/db");
    await startComparison(
      (await db.snapshots.toArray())[0].id,
      null,
      (await db.metadata.get("epoch"))!.value,
    );
  });
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-comparison-view",
    "none",
  );
  await expect(page.locator(".tiptap")).toHaveAttribute(
    "contenteditable",
    "true",
  );
  await page.evaluate(() =>
    (
      window as unknown as { restoreComparisonWrites: () => void }
    ).restoreComparisonWrites(),
  );
  await history(page);
  await page
    .getByRole("button", { name: "Сравнить город", exact: true })
    .click();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-comparison-view",
    "changes",
  );
  expect((await rows<{ text: string }>(page, "notes"))[0].text).toBe(
    "Черновик перед сравнением",
  );
});

test("updating current note revisions never rebuilds a frozen comparison scene", async ({
  page,
  context,
}) => {
  await createCity(page);
  await page.getByRole("button", { name: "Акварель", exact: true }).click();
  await page
    .getByRole("button", { name: "Новая заметка", exact: true })
    .click();
  await page.getByLabel("Заголовок заметки").fill("Живой материал");
  await page.locator(".tiptap").fill("Первая редакция");
  await page
    .getByRole("button", { name: "Оформление и перенос", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Перенести на карте", exact: true })
    .click();
  await clickCell(page, 23, 18);
  await history(page);
  await page
    .getByRole("button", { name: "Сравнить город", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Изменение: Акварель", exact: true })
    .click();
  await expect(
    page.getByText(
      "В этом промежутке связанных событий нет. Основание развития не предполагается.",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Живой материал", exact: true })
    .click();
  await expect(page.locator(".tiptap")).toContainText("Первая редакция");
  await page.evaluate(async () => {
    const path = "/src/city/engine.ts";
    const { CityEngine } = (await import(
      path
    )) as typeof import("../../src/city/engine");
    const update = CityEngine.prototype.update;
    Object.assign(window, { comparisonSceneUpdates: 0 });
    CityEngine.prototype.update = function (input) {
      (window as unknown as { comparisonSceneUpdates: number })
        .comparisonSceneUpdates++;
      return update.call(this, input);
    };
  });
  const second = await context.newPage();
  await second.goto("/");
  await second.getByRole("button", { name: "Акварель", exact: true }).click();
  await second
    .getByRole("button", { name: "Живой материал", exact: true })
    .click();
  await second.locator(".tiptap").fill("Новая текущая редакция");
  await second
    .getByRole("button", { name: "Сохранить заметку", exact: true })
    .click();
  await expect(second.getByTestId("save-status")).toHaveText("Сохранено");
  await expect(page.locator(".tiptap")).toContainText("Новая текущая редакция");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { comparisonSceneUpdates: number })
          .comparisonSceneUpdates,
    ),
  ).toBe(0);
  await expect(page.getByTestId("comparison-stages")).toHaveText(
    "A: этап 1 → B: этап 1",
  );
  await second.close();
});

test("equal saved states have a clear empty view and keep the camera", async ({
  page,
}) => {
  await createCity(page);
  await page.getByRole("button", { name: "История", exact: true }).click();
  const first = (await rows<Snapshot>(page, "snapshots"))[0];
  await page.getByLabel("B — стало").selectOption(first.id);
  const camera = await page.locator("canvas").getAttribute("data-camera");
  await page
    .getByRole("button", { name: "Сравнить город", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Было", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("В выбранных состояниях изменений нет.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Было", exact: true }).click();
  await expect(page.locator("canvas")).toHaveAttribute("data-camera", camera!);
  await expect(page.locator("canvas")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Фокус на изменениях", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Закрыть панель", exact: true })
    .click();
  await expect(page.locator("canvas")).not.toHaveAttribute(
    "data-camera",
    camera!,
  );
  await page
    .getByRole("button", { name: "Закончить сравнение на карте", exact: true })
    .click();
  await expect(page.locator("canvas")).toHaveAttribute("data-camera", camera!);
});

test("compare city on one canvas with frozen states, camera and read-only materials", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await createCity(page);
  await tree(page, 16, 18);
  const a = await capture(page, "Отправная точка");
  await page.getByRole("button", { name: "Акварель", exact: true }).click();
  await page
    .getByRole("button", { name: "Новая заметка", exact: true })
    .click();
  await page.getByLabel("Заголовок заметки").fill("Свет и тень");
  await page.locator(".tiptap").fill("Сравнил тёплые и холодные тени.");
  const image = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 32;
    const g = c.getContext("2d")!;
    g.fillStyle = "#bc7153";
    g.fillRect(0, 0, 32, 32);
    g.fillStyle = "#647ba3";
    g.fillRect(32, 0, 32, 32);
    return c.toDataURL().split(",")[1];
  });
  await page.getByLabel("Добавить изображение").setInputFiles({
    name: "light.png",
    mimeType: "image/png",
    buffer: Buffer.from(image, "base64"),
  });
  await page
    .getByRole("button", { name: "Зафиксировать результат", exact: true })
    .click();
  await page.getByLabel("Что получилось").fill("Проверил свет на двух этюдах");
  await page.getByLabel("Тип результата").selectOption("apply");
  await page
    .getByRole("button", { name: "Подтвердить результат", exact: true })
    .click();
  await expect(page.getByTestId("balance")).toContainText("3");
  await page.getByRole("button", { name: "Улучшить", exact: true }).click();
  await expect(page.getByTestId("stage")).toContainText("2");
  await page
    .getByRole("button", { name: "Оформление и перенос", exact: true })
    .click();
  await page.getByLabel("Имя объекта").fill("Мастерская света");
  await page
    .getByRole("combobox", { name: "Палитра", exact: true })
    .selectOption("#647ba3");
  await page
    .getByRole("button", { name: "Перенести на карте", exact: true })
    .click();
  await clickCell(page, 23, 18);
  await expect
    .poll(
      async () =>
        (await rows<Building>(page, "buildings")).find((b) => b.trackId)?.x,
    )
    .toBe(23);
  await clickCell(page, 16, 18);
  await page
    .getByRole("button", { name: "Снять с карты", exact: true })
    .click();
  await tree(page, 19, 23);
  const b = await capture(page, "После этюдов");
  const before = await database(page);
  const undoTitle = await page
    .getByRole("button", { name: "Отменить планировку", exact: true })
    .getAttribute("title");
  const camera = await page.locator("canvas").getAttribute("data-camera");
  await page.getByLabel("A — было").selectOption(a.id);
  await page.getByLabel("B — стало").selectOption(b.id);
  await page
    .getByRole("button", { name: "Сравнить город", exact: true })
    .click();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-comparison-changes",
    "3",
  );
  await expect(page.locator("canvas")).toHaveCount(1);
  for (const mode of ["Было", "Стало", "Показать изменения"]) {
    await page.getByRole("button", { name: mode, exact: true }).click();
    await expect(page.locator("canvas")).toHaveAttribute(
      "data-camera",
      camera!,
    );
    const stages = JSON.parse(
      (await page.locator("canvas").getAttribute("data-building-stages"))!,
    ) as { id: string; stage: number }[];
    const id = a.buildings.find((v) => v.trackId)!.id;
    expect(stages.find((v) => v.id === id)?.stage).toBe(
      mode === "Было" ? 1 : 2,
    );
  }
  const point = await gridPoint(page, 24, 19);
  await page.mouse.click(point.x, point.y - 18);
  await expect(page.getByTestId("comparison-stages")).toHaveText(
    "A: этап 1 → B: этап 2",
  );
  await expect(
    page.getByRole("region", { name: "Выбранное изменение" }),
  ).toContainText("Перемещено");
  await expect(
    page.getByRole("region", { name: "Выбранное изменение" }),
  ).toContainText("Изменено оформление");
  await expect(
    page.getByRole("button", { name: "Строить", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Настройки", exact: true }),
  ).toBeDisabled();
  await page.locator("canvas").focus();
  await page.keyboard.press("Control+Z");
  await page.keyboard.press("Control+Y");
  expect(await database(page)).toEqual(before);
  await page
    .getByRole("button", { name: "Фокус на изменениях", exact: true })
    .click();
  const focused = await page.locator("canvas").getAttribute("data-camera");
  expect(focused).not.toBe(camera);
  await page.screenshot({
    path: "docs/review-evidence/comparison-changes.png",
  });
  await page.getByLabel("Показывать изменения декора").uncheck();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-comparison-changes",
    "1",
  );
  await page
    .getByRole("button", { name: "Изменение: Мастерская света", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Свет и тень · материал результата",
      exact: true,
    })
    .last()
    .click();
  await expect(page.locator(".tiptap")).toHaveAttribute(
    "contenteditable",
    "false",
  );
  await expect(page.getByLabel("Заголовок заметки")).toBeDisabled();
  await expect(page.locator(".tiptap img")).toBeVisible();
  expect(
    await page
      .locator(".tiptap img")
      .evaluate((img) => (img as HTMLImageElement).naturalWidth),
  ).toBe(64);
  await expect(page.getByText(/Текущая редакция заметки/)).toBeVisible();
  await page.locator(".tiptap img").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "docs/review-evidence/comparison-material.png",
  });
  await page.getByRole("button", { name: "Было", exact: true }).click();
  await expect(page.locator("canvas")).toHaveAttribute("data-camera", focused!);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Закрыть панель", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Было", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "docs/review-evidence/comparison-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Список изменений", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Выйти из сравнения", exact: true })
    .click();
  await expect(page.locator("canvas")).toHaveAttribute("data-camera", camera!);
  await expect(
    page.getByRole("button", { name: "Отменить планировку", exact: true }),
  ).toHaveAttribute("title", undoTitle!);
  expect(await database(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test("current comparison only refreshes explicitly and resets after cross-tab import", async ({
  page,
  context,
}) => {
  await createCity(page);
  await tree(page, 16, 18);
  await history(page);
  await page
    .getByRole("button", { name: "Сравнить город", exact: true })
    .click();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-comparison-changes",
    "1",
  );
  const second = await context.newPage();
  await second.goto("/");
  await tree(second, 23, 22);
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "2",
  );
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-comparison-changes",
    "1",
  );
  await page
    .getByRole("button", { name: "Обновить текущее состояние", exact: true })
    .click();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "3",
  );
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-comparison-changes",
    "2",
  );
  await page.getByLabel("Показывать изменения декора").uncheck();
  await expect(
    page.getByText("Изменения есть только в скрытом декоре.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Фокус на изменениях", exact: true }),
  ).toBeDisabled();
  await second.getByRole("button", { name: "Настройки", exact: true }).click();
  const download = second.waitForEvent("download");
  await second
    .getByRole("button", { name: "Экспортировать город", exact: true })
    .click();
  const zip = await readFile((await (await download).path())!);
  await second.getByLabel("Архив для восстановления").setInputFiles({
    name: "comparison-city.zip",
    mimeType: "application/zip",
    buffer: zip,
  });
  await second
    .getByRole("button", { name: "Заменить текущий город", exact: true })
    .click();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-comparison-view",
    "none",
  );
  await expect(
    page.getByRole("button", { name: "Строить", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Отменить планировку", exact: true }),
  ).toBeDisabled();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "3",
  );
  await second.close();
});

test("comparison cancels unfinished road and preserves undo and redo commands", async ({
  page,
}) => {
  await createCity(page);
  await tree(page, 16, 18);
  await tree(page, 23, 22);
  await page
    .getByRole("button", { name: "Отменить планировку", exact: true })
    .click();
  const undo = page.getByRole("button", {
    name: "Отменить планировку",
    exact: true,
  });
  const redo = page.getByRole("button", {
    name: "Повторить планировку",
    exact: true,
  });
  await expect(redo).toBeEnabled();
  const titles = [
    await undo.getAttribute("title"),
    await redo.getAttribute("title"),
  ];
  await page.getByRole("button", { name: "Строить", exact: true }).click();
  await page.getByLabel("Тип объекта").selectOption("road");
  await page
    .getByRole("button", { name: "Выбрать место на карте", exact: true })
    .click();
  const start = await gridPoint(page, 17.5, 22.5),
    end = await gridPoint(page, 21.5, 22.5);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await expect(page.locator("canvas")).toHaveAttribute("data-road-cells", "5");
  await page.getByRole("button", { name: "История", exact: true }).focus();
  await page.keyboard.press("Enter");
  const before = await database(page);
  await page
    .getByRole("button", { name: "Сравнить город", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-comparison-view",
    "changes",
  );
  await page.mouse.up();
  await page.locator("canvas").focus();
  await page.keyboard.press("Control+Z");
  expect(await database(page)).toEqual(before);
  await page
    .getByRole("button", { name: "Выйти из сравнения", exact: true })
    .click();
  await expect(undo).toHaveAttribute("title", titles[0]!);
  await expect(redo).toHaveAttribute("title", titles[1]!);
  await redo.click();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "3",
  );
});
