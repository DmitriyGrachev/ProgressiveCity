import { test, expect, type Page } from "@playwright/test";
import { createCity, rows } from "./helpers";
import { failWrites, restoreWrites } from "./daily-helpers";
import type { Note, Activity } from "../../src/domain/model";
import {
  habitGrowthArchive,
  largeLibraryArchive,
  imageHashes,
} from "./long-term-helpers";
import { clickCell } from "./helpers";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
const button = (p: Page, name: string) =>
  p.getByRole("button", { name, exact: true });
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE2cAAAAASUVORK5CYII=",
  "base64",
);

test("long term: competing habit purchases in two tabs cannot overspend the remaining balance", async ({
  page,
  context,
}, info) => {
  const archive = info.outputPath("two-tab-habit.zip");
  await habitGrowthArchive(archive);
  await page.goto("/");
  await page
    .getByText("Уже есть город? Восстановить архив", { exact: true })
    .click();
  await page
    .getByLabel("Архив для восстановления", { exact: true })
    .setInputFiles(archive);
  await button(page, "Восстановить город").click();
  await button(page, "Прогулка").click();
  await button(page, "Приобрести сад · 3 очка").click();
  await expect(
    page.getByRole("region", { name: "Дополнения привычки", exact: true }),
  ).toContainText("Приобретено");
  const peer = await context.newPage();
  await peer.goto("/");
  await button(peer, "Прогулка").click();
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("progress-city-v1");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result,
            tx = database.transaction(["tracks", "events"], "readwrite");
          let released = false;
          const keep = () => {
            if (released) return;
            tx.objectStore("tracks").get("__purchase_barrier__").onsuccess =
              keep;
          };
          Object.assign(window, {
            releasePurchaseBarrier: () => {
              released = true;
            },
          });
          tx.oncomplete = () => database.close();
          keep();
          resolve();
        };
      }),
  );
  await Promise.all([
    button(page, "Приобрести двор · 3 очка").click(),
    button(peer, "Приобрести павильон · 3 очка").click(),
  ]);
  await page.evaluate(() =>
    (
      window as unknown as { releasePurchaseBarrier: () => void }
    ).releasePurchaseBarrier(),
  );
  await expect
    .poll(
      async () =>
        (await rows<{ type: string }>(page, "events")).filter(
          (e) => e.type === "habitAddition",
        ).length,
    )
    .toBe(2);
  expect((await rows<{ balance: number }>(page, "tracks"))[0].balance).toBe(0);
  await expect
    .poll(
      async () =>
        (await page.getByRole("alert").count()) +
        (await peer.getByRole("alert").count()),
    )
    .toBe(1);
  expect(await rows(page, "buildings")).toHaveLength(1);
});

test("long term: a stage three habit buys an owned garden, cancels, places, removes and replaces without paying twice", async ({
  page,
}, info) => {
  const archive = info.outputPath("habit-growth.zip");
  await habitGrowthArchive(archive);
  await page.goto("/");
  await page
    .getByText("Уже есть город? Восстановить архив", { exact: true })
    .click();
  await page
    .getByLabel("Архив для восстановления", { exact: true })
    .setInputFiles(archive);
  await button(page, "Восстановить город").click();
  await button(page, "Прогулка").click();
  await button(page, "Приобрести сад · 3 очка").click();
  const inventory = page.getByRole("region", {
    name: "Дополнения привычки",
    exact: true,
  });
  await expect(inventory).toContainText("Приобретено");
  expect((await rows<{ balance: number }>(page, "tracks"))[0].balance).toBe(3);
  await button(page, "Разместить сад").click();
  await expect(
    page.getByRole("combobox", { name: "Тип объекта", exact: true }),
  ).toHaveValue("park");
  await button(page, "Выбрать место на карте").click();
  await page.keyboard.press("Escape");
  expect(await rows(page, "buildings")).toHaveLength(1);
  await button(page, "Прогулка").click();
  await button(page, "Разместить сад").click();
  await button(page, "Выбрать место на карте").click();
  await clickCell(page, 23, 19);
  await expect.poll(async () => (await rows(page, "buildings")).length).toBe(2);
  await expect(button(page, "Повторить планировку")).toBeDisabled();
  await button(page, "Отменить планировку").click();
  await expect.poll(async () => (await rows(page, "buildings")).length).toBe(1);
  await button(page, "Повторить планировку").click();
  await expect.poll(async () => (await rows(page, "buildings")).length).toBe(2);
  await page.reload();
  await button(page, "Прогулка").click();
  await button(page, "Оформить сад").click();
  await button(page, "Снять с карты").click();
  await button(page, "Прогулка").click();
  await button(page, "Разместить сад").click();
  await button(page, "Выбрать место на карте").click();
  await clickCell(page, 23, 22);
  await expect.poll(async () => (await rows(page, "buildings")).length).toBe(2);
  expect((await rows<{ balance: number }>(page, "tracks"))[0].balance).toBe(3);
  expect(
    (await rows<{ type: string }>(page, "events")).filter(
      (e) => e.type === "habitAddition",
    ),
  ).toHaveLength(1);
  await page.screenshot({ path: info.outputPath("owned-garden.png") });
});

test("long term: failed note and image survive reload and recover through the existing editor without rewards", async ({
  page,
}) => {
  await createCity(page);
  await button(page, "Акварель").click();
  await button(page, "Новая заметка").click();
  await page
    .getByRole("textbox", { name: "Заголовок заметки", exact: true })
    .fill("Страховка опыта");
  await expect
    .poll(async () => (await rows<Note>(page, "notes"))[0].title)
    .toBe("Страховка опыта");
  const before = await rows(page, "events");
  await failWrites(page, "notes");
  await page
    .getByRole("textbox", { name: "Текст заметки", exact: true })
    .fill("Ввод переживает перезапуск после ошибки основной записи");
  await page.getByLabel("Добавить изображение", { exact: true }).setInputFiles({
    name: "original.png",
    mimeType: "image/png",
    buffer: pixel,
  });
  await expect(page.locator(".tiptap img")).toBeVisible();
  await expect(page.getByTestId("recovery-protection")).toContainText(
    "защищён",
  );
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  const recovery = page.getByRole("region", {
    name: "Аварийные черновики",
    exact: true,
  });
  await recovery
    .getByText("Аварийные черновики", { exact: false })
    .first()
    .click();
  await expect(recovery).toContainText("Страховка опыта");
  await button(page, "Восстановить заметку").click();
  await expect(
    page.getByRole("textbox", { name: "Текст заметки", exact: true }),
  ).toContainText("Ввод переживает");
  await expect(page.locator(".tiptap img")).toBeVisible();
  expect(await rows(page, "events")).toEqual(before);
  expect((await rows<Note>(page, "notes"))[0].text).toContain(
    "Ввод переживает",
  );
  await expect
    .poll(
      async () =>
        (await rows(page, "recovery")).filter((r: unknown) =>
          Boolean((r as { payload: unknown }).payload),
        ).length,
    )
    .toBe(0);
});

test("long term: unconfirmed habit form can continue after reload without creating or rewarding an activity", async ({
  page,
}) => {
  await createCity(page);
  await button(page, "Новое направление").click();
  await page.getByLabel("Название направления").fill("Чтение");
  await page
    .getByRole("combobox", { name: "Тип направления", exact: true })
    .selectOption("habit");
  await button(page, "Создать направление").click();
  await button(page, "Отметить сегодня").click();
  await page
    .getByRole("textbox", { name: "Что получилось", exact: true })
    .fill("Незавершённая запись после закрытия");
  await expect(page.getByTestId("form-protection").first()).toContainText(
    "защищён",
  );
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  expect(await rows<Activity>(page, "activities")).toHaveLength(0);
  const recovery = page.getByRole("region", {
    name: "Аварийные черновики",
    exact: true,
  });
  await recovery
    .getByText("Аварийные черновики", { exact: false })
    .first()
    .click();
  await button(page, "Продолжить форму").click();
  await expect(
    page.getByRole("textbox", { name: "Что получилось", exact: true }),
  ).toHaveValue("Незавершённая запись после закрытия");
  expect(await rows<Activity>(page, "activities")).toHaveLength(0);
  expect(
    (await rows<{ type: string }>(page, "events")).filter(
      (e) => e.type === "activity",
    ),
  ).toHaveLength(0);
  await expect(page.getByTestId("form-protection").first()).toContainText(
    "защищён",
  );
  await expect
    .poll(
      async () =>
        (await rows<{ payload: unknown }>(page, "recovery")).filter(
          (r) => r.payload,
        ).length,
    )
    .toBe(1);
});

test("long term: recovered new activity retains its original timezone after the city timezone changes in another tab", async ({
  page,
  context,
}) => {
  await createCity(page);
  await button(page, "Новое направление").click();
  await page.getByLabel("Название направления").fill("Прогулка");
  await page
    .getByRole("combobox", { name: "Тип направления", exact: true })
    .selectOption("habit");
  await button(page, "Создать направление").click();
  await button(page, "Отметить сегодня").click();
  await page
    .getByRole("textbox", { name: "Что получилось", exact: true })
    .fill("Исходный часовой пояс важен");
  await expect(page.getByTestId("form-protection")).toContainText("защищён");
  const original = (await rows<{ timezone: string }>(page, "cities"))[0]
    .timezone;
  const peer = await context.newPage();
  await peer.goto("/");
  await button(peer, "Настройки").click();
  await peer
    .getByRole("textbox", { name: "Часовой пояс", exact: true })
    .fill(original === "America/New_York" ? "Asia/Tokyo" : "America/New_York");
  await button(peer, "Сохранить настройки").click();
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await page
    .getByRole("region", { name: "Аварийные черновики", exact: true })
    .locator("summary")
    .click();
  await button(page, "Продолжить форму").click();
  await expect(
    page.getByRole("textbox", { name: "Что получилось", exact: true }),
  ).toHaveValue("Исходный часовой пояс важен");
  await button(page, "Сохранить черновик").click();
  await expect
    .poll(async () => (await rows<Activity>(page, "activities"))[0]?.timezone)
    .toBe(original);
});

test("long term: an image prepared before its blocked main insert survives reload and is inserted only by explicit recovery", async ({
  page,
}) => {
  await createCity(page);
  await button(page, "Акварель").click();
  await button(page, "Новая заметка").click();
  await page
    .getByRole("textbox", { name: "Текст заметки", exact: true })
    .fill("Исходный материал");
  await expect
    .poll(async () => (await rows<Note>(page, "notes"))[0].text)
    .toContain("Исходный материал");
  await failWrites(page, "attachments");
  await page.getByLabel("Добавить изображение", { exact: true }).setInputFiles({
    name: "pending.png",
    mimeType: "image/png",
    buffer: pixel,
  });
  await expect(page.getByTestId("recovery-protection")).toContainText(
    "защищён",
  );
  await expect(button(page, "Повторить загрузку изображения")).toBeVisible();
  await expect(page.locator(".tiptap img")).toHaveCount(0);
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  const recovery = page.getByRole("region", {
    name: "Аварийные черновики",
    exact: true,
  });
  await recovery.locator("summary").click();
  await expect(recovery).toContainText("незавершённая загрузка");
  await button(page, "Восстановить заметку").click();
  await expect(page.locator(".tiptap img")).toBeVisible();
  const hashes = await imageHashes(page);
  expect(Object.values(hashes)).toHaveLength(1);
});

test("long term: cleanup refuses another tab editor then deletes only the previewed unused image", async ({
  page,
  context,
}) => {
  await createCity(page);
  await button(page, "Акварель").click();
  await button(page, "Новая заметка").click();
  await page.getByLabel("Добавить изображение", { exact: true }).setInputFiles({
    name: "unused.png",
    mimeType: "image/png",
    buffer: pixel,
  });
  await expect(page.locator(".tiptap img")).toBeVisible();
  const text = page.getByRole("textbox", {
    name: "Текст заметки",
    exact: true,
  });
  await text.click();
  await text.press("ControlOrMeta+a");
  await text.press("Backspace");
  await text.fill("Изображение удалено из текста намеренно");
  await expect(page.locator(".tiptap img")).toHaveCount(0);
  await expect
    .poll(async () => (await rows<Note>(page, "notes"))[0].text)
    .toContain("намеренно");
  await expect(page.getByTestId("recovery-protection")).toContainText(
    "Нет незавершённого ввода",
  );
  expect(
    (await rows<Note>(page, "notes"))[0].doc.content?.some(
      (n) => n.type === "attachmentImage",
    ),
  ).toBe(false);
  const before = await Promise.all(
    [
      "tracks",
      "learningObjects",
      "notes",
      "events",
      "activities",
      "snapshots",
      "buildings",
    ].map((t) => rows(page, t)),
  );
  const peer = await context.newPage();
  await peer.goto("/");
  await button(peer, "Настройки").click();
  await button(peer, "Найти неиспользуемые изображения").click();
  await expect(
    peer.getByRole("region", { name: "Очистка библиотеки", exact: true }),
  ).toContainText("1 изображений");
  peer.on("dialog", (dialog) => dialog.accept());
  await button(peer, "Очистить по предпросмотру").click();
  await expect(peer.getByRole("alert")).toContainText("Закройте редакторы");
  expect(await rows(peer, "attachments")).toHaveLength(1);
  await button(page, "Progress City").click();
  await button(peer, "Очистить по предпросмотру").click();
  await expect
    .poll(async () => (await rows(peer, "attachments")).length)
    .toBe(0);
  expect(
    await Promise.all(
      [
        "tracks",
        "learningObjects",
        "notes",
        "events",
        "activities",
        "snapshots",
        "buildings",
      ].map((t) => rows(peer, t)),
    ),
  ).toEqual(before);
});

test("long term: download alone is not a verified backup, checked file becomes stale after a saved change", async ({
  page,
}, info) => {
  await createCity(page);
  const backup = page.locator(".quick-backup");
  await backup.locator("summary").click();
  await expect(backup.getByTestId("backup-status")).toContainText(
    "ещё нет проверенной",
  );
  const download = page.waitForEvent("download");
  await button(page, "Скачать полную копию").click();
  const file = await download,
    path = info.outputPath("verified.progresscity.zip");
  await file.saveAs(path);
  await expect(backup.getByTestId("backup-status")).toContainText(
    "ещё нет проверенной",
  );
  await page
    .getByLabel("Проверить архив без замены", { exact: true })
    .setInputFiles(path);
  await expect(backup.getByTestId("backup-status")).toContainText("совпадает");
  await button(page, "Настройки").click();
  await page
    .getByRole("textbox", { name: "Имя города", exact: true })
    .fill("Новый сохранённый город");
  await button(page, "Сохранить настройки").click();
  await expect(backup.getByTestId("backup-status")).toContainText(
    "город изменился",
  );
  await page
    .getByLabel("Проверить архив без замены", { exact: true })
    .setInputFiles(path);
  await expect(backup.getByTestId("backup-status")).toContainText(
    "город изменился",
  );
});

test("long term: both persistence failures keep editable text and allow a direct draft download without a database write", async ({
  page,
}, info) => {
  await createCity(page);
  await button(page, "Акварель").click();
  await button(page, "Новая заметка").click();
  await expect(
    page.getByRole("textbox", { name: "Текст заметки", exact: true }),
  ).toBeEditable();
  await failWrites(page, "notes");
  await failWrites(page, "recovery");
  await page
    .getByRole("textbox", { name: "Текст заметки", exact: true })
    .fill("Оба хранилища отказали, ввод можно выгрузить");
  await expect(page.getByTestId("recovery-protection")).toContainText(
    "не сохранена",
  );
  const download = page.waitForEvent("download");
  await button(page, "Выгрузить текущий ввод").click({ timeout: 10000 });
  const file = await download,
    path = info.outputPath("unsaved-recovery.zip");
  await file.saveAs(path);
  const files = unzipSync(await readFile(path));
  expect(strFromU8(files["note.txt"])).toContain("Оба хранилища отказали");
  await expect(
    page.getByRole("textbox", { name: "Текст заметки", exact: true }),
  ).toContainText("Оба хранилища отказали");
});

test("long term: public large v3 library remains responsive during export and restores all image bytes in a clean profile", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000);
  const fixture = info.outputPath("large-source.progresscity.zip"),
    expected = await largeLibraryArchive(fixture);
  await page.goto("/");
  await page
    .getByText("Уже есть город? Восстановить архив", { exact: true })
    .click();
  await page
    .getByLabel("Архив для восстановления", { exact: true })
    .setInputFiles(fixture);
  await button(page, "Восстановить город").click();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    String(expected.buildings),
  );
  expect(await rows(page, "notes")).toHaveLength(1000);
  expect(await imageHashes(page)).toEqual(expected.hashes);
  await page.locator(".quick-backup summary").click();
  await page.evaluate(() => {
    let last = performance.now();
    const gaps: number[] = [];
    const timer = setInterval(() => {
      const now = performance.now();
      gaps.push(now - last);
      last = now;
    }, 25);
    Object.assign(window, {
      longTermExportMeasure: () => {
        clearInterval(timer);
        return { gaps, maxGap: Math.max(0, ...gaps) };
      },
    });
  });
  const pending = page.waitForEvent("download");
  await button(page, "Скачать полную копию").click();
  const download = await pending,
    archive = info.outputPath("large-roundtrip.progresscity.zip");
  await download.saveAs(archive);
  const measured = await page.evaluate(() =>
    (
      window as unknown as {
        longTermExportMeasure: () => { gaps: number[]; maxGap: number };
      }
    ).longTermExportMeasure(),
  );
  await info.attach("large-export-response.json", {
    body: JSON.stringify(measured, null, 2),
    contentType: "application/json",
  });
  expect(measured.gaps.length).toBeGreaterThan(5);
  expect(measured.maxGap).toBeLessThan(500);
  const fresh = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  try {
    const other = await fresh.newPage();
    await other.goto("/");
    await other
      .getByText("Уже есть город? Восстановить архив", { exact: true })
      .click();
    await other
      .getByLabel("Архив для восстановления", { exact: true })
      .setInputFiles(archive);
    await button(other, "Восстановить город").click();
    await expect(other.locator("canvas")).toHaveAttribute(
      "data-building-count",
      String(expected.buildings),
    );
    expect(await rows(other, "notes")).toHaveLength(1000);
    expect(await imageHashes(other)).toEqual(expected.hashes);
  } finally {
    await fresh.close();
  }
});

for (const decision of ["retry", "cancel"] as const)
  test(`long term: ${decision} of a failed image never resurrects the abandoned original`, async ({
    page,
  }) => {
    await createCity(page);
    await button(page, "Акварель").click();
    await button(page, "Новая заметка").click();
    await expect(
      page.getByRole("textbox", { name: "Текст заметки", exact: true }),
    ).toBeEditable();
    await failWrites(page, "attachments");
    await page
      .getByLabel("Добавить изображение", { exact: true })
      .setInputFiles({
        name: "attempt.png",
        mimeType: "image/png",
        buffer: pixel,
      });
    await expect(button(page, "Повторить загрузку изображения")).toBeVisible();
    await restoreWrites(page);
    if (decision === "retry") {
      await button(page, "Повторить загрузку изображения").click();
      await expect(page.locator(".tiptap img")).toHaveCount(1);
      await expect(page.getByTestId("save-status")).toHaveText("Сохранено");
    } else await button(page, "Отменить повтор загрузки").click();
    await failWrites(page, "notes");
    await page
      .getByRole("textbox", { name: "Заголовок заметки", exact: true })
      .fill("После решения о загрузке");
    await expect(page.getByTestId("recovery-protection")).toContainText(
      "защищён",
    );
    page.on("dialog", (d) => d.accept());
    await page.reload();
    const recovery = page.getByRole("region", {
      name: "Аварийные черновики",
      exact: true,
    });
    await recovery.locator("summary").click();
    await expect(recovery).not.toContainText("Есть незавершённая загрузка");
    await button(page, "Восстановить заметку").click();
    await expect(
      page.getByRole("textbox", { name: "Заголовок заметки", exact: true }),
    ).toHaveValue("После решения о загрузке");
    await expect(page.locator(".tiptap img")).toHaveCount(
      decision === "retry" ? 1 : 0,
    );
  });

test("long term: two failed editors keep separate durable branches after both pages close", async ({
  page,
  context,
}) => {
  await createCity(page);
  await button(page, "Акварель").click();
  await button(page, "Новая заметка").click();
  await expect(
    page.getByRole("textbox", { name: "Текст заметки", exact: true }),
  ).toBeEditable();
  const title = (await rows<Note>(page, "notes"))[0].title;
  const peer = await context.newPage();
  await peer.goto("/");
  await button(peer, "Акварель").click();
  await button(peer, title).click();
  for (const [p, text] of [
    [page, "Ветка первой вкладки"],
    [peer, "Ветка второй вкладки"],
  ] as const) {
    await failWrites(p, "notes");
    await p
      .getByRole("textbox", { name: "Текст заметки", exact: true })
      .fill(text);
    await expect(p.getByTestId("recovery-protection")).toContainText("защищён");
  }
  await page.close();
  await peer.close();
  const reopened = await context.newPage();
  await reopened.goto("/");
  const recovery = reopened.getByRole("region", {
    name: "Аварийные черновики",
    exact: true,
  });
  await recovery.locator("summary").click();
  await expect(recovery.getByRole("textbox")).toHaveCount(2);
  expect(
    await recovery
      .getByRole("textbox")
      .evaluateAll((elements) =>
        elements.map((element) => (element as HTMLTextAreaElement).value),
      ),
  ).toEqual(
    expect.arrayContaining(["Ветка первой вкладки", "Ветка второй вкладки"]),
  );
  await recovery
    .getByRole("button", { name: "Восстановить отдельной копией", exact: true })
    .first()
    .click();
  await expect.poll(async () => (await rows(reopened, "notes")).length).toBe(2);
  expect(await rows(reopened, "activities")).toHaveLength(0);
});

test("long term: same-ID import from another tab preserves old durable input but disables writing it into the replaced city", async ({
  page,
  context,
}, info) => {
  await createCity(page);
  await button(page, "Акварель").click();
  await button(page, "Новая заметка").click();
  await expect(
    page.getByRole("textbox", { name: "Текст заметки", exact: true }),
  ).toBeEditable();
  const peer = await context.newPage();
  await peer.goto("/");
  await peer.locator(".quick-backup summary").click();
  const pending = peer.waitForEvent("download");
  await button(peer, "Скачать полную копию").click();
  const file = await pending,
    path = info.outputPath("same-ids.zip");
  await file.saveAs(path);
  await failWrites(page, "notes");
  await page
    .getByRole("textbox", { name: "Текст заметки", exact: true })
    .fill("Материал прежнего города должен сохраниться отдельно");
  await expect(page.getByTestId("recovery-protection")).toContainText(
    "защищён",
  );
  await button(peer, "Настройки").click();
  await peer
    .getByLabel("Архив для восстановления", { exact: true })
    .setInputFiles(path);
  peer.on("dialog", (d) => d.accept());
  await button(peer, "Заменить текущий город").click();
  await expect(
    page.getByRole("region", { name: "Локальные черновики", exact: true }),
  ).toBeVisible();
  page.on("dialog", (d) => d.accept());
  await page.reload();
  const recovery = page.getByRole("region", {
    name: "Аварийные черновики",
    exact: true,
  });
  await recovery.locator("summary").click();
  await expect(recovery).toContainText("прежний город");
  await expect(recovery.getByRole("textbox")).toHaveValue(
    "Материал прежнего города должен сохраниться отдельно",
  );
  await expect(button(page, "Восстановить заметку")).toBeDisabled();
  expect((await rows<Note>(page, "notes"))[0].text).not.toContain(
    "прежнего города",
  );
});

test("long term: restoring a question into a previously saved form clears success and keeps the field conflict", async ({
  page,
  context,
}) => {
  await createCity(page);
  await button(page, "Акварель").click();
  await page
    .getByRole("combobox", { name: "Учебный объект", exact: true })
    .selectOption((await rows<{ id: string }>(page, "learningObjects"))[0].id);
  await page.locator(".research-details summary").click();
  const peer = await context.newPage();
  await peer.goto("/");
  await button(peer, "Акварель").click();
  await peer.locator(".research-details summary").click();
  await peer
    .getByRole("textbox", { name: "Следующий вопрос", exact: true })
    .fill("Защищённый вопрос другой вкладки");
  await expect(peer.getByTestId("form-protection")).toContainText("защищён");
  await page
    .getByRole("textbox", { name: "Следующий вопрос", exact: true })
    .fill("Новый сохранённый вопрос");
  await button(page, "Сохранить исследование").click();
  await expect(
    page.getByText("Исследование сохранено", { exact: false }),
  ).toBeVisible();
  const before = await Promise.all(
    ["events", "tracks", "learningObjects"].map((t) => rows(page, t)),
  );
  await peer.close();
  const recovery = page.getByRole("region", {
    name: "Аварийные черновики",
    exact: true,
  });
  await recovery.locator("summary").click();
  await recovery
    .getByRole("button", { name: "Продолжить форму", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Следующий вопрос", exact: true }),
  ).toHaveValue("Защищённый вопрос другой вкладки");
  await expect(
    page.getByText("Исследование сохранено", { exact: false }),
  ).toHaveCount(0);
  await button(page, "Сохранить исследование").click();
  await expect(page.getByRole("alert")).toContainText("измен");
  expect(
    await Promise.all(
      ["events", "tracks", "learningObjects"].map((t) => rows(page, t)),
    ),
  ).toEqual(before);
});
