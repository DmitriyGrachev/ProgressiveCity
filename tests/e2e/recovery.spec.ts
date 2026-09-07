import { test, expect } from "@playwright/test";
import { createCity, rows } from "./helpers";
import type { Note } from "../../src/domain/model";

test("conflicting tabs retain both drafts and copy recovery releases navigation", async ({
  page,
  context,
}) => {
  await createCity(page);
  await page.getByRole("button", { name: "Акварель", exact: true }).click();
  await page
    .getByRole("button", { name: "Новая заметка", exact: true })
    .click();
  await page.getByLabel("Заголовок заметки").fill("Общий материал");
  await page.locator(".tiptap").fill("Исходный текст");
  await page
    .getByRole("button", { name: "Сохранить заметку", exact: true })
    .click();
  await expect(page.getByTestId("save-status")).toHaveText("Сохранено");
  const second = await context.newPage();
  await second.goto("/");
  await second.getByRole("button", { name: "Библиотека", exact: true }).click();
  await second
    .getByRole("button", { name: "Общий материал", exact: true })
    .click();
  await page.locator(".tiptap").fill("Версия первой вкладки");
  await page
    .getByRole("button", { name: "Сохранить заметку", exact: true })
    .click();
  await expect(page.getByTestId("save-status")).toHaveText("Сохранено");
  await second.locator(".tiptap").fill("Версия второй вкладки");
  await second
    .getByRole("button", { name: "Сохранить заметку", exact: true })
    .click();
  await expect(second.getByTestId("save-status")).toContainText("Ошибка");
  await second
    .getByRole("button", { name: "Сохранить отдельную копию", exact: true })
    .click();
  await expect(second.getByLabel("Заголовок заметки")).toHaveValue(
    "Общий материал (копия)",
  );
  await second.getByRole("button", { name: "История", exact: true }).click();
  await expect(
    second.getByRole("heading", { name: "История города", exact: true }),
  ).toBeVisible();
  const notes = await rows<Note>(page, "notes");
  expect(notes.map((n) => n.text).sort()).toEqual([
    "Версия второй вкладки",
    "Версия первой вкладки",
  ]);
  await second.close();
});

test("real IndexedDB write failure keeps the editable draft, blocks navigation and permits retry", async ({
  page,
}) => {
  await createCity(page);
  await page.getByRole("button", { name: "Акварель", exact: true }).click();
  await page
    .getByRole("button", { name: "Новая заметка", exact: true })
    .click();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    Object.defineProperty(window, "restoreNoteWrites", {
      configurable: true,
      value: () => {
        IDBObjectStore.prototype.put = original;
      },
    });
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === "notes")
        throw new DOMException("Synthetic write failure", "QuotaExceededError");
      return original.call(this, value, key);
    };
  });
  await page.locator(".tiptap").fill("Черновик при ошибке записи");
  await page
    .getByRole("button", { name: "Сохранить заметку", exact: true })
    .click();
  await expect(page.getByTestId("save-status")).toContainText("Ошибка");
  await page.getByRole("button", { name: "История", exact: true }).click();
  await expect(page.locator(".tiptap")).toContainText(
    "Черновик при ошибке записи",
  );
  expect((await rows<Note>(page, "notes"))[0].text).toBe("");
  await page.evaluate(() => {
    (
      window as unknown as { restoreNoteWrites: () => void }
    ).restoreNoteWrites();
  });
  await page
    .getByRole("button", { name: "Сохранить заметку", exact: true })
    .click();
  await expect(page.getByTestId("save-status")).toHaveText("Сохранено");
  expect((await rows<Note>(page, "notes"))[0].text).toBe(
    "Черновик при ошибке записи",
  );
});
