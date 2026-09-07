import { test, expect } from "@playwright/test";
import { createCity } from "./helpers";
import { clickCell, rows } from "./helpers";
import type { Building } from "../../src/domain/model";
import { mkdir } from "node:fs/promises";
import path from "node:path";

test("synthetic architecture gallery renders all three templates and stages without console errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await createCity(page, "Мастерская 1");
  // Synthetic fixtures use the same transactional application commands as the UI.
  await page.evaluate(async () => {
    const modulePath = "/src/storage/service.ts";
    const { service } = (await import(
      /* @vite-ignore */ modulePath
    )) as typeof import("../../src/storage/service");
    const db = service.db;
    for (const b of await db.buildings.toArray())
      await service.removeBuilding(b.id);
    const names = ["Мастерская", "Библиотека", "Павильон"];
    const kinds = ["workshop", "library", "pavilion"] as const;
    for (let row = 0; row < 3; row++)
      for (let level = 1; level <= 3; level++) {
        const t =
          row === 0 && level === 1
            ? (await db.tracks.toArray())[0]
            : await service.createTrack({
                name: `${names[row]} ${level}`,
                type: "skill",
                description: "Синтетический пример для проверки архитектуры",
                goal: "",
                schedule: "",
                unit: "",
                comparison: "min",
              });
        await service.placeBuilding({
          id: crypto.randomUUID(),
          trackId: t.id,
          kind: kinds[row],
          name: `${names[row]} · ${level}`,
          color: ["#bc7153", "#647ba3", "#578b7c"][row],
          x: 14 + (level - 1) * 5,
          y: 14 + row * 5,
          w: 2,
          h: 2,
        });
        if (level > 1) {
          for (let a = 0; a < (level === 2 ? 1 : 3); a++) {
            const activity = await service.saveActivity({
              trackId: t.id,
              title: `Синтетический результат ${a + 1}`,
              result: "Проверка этапа в тестовой базе",
              kind: "apply",
              date: "2026-09-08",
              noteIds: [],
              achieved: true,
            });
            await service.confirmActivity(activity.id);
          }
          await service.upgrade(t.id, crypto.randomUUID());
          if (level === 3) await service.upgrade(t.id, crypto.randomUUID());
        }
      }
    await service.saveDistrict({
      id: crypto.randomUUID(),
      name: "Исследования",
      color: "#517d6c",
      x: 13,
      y: 13,
      w: 15,
      h: 15,
    });
    for (let x = 14; x < 27; x++)
      await service.placeBuilding({
        id: crypto.randomUUID(),
        name: "Дорожка",
        kind: "road",
        color: "#ac8a49",
        x,
        y: 17,
        w: 1,
        h: 1,
      });
    await service.placeBuilding({
      id: crypto.randomUUID(),
      name: "Тихий сквер",
      kind: "park",
      color: "#578b7c",
      x: 23,
      y: 21,
      w: 2,
      h: 2,
    });
    await service.snapshot("Архитектурная проверка · синтетические данные");
  });
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "23",
  );
  const folder = path.resolve("docs/review-evidence");
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: path.join(folder, "architecture-gallery.png"),
  });
  await page.getByRole("button", { name: "Библиотека 3", exact: true }).click();
  await page
    .getByRole("button", { name: "Найти на карте", exact: true })
    .click();
  await expect(page.getByTestId("stage")).toContainText("3");
  await page.screenshot({ path: path.join(folder, "building-detail.png") });
  await page.getByRole("button", { name: "История", exact: true }).click();
  await page.getByRole("button", { name: /Архитектурная проверка/ }).click();
  await expect(
    page.getByText("Исторический город · только просмотр"),
  ).toBeVisible();
  await page.screenshot({ path: path.join(folder, "history.png") });
  expect(errors).toEqual([]);
});
test("decor palette changes actual rendered pixels and persists on reload", async ({
  page,
}) => {
  await createCity(page);
  await page.getByRole("button", { name: "Строить", exact: true }).click();
  await page.getByLabel("Тип объекта").selectOption("tree");
  await page
    .getByRole("button", { name: "Выбрать место на карте", exact: true })
    .click();
  await clickCell(page, 23, 22);
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "2",
  );
  await expect(
    page.getByRole("button", { name: "Сохранить оформление", exact: true }),
  ).toBeVisible();
  const before = await page.locator("canvas").screenshot();
  await page
    .getByRole("combobox", { name: "Палитра", exact: true })
    .selectOption("#90759d");
  await page
    .getByRole("button", { name: "Сохранить оформление", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await rows<Building>(page, "buildings")).find((b) => b.kind === "tree")
          ?.color,
    )
    .toBe("#90759d");
  const after = await page.locator("canvas").screenshot();
  expect(after.equals(before)).toBe(false);
  await page.reload();
  expect(
    (await rows<Building>(page, "buildings")).find((b) => b.kind === "tree")
      ?.color,
  ).toBe("#90759d");
});
