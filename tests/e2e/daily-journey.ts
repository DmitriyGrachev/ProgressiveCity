import { expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
export async function importDailyFixture(page: Page) {
  await page.goto("/");
  await page
    .getByText("Уже есть город? Восстановить архив", { exact: true })
    .click();
  await page.getByLabel("Архив для восстановления").setInputFiles({
    name: "previous-v2.progresscity.zip",
    mimeType: "application/zip",
    buffer: await readFile(".tools/daily-legacy-v2.progresscity.zip"),
  });
  await page
    .getByRole("button", { name: "Восстановить город", exact: true })
    .click();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "1",
  );
}
/** Public controls only: shared by preview and the actual Windows prepared server. */
export async function dailyJourney(page: Page) {
  await page
    .getByRole("button", { name: "Найти в городе", exact: true })
    .click();
  const search = page.getByRole("dialog", {
    name: "Найти в городе",
    exact: true,
  });
  await search.getByRole("searchbox").fill("Спектр");
  await expect(search.getByRole("option").first()).toContainText(
    "Исследование",
  );
  await search
    .getByRole("button", { name: "Продолжить исследование", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Заголовок заметки", exact: true }),
  ).toHaveValue("Спектр света");
  await expect(page.locator(".note-image img")).toHaveCount(1);
  // Keep the existing image while appending text through the editor.
  await page.locator(".tiptap").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("Продолжение сегодняшней работы");
  await page
    .getByRole("button", { name: "Зафиксировать результат", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Что получилось", exact: true })
    .fill("Разделил белый свет на цвета");
  await page.getByLabel("Тип результата").selectOption("verify");
  await page
    .getByRole("button", { name: "Подтвердить результат", exact: true })
    .click();
  await expect(
    page.getByText("Результат подтверждён.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("textbox", {
      name: "Следующий вопрос после результата",
      exact: true,
    })
    .fill("Как изменится спектр через воду?");
  await page
    .getByRole("button", { name: "Вернуться в город", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Сохранить и продолжить", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Отметить «Прогулка»", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Что получилось", exact: true })
    .fill("Прогулялся по парку");
  await page
    .getByRole("spinbutton", { name: "Значение (минут)", exact: true })
    .fill("15");
  await page.getByLabel("Я считаю свою цель выполненной").check();
  await page
    .getByRole("button", { name: "Подтвердить результат", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Подтверждённая запись", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Закрыть панель", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Привычки сегодня", exact: true }),
  ).toContainText("Подтверждено с наградой");
  await page
    .getByRole("button", { name: "Найти в городе", exact: true })
    .click();
  await search.getByRole("searchbox").fill("Спектр");
  await search
    .getByRole("button", { name: "Продолжить исследование", exact: true })
    .click();
  const materials = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: "Выгрузить материалы исследования",
      exact: true,
    })
    .click();
  const files = unzipSync(await readFile((await (await materials).path())!));
  expect(strFromU8(files["README.md"])).toContain(
    "Как изменится спектр через воду?",
  );
  expect(
    Object.keys(files).filter((p) => p.startsWith("images/")),
  ).toHaveLength(1);
  await page
    .getByRole("button", { name: "Вернуться в город", exact: true })
    .click();
  await page.getByText("Копия и проверка архива", { exact: true }).click();
  const backup = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Скачать полную копию", exact: true })
    .click();
  const zip = await readFile((await (await backup).path())!);
  await page
    .getByLabel("Проверить архив без замены", { exact: true })
    .setInputFiles({
      name: "daily.zip",
      mimeType: "application/zip",
      buffer: zip,
    });
  await expect(
    page.getByRole("status", {
      name: "Результат проверки архива",
      exact: true,
    }),
  ).toContainText("Текущий город не заменён");
  return zip;
}
