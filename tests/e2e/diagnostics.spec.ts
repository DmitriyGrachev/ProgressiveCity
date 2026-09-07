import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import { createCity, rows } from "./helpers";
import type { Note } from "../../src/domain/model";

test("does not open old notes with the replacement epoch while note subscription is delayed", async ({
  page,
  context,
}) => {
  await openNote(page);
  await page.getByRole("button", { name: "Библиотека", exact: true }).click();
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
        const values = await read();
        Object.assign(window, { noteReadWaiting: true });
        await CityDB.waitFor(gate);
        return values;
      },
    });
  });
  const second = await context.newPage();
  await second.goto("/");
  await second.evaluate(async () => {
    const dbPath = "/src/storage/db.ts",
      backupPath = "/src/storage/backup.ts";
    const { db } = (await import(
      dbPath
    )) as typeof import("../../src/storage/db");
    const { exportCity, inspectArchive, replaceCity } = (await import(
      backupPath
    )) as typeof import("../../src/storage/backup");
    const archive = await inspectArchive(await exportCity(db));
    archive.data.notes[0].title = "Материал из архива";
    await replaceCity(db, archive);
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          (window as unknown as { noteReadWaiting?: boolean }).noteReadWaiting,
        ),
      ),
    )
    .toBe(true);
  // Only the note subscription is held; let the other subscriptions publish their epoch.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(
    page.getByRole("button", { name: "Локальный материал", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    (window as unknown as { releaseNoteRead: () => void }).releaseNoteRead(),
  );
  await expect(
    page.getByRole("button", { name: "Материал из архива", exact: true }),
  ).toBeVisible();
  await second.close();
});

async function openNote(page: Page) {
  await createCity(page);
  await page.getByRole("button", { name: "Акварель", exact: true }).click();
  await page
    .getByRole("button", { name: "Новая заметка", exact: true })
    .click();
  await page.getByLabel("Заголовок заметки").fill("Локальный материал");
  await page
    .getByRole("button", { name: "Сохранить заметку", exact: true })
    .click();
  await expect(page.getByTestId("save-status")).toHaveText("Сохранено");
}
async function failWrites(page: Page) {
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === "notes")
        throw new DOMException("Synthetic failure", "QuotaExceededError");
      return put.call(this, value, key);
    };
    Object.assign(window, {
      restoreWrites: () => {
        IDBObjectStore.prototype.put = put;
      },
    });
  });
}
test("saving note text never updates or recreates the city scene", async ({
  page,
}) => {
  await openNote(page);
  await page.evaluate(async () => {
    const path = "/src/city/engine.ts";
    const { CityEngine } = (await import(
      path
    )) as typeof import("../../src/city/engine");
    const update = CityEngine.prototype.update;
    const counts = { updates: 0, recreations: 0 };
    Object.assign(window, { sceneCounts: counts });
    CityEngine.prototype.update = function (input) {
      const scene = this as unknown as { objects: { children: unknown[] } };
      const before = scene.objects.children[0];
      counts.updates++;
      update.call(this, input);
      if (before !== scene.objects.children[0]) counts.recreations++;
    };
  });
  for (const text of ["Первая мысль", "Последняя мысль"]) {
    await page.locator(".tiptap").fill(text);
    await page
      .getByRole("button", { name: "Сохранить заметку", exact: true })
      .click();
    await expect(page.getByTestId("save-status")).toHaveText("Сохранено");
    await expect(
      page.getByRole("button", { name: "Локальный материал", exact: true }),
    ).toBeVisible();
  }
  // Wait for the live-query notification to reach React, not merely the IDB write.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(
    await page.evaluate(
      () => (window as unknown as { sceneCounts: unknown }).sceneCounts,
    ),
  ).toEqual({ updates: 0, recreations: 0 });
});
test("copy locks every editor mutation until the delayed write completes and then permits navigation", async ({
  page,
}) => {
  await openNote(page);
  await failWrites(page);
  await page.locator(".tiptap").fill("Важный черновик");
  await page
    .getByRole("button", { name: "Сохранить заметку", exact: true })
    .click();
  await expect(page.getByTestId("save-status")).toContainText("Ошибка");
  await page.evaluate(async () => {
    const path = "/src/storage/service.ts";
    const { service } = (await import(
      path
    )) as typeof import("../../src/storage/service");
    const original = service.copyNote.bind(service);
    service.copyNote = async (...args) => {
      await new Promise<void>((resolve) =>
        Object.assign(window, { releaseCopy: resolve }),
      );
      (window as unknown as { restoreWrites: () => void }).restoreWrites();
      return original(...args);
    };
  });
  await page
    .getByRole("button", { name: "Сохранить отдельную копию", exact: true })
    .click();
  await expect(page.getByLabel("Заголовок заметки")).toBeDisabled();
  await expect(page.getByLabel("Теги через запятую")).toBeDisabled();
  await expect(page.getByLabel("Добавить изображение")).toBeDisabled();
  await expect(page.locator(".tiptap")).toHaveAttribute(
    "contenteditable",
    "false",
  );
  await page.keyboard.type("THIS MUST NOT BE ACCEPTED");
  await page.evaluate(() =>
    (window as unknown as { releaseCopy: () => void }).releaseCopy(),
  );
  await expect(page.getByLabel("Заголовок заметки")).toHaveValue(
    "Локальный материал (копия)",
  );
  expect(
    (await rows<Note>(page, "notes")).filter(
      (n) => n.text === "Важный черновик",
    ),
  ).toHaveLength(1);
  await page.getByRole("button", { name: "История", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "История города", exact: true }),
  ).toBeVisible();
});

for (const sameIds of [false, true])
  test(`cross-tab replacement preserves a failed local draft and its original image (same IDs: ${sameIds})`, async ({
    page,
    context,
  }) => {
    await openNote(page);
    if (!sameIds) {
      await page
        .getByRole("button", { name: "Библиотека", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Локальный материал", exact: true })
        .click();
    }
    const image = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE2cAAAAASUVORK5CYII=",
      "base64",
    );
    await page.getByLabel("Добавить изображение").setInputFiles({
      name: "original.png",
      mimeType: "image/png",
      buffer: image,
    });
    await expect(page.locator(".note-image img")).toBeVisible();
    await expect(page.getByTestId("save-status")).toHaveText("Сохранено");
    const encoded = await page.evaluate(async (sameIds) => {
      const dbPath = "/src/storage/db.ts",
        servicePath = "/src/storage/service.ts",
        backupPath = "/src/storage/backup.ts";
      const { db, CityDB } = (await import(
        dbPath
      )) as typeof import("../../src/storage/db");
      const { CityService } = (await import(
        servicePath
      )) as typeof import("../../src/storage/service");
      const { exportCity } = (await import(
        backupPath
      )) as typeof import("../../src/storage/backup");
      const source = sameIds
        ? db
        : new CityDB(`replacement-${crypto.randomUUID()}`);
      if (!sameIds)
        await new CityService(source).initialize("Другой город", "Другая тема");
      const bytes = new Uint8Array(
        await (await exportCity(source)).arrayBuffer(),
      );
      if (!sameIds) await source.delete();
      return Array.from(bytes);
    }, sameIds);
    const second = await context.newPage();
    await second.goto("/");
    await second
      .getByRole("button", { name: "Настройки", exact: true })
      .click();
    await failWrites(page);
    await page.locator(".tiptap").press("Control+End");
    await page.keyboard.type("UNSAVED LOCAL SENTENCE");
    await page
      .getByRole("button", { name: "Сохранить заметку", exact: true })
      .click();
    await expect(page.getByTestId("save-status")).toContainText("Ошибка");
    await second.getByLabel("Архив для восстановления").setInputFiles({
      name: "replacement.progresscity.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(encoded),
    });
    await second
      .getByRole("button", { name: "Заменить текущий город", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Несохранённый материал",
        exact: true,
      }),
    ).toBeVisible();
    if (!sameIds)
      await page.screenshot({
        path: "docs/review-evidence/draft-recovery.png",
        fullPage: true,
      });
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", {
        name: "Выгрузить черновик с изображениями",
        exact: true,
      })
      .click();
    const file = await download;
    const archive = unzipSync(
      new Uint8Array(await readFile((await file.path())!)),
    );
    expect(strFromU8(archive["note.txt"])).toContain("UNSAVED LOCAL SENTENCE");
    const recovered = JSON.parse(strFromU8(archive["note.json"])) as Note;
    expect(recovered.title).toBe("Локальный материал");
    expect(
      Object.entries(archive)
        .filter(([path]) => path.startsWith("attachments/"))
        .map(([, bytes]) => Buffer.from(bytes)),
    ).toEqual([image]);
    expect(
      (await rows<Note>(second, "notes")).some((n) =>
        n.text.includes("UNSAVED LOCAL SENTENCE"),
      ),
    ).toBe(false);
    await second.close();
  });

test("copy waits for a pending image, ignores repeated clicks, retains a failed draft and retries", async ({
  page,
}) => {
  await openNote(page);
  await failWrites(page);
  await page.locator(".tiptap").fill("Черновик с поздней картинкой");
  await page
    .getByRole("button", { name: "Сохранить заметку", exact: true })
    .click();
  await expect(page.getByTestId("save-status")).toContainText("Ошибка");
  await page.evaluate(async () => {
    const path = "/src/storage/service.ts";
    const { service } = (await import(
      path
    )) as typeof import("../../src/storage/service");
    const copy = service.copyNote.bind(service);
    const controls = {
      calls: 0,
      releaseUpload: () => {},
      releaseFailure: () => {},
    };
    Object.assign(window, { copyControls: controls });
    service.copyNote = async (...args) => {
      controls.calls++;
      if (controls.calls === 1) {
        await new Promise<void>((resolve) => {
          controls.releaseFailure = resolve;
        });
        throw new Error("Synthetic copy failure");
      }
      (window as unknown as { restoreWrites: () => void }).restoreWrites();
      return copy(...args);
    };
    const arrayBuffer = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      if (this.name === "late.png")
        await new Promise<void>((resolve) => {
          controls.releaseUpload = resolve;
        });
      return arrayBuffer.call(this);
    };
  });
  await page.getByLabel("Добавить изображение").setInputFiles({
    name: "late.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE2cAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page
    .getByRole("button", { name: "Сохранить отдельную копию", exact: true })
    .evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { copyControls: { calls: number } }).copyControls
          .calls,
    ),
  ).toBe(0);
  await page.evaluate(() =>
    (
      window as unknown as { copyControls: { releaseUpload: () => void } }
    ).copyControls.releaseUpload(),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { copyControls: { calls: number } })
            .copyControls.calls,
      ),
    )
    .toBe(1);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    (
      window as unknown as { copyControls: { releaseFailure: () => void } }
    ).copyControls.releaseFailure();
  });
  await expect(page.getByLabel("Заголовок заметки")).toBeEnabled();
  await expect(page.locator(".note-image img")).toBeVisible();
  await page.locator(".tiptap").press("Control+End");
  await page.keyboard.type(" Ещё мысль после ошибки");
  await page
    .getByRole("button", { name: "Сохранить отдельную копию", exact: true })
    .click();
  await expect(page.getByLabel("Заголовок заметки")).toHaveValue(
    "Локальный материал (копия)",
  );
  const copies = (await rows<Note>(page, "notes")).filter((n) =>
    n.title.endsWith("(копия)"),
  );
  expect(copies).toHaveLength(1);
  expect(copies[0].text).toContain("Ещё мысль после ошибки");
  expect(JSON.stringify(copies[0].doc)).toContain("attachmentImage");
  await expect(page.locator(".note-image img")).toBeVisible();
});
