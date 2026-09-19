import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  archiveBytes,
  legacyCity,
  legacyStores,
  pixel,
} from "../fixtures/legacy-city";
import { clickCell, createCity, rows } from "./helpers";
import type {
  Building,
  LearningObject,
  Note,
  Track,
} from "../../src/domain/model";

test("opens an actual IndexedDB v1 city and migrates it atomically in Chromium", async ({
  page,
}) => {
  await page.route("**/src/main.tsx", (route) => route.abort());
  await page.goto("/");
  await page.evaluate(
    async ({ stores, data, image }) => {
      await new Promise<void>((resolve, reject) => {
        // Dexie multiplies the declared schema version by ten in native IndexedDB.
        const request = indexedDB.open("progress-city-v1", 10);
        request.onupgradeneeded = () => {
          for (const [table, spec] of Object.entries(stores)) {
            const [keyPath, ...indexes] = spec.split(",");
            const store = request.result.createObjectStore(table, { keyPath });
            for (const index of indexes) {
              const key = index.replace(/^[&*]/, "");
              store.createIndex(key, key, {
                unique: index.startsWith("&"),
                multiEntry: index.startsWith("*"),
              });
            }
          }
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const tx = database.transaction(Object.keys(stores), "readwrite");
          tx.objectStore("cities").add(data.city);
          tx.objectStore("metadata").add({
            id: "epoch",
            value: "v1-city-epoch",
          });
          for (const key of [
            "tracks",
            "buildings",
            "districts",
            "notes",
            "activities",
            "events",
            "snapshots",
          ] as const)
            for (const row of data[key]) tx.objectStore(key).add(row);
          tx.objectStore("attachments").add({
            ...data.attachments[0],
            blob: new Blob([new Uint8Array(image)], { type: "image/png" }),
          });
          tx.oncomplete = () => {
            database.close();
            resolve();
          };
          tx.onabort = () => {
            database.close();
            reject(tx.error);
          };
        };
      });
    },
    { stores: legacyStores, data: legacyCity(), image: Array.from(pixel) },
  );
  await page.unroute("**/src/main.tsx");
  await page.reload();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "1",
  );
  await page.getByRole("button", { name: "Фотография", exact: true }).click();
  await expect(page.getByTestId("stage")).toContainText("2");
  await expect(page.getByTestId("balance")).toContainText("3");
  await page.getByRole("button", { name: "Первый свет", exact: true }).click();
  await expect(page.locator(".note-image img")).toBeVisible();
  expect((await rows<LearningObject>(page, "learningObjects"))[0].stage).toBe(
    2,
  );
  expect((await rows<Note>(page, "notes"))[0]).toMatchObject({
    id: "old-note",
    learningObjectId: "photo",
    revision: 2,
  });
  expect(
    (await rows<{ id: string; value: string }>(page, "metadata"))[0].value,
  ).toBe("v1-city-epoch");
});

test("an open research form cannot overwrite newer fields from another tab", async ({
  page,
  context,
}) => {
  await createCity(page, "Фотография");
  await page.getByRole("button", { name: "Фотография", exact: true }).click();
  await page
    .getByText("Вопрос и название исследования", { exact: true })
    .click();
  await page.getByLabel("Следующий вопрос").fill("Мой локальный вопрос");
  const second = await context.newPage();
  await second.goto("/");
  await second.evaluate(async () => {
    const path = "/src/storage/service.ts";
    const { service } = (await import(
      path
    )) as typeof import("../../src/storage/service");
    const object = (await service.db.learningObjects.toArray())[0];
    await service.updateLearningObject({
      ...object,
      name: "Новый заголовок из другой вкладки",
      nextQuestion: "Сохранённый вопрос",
    });
  });
  await expect(
    page.getByLabel("Учебный объект").locator("option:checked"),
  ).toContainText("Новый заголовок");
  await page
    .getByRole("button", { name: "Сохранить исследование", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "изменено в другой вкладке",
  );
  await expect(page.getByLabel("Следующий вопрос")).toHaveValue(
    "Мой локальный вопрос",
  );
  expect(
    (await rows<LearningObject>(page, "learningObjects"))[0],
  ).toMatchObject({
    name: "Новый заголовок из другой вкладки",
    nextQuestion: "Сохранённый вопрос",
  });
  await second.close();
});

test("result shortcut uses the saved note title while the live note list is delayed", async ({
  page,
}) => {
  await createCity(page);
  await page.getByRole("button", { name: "Акварель", exact: true }).click();
  await page
    .getByRole("button", { name: "Новая заметка", exact: true })
    .click();
  await expect(page.getByLabel("Заголовок заметки")).toHaveValue(
    "Без названия",
  );
  await page.evaluate(async () => {
    const path = "/src/storage/db.ts";
    const { db, CityDB } = (await import(
      path
    )) as typeof import("../../src/storage/db");
    const read = db.notes.toArray.bind(db.notes);
    const gate = new Promise<void>((resolve) =>
      Object.assign(window, { releaseNoteRead: resolve }),
    );
    Object.defineProperty(db.notes, "toArray", {
      configurable: true,
      value: async () => {
        const notes = await read();
        await CityDB.waitFor(gate);
        return notes;
      },
    });
  });
  await page.getByLabel("Заголовок заметки").fill("Последнее название");
  await page
    .getByRole("button", { name: "Зафиксировать результат", exact: true })
    .click();
  await expect(page.getByLabel("Название результата")).toHaveValue(
    "Последнее название",
  );
  await page.evaluate(() =>
    (window as unknown as { releaseNoteRead: () => void }).releaseNoteRead(),
  );
});

test("creating a direction after selecting a research resets the object and result context", async ({
  page,
}) => {
  await createCity(page, "Фотография");
  await clickCell(page, 20, 20);
  await expect(page.getByLabel("Учебный объект")).toBeVisible();
  await page
    .getByRole("button", { name: "Новая заметка", exact: true })
    .click();
  await page.getByLabel("Заголовок заметки").fill("Старый материал");
  await page
    .getByRole("button", { name: "Зафиксировать результат", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Новое направление", exact: true })
    .click();
  await page.getByLabel("Название направления").fill("Рисование");
  await page
    .getByRole("button", { name: "Создать направление", exact: true })
    .click();
  await expect(page.getByLabel("Учебный объект")).toBeVisible();
  const track = (await rows<Track>(page, "tracks")).find(
    (t) => t.name === "Рисование",
  )!;
  await expect(page.getByLabel("Учебный объект")).toHaveValue(track.id);
  await page
    .getByRole("button", { name: "Новая заметка", exact: true })
    .click();
  await page.getByLabel("Заголовок заметки").fill("Свежий набросок");
  await page
    .getByRole("button", { name: "Сохранить заметку", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Свежий набросок", exact: true }),
  ).toBeVisible();
  expect(
    (await rows<Note>(page, "notes")).find(
      (n) => n.title === "Свежий набросок",
    )!.learningObjectId,
  ).toBe(track.id);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Учебный объект")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "docs/review-evidence/quarter-mobile.png",
    fullPage: true,
  });
});

test("old city grows a second research building from a note and survives reload and ZIP", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page
    .getByText("Уже есть город? Восстановить архив", { exact: true })
    .click();
  const legacy = await archiveBytes(legacyCity(), 1, {
    "attachments/photo-image": pixel,
  });
  await page.getByLabel("Архив для восстановления").setInputFiles({
    name: "old.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(await legacy.arrayBuffer()),
  });
  await page.getByRole("button", { name: /Восстановить/ }).click();
  await page.getByRole("button", { name: "Фотография", exact: true }).click();
  await expect(page.getByTestId("stage")).toContainText("2");
  await page
    .getByText("Новое исследование в этом направлении", { exact: true })
    .click();
  await page.getByLabel("Название исследования").fill("Студия света");
  await page
    .getByRole("button", { name: "Начать исследование", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Новая заметка", exact: true })
    .click();
  await page.getByLabel("Заголовок заметки").fill("Три схемы света");
  await page.locator(".tiptap").fill("Сравнил три схемы на одном объекте.");
  const illustration = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 240;
    const drawing = canvas.getContext("2d")!;
    drawing.fillStyle = "#eee5cd";
    drawing.fillRect(0, 0, 480, 240);
    drawing.fillStyle = "#344d50";
    drawing.font = "18px sans-serif";
    drawing.fillText("Три схемы света · тестовый материал", 18, 30);
    ["#cfab71", "#8dada8", "#a1a6c3"].forEach((color, i) => {
      const x = 24 + i * 155;
      drawing.fillStyle = color;
      drawing.fillRect(x, 50, 135, 166);
      drawing.fillStyle = "#617275";
      drawing.beginPath();
      drawing.ellipse(x + 76, 170, 42, 14, i * 0.2, 0, Math.PI * 2);
      drawing.fill();
      drawing.fillStyle = "#f4e4c0";
      drawing.beginPath();
      drawing.arc(x + 62, 138, 32, 0, Math.PI * 2);
      drawing.fill();
    });
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.getByLabel("Добавить изображение").setInputFiles({
    name: "light.png",
    mimeType: "image/png",
    buffer: Buffer.from(illustration, "base64"),
  });
  await page
    .getByRole("button", { name: "Зафиксировать результат", exact: true })
    .click();
  await expect(page.getByLabel("Название результата")).toHaveValue(
    "Три схемы света",
  );
  await expect(
    page.getByRole("checkbox", { name: "Три схемы света" }),
  ).toBeChecked();
  await page
    .getByLabel("Что получилось")
    .fill("Сравнил три схемы освещения на одном объекте");
  await page.getByLabel("Тип результата").selectOption("apply");
  await page
    .getByRole("button", { name: "Подтвердить результат", exact: true })
    .click();
  await expect(page.getByTestId("balance")).toContainText("6");
  await expect(
    page.getByRole("button", { name: "Развить «Фотография»" }),
  ).toBeEnabled();
  await page.locator(".development-choice").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "docs/review-evidence/quarter-choice.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Построить «Студия света»" }).click();
  await page.getByLabel("Тип объекта").selectOption("pavilion");
  await page.getByRole("button", { name: "Выбрать место на карте" }).click();
  await clickCell(page, 23, 19);
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "2",
  );
  await clickCell(page, 24, 20);
  await expect(page.getByLabel("Учебный объект")).toHaveValue(
    (await rows<LearningObject>(page, "learningObjects")).find(
      (o) => o.name === "Студия света",
    )!.id,
  );
  await expect(
    page.getByRole("button", { name: "Первый свет", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Три схемы света", exact: true })
    .click();
  await expect(page.locator(".tiptap img")).toBeVisible();
  await page
    .getByText("Вопрос и название исследования", { exact: true })
    .click();
  await page
    .getByLabel("Следующий вопрос")
    .fill("Что изменится при другом источнике?");
  await page.getByRole("button", { name: "Сохранить исследование" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Исследование сохранено" }),
  ).toBeVisible();
  await page
    .getByText("Вопрос и название исследования", { exact: true })
    .click();
  await page.getByLabel("Учебный объект").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "docs/review-evidence/quarter-overview.png",
    fullPage: true,
  });
  await page.locator(".note-image img").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "docs/review-evidence/quarter-materials.png",
    fullPage: true,
  });
  const before = {
    tracks: await rows<Track>(page, "tracks"),
    objects: await rows<LearningObject>(page, "learningObjects"),
    notes: await rows<Note>(page, "notes"),
    buildings: await rows<Building>(page, "buildings"),
  };
  expect(before.tracks[0].balance).toBe(3);
  expect(before.objects.find((o) => o.id === "photo")!.stage).toBe(2);
  expect(before.objects.find((o) => o.id !== "photo")!.stage).toBe(1);
  await page.reload();
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Экспортировать город", exact: true })
    .click();
  const zip = await readFile((await (await download).path())!);
  const context = await browser.newContext();
  try {
    const restored = await context.newPage();
    await restored.goto(page.url());
    await restored
      .getByText("Уже есть город? Восстановить архив", { exact: true })
      .click();
    await restored.getByLabel("Архив для восстановления").setInputFiles({
      name: "quarter.zip",
      mimeType: "application/zip",
      buffer: zip,
    });
    await restored.getByRole("button", { name: /Восстановить/ }).click();
    await expect(restored.locator("canvas")).toHaveAttribute(
      "data-building-count",
      "2",
    );
    expect(await rows(restored, "learningObjects")).toEqual(before.objects);
    expect(await rows(restored, "notes")).toEqual(before.notes);
    expect(await rows(restored, "buildings")).toEqual(before.buildings);
    expect(await rows(restored, "tracks")).toEqual(before.tracks);
    await restored
      .getByRole("button", { name: "Библиотека", exact: true })
      .click();
    await restored
      .getByRole("button", { name: "Три схемы света", exact: true })
      .click();
    await expect(restored.locator(".tiptap img")).toBeVisible();
    expect(
      await restored
        .locator(".tiptap img")
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    ).toBe(480);
  } finally {
    await context.close();
  }
  expect(errors).toEqual([]);
});
