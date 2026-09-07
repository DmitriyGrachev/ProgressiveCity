import { test, expect } from "@playwright/test";
test("city, material, result, improvement and reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Название города").fill("Город открытий");
  await page.getByLabel("Первое направление").fill("Акварель");
  await page
    .getByRole("button", { name: "Создать город", exact: true })
    .click();
  await expect(page.locator("canvas")).toBeVisible();
  await page.getByRole("button", { name: "Акварель", exact: true }).click();
  await page
    .getByRole("button", { name: "Новая заметка", exact: true })
    .click();
  await page.getByLabel("Заголовок заметки").fill("Свет и тень");
  await page
    .locator(".tiptap")
    .fill("Сохраняю собственный эксперимент с акварелью.");
  await page
    .getByRole("button", { name: "Сохранить заметку", exact: true })
    .click();
  await expect(page.getByTestId("save-status")).toHaveText("Сохранено");
  await page.getByRole("button", { name: "Результаты", exact: true }).click();
  await page.getByLabel("Название результата").fill("Этюд");
  await page
    .getByLabel("Что получилось")
    .fill("Применил светотень в самостоятельном этюде");
  await page.getByLabel("Тип результата").selectOption("apply");
  await page
    .getByRole("button", { name: "Подтвердить результат", exact: true })
    .click();
  await expect(page.getByTestId("balance")).toContainText("3");
  await page.getByRole("button", { name: "Улучшить", exact: true }).click();
  await expect(page.getByTestId("stage")).toContainText("2");
  await page.reload();
  await page.getByRole("button", { name: "Библиотека", exact: true }).click();
  await page.getByLabel("Поиск материалов").fill("акварелью");
  await page.getByRole("button", { name: "Свет и тень", exact: true }).click();
  await expect(page.locator(".tiptap")).toContainText("эксперимент");
  expect(errors).toEqual([]);
});
