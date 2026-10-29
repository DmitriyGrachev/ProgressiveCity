import { test, expect } from "@playwright/test";
import { createCity, rows } from "./helpers";
import type { Note, Track } from "../../src/domain/model";
import { failWrites, restoreWrites } from "./daily-helpers";
test("quick search keeps one editor, keyboard focus and safely opens a saved material", async ({
  page,
}) => {
  await createCity(page, "Свет");
  await page.getByRole("button", { name: "Свет", exact: true }).click();
  await page
    .getByRole("button", { name: "Новая заметка", exact: true })
    .click();
  await page
    .getByLabel("Заголовок заметки", { exact: true })
    .fill("Мой спектр");
  await page.locator(".tiptap").fill("Запись для поиска");
  await page.evaluate(async () => {
    const path = "/src/city/engine.ts";
    const { CityEngine } = (await import(
      path
    )) as typeof import("../../src/city/engine");
    const original = CityEngine.prototype.update;
    Object.assign(window, { dailySceneUpdates: 0 });
    CityEngine.prototype.update = function (...args) {
      (window as unknown as { dailySceneUpdates: number }).dailySceneUpdates++;
      return original.apply(this, args);
    };
  });
  await page
    .locator(".tiptap")
    .evaluate((el) => Object.assign(window, { dailyEditor: el }));
  await page
    .getByRole("button", { name: "Найти в городе", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Найти в городе",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Найти в городе", exact: true }),
  ).toBeFocused();
  expect(
    await page
      .locator(".tiptap")
      .evaluate(
        (el) =>
          el === (window as unknown as { dailyEditor: Element }).dailyEditor,
      ),
  ).toBe(true);
  await page.keyboard.press("Control+k");
  await dialog.getByRole("searchbox").fill("спектр");
  await expect(dialog.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Заголовок заметки", exact: true }),
  ).toHaveValue("Мой спектр");
  expect(await rows<Note>(page, "notes")).toHaveLength(1);
  expect((await rows<Track>(page, "tracks"))[0].balance).toBe(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { dailySceneUpdates: number }).dailySceneUpdates,
    ),
  ).toBe(0);
  await expect(page.locator("canvas")).toHaveCount(1);
});

test("search respects archives, unbuilt research, editor shortcuts and failed writes", async ({
  page,
}) => {
  await createCity(page, "Свет");
  await page.evaluate(async () => {
    const path = "/src/storage/service.ts";
    const { service } = (await import(
      path
    )) as typeof import("../../src/storage/service");
    const track = (await service.db.tracks.toArray())[0];
    const object = await service.createLearningObject(
      track.id,
      "Spectrum без здания",
    );
    const note = await service.createNote(track.id, object.id);
    await service.saveNote({
      ...note,
      title: "Архивный спектр",
      tags: ["light-tag"],
    });
    await service.updateTrack({ ...track, archived: true });
  });
  const open = page.getByRole("button", {
    name: "Найти в городе",
    exact: true,
  });
  await open.click();
  const search = page.getByRole("dialog", {
    name: "Найти в городе",
    exact: true,
  });
  await search.getByRole("searchbox").fill("light-tag");
  await expect(search.getByRole("option")).toHaveCount(0);
  await search.getByLabel("Включая архивные направления").check();
  await expect(search.getByRole("option")).toHaveCount(1);
  await expect(search).toContainText("Постройки нет на карте");
  await expect(
    search.getByRole("button", {
      name: "Продолжить исследование",
      exact: true,
    }),
  ).toHaveCount(0);
  await search
    .getByRole("button", { name: "Открыть материал", exact: true })
    .click();
  await page.locator(".tiptap").focus();
  await page.keyboard.press("Control+k");
  await expect(search).not.toBeVisible();
  await failWrites(page, "notes");
  await page.locator(".tiptap").fill("Не потерять при поиске");
  await open.click();
  await search.getByRole("searchbox").fill("Spectrum");
  await search
    .getByRole("button", { name: "Открыть исследование", exact: true })
    .click();
  await expect(page.getByTestId("save-status")).toContainText("Ошибка");
  await expect(page.locator(".tiptap")).toHaveText("Не потерять при поиске");
  await restoreWrites(page);
  await open.click();
  await search
    .getByRole("button", { name: "Открыть исследование", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Учебный объект", exact: true }),
  ).toHaveValue(
    (await rows<{ id: string; name: string }>(page, "learningObjects")).find(
      (o) => o.name === "Spectrum без здания",
    )!.id,
  );
  expect((await rows<Note>(page, "notes"))[0].text).toBe(
    "Не потерять при поиске",
  );
  expect((await rows<Track>(page, "tracks"))[0].archived).toBe(true);
});

test("today keeps an open date across midnight and timezone changes; two tabs and retry grant once", async ({
  page,
  context,
}) => {
  await page.clock.install({ time: new Date("2026-10-04T20:59:00Z") });
  await createCity(page);
  await page.evaluate(async () => {
    const path = "/src/storage/service.ts";
    const { service } = (await import(
      path
    )) as typeof import("../../src/storage/service");
    await service.updateSettings({
      name: "Город открытий",
      timezone: "Europe/Chisinau",
      reducedMotion: false,
    });
    await service.createTrack({
      name: "Меньше экранов",
      type: "reduce",
      description: "",
      goal: "Отложить телефон",
      schedule: "Вечером",
      unit: "минут",
      comparison: "max",
      limit: 60,
    });
  });
  await page
    .getByRole("button", { name: "Отметить «Меньше экранов»", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Что получилось", exact: true })
    .fill("Отложил телефон");
  await page.getByLabel("Я считаю свою цель выполненной").check();
  await page.clock.fastForward(120000);
  await page
    .getByRole("button", { name: "Подробная запись", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Дата результата", exact: true }),
  ).toHaveValue("2026-10-04");
  await expect(
    page.getByText("Открыта запись за", { exact: false }),
  ).toContainText("2026-10-05");
  const peer = await context.newPage();
  await peer.goto("/");
  await peer.getByRole("button", { name: "Настройки", exact: true }).click();
  await peer.getByLabel("Часовой пояс", { exact: true }).fill("UTC");
  await peer
    .getByRole("button", { name: "Сохранить настройки", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Сохранить черновик", exact: true })
    .click();
  const initial = (
    await rows<{ timezone: string; date: string }>(page, "activities")
  )[0];
  expect(initial).toMatchObject({
    timezone: "Europe/Chisinau",
    date: "2026-10-04",
  });
  await peer
    .getByRole("button", { name: "Progress City", exact: true })
    .click();
  await peer
    .getByRole("button", { name: "Открыть «Меньше экранов»", exact: true })
    .click();
  await failWrites(page, "events");
  await page
    .getByRole("button", { name: "Подтвердить результат", exact: true })
    .click();
  await expect(page.locator(".error-banner")).toContainText(
    "Synthetic write failure",
  );
  expect(await rows(page, "events")).toHaveLength(0);
  await restoreWrites(page);
  await Promise.all([
    page
      .getByRole("button", { name: "Подтвердить результат", exact: true })
      .click(),
    peer
      .getByRole("button", { name: "Подтвердить результат", exact: true })
      .click(),
  ]);
  await expect.poll(async () => (await rows(page, "events")).length).toBe(1);
  expect(
    (await rows<Track>(page, "tracks")).find(
      (t) => t.name === "Меньше экранов",
    )!.balance,
  ).toBe(1);
  await peer.close();
});
test("today opens a real habit draft, zero confirmation cannot be rewarded again", async ({
  page,
}) => {
  await createCity(page);
  await page.evaluate(async () => {
    const path = "/src/storage/service.ts";
    const { service } = (await import(
      path
    )) as typeof import("../../src/storage/service");
    await service.createTrack({
      name: "Прогулка",
      type: "habit",
      description: "",
      goal: "Выйти на воздух",
      schedule: "По возможности",
      unit: "минут",
      comparison: "min",
    });
  });
  const today = page.getByRole("region", {
    name: "Привычки сегодня",
    exact: true,
  });
  await expect(today).toContainText("Нет записи");
  await today
    .getByRole("button", { name: "Отметить «Прогулка»", exact: true })
    .click();
  await page
    .getByLabel("Что получилось", { exact: true })
    .fill("Сегодня только наблюдение");
  await page
    .getByRole("button", { name: "Сохранить черновик", exact: true })
    .click();
  expect(await rows(page, "events")).toHaveLength(0);
  await page
    .getByRole("button", { name: "Подтвердить результат", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Подтверждённая запись" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Закрыть панель", exact: true })
    .click();
  await expect(today).toContainText("Подтверждено без награды");
  await today
    .getByRole("button", { name: "Открыть «Прогулка»", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Подтвердить результат", exact: true }),
  ).toBeDisabled();
  expect(await rows(page, "events")).toHaveLength(1);
  expect(
    (await rows<Track>(page, "tracks")).find((t) => t.name === "Прогулка")!
      .balance,
  ).toBe(0);
});
