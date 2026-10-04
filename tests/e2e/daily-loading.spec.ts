import { test, expect } from "@playwright/test";
import { createCity, rows } from "./helpers";
import type { Note } from "../../src/domain/model";
test("optional editor loading can fail and retry without reloading the city", async ({
  page,
}) => {
  await createCity(page, "Свет");
  let failures = 0;
  await page.route(
    /\/(?:src\/notes\/NoteEditor\.tsx|assets\/NoteEditor-[^/]+\.js)(?:\?.*)?$/,
    async (route) => {
      failures++;
      await route.abort("failed");
    },
  );
  await page.getByRole("button", { name: "Свет", exact: true }).click();
  await page
    .getByRole("button", { name: "Новая заметка", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Повторить загрузку редактора",
      exact: true,
    }),
  ).toBeVisible();
  expect(failures).toBeGreaterThan(0);
  expect(await rows(page, "notes")).toHaveLength(1);
  const camera = await page.locator("canvas").getAttribute("data-camera");
  await page.unroute(
    /\/(?:src\/notes\/NoteEditor\.tsx|assets\/NoteEditor-[^/]+\.js)(?:\?.*)?$/,
  );
  await page
    .getByRole("button", { name: "Повторить загрузку редактора", exact: true })
    .click();
  await expect(page.locator(".tiptap")).toBeVisible();
  await expect(page.locator("canvas")).toHaveAttribute("data-camera", camera!);
  expect(await rows(page, "notes")).toHaveLength(1);
});

test("optional materials loading retries while preserving the active editor and text", async ({
  page,
}) => {
  await createCity(page, "Свет");
  await page.getByRole("button", { name: "Свет", exact: true }).click();
  await page
    .getByRole("button", { name: "Новая заметка", exact: true })
    .click();
  await page.locator(".tiptap").fill("Работа во время отказа модуля");
  await page
    .locator(".tiptap")
    .evaluate((el) => Object.assign(window, { activeDailyEditor: el }));
  const moduleURL =
    /\/(?:src\/storage\/materials\.ts|assets\/materials-[^/]+\.js)(?:\?.*)?$/;
  await page.route(moduleURL, (route) => route.abort("failed"));
  await page
    .getByRole("button", { name: "Выгрузить заметку", exact: true })
    .click();
  await expect(page.locator(".error-banner")).toBeVisible();
  expect(
    await page
      .locator(".tiptap")
      .evaluate(
        (el) =>
          el ===
          (window as unknown as { activeDailyEditor: Element })
            .activeDailyEditor,
      ),
  ).toBe(true);
  await page.locator(".tiptap").fill("Продолжение после отказа модуля");
  await page.unroute(moduleURL);
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Выгрузить заметку", exact: true })
    .click();
  expect((await downloading).suggestedFilename()).toContain(".materials.zip");
  const notes = await rows<Note>(page, "notes");
  expect(notes).toHaveLength(1);
  expect(notes[0].text).toBe("Продолжение после отказа модуля");
  await expect(page.locator("canvas")).toHaveCount(1);
});
