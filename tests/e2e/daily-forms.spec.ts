import { test, expect } from "@playwright/test";
import { createCity, rows } from "./helpers";
import { failWrites, restoreWrites } from "./daily-helpers";
import { readFile } from "node:fs/promises";
import type {
  Activity,
  LearningObject,
  Note,
  Track,
} from "../../src/domain/model";

test("daily forms: a question and note share safe save, stay and discard navigation", async ({
  page,
}) => {
  await createCity(page, "Свет");
  await page.getByRole("button", { name: "Свет", exact: true }).click();
  await page
    .getByRole("button", { name: "Новая заметка", exact: true })
    .click();
  await page.locator(".tiptap").fill("Заметка перед вопросом");
  await page
    .getByText("Вопрос и название исследования", { exact: true })
    .click();
  const question = page
    .locator(".research-details")
    .getByRole("textbox", { name: "Следующий вопрос", exact: true });
  await question.fill("Незавершённый вопрос");
  await page.getByRole("button", { name: "Библиотека", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Незавершённые формы" });
  await expect(dialog).toBeVisible();
  expect((await rows<Note>(page, "notes"))[0].text).toBe(
    "Заметка перед вопросом",
  );
  await dialog.getByRole("button", { name: "Остаться", exact: true }).click();
  await expect(question).toHaveValue("Незавершённый вопрос");
  await page.getByRole("button", { name: "Библиотека", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Сохранить и продолжить", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Библиотека", exact: true }),
  ).toBeVisible();
  expect(
    (await rows<LearningObject>(page, "learningObjects"))[0].nextQuestion,
  ).toBe("Незавершённый вопрос");
  await page.getByRole("button", { name: "Свет", exact: true }).click();
  await page
    .getByText("Вопрос и название исследования", { exact: true })
    .click();
  await question.fill("Этот вариант отброшен");
  await page.getByRole("button", { name: "История", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Не сохранять", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "История города", exact: true }),
  ).toBeVisible();
  expect(
    (await rows<LearningObject>(page, "learningObjects"))[0].nextQuestion,
  ).toBe("Незавершённый вопрос");
  expect((await rows<Track>(page, "tracks"))[0].balance).toBe(0);
});

test("daily forms: partial save reports the failed participant and retry never confirms a draft", async ({
  page,
}) => {
  await createCity(page, "Свет");
  await page.getByRole("button", { name: "Свет", exact: true }).click();
  await page.getByRole("button", { name: "Результаты", exact: true }).click();
  await page
    .getByText("Вопрос и название исследования", { exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Следующий вопрос", exact: true })
    .fill("Сохранить отдельно");
  await page.getByLabel("Название результата", { exact: true }).fill("Опыт");
  await page
    .getByLabel("Что получилось", { exact: true })
    .fill("Локальный вывод");
  await failWrites(page, "activities");
  await page.getByRole("button", { name: "Библиотека", exact: true }).click();
  await page
    .getByRole("button", { name: "Сохранить и продолжить", exact: true })
    .click();
  await expect(page.locator(".error-banner")).toContainText(
    "Сохранено: Исследование",
  );
  await expect(page.locator(".error-banner")).toContainText(
    "Не сохранено: Результат",
  );
  await expect(
    page.getByRole("textbox", { name: "Что получилось", exact: true }),
  ).toHaveValue("Локальный вывод");
  expect(
    (await rows<LearningObject>(page, "learningObjects"))[0].nextQuestion,
  ).toBe("Сохранить отдельно");
  expect(await rows(page, "activities")).toHaveLength(0);
  await restoreWrites(page);
  await page.getByRole("button", { name: "Библиотека", exact: true }).click();
  await page
    .getByRole("button", { name: "Сохранить и продолжить", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Библиотека", exact: true }),
  ).toBeVisible();
  expect((await rows<Activity>(page, "activities"))[0].confirmed).toBe(false);
  expect(await rows(page, "events")).toHaveLength(0);
});

test("daily forms: import with the same IDs retains old question text without writing it to the new city", async ({
  page,
  context,
}) => {
  await createCity(page, "Свет");
  await page.getByRole("button", { name: "Свет", exact: true }).click();
  await page
    .getByText("Вопрос и название исследования", { exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Следующий вопрос", exact: true })
    .fill("Вопрос прежнего города");
  const peer = await context.newPage();
  await peer.goto("/");
  await peer.getByRole("button", { name: "Настройки", exact: true }).click();
  const download = peer.waitForEvent("download");
  await peer
    .getByRole("button", { name: "Экспортировать город", exact: true })
    .click();
  const zip = await readFile((await (await download).path())!);
  await peer.getByLabel("Архив для восстановления").setInputFiles({
    name: "synthetic.zip",
    mimeType: "application/zip",
    buffer: zip,
  });
  await peer
    .getByRole("button", { name: "Заменить текущий город", exact: true })
    .click();
  const recovery = page.getByRole("complementary", {
    name: "Сохранённые тексты незавершённых форм",
  });
  await expect(recovery).toBeVisible();
  await recovery.locator("summary").click();
  await expect(recovery.getByRole("textbox")).toContainText(
    "Вопрос прежнего города",
  );
  expect(
    (await rows<LearningObject>(page, "learningObjects"))[0].nextQuestion,
  ).toBe("");
  const textDownload = page.waitForEvent("download");
  await recovery.getByRole("button", { name: "Скачать текст" }).click();
  expect(
    await readFile((await (await textDownload).path())!, "utf8"),
  ).toContain("Вопрос прежнего города");
  await peer.close();
});

test("daily forms: leaving a result saves a draft without confirmation and warns before unload", async ({
  page,
}) => {
  await createCity(page, "Свет");
  await page.getByRole("button", { name: "Свет", exact: true }).click();
  await page.getByRole("button", { name: "Результаты", exact: true }).click();
  await page
    .getByLabel("Название результата", { exact: true })
    .fill("Черновой опыт");
  await page
    .getByLabel("Что получилось", { exact: true })
    .fill("Пока проверяю предположение");
  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(true);
  await page.getByRole("button", { name: "Библиотека", exact: true }).click();
  await page
    .getByRole("button", { name: "Сохранить и продолжить", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Библиотека", exact: true }),
  ).toBeVisible();
  const activity = (await rows<Activity>(page, "activities"))[0];
  expect(activity.confirmed).toBe(false);
  expect(activity.result).toContain("предположение");
  expect((await rows<Track>(page, "tracks"))[0].balance).toBe(0);
  expect(await rows(page, "events")).toHaveLength(0);
});

test("daily forms: archiving then editing your own confirmed record is not a cross-tab conflict", async ({
  page,
}) => {
  await createCity(page, "Свет");
  await page.getByRole("button", { name: "Свет", exact: true }).click();
  await page.getByRole("button", { name: "Результаты", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Название результата", exact: true })
    .fill("Опыт");
  await page
    .getByRole("textbox", { name: "Что получилось", exact: true })
    .fill("Первый вывод");
  await page
    .getByRole("button", { name: "Подтвердить результат", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Подтверждённая запись", exact: true }),
  ).toBeVisible();
  const events = await rows(page, "events");
  await page
    .getByRole("button", { name: "Архивировать запись", exact: true })
    .click();
  await expect
    .poll(async () => (await rows<Activity>(page, "activities"))[0].archived)
    .toBe(true);
  await page
    .getByRole("textbox", { name: "Что получилось", exact: true })
    .fill("Вывод после архивации");
  await page
    .getByRole("button", { name: "Сохранить дополнение", exact: true })
    .click();
  await expect
    .poll(async () => (await rows<Activity>(page, "activities"))[0].result)
    .toBe("Вывод после архивации");
  expect(await rows(page, "events")).toEqual(events);
  await expect(page.locator(".error-banner")).toHaveCount(0);
});
