import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { strFromU8, strToU8, unzipSync } from "fflate";
import { archiveBytes, legacyStores, pixel } from "../fixtures/legacy-city";
import { createCity, rows } from "./helpers";
import { migrationBoundary } from "../fixtures/migration-boundary";
import { zipBoundary } from "../fixtures/zip-boundary";
import {
  dataSchema,
  validateRelations,
} from "../../src/storage/legacy-validation";

for (const boundary of ["json", "zip"] as const) {
  test(`preserves an oversized legacy migration and offers the unchanged v1 archive (${boundary})`, async ({
    page,
  }, testInfo) => {
    const fixture =
      boundary === "zip" ? await zipBoundary(64 * 1024 * 1024 + 1) : undefined;
    const data = fixture?.legacy ?? migrationBoundary(32 * 1024 * 1024, 1);
    const images = fixture?.images ?? { "attachments/photo-image": pixel };
    // Synthetic padding is all zero between the first 256 and last 32 bytes.
    // Rebuild that padding in Chromium instead of transferring 64 MiB as JSON.
    const imageParts = data.attachments.map((a) => {
      const bytes = images[`attachments/${a.id}`];
      return {
        ...a,
        prefix: Array.from(bytes.subarray(0, 256)),
        suffix: Array.from(bytes.subarray(-32)),
      };
    });
    const entryScript =
      /\/(?:src\/main\.tsx|assets\/index-[^/]+\.js)(?:\?.*)?$/;
    await page.route(entryScript, (route) => route.abort());
    await page.goto("/");
    await page.evaluate(
      async ({ data, stores, imageParts }) => {
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.open("progress-city-v1", 10);
          request.onupgradeneeded = () => {
            for (const [table, spec] of Object.entries(stores)) {
              const [keyPath, ...indexes] = spec.split(",");
              const store = request.result.createObjectStore(table, {
                keyPath,
              });
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
              value: "preserved-epoch",
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
            for (const { prefix, suffix, ...image } of imageParts) {
              const bytes = new Uint8Array(image.size);
              bytes.set(prefix);
              bytes.set(suffix, image.size - suffix.length);
              tx.objectStore("attachments").add({
                ...image,
                blob: new Blob([bytes], { type: image.mime }),
              });
            }
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
      { data, stores: legacyStores, imageParts },
    );
    await page.unroute(entryScript);
    if (boundary === "zip") {
      const decoded = await page.evaluate(async ({ prefix, suffix, size }) => {
        const bytes = new Uint8Array(size);
        bytes.set(prefix);
        bytes.set(suffix, size - suffix.length);
        const image = await createImageBitmap(
          new Blob([bytes], { type: "image/png" }),
        );
        const dimensions = { width: image.width, height: image.height };
        image.close();
        return dimensions;
      }, imageParts[0]);
      expect(decoded).toEqual({ width: 1, height: 1 });
    }
    const errors: string[] = [];
    const consoleErrors: Promise<string>[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error")
        consoleErrors.push(
          Promise.all(
            message
              .args()
              .map((arg) =>
                arg.evaluate((value: unknown) =>
                  value && typeof value === "object" && "message" in value
                    ? String(value.message)
                    : String(value),
                ),
              ),
          ).then((args) => args.join(" ")),
        );
    });
    await page.reload();
    await expect(page).toHaveTitle(/Progress City/);
    await expect(
      page.getByRole("heading", { name: "Не удалось открыть приложение" }),
    ).toBeVisible();
    await expect(page.getByText(/Обновление остановлено/)).toBeVisible();
    await expect(page.getByText(/Обновление остановлено/)).toContainText(
      boundary === "zip" ? "64 MiB" : "32 MiB",
    );
    await expect(
      page.getByRole("button", { name: "Скачать старый город" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Создать город", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Скачать старый город" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/v1.*\.progresscity\.zip$/);
    const files = unzipSync(
      new Uint8Array(await readFile((await file.path())!)),
    );
    const manifest = JSON.parse(strFromU8(files["manifest.json"]));
    expect(manifest.version).toBe(1);
    expect(files["data.json"].length).toBe(
      strToU8(JSON.stringify(data)).length,
    );
    const restored = dataSchema.parse(
      JSON.parse(strFromU8(files["data.json"])),
    );
    validateRelations(restored);
    expect(restored.notes).toEqual(
      [...data.notes].sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect(restored.events).toEqual(
      [...data.events].sort((a, b) => a.id.localeCompare(b.id)),
    );
    for (const [path, bytes] of Object.entries(images))
      expect(Buffer.from(files[path]).equals(bytes)).toBe(true);
    for (const entry of manifest.files as {
      path: string;
      size: number;
      sha256: string;
    }[]) {
      expect(files[entry.path].length).toBe(entry.size);
      const digest = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new Uint8Array(files[entry.path]),
          ),
        ),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      expect(digest).toBe(entry.sha256);
    }
    await page.screenshot({
      path: testInfo.outputPath("migration-recovery-desktop.png"),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole("button", { name: "Скачать старый город" }),
    ).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("migration-recovery-mobile.png"),
    });
    await page.getByRole("button", { name: "Повторить загрузку" }).click();
    await expect(
      page.getByRole("button", { name: "Скачать старый город" }),
    ).toBeVisible();
    const unchanged = await page.evaluate(
      async () =>
        new Promise<{
          version: number;
          epoch: string;
          count: number;
          upgraded: boolean;
        }>((resolve, reject) => {
          const request = indexedDB.open("progress-city-v1");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(["metadata", "notes"]);
            const epoch = tx.objectStore("metadata").get("epoch");
            const count = tx.objectStore("notes").count();
            tx.oncomplete = () => {
              resolve({
                version: db.version,
                epoch: epoch.result.value,
                count: count.result,
                upgraded: db.objectStoreNames.contains("learningObjects"),
              });
              db.close();
            };
          };
        }),
    );
    expect(unchanged).toEqual({
      version: 10,
      epoch: "preserved-epoch",
      count: data.notes.length,
      upgraded: false,
    });
    // React reports the intentionally caught migration failure; unrelated errors must fail.
    expect(
      [...errors, ...(await Promise.all(consoleErrors))].filter(
        (message) => !message.includes("Обновление остановлено"),
      ),
    ).toEqual([]);
  });

  test(`rejects a legacy archive before offering to replace the current city (${boundary})`, async ({
    page,
  }, testInfo) => {
    await createCity(page);
    const before = await rows(page, "cities");
    const epoch = await rows(page, "metadata");
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    const blob =
      boundary === "zip"
        ? (await zipBoundary(64 * 1024 * 1024 - 1024, 1)).zip
        : await archiveBytes(migrationBoundary(32 * 1024 * 1024, 1), 1, {
            "attachments/photo-image": pixel,
          });
    const path = testInfo.outputPath("boundary.progresscity.zip");
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    await page.getByLabel("Архив для восстановления").setInputFiles(path);
    await expect(page.getByRole("alert")).toContainText(
      boundary === "zip" ? "64 MiB" : "32 MiB",
    );
    await expect(page.getByRole("alert")).toContainText(
      "Текущий город сохранён",
    );
    await expect(
      page.getByRole("alertdialog", { name: "Подтверждение замены города" }),
    ).toHaveCount(0);
    expect(await rows(page, "cities")).toEqual(before);
    expect(await rows(page, "metadata")).toEqual(epoch);
    await page.reload();
    await expect(page.locator("canvas")).toHaveAttribute(
      "data-building-count",
      "1",
    );
    expect(await rows(page, "cities")).toEqual(before);
    expect(errors).toEqual([]);
  });
}
