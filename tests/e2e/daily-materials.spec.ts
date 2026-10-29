import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import { createCity, rows } from "./helpers";
import { failWrites, restoreWrites } from "./daily-helpers";
import type { Note } from "../../src/domain/model";
test("materials export flushes the note, rejects stale saves and leaves a readable independent package", async ({
  page,
}) => {
  await createCity(page, "Свет");
  await page.getByRole("button", { name: "Свет", exact: true }).click();
  await page
    .getByRole("button", { name: "Новая заметка", exact: true })
    .click();
  await page
    .getByLabel("Заголовок заметки", { exact: true })
    .fill("Читаемый материал");
  await page.locator(".tiptap").fill("Последняя редакция");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Выгрузить заметку", exact: true })
    .click();
  const zip = await download;
  expect(zip.suggestedFilename()).toContain(".materials.zip");
  const files = unzipSync(await readFile((await zip.path())!));
  expect(
    strFromU8(files[Object.keys(files).find((p) => p.startsWith("notes/"))!]),
  ).toContain("Последняя редакция");
  await expect(
    page.getByText("Пакет материалов передан браузеру", { exact: false }),
  ).toBeVisible();
  const before = await rows<Note>(page, "notes");
  await failWrites(page, "notes");
  let count = 0;
  page.on("download", () => count++);
  await page.locator(".tiptap").fill("Нельзя выдать старое за новое");
  await page
    .getByRole("button", { name: "Выгрузить заметку", exact: true })
    .click();
  await expect(page.getByTestId("save-status")).toContainText("Ошибка");
  expect(count).toBe(0);
  expect(await rows<Note>(page, "notes")).toEqual(before);
  await restoreWrites(page);
  const researchDownload = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: "Выгрузить материалы исследования",
      exact: true,
    })
    .click();
  expect((await researchDownload).suggestedFilename()).toContain(
    ".materials.zip",
  );
  expect((await rows<Note>(page, "notes"))[0].text).toBe(
    "Нельзя выдать старое за новое",
  );
});

test("quick backup verifies a file without replacing the current city and rejects materials as a city", async ({
  page,
}) => {
  await createCity(page, "Копия");
  await page.getByText("Копия и проверка архива", { exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Скачать полную копию", exact: true })
    .click();
  const zip = await readFile((await (await downloading).path())!);
  const before = await rows(page, "metadata");
  await page
    .getByLabel("Проверить архив без замены", { exact: true })
    .setInputFiles({
      name: "city.zip",
      mimeType: "application/zip",
      buffer: zip,
    });
  await expect(
    page.getByRole("status", {
      name: "Результат проверки архива",
      exact: true,
    }),
  ).toContainText("Текущий город не заменён");
  expect(await rows(page, "metadata")).toEqual(before);
  await page.getByRole("button", { name: "Копия", exact: true }).click();
  const material = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: "Выгрузить материалы исследования",
      exact: true,
    })
    .click();
  const empty = await readFile((await (await material).path())!);
  expect(Object.keys(unzipSync(empty))).toEqual(["README.md"]);
  await page
    .getByLabel("Проверить архив без замены", { exact: true })
    .setInputFiles({
      name: "read.materials.zip",
      mimeType: "application/zip",
      buffer: empty,
    });
  await expect(page.locator(".error-banner")).toBeVisible();
  expect(await rows(page, "metadata")).toEqual(before);
});
