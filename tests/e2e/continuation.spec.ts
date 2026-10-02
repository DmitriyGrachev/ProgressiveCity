import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createCity, rows } from "./helpers";
import type {
  Note,
  Activity,
  LearningObject,
  Track,
} from "../../src/domain/model";

async function openWork(page: Page) {
  await createCity(page, "Свет");
  await page.getByRole("button", { name: "Свет", exact: true }).click();
  await page
    .getByRole("button", { name: "Новая заметка", exact: true })
    .click();
  await page
    .getByLabel("Заголовок заметки", { exact: true })
    .fill("Рабочий материал");
  await page.locator(".tiptap").fill("Исходный текст");
  await page.getByRole("button", { name: "Рабочий вид", exact: true }).click();
  await expect(page.locator(".work-view")).toHaveCount(1);
}
async function confirmResult(page: Page) {
  await page
    .getByRole("button", { name: "Зафиксировать результат", exact: true })
    .click();
  await page
    .getByLabel("Что получилось", { exact: true })
    .fill("Проверил гипотезу");
  await page
    .getByRole("button", { name: "Подтвердить результат", exact: true })
    .evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
  await expect(
    page.getByRole("textbox", {
      name: "Следующий вопрос после результата",
      exact: true,
    }),
  ).toBeVisible();
}
async function failWrites(page: Page, table: string) {
  await page.evaluate((table) => {
    const put = IDBObjectStore.prototype.put,
      add = IDBObjectStore.prototype.add;
    Object.assign(window, {
      restoreContinueWrites: () => {
        IDBObjectStore.prototype.put = put;
        IDBObjectStore.prototype.add = add;
      },
    });
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === table)
        throw new DOMException("Synthetic write failure", "QuotaExceededError");
      return put.call(this, value, key);
    };
    IDBObjectStore.prototype.add = function (value, key) {
      if (this.name === table)
        throw new DOMException("Synthetic write failure", "QuotaExceededError");
      return add.call(this, value, key);
    };
  }, table);
}
async function restoreWrites(page: Page) {
  await page.evaluate(() =>
    (
      window as unknown as { restoreContinueWrites(): void }
    ).restoreContinueWrites(),
  );
}
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE2cAAAAASUVORK5CYII=",
  "base64",
);

test("continue research: public city to material result next question and reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await createCity(page, "Свет");
  const resume = page.getByRole("region", { name: "Продолжить", exact: true });
  await expect(resume).toContainText("Пока нет сохранённой учебной работы");
  await page.getByRole("button", { name: "Свет", exact: true }).click();
  await page
    .getByRole("button", { name: "Новая заметка", exact: true })
    .click();
  await page
    .getByLabel("Заголовок заметки", { exact: true })
    .fill("Опыт с отражением");
  await page
    .getByRole("textbox", { name: "Текст заметки" })
    .fill("Сравнил два угла света.");
  await page
    .getByRole("button", { name: "Progress City", exact: true })
    .click();
  await expect(resume).toContainText("Сохранена заметка");
  await page
    .getByRole("button", { name: "Продолжить «Свет»", exact: true })
    .click();
  await expect(
    page.getByLabel("Заголовок заметки", { exact: true }),
  ).toHaveValue("Опыт с отражением");
  await expect(page.locator(".note-editor")).toHaveCount(1);
  const notes = await rows<Note>(page, "notes");
  await page
    .getByRole("textbox", { name: "Текст заметки" })
    .fill("Продолжил опыт: проверил отражение на третьем угле.");
  await page
    .getByRole("button", { name: "Свернуть рабочий вид", exact: true })
    .click();
  await page.getByRole("button", { name: "Рабочий вид", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Текст заметки" }),
  ).toContainText("третьем угле");
  await expect(page.locator(".note-editor")).toHaveCount(1);
  await page.screenshot({ path: "docs/review-evidence/continue-work.png" });
  await page
    .getByRole("button", { name: "Зафиксировать результат", exact: true })
    .click();
  await page
    .getByLabel("Что получилось", { exact: true })
    .fill("На третьем угле отражение сохранилось.");
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
    .fill("Что изменится на матовой поверхности?");
  await page
    .getByRole("button", { name: "Сохранить следующий вопрос", exact: true })
    .click();
  await expect(
    page.getByText("Следующий вопрос сохранён", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Подтвердить результат", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Вернуться в город", exact: true })
    .click();
  await expect(resume).toContainText("Подтверждён результат");
  await expect(resume).toContainText("матовой поверхности");
  await page.screenshot({ path: "docs/review-evidence/continue-city.png" });
  await page.reload();
  await page
    .getByRole("button", { name: "Продолжить «Свет»", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Текст заметки" }),
  ).toContainText("третьем угле");
  await expect(page.locator(".research-details")).toContainText(
    "На третьем угле отражение сохранилось.",
  );
  await expect(page.locator(".research-details")).toContainText(
    "матовой поверхности",
  );
  expect((await rows<Note>(page, "notes")).map((n) => n.id)).toEqual(
    notes.map((n) => n.id),
  );
  expect(await rows<Activity>(page, "activities")).toHaveLength(1);
  expect((await rows<Track>(page, "tracks"))[0].balance).toBe(1);
  expect(
    (await rows<LearningObject>(page, "learningObjects"))[0].nextQuestion,
  ).toBe("Что изменится на матовой поверхности?");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Вернуться в город", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "docs/review-evidence/continue-mobile.png" });
  await page.locator(".tiptap").scrollIntoViewIfNeeded();
  await expect(page.locator(".tiptap")).toBeVisible();
  const editorBounds = await page.locator(".tiptap").boundingBox();
  expect(editorBounds!.x + editorBounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "docs/review-evidence/continue-mobile-editor.png",
  });
  expect(errors).toEqual([]);
});

test("recent cards ignore archived directions and continue the correct material without a building", async ({
  page,
}) => {
  await createCity(page, "Свет");
  await page.evaluate(async () => {
    const path = "/src/storage/service.ts";
    const { service } = (await import(
      path
    )) as typeof import("../../src/storage/service");
    const initial = (await service.db.tracks.toArray())[0];
    await service.removeBuilding((await service.db.buildings.toArray())[0].id);
    for (let i = 0; i < 4; i++) {
      const t =
        i === 0
          ? initial
          : await service.createTrack({
              name: `Тема ${i}`,
              type: "skill",
              description: "",
              goal: "",
              schedule: "",
              unit: "",
              comparison: "min",
            });
      const o =
        i === 0
          ? await service.updateLearningObject({
              ...(await service.db.learningObjects.get(initial.id))!,
              name: "Исследование 0",
            })
          : await service.createLearningObject(t.id, `Исследование ${i}`);
      const n = await service.createNote(t.id, o.id);
      await service.saveNote({ ...n, title: `Материал ${i}` });
      await service.db.notes.update(n.id, {
        updatedAt: `2026-09-${27 + i}T12:00:00.000Z`,
      });
      if (i === 3) await service.updateTrack({ ...t, archived: true });
    }
  });
  const cards = page.locator(".continue-cards article");
  await expect(cards).toHaveCount(3);
  await expect(cards.locator("h3")).toHaveText([
    "Исследование 2",
    "Исследование 1",
    "Исследование 0",
  ]);
  await page.screenshot({ path: "docs/review-evidence/continue-several.png" });
  await page
    .getByRole("button", { name: "Свернуть продолжение", exact: true })
    .click();
  await expect(cards.first()).not.toBeVisible();
  await page
    .getByRole("button", { name: "Развернуть продолжение", exact: true })
    .click();
  const before = await rows<Note>(page, "notes");
  // Unbuilt research and a formerly placed workshop are both accessible.
  await page
    .getByRole("button", { name: "Продолжить «Исследование 1»", exact: true })
    .click();
  await expect(
    page.getByLabel("Заголовок заметки", { exact: true }),
  ).toHaveValue("Материал 1");
  await expect(
    page.getByRole("button", { name: "Найти на карте", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Вернуться в город", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Продолжить «Исследование 0»", exact: true })
    .click();
  await expect(
    page.getByLabel("Заголовок заметки", { exact: true }),
  ).toHaveValue("Материал 0");
  await expect(
    page.getByRole("button", { name: "Найти на карте", exact: true }),
  ).toHaveCount(0);
  expect(await rows<Note>(page, "notes")).toEqual(before);
  await page
    .getByRole("button", { name: "Новая заметка", exact: true })
    .click();
  await expect(
    page.getByLabel("Заголовок заметки", { exact: true }),
  ).toHaveValue("Без названия");
  expect(await rows<Note>(page, "notes")).toHaveLength(before.length + 1);
  await page
    .getByLabel("Заголовок заметки", { exact: true })
    .fill("Новый эксперимент");
  await page
    .getByRole("button", { name: "Вернуться в город", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Продолжить «Исследование 0»", exact: true })
    .click();
  await expect(
    page.getByLabel("Заголовок заметки", { exact: true }),
  ).toHaveValue("Новый эксперимент");
});

test("question failure and two-tab field conflict never repeat a confirmed reward", async ({
  page,
  context,
}) => {
  await openWork(page);
  await confirmResult(page);
  const activities = await rows(page, "activities"),
    events = await rows(page, "events"),
    tracks = await rows(page, "tracks");
  await failWrites(page, "learningObjects");
  await page
    .getByRole("textbox", {
      name: "Следующий вопрос после результата",
      exact: true,
    })
    .fill("Мой следующий опыт");
  await page
    .getByRole("button", { name: "Сохранить следующий вопрос", exact: true })
    .click();
  await expect(page.locator(".next-question [role=alert]")).toContainText(
    "Вопрос не сохранён",
  );
  await expect(
    page.getByText("Результат подтверждён.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Следующий вопрос сохранён", { exact: true }),
  ).toHaveCount(0);
  expect(await rows(page, "activities")).toEqual(activities);
  expect(await rows(page, "events")).toEqual(events);
  expect(await rows(page, "tracks")).toEqual(tracks);
  await restoreWrites(page);
  await page
    .getByRole("button", { name: "Сохранить следующий вопрос", exact: true })
    .click();
  await expect(
    page.getByText("Следующий вопрос сохранён", { exact: true }),
  ).toBeVisible();
  const peer = await context.newPage();
  await peer.goto("/");
  await peer
    .getByRole("button", { name: "Продолжить «Свет»", exact: true })
    .click();
  await peer
    .getByText("Вопрос и название исследования", { exact: true })
    .click();
  await peer
    .getByRole("textbox", { name: "Следующий вопрос", exact: true })
    .fill("Вопрос другой вкладки");
  await peer
    .getByRole("button", { name: "Сохранить исследование", exact: true })
    .click();
  await expect(
    peer.getByText("Исследование сохранено", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("textbox", {
      name: "Следующий вопрос после результата",
      exact: true,
    })
    .fill("Мой конфликтующий вопрос");
  await page
    .getByRole("button", { name: "Сохранить следующий вопрос", exact: true })
    .click();
  await expect(page.locator(".next-question [role=alert]")).toContainText(
    "изменено в другой вкладке",
  );
  await expect(
    page.getByRole("textbox", {
      name: "Следующий вопрос после результата",
      exact: true,
    }),
  ).toHaveValue("Мой конфликтующий вопрос");
  expect(
    (await rows<LearningObject>(page, "learningObjects"))[0].nextQuestion,
  ).toBe("Вопрос другой вкладки");
  await page
    .getByRole("button", { name: "Загрузить актуальный вопрос", exact: true })
    .click();
  await page
    .getByRole("textbox", {
      name: "Следующий вопрос после результата",
      exact: true,
    })
    .fill("Согласованный вопрос");
  await page
    .getByRole("button", { name: "Сохранить следующий вопрос", exact: true })
    .click();
  await expect(
    page.getByText("Следующий вопрос сохранён", { exact: true }),
  ).toBeVisible();
  expect(await rows(page, "events")).toEqual(events);
  expect(await rows(page, "tracks")).toEqual(tracks);
  await peer.close();
});

test("work view keeps one editor, blocks a failed save and waits for an unfinished image", async ({
  page,
}) => {
  await openWork(page);
  await page
    .locator(".tiptap")
    .evaluate((el) => Object.assign(window, { originalWorkEditor: el }));
  await failWrites(page, "notes");
  await page.locator(".tiptap").fill("Текст при отказе");
  await page
    .getByRole("button", { name: "Свернуть рабочий вид", exact: true })
    .click();
  await expect(page.getByTestId("save-status")).toContainText("Ошибка");
  await expect(page.locator(".work-view")).toHaveCount(1);
  await expect(page.locator(".tiptap")).toContainText("Текст при отказе");
  await restoreWrites(page);
  await page
    .getByRole("button", { name: "Свернуть рабочий вид", exact: true })
    .click();
  await expect(page.locator(".work-view")).toHaveCount(0);
  expect(
    await page
      .locator(".tiptap")
      .evaluate(
        (el) =>
          el ===
          (window as unknown as { originalWorkEditor: Element })
            .originalWorkEditor,
      ),
  ).toBe(true);
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      await new Promise<void>((resolve) =>
        Object.assign(window, { releaseContinueImage: resolve }),
      );
      return original.call(this);
    };
  });
  await page.getByLabel("Добавить изображение").setInputFiles({
    name: "delayed.png",
    mimeType: "image/png",
    buffer: pixel,
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof (window as unknown as { releaseContinueImage?: unknown })
            .releaseContinueImage,
      ),
    )
    .toBe("function");
  await page.getByRole("button", { name: "Рабочий вид", exact: true }).click();
  await expect(page.locator(".work-view")).toHaveCount(0);
  await page.evaluate(() =>
    (
      window as unknown as { releaseContinueImage(): void }
    ).releaseContinueImage(),
  );
  await expect(page.locator(".work-view")).toHaveCount(1);
  await expect(page.locator(".note-image img")).toHaveCount(1);
  expect(
    await page
      .locator(".tiptap")
      .evaluate(
        (el) =>
          el ===
          (window as unknown as { originalWorkEditor: Element })
            .originalWorkEditor,
      ),
  ).toBe(true);
  await page.reload();
  await page
    .getByRole("button", { name: "Продолжить «Свет»", exact: true })
    .click();
  await expect(page.locator(".note-image img")).toHaveCount(1);
  await expect(page.locator(".tiptap")).toContainText("Текст при отказе");
});

test("failed image persistence stops a work-view transition and permits retry", async ({
  page,
}) => {
  await openWork(page);
  await failWrites(page, "attachments");
  await page
    .getByLabel("Добавить изображение")
    .setInputFiles({ name: "retry.png", mimeType: "image/png", buffer: pixel });
  await expect(page.locator(".error-banner")).toContainText(
    "Synthetic write failure",
  );
  await expect(page.getByLabel("Добавить изображение")).toBeDisabled();
  await page
    .getByRole("button", { name: "Свернуть рабочий вид", exact: true })
    .click();
  await expect(page.locator(".work-view")).toHaveCount(1);
  await restoreWrites(page);
  await page
    .getByRole("button", {
      name: "Повторить загрузку изображения",
      exact: true,
    })
    .click();
  await expect(page.locator(".note-image img")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Свернуть рабочий вид", exact: true })
    .click();
  await expect(page.locator(".work-view")).toHaveCount(0);
});

test("city replacement clears work context with same IDs and retains a failed draft; A/B stays read-only", async ({
  page,
  context,
}) => {
  await openWork(page);
  const peer = await context.newPage();
  await peer.goto("/");
  await peer.getByRole("button", { name: "Настройки", exact: true }).click();
  const download = peer.waitForEvent("download");
  await peer
    .getByRole("button", { name: "Экспортировать город", exact: true })
    .click();
  const zip = await readFile((await (await download).path())!);
  await failWrites(page, "notes");
  await page.locator(".tiptap").fill("Черновик старого города");
  await page
    .getByRole("button", { name: "Сохранить заметку", exact: true })
    .click();
  await expect(page.getByTestId("save-status")).toContainText("Ошибка");
  await peer.getByLabel("Архив для восстановления").setInputFiles({
    name: "replacement.zip",
    mimeType: "application/zip",
    buffer: zip,
  });
  await peer
    .getByRole("button", { name: "Заменить текущий город", exact: true })
    .click();
  await expect(page.locator(".work-view")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Несохранённый материал", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".note-editor")).toHaveCount(0);
  expect((await rows<Note>(page, "notes"))[0].text).toBe("Исходный текст");
  await page.getByRole("button", { name: "История", exact: true }).click();
  await page
    .getByRole("button", { name: "Сравнить город", exact: true })
    .click();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-comparison-view",
    "changes",
  );
  await expect(
    page.getByRole("region", { name: "Продолжить", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Рабочий вид", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", {
      name: "Следующий вопрос после результата",
      exact: true,
    }),
  ).toHaveCount(0);
  await peer.close();
});

test("saving in the work view leaves city graphics and camera intact, and finding the building is explicit", async ({
  page,
}) => {
  await openWork(page);
  await page.evaluate(async () => {
    const path = "/src/city/engine.ts";
    const { CityEngine } = (await import(
      path
    )) as typeof import("../../src/city/engine");
    const original = CityEngine.prototype.update;
    Object.assign(window, { continueSceneUpdates: 0 });
    CityEngine.prototype.update = function (...args) {
      (window as unknown as { continueSceneUpdates: number })
        .continueSceneUpdates++;
      return original.apply(this, args);
    };
  });
  const camera = await page.locator("canvas").getAttribute("data-camera");
  await page.locator(".tiptap").fill("Сохранение без обновления города");
  await page
    .getByRole("button", { name: "Сохранить заметку", exact: true })
    .click();
  await expect(page.getByTestId("save-status")).toHaveText("Сохранено");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { continueSceneUpdates: number })
          .continueSceneUpdates,
    ),
  ).toBe(0);
  await expect(page.locator("canvas")).toHaveAttribute("data-camera", camera!);
  await page
    .getByRole("button", { name: "Найти на карте", exact: true })
    .click();
  await expect(page.locator(".work-view")).toHaveCount(0);
  await expect(page.locator(".detail-panel")).toHaveCount(0);
  expect((await rows<Note>(page, "notes"))[0].text).toBe(
    "Сохранение без обновления города",
  );
  await page.getByRole("button", { name: "Библиотека", exact: true }).click();
  await page
    .getByRole("button", { name: "Рабочий материал", exact: true })
    .click();
  await page.getByRole("button", { name: "Рабочий вид", exact: true }).click();
  await page.getByRole("button", { name: "К зданию", exact: true }).click();
  await expect(page.locator(".work-view")).toHaveCount(0);
  await expect(page.locator(".detail-panel")).toHaveCount(0);
});
