import { test, expect, type Page } from "@playwright/test";
import { clickCell, createCity, gridPoint, rows } from "./helpers";
import type { Building } from "../../src/domain/model";
import { archiveBytes, legacyCity } from "../fixtures/legacy-city";
import { readFile } from "node:fs/promises";

test("failed road persistence keeps the tool and supports retry without partial cells", async ({
  page,
}) => {
  await createCity(page);
  await tool(page, "road");
  await page.evaluate(async () => {
    const path = "/src/storage/db.ts";
    const { db } = (await import(
      path
    )) as typeof import("../../src/storage/db");
    const fail = () => {
      throw new Error("Synthetic layout write failure");
    };
    db.events.hook("creating", fail);
    Object.assign(window, {
      restoreLayoutWrites: () => db.events.hook("creating").unsubscribe(fail),
    });
  });
  await draw(page, [17, 22], [23, 22]);
  await page.mouse.up();
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic layout write failure",
  );
  expect(await rows(page, "buildings")).toHaveLength(1);
  await expect(
    page.getByRole("button", { name: "Отменить планировку", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", {
      name: "Завершить инструмент · Escape",
      exact: true,
    }),
  ).toBeVisible();
  await page.evaluate(() =>
    (
      window as unknown as { restoreLayoutWrites: () => void }
    ).restoreLayoutWrites(),
  );
  await draw(page, [17, 22], [23, 22]);
  await page.mouse.up();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "8",
  );
  await page
    .getByRole("button", { name: "Отменить планировку", exact: true })
    .click();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "1",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
});

async function tool(page: Page, kind: string) {
  await page.getByRole("button", { name: "Строить", exact: true }).click();
  await page.getByLabel("Тип объекта").selectOption(kind);
  await page.getByRole("button", { name: "Выбрать место на карте" }).click();
}
async function draw(page: Page, from: [number, number], to: [number, number]) {
  const a = await gridPoint(page, from[0] + 0.5, from[1] + 0.5);
  const b = await gridPoint(page, to[0] + 0.5, to[1] + 0.5);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
}
test("convenient planning: road gesture, serial decor, move undo redo and durable layout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const image = Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 32;
      c.height = 32;
      const g = c.getContext("2d")!;
      g.fillStyle = "#cfab71";
      g.fillRect(0, 0, 32, 32);
      return c.toDataURL("image/png").split(",")[1];
    }),
    "base64",
  );
  const old = legacyCity();
  old.city.name = "Мой квартал";
  old.attachments[0].size = image.length;
  old.tracks.push({
    ...old.tracks[0],
    id: "print",
    name: "Линогравюра",
    stage: 1,
    balance: 0,
  });
  old.buildings.push({
    ...old.buildings[0],
    id: "print-building",
    trackId: "print",
    name: "Линогравюра",
    kind: "pavilion",
    x: 25,
    y: 19,
  });
  const zip = await archiveBytes(old, 1, { "attachments/photo-image": image });
  await page
    .getByText("Уже есть город? Восстановить архив", { exact: true })
    .click();
  await page.getByLabel("Архив для восстановления").setInputFiles({
    name: "existing.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(await zip.arrayBuffer()),
  });
  await page.getByRole("button", { name: /Восстановить/ }).click();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "2",
  );
  const preserved = async () =>
    Promise.all(
      ["tracks", "learningObjects", "notes", "activities", "snapshots"].map(
        (name) => rows(page, name),
      ),
    );
  const before = await preserved();
  await tool(page, "road");
  await draw(page, [21, 20], [24, 20]);
  await expect(page.locator("canvas")).toHaveAttribute("data-road-cells", "4");
  expect(await rows<Building>(page, "buildings")).toHaveLength(2);
  await page.mouse.up();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "6",
  );
  await page
    .getByRole("button", { name: "Отменить планировку", exact: true })
    .click();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "2",
  );
  await page
    .getByRole("button", { name: "Повторить планировку", exact: true })
    .click();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "6",
  );
  await tool(page, "tree");
  await clickCell(page, 17, 18);
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "7",
  );
  await clickCell(page, 16, 18);
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "8",
  );
  await tool(page, "park");
  await clickCell(page, 18, 23);
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "9",
  );
  await clickCell(page, 21, 23);
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "10",
  );
  await page.keyboard.press("Escape");
  const moveWorkshop = async () => {
    await page.getByRole("button", { name: "Фотография", exact: true }).click();
    await page.getByRole("button", { name: "Оформление и перенос" }).click();
    await page.getByRole("button", { name: "Перенести на карте" }).click();
    await clickCell(page, 18, 16);
    await expect
      .poll(
        async () =>
          (await rows<Building>(page, "buildings")).find(
            (b) => b.id === "old-building",
          )!.x,
      )
      .toBe(18);
  };
  await moveWorkshop();
  const undo = page.getByRole("button", {
    name: "Отменить планировку",
    exact: true,
  });
  await undo.click();
  await expect
    .poll(
      async () =>
        (await rows<Building>(page, "buildings")).find(
          (b) => b.id === "old-building",
        )!.x,
    )
    .toBe(19);
  await page.locator("canvas").focus();
  await page.keyboard.press("Control+Shift+Z");
  await expect
    .poll(
      async () =>
        (await rows<Building>(page, "buildings")).find(
          (b) => b.id === "old-building",
        )!.x,
    )
    .toBe(18);
  expect(await preserved()).toEqual(before);
  await page.getByRole("button", { name: "Закрыть панель" }).click();
  await page.screenshot({ path: "docs/review-evidence/planning-city.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(undo).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "docs/review-evidence/planning-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Undo the later move and four decorations first; the road remains one command.
  for (let i = 0; i < 5; i++) {
    await undo.click();
    await expect(undo).toBeEnabled();
  }
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "6",
  );
  await undo.click();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "2",
  );
  await moveWorkshop();
  const layout = await rows(page, "buildings");
  await page.reload();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "2",
  );
  expect(await rows(page, "buildings")).toEqual(layout);
  expect(await preserved()).toEqual(before);
  await expect(undo).toBeDisabled();
  await page.getByRole("button", { name: "Библиотека", exact: true }).click();
  await page.getByRole("button", { name: "Первый свет", exact: true }).click();
  await expect(page.locator(".tiptap img")).toBeVisible();
  expect(
    await page
      .locator(".tiptap img")
      .evaluate((img) => (img as HTMLImageElement).naturalWidth),
  ).toBe(32);
  expect(errors).toEqual([]);
});

test("roads reject obstacles and boundaries, cancel interrupted gestures, and preserve existing crossings", async ({
  page,
}) => {
  await createCity(page);
  await tool(page, "road");
  await draw(page, [17, 20], [22, 20]);
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-placement-valid",
    "false",
  );
  await page.screenshot({
    path: "docs/review-evidence/planning-blocked-road.png",
  });
  await page.mouse.up();
  expect(await rows(page, "buildings")).toHaveLength(1);
  await draw(page, [17, 22], [23, 22]);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await rows(page, "buildings")).toHaveLength(1);
  await tool(page, "road");
  await draw(page, [17, 22], [23, 22]);
  await page.locator("canvas").dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
  expect(await rows(page, "buildings")).toHaveLength(1);
  await draw(page, [17, 22], [23, 22]);
  await page.mouse.up();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "8",
  );
  const original = await rows<Building>(page, "buildings");
  // Same active road tool: crossing leaves existing IDs and appearance unchanged.
  await draw(page, [22, 21], [22, 24]);
  await page.mouse.up();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "11",
  );
  await page.locator("canvas").focus();
  await page.keyboard.press("Control+Z");
  await expect.poll(() => rows(page, "buildings")).toEqual(original);
  await page.keyboard.press("Control+Y");
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "11",
  );
  // Zoom out so the near map boundary is within the real canvas.
  for (let i = 0; i < 5; i++)
    await page.getByRole("button", { name: "Отдалить", exact: true }).click();
  await tool(page, "road");
  await draw(page, [0, 19], [-1, 19]);
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-placement-valid",
    "false",
  );
  await page.mouse.up();
  expect(await rows(page, "buildings")).toHaveLength(11);
  await page.getByRole("button", { name: "История", exact: true }).click();
  await page.getByRole("button", { name: /Начало города/ }).click();
  await expect(
    page.getByRole("button", { name: "Отменить планировку", exact: true }),
  ).toBeDisabled();
});

test("note undo belongs to the editor and import in another tab clears layout commands and tool", async ({
  page,
  context,
}) => {
  await createCity(page);
  await tool(page, "tree");
  await clickCell(page, 17, 18);
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "2",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Акварель", exact: true }).click();
  await page
    .getByRole("button", { name: "Новая заметка", exact: true })
    .click();
  await page.locator(".tiptap").fill("Текст для отмены");
  await page.locator(".tiptap").press("Control+Z");
  await expect(page.locator(".tiptap")).not.toContainText("Текст для отмены");
  expect(await rows(page, "buildings")).toHaveLength(2);
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Экспортировать город", exact: true })
    .click();
  const zip = await readFile((await (await downloading).path())!);
  await tool(page, "road");
  const second = await context.newPage();
  await second.goto("/");
  await second.getByRole("button", { name: "Настройки", exact: true }).click();
  await second.getByLabel("Архив для восстановления").setInputFiles({
    name: "same-ids.zip",
    mimeType: "application/zip",
    buffer: zip,
  });
  await second
    .getByRole("button", { name: "Заменить текущий город", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Отменить планировку", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", {
      name: "Завершить инструмент · Escape",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.locator("canvas").focus();
  await page.keyboard.press("Control+Z");
  expect(await rows(page, "buildings")).toHaveLength(2);
  await tool(page, "tree");
  await clickCell(page, 16, 18);
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "3",
  );
  await page.keyboard.press("Control+Z");
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "2",
  );
  await second.close();
});
