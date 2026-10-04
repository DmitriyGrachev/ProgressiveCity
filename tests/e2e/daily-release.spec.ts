import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import { dailyJourney, importDailyFixture } from "./daily-journey";
import { rows, gridPoint } from "./helpers";
import { failWrites } from "./daily-helpers";
import type { Track, Note, LearningObject } from "../../src/domain/model";
async function publicSnapshot(page: Page) {
  const data: Record<string, unknown> = {};
  for (const table of [
    "cities",
    "tracks",
    "learningObjects",
    "notes",
    "buildings",
    "districts",
    "activities",
    "events",
    "snapshots",
  ])
    data[table] = await rows(page, table);
  data.images = await page.evaluate(async () => {
    const request = indexedDB.open("progress-city-v1");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const attachments = await new Promise<{ id: string; blob: Blob }[]>(
        (resolve, reject) => {
          const q = db
            .transaction("attachments")
            .objectStore("attachments")
            .getAll();
          q.onsuccess = () => resolve(q.result);
          q.onerror = () => reject(q.error);
        },
      );
      return await Promise.all(
        attachments.map(async (a) => ({
          ...a,
          blob: Array.from(new Uint8Array(await a.blob.arrayBuffer())),
        })),
      );
    } finally {
      db.close();
    }
  });
  return data;
}
test("daily release: previous v2, daily journey, roads, A/B and full clean restore preserve data and image bytes", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await importDailyFixture(page);
  await dailyJourney(page);
  const tracks = await rows<Track>(page, "tracks");
  expect(tracks.find((t) => t.name === "Оптика")!.balance).toBe(2);
  expect(tracks.find((t) => t.name === "Прогулка")!.balance).toBe(1);
  const note = (await rows<Note>(page, "notes"))[0];
  expect(note.text).toContain("Продолжение сегодняшней работы");
  expect(
    (await rows<LearningObject>(page, "learningObjects")).find(
      (o) => o.name === "Спектр",
    )!.nextQuestion,
  ).toBe("Как изменится спектр через воду?");
  const studyBefore = await Promise.all(
    ["notes", "tracks", "learningObjects", "activities"].map((t) =>
      rows(page, t),
    ),
  );
  await page.getByRole("button", { name: "Строить", exact: true }).click();
  await page.getByLabel("Тип объекта").selectOption("road");
  await page
    .getByRole("button", { name: "Выбрать место на карте", exact: true })
    .click();
  const a = await gridPoint(page, 21.5, 22.5),
    b = await gridPoint(page, 24.5, 22.5);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "5",
  );
  await page
    .getByRole("button", { name: "Отменить планировку", exact: true })
    .click();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "1",
  );
  await page
    .getByRole("button", { name: "Повторить планировку", exact: true })
    .click();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "5",
  );
  await page.getByRole("button", { name: "История", exact: true }).click();
  const camera = await page.locator("canvas").getAttribute("data-camera");
  await page
    .getByRole("button", { name: "Сравнить город", exact: true })
    .click();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-comparison-view",
    "changes",
  );
  await expect(
    page.getByRole("button", { name: "Найти в городе", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Отменить планировку", exact: true }),
  ).toHaveCount(0);
  const comparisonLayout = await rows(page, "buildings");
  await page.keyboard.press("Control+z");
  expect(await rows(page, "buildings")).toEqual(comparisonLayout);
  await page.screenshot({ path: "docs/review-evidence/daily-comparison.png" });
  await page
    .getByRole("button", { name: "Выйти из сравнения", exact: true })
    .click();
  await expect(page.locator("canvas")).toHaveAttribute("data-camera", camera!);
  expect(
    await Promise.all(
      ["notes", "tracks", "learningObjects", "activities"].map((t) =>
        rows(page, t),
      ),
    ),
  ).toEqual(studyBefore);
  await page
    .getByRole("button", { name: "Progress City", exact: true })
    .click();
  await page.screenshot({ path: "docs/review-evidence/daily-city.png" });
  const before = await publicSnapshot(page);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Скачать полную копию", exact: true })
    .click();
  const zip = await readFile((await (await download).path())!);
  const clean = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  const restored = await clean.newPage();
  await restored.goto("/");
  await restored
    .getByText("Уже есть город? Восстановить архив", { exact: true })
    .click();
  await restored.getByLabel("Архив для восстановления").setInputFiles({
    name: "roundtrip.zip",
    mimeType: "application/zip",
    buffer: zip,
  });
  await restored
    .getByRole("button", { name: "Восстановить город", exact: true })
    .click();
  await expect(restored.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "5",
  );
  expect(await publicSnapshot(restored)).toEqual(before);
  await clean.close();
  await page.reload();
  await page
    .getByRole("button", { name: "Продолжить «Спектр»", exact: true })
    .click();
  await expect(page.locator(".tiptap")).toContainText(
    "Продолжение сегодняшней работы",
  );
  await expect(page.locator(".note-image img")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("daily release: search transition waits for images and same-ID import retains note and form recovery", async ({
  page,
  context,
}) => {
  await importDailyFixture(page);
  await page
    .getByRole("button", { name: "Продолжить «Спектр»", exact: true })
    .click();
  await page
    .getByText("Вопрос и название исследования", { exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Следующий вопрос", exact: true })
    .fill("Старый несохранённый вопрос");
  const peer = await context.newPage();
  await peer.goto("/");
  await peer
    .getByRole("button", { name: "Продолжить «Спектр»", exact: true })
    .click();
  await peer
    .getByText("Вопрос и название исследования", { exact: true })
    .click();
  await peer
    .getByRole("textbox", { name: "Следующий вопрос", exact: true })
    .fill("Вопрос второй вкладки");
  await peer
    .getByRole("button", { name: "Сохранить исследование", exact: true })
    .click();
  await expect(
    peer.getByText("Исследование сохранено", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Сохранить исследование", exact: true })
    .click();
  await expect(page.locator(".error-banner")).toContainText(
    "изменено в другой вкладке",
  );
  await expect(
    page.getByRole("textbox", { name: "Следующий вопрос", exact: true }),
  ).toHaveValue("Старый несохранённый вопрос");
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      await new Promise<void>((resolve) =>
        Object.assign(window, { releaseDailyImage: resolve }),
      );
      return original.call(this);
    };
  });
  await page.getByLabel("Добавить изображение").setInputFiles({
    name: "new.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE2cAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page
    .getByRole("button", { name: "Найти в городе", exact: true })
    .click();
  const search = page.getByRole("dialog", {
    name: "Найти в городе",
    exact: true,
  });
  await search.getByRole("searchbox").fill("Оптика");
  await search.getByRole("option").first().click();
  await expect(
    page.getByRole("dialog", { name: "Незавершённые формы", exact: true }),
  ).not.toBeVisible();
  await failWrites(page, "notes");
  await page.evaluate(() =>
    (window as unknown as { releaseDailyImage(): void }).releaseDailyImage(),
  );
  await expect(page.getByTestId("save-status")).toContainText("Ошибка");
  await expect(page.locator(".note-image img")).toHaveCount(2);
  await peer.getByRole("button", { name: "Настройки", exact: true }).click();
  // The source archive has the same IDs. It predates the just-loaded attachment.
  await peer.getByLabel("Архив для восстановления").setInputFiles({
    name: "same-ids.zip",
    mimeType: "application/zip",
    buffer: await readFile(".tools/daily-legacy-v2.progresscity.zip"),
  });
  // Keep search open across replacement to verify it is reset as well.
  await page
    .getByRole("button", { name: "Найти в городе", exact: true })
    .click();
  await peer
    .getByRole("button", { name: "Заменить текущий город", exact: true })
    .click();
  await expect(search).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Несохранённый материал", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Незавершённые формы прежнего города",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    (await rows<LearningObject>(page, "learningObjects")).find(
      (o) => o.name === "Спектр",
    )!.nextQuestion,
  ).toBe("Какие цвета видны?");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: "Выгрузить черновик с изображениями",
      exact: true,
    })
    .click();
  const files = unzipSync(await readFile((await (await download).path())!));
  expect(
    Object.keys(files).filter((p) => p.startsWith("attachments/")).length,
  ).toBe(2);
  expect(strFromU8(files["note.json"])).toContain("attachmentImage");
  await page.screenshot({ path: "docs/review-evidence/daily-recovery.png" });
  await peer.close();
});

test("daily release: narrow keyboard search and form dialog remain accessible with reduced motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await importDailyFixture(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page
    .getByRole("button", { name: "Найти в городе", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "Найти в городе",
    exact: true,
  });
  await dialog.getByRole("searchbox").fill("Спектр");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await page.screenshot({
    path: "docs/review-evidence/daily-search-mobile.png",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Enter");
  await page
    .getByText("Вопрос и название исследования", { exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Следующий вопрос", exact: true })
    .fill("Мобильный вопрос");
  await page
    .getByRole("button", { name: "Закрыть панель", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Остаться", exact: true }),
  ).toBeFocused();
  await page.screenshot({ path: "docs/review-evidence/daily-form-mobile.png" });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("textbox", { name: "Следующий вопрос", exact: true }),
  ).toHaveValue("Мобильный вопрос");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("daily release: search preserves the editor image URL and closing it releases the URL", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = URL.createObjectURL,
      revoke = URL.revokeObjectURL;
    const active = new Set<string>();
    Object.assign(window, { dailyImageUrls: active });
    URL.createObjectURL = function (blob) {
      const url = original.call(URL, blob);
      if (blob instanceof Blob && blob.type.startsWith("image/"))
        active.add(url);
      return url;
    };
    URL.revokeObjectURL = function (url) {
      active.delete(url);
      revoke.call(URL, url);
    };
  });
  await importDailyFixture(page);
  const saved = await rows(page, "notes");
  await page
    .getByRole("button", { name: "Продолжить «Спектр»", exact: true })
    .click();
  const image = page.locator(".note-image img");
  await expect(image).toBeVisible();
  const source = await image.getAttribute("src");
  const count = () =>
    page.evaluate(
      () =>
        (window as unknown as { dailyImageUrls: Set<string> }).dailyImageUrls
          .size,
    );
  await expect.poll(count).toBe(1);
  for (let i = 0; i < 3; i++) {
    await page
      .getByRole("button", { name: "Найти в городе", exact: true })
      .click();
    await page.getByRole("searchbox").fill("spectrum");
    await page.keyboard.press("Escape");
    await expect(image).toHaveAttribute("src", source!);
    expect(await count()).toBe(1);
  }
  await page
    .getByRole("button", { name: "Вернуться в город", exact: true })
    .click();
  await expect.poll(count).toBe(0);
  expect(await rows(page, "notes")).toEqual(saved);
  await expect(page.locator("canvas")).toHaveCount(1);
});
