import { test, expect } from "@playwright/test";
import { createCity, gridPoint, clickCell, rows } from "./helpers";
import type {
  Activity,
  Attachment,
  Building,
  Note,
  ProgressEvent,
  Snapshot,
  Track,
} from "../../src/domain/model";
import path from "node:path";
import { mkdir } from "node:fs/promises";
const evidence = path.resolve("docs/review-evidence");

test("interactive canvas: hit testing after zoom/pan, placement, collisions, removal and historical layout", async ({
  page,
}) => {
  await createCity(page);
  const center = await gridPoint(page, 20, 20);
  await page.mouse.click(center.x, center.y - 18);
  await expect(
    page.getByRole("heading", { name: "Акварель", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Оформление и перенос" }).click();
  await page.getByRole("button", { name: "Перенести на карте" }).click();
  await clickCell(page, 16, 17);
  await expect
    .poll(async () => (await rows<Building>(page, "buildings"))[0].x)
    .toBe(16);
  await page.getByRole("button", { name: "Закрыть панель" }).click();
  const canvas = page.locator("canvas");
  const before = await canvas.getAttribute("data-camera");
  const p = await gridPoint(page, 16.5, 17.5);
  await page.mouse.move(p.x, p.y);
  await page.mouse.wheel(0, -330);
  await expect.poll(() => canvas.getAttribute("data-camera")).not.toBe(before);
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 50, box.y + 220);
  await page.mouse.down();
  await page.mouse.move(box.x + 145, box.y + 280, { steps: 8 });
  await page.mouse.up();
  const moved = await gridPoint(page, 17, 18);
  await page.mouse.click(moved.x, moved.y - 20);
  await expect(
    page.getByRole("heading", { name: "Акварель", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Строить", exact: true }).click();
  await page.getByLabel("Тип объекта").selectOption("tree");
  await page.getByRole("button", { name: "Выбрать место на карте" }).click();
  await clickCell(page, 16, 17);
  await expect(canvas).toHaveAttribute("data-placement-valid", "false");
  expect(await rows<Building>(page, "buildings")).toHaveLength(1);
  await page.keyboard.press("Escape");
  await expect(
    page.getByText("Выбран инструмент размещения.", { exact: false }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Выбрать место на карте" }).click();
  await clickCell(page, 21, 17);
  await expect(canvas).toHaveAttribute("data-building-count", "2");
  await page.getByRole("button", { name: "История", exact: true }).click();
  await page.getByRole("button", { name: /Начало города/ }).click();
  await expect(canvas).toHaveAttribute("data-building-count", "1");
  const snapshots = await rows<Snapshot>(page, "snapshots");
  expect(snapshots[0].buildings[0].x).toBe(19);
  await page
    .getByRole("button", { name: "Текущий город", exact: true })
    .click();
  await expect(canvas).toHaveAttribute("data-building-count", "2");
  await mkdir(evidence, { recursive: true });
  await page.getByRole("button", { name: "Закрыть панель" }).click();
  await page.screenshot({ path: path.join(evidence, "city-canvas.png") });
});

test("image, fast note switching, reload, removal, search and archive restore into a clean browser", async ({
  page,
  browser,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await createCity(page);
  await page.getByRole("button", { name: "Акварель", exact: true }).click();
  await page
    .getByRole("button", { name: "Новая заметка", exact: true })
    .click();
  await page.getByLabel("Заголовок заметки").fill("Наблюдение света");
  await page.locator(".tiptap").fill("Рисую тёплый свет и холодные тени.");
  await page.getByLabel("Теги через запятую").fill("этюд, свет");
  const syntheticImage = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 280;
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#eee5cd";
    g.fillRect(0, 0, 480, 280);
    g.fillStyle = "#cfab71";
    g.fillRect(28, 55, 190, 185);
    g.fillStyle = "#8dada8";
    g.fillRect(260, 55, 190, 185);
    g.fillStyle = "#626f86";
    g.beginPath();
    g.ellipse(158, 193, 72, 20, -0.1, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#eed8a5";
    g.beginPath();
    g.arc(125, 151, 47, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#465c67";
    g.beginPath();
    g.ellipse(371, 195, 66, 18, -0.1, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#abc5c2";
    g.beginPath();
    g.arc(337, 151, 47, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#4b5d52";
    g.font = "18px sans-serif";
    g.fillText("Свет и тень · синтетический этюд", 28, 32);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.getByLabel("Добавить изображение").setInputFiles({
    name: "study.png",
    mimeType: "image/png",
    buffer: Buffer.from(syntheticImage, "base64"),
  });
  await expect(page.locator(".note-image img")).toBeVisible();
  await expect(page.getByTestId("save-status")).toHaveText("Сохранено");
  await page.locator(".tiptap").press("Control+End");
  await page.locator(".tiptap").pressSequentially(" Последняя мысль.");
  await page
    .getByRole("button", { name: "Новая заметка", exact: true })
    .click();
  await page.getByLabel("Заголовок заметки").fill("Вторая заметка");
  await page.locator(".tiptap").fill("Другой вопрос");
  await page
    .getByRole("button", { name: "Наблюдение света", exact: true })
    .click();
  await expect(page.locator(".tiptap")).toContainText("Последняя мысль");
  await page.getByRole("button", { name: "Оформление и перенос" }).click();
  await page
    .getByRole("button", { name: "Снять с карты", exact: true })
    .click();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "0",
  );
  await page.reload();
  await page.getByRole("button", { name: "Библиотека", exact: true }).click();
  await page.getByLabel("Поиск материалов").fill("холодные");
  await page
    .getByRole("button", { name: "Наблюдение света", exact: true })
    .click();
  await expect(page.locator(".note-image img")).toBeVisible();
  await expect(
    page.getByText("Здание снято с карты", { exact: true }),
  ).toBeVisible();
  expect(
    JSON.stringify((await rows<Note>(page, "notes"))[0].doc),
  ).not.toContain("blob:");
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: path.join(evidence, "notes-and-image.png") });
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Экспортировать город", exact: true })
    .click();
  const download = await downloadPromise;
  const archivePath = testInfo.outputPath("city.progresscity.zip");
  await download.saveAs(archivePath);
  const originalNotes = await rows<Note>(page, "notes");
  const context = await browser.newContext();
  const target = await context.newPage();
  try {
    await target.goto("/");
    await target
      .getByText("Уже есть город? Восстановить архив", { exact: true })
      .click();
    await target
      .getByLabel("Архив для восстановления")
      .setInputFiles(archivePath);
    await expect(target.getByRole("alertdialog")).toContainText(
      "Архив проверен",
    );
    await target
      .getByRole("button", { name: "Восстановить город", exact: true })
      .click();
    await target
      .getByRole("button", { name: "Библиотека", exact: true })
      .click();
    await target
      .getByRole("button", { name: "Наблюдение света", exact: true })
      .click();
    await expect(target.locator(".note-image img")).toBeVisible();
    expect(
      await target
        .locator(".note-image img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    ).toBe(480);
    expect(await rows<Note>(target, "notes")).toEqual(originalNotes);
    expect(await rows<Attachment>(target, "attachments")).toHaveLength(1);
  } finally {
    await context.close();
  }
  await page.getByLabel("Архив для восстановления").setInputFiles({
    name: "broken.progresscity.zip",
    mimeType: "application/zip",
    buffer: Buffer.from("broken"),
  });
  await expect(page.getByRole("alert")).toContainText("архив");
  expect(await rows<Note>(page, "notes")).toEqual(originalNotes);
  expect(errors).toEqual([]);
});

test("habit daily reward and rule changes remain idempotent in two real tabs", async ({
  page,
  context,
}) => {
  await createCity(page);
  await page.getByRole("button", { name: "Новое направление" }).click();
  await page.getByLabel("Название направления").fill("Меньше скроллинга");
  await page.getByLabel("Тип направления").selectOption("reduce");
  await page.getByLabel("Моя цель").fill("Не больше двадцати минут");
  await page.getByLabel("Граница", { exact: true }).fill("20");
  await page.getByLabel("Единица", { exact: true }).fill("мин");
  await page
    .getByRole("button", { name: "Создать направление", exact: true })
    .click();
  await page.getByRole("button", { name: "Результаты", exact: true }).click();
  await page.getByLabel("Название результата").fill("Прогулка вместо телефона");
  await page.getByLabel("Что получилось").fill("Выбрал прогулку");
  await page.getByLabel("Я считаю свою цель выполненной").check();
  await page.getByLabel("Тип результата").selectOption("apply");
  await page
    .getByRole("button", { name: "Сохранить черновик", exact: true })
    .click();
  const second = await context.newPage();
  await second.goto("/");
  await second
    .getByRole("button", { name: "Меньше скроллинга", exact: true })
    .click();
  await second.getByRole("button", { name: "Результаты", exact: true }).click();
  await second
    .getByRole("button", { name: /Прогулка вместо телефона/ })
    .click();
  await Promise.all([
    page
      .getByRole("button", { name: "Подтвердить результат", exact: true })
      .click(),
    second
      .getByRole("button", { name: "Подтвердить результат", exact: true })
      .click(),
  ]);
  await expect(page.getByTestId("balance")).toContainText("3");
  expect(
    (await rows<ProgressEvent>(page, "events")).filter(
      (e) => e.type === "activity",
    ),
  ).toHaveLength(1);
  await page.getByRole("button", { name: "Новая запись", exact: true }).click();
  await page.getByLabel("Название результата").fill("Ещё одна отметка");
  await page.getByLabel("Что получилось").fill("Честное дополнение");
  await page.getByLabel("Я считаю свою цель выполненной").check();
  await page
    .getByRole("button", { name: "Подтвердить результат", exact: true })
    .click();
  expect(
    (await rows<Track>(page, "tracks")).find((t) => t.type === "reduce")
      ?.balance,
  ).toBe(3);
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.getByLabel("Применение", { exact: true }).fill("7");
  await page
    .getByRole("button", { name: "Сохранить правила", exact: true })
    .click();
  expect(
    (await rows<ProgressEvent>(page, "events")).filter(
      (e) => e.type === "activity",
    )[0],
  ).toMatchObject({ amount: 3, ruleVersion: 1 });
  expect(
    (await rows<Activity>(page, "activities")).filter((a) => a.confirmed),
  ).toHaveLength(2);
  await second.close();
});

test("district editing and small viewport do not overflow", async ({
  page,
}) => {
  await createCity(page);
  await page.getByRole("button", { name: "Районы", exact: true }).click();
  await page.getByLabel("Имя района").fill("Творческая сторона");
  await page
    .getByRole("button", { name: "Сохранить район", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Творческая сторона/ })
    .first()
    .click();
  await page.getByLabel("Ширина", { exact: true }).fill("12");
  await page
    .getByRole("button", { name: "Сохранить район", exact: true })
    .click();
  await expect(page.getByText(/12 × 10/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Закрыть панель" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: path.join(evidence, "small-screen.png") });
});
