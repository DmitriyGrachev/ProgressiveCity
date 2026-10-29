import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createCity, rows } from "./helpers";
import type { Track } from "../../src/domain/model";

test("stabilization: two direction forms preserve saved fields and local input after conflict", async ({
  page,
  context,
}, testInfo) => {
  await createCity(page, "Оптика");
  const open = async (p: typeof page) => {
    await p.getByRole("button", { name: "Оптика", exact: true }).click();
    await p.getByRole("button", { name: "Направление", exact: true }).click();
  };
  await open(page);
  const peer = await context.newPage();
  await peer.goto("/");
  await open(peer);
  await expect(
    peer.getByRole("textbox", { name: "Описание", exact: true }),
  ).toHaveValue("");
  await page
    .getByRole("textbox", { name: "Описание", exact: true })
    .fill("Описание первой вкладки");
  await page
    .getByRole("button", { name: "Сохранить направление", exact: true })
    .click();
  await expect
    .poll(async () => (await rows<Track>(page, "tracks"))[0].description)
    .toBe("Описание первой вкладки");
  await peer.getByLabel("Название направления").fill("Мой локальный заголовок");
  await peer
    .getByRole("button", { name: "Сохранить направление", exact: true })
    .click();
  await expect(peer.getByRole("alert")).toContainText("другой вкладке");
  expect((await rows<Track>(page, "tracks"))[0].description).toBe(
    "Описание первой вкладки",
  );
  await expect(peer.getByLabel("Название направления")).toHaveValue(
    "Мой локальный заголовок",
  );
  await peer.screenshot({
    path: testInfo.outputPath("direction-conflict.png"),
  });
  await peer
    .getByRole("button", {
      name: "Загрузить актуальное направление",
      exact: true,
    })
    .click();
  await expect(
    peer.getByRole("textbox", { name: "Описание", exact: true }),
  ).toHaveValue("Описание первой вкладки");
  await peer.getByLabel("Название направления").fill("Согласованное название");
  await peer
    .getByRole("button", { name: "Сохранить направление", exact: true })
    .click();
  await peer
    .getByRole("textbox", { name: "Описание", exact: true })
    .fill("Дополнение после сохранения");
  await peer
    .getByRole("button", { name: "Сохранить направление", exact: true })
    .click();
  await expect
    .poll(async () => (await rows<Track>(peer, "tracks"))[0].description)
    .toBe("Дополнение после сохранения");
  await expect(
    peer.getByRole("status").filter({ hasText: "Направление сохранено" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Архивировать направление", exact: true })
    .click();
  await expect(
    peer.getByText("Сохранённое направление изменилось.", { exact: false }),
  ).toBeVisible();
  await peer
    .getByRole("button", { name: "Сохранить направление", exact: true })
    .click();
  await expect(peer.getByRole("alert")).toContainText("другой вкладке");
  await expect(
    peer.getByRole("status").filter({ hasText: "Направление сохранено" }),
  ).toHaveCount(0);
  expect((await rows<Track>(peer, "tracks"))[0].archived).toBe(true);
});
test("stabilization: quick verification refuses a truncated ZIP and keeps the city", async ({
  page,
}) => {
  await createCity(page, "Архив");
  await page.getByText("Копия и проверка архива", { exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Скачать полную копию", exact: true })
    .click();
  const bytes = await readFile((await (await downloading).path())!);
  const before = await rows(page, "tracks");
  await page.getByLabel("Проверить архив без замены").setInputFiles({
    name: "truncated.zip",
    mimeType: "application/zip",
    buffer: bytes.subarray(0, -22),
  });
  await expect(page.getByRole("alert")).toContainText(/ZIP|Архив|архив/);
  expect(await rows(page, "tracks")).toEqual(before);
});
test("stabilization: enabled daily guidance has readable contrast on desktop and narrow screens", async ({
  page,
}, testInfo) => {
  await createCity(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const hint = page.locator(".today-panel .hint").first();
    await expect(hint).toBeVisible();
    const colors = await hint.evaluate((el) => {
      let parent: Element | null = el,
        background = "rgb(255, 255, 255)";
      while (parent) {
        const c = getComputedStyle(parent).backgroundColor;
        if (c !== "rgba(0, 0, 0, 0)" && c !== "transparent") {
          background = c;
          break;
        }
        parent = parent.parentElement;
      }
      return [getComputedStyle(el).color, background];
    });
    const luminance = (c: string) =>
      c
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
        .map((v) => {
          v /= 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        })
        .reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i], 0);
    const [a, b] = colors.map(luminance);
    expect(
      (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`readable-${width}.png`),
    });
  }
});
test("stabilization: native beforeunload allows staying with an unconfirmed result", async ({
  page,
}) => {
  await createCity(page, "Оптика");
  await page.getByRole("button", { name: "Оптика", exact: true }).click();
  await page.getByRole("button", { name: "Результаты", exact: true }).click();
  await page
    .getByLabel("Название результата", { exact: true })
    .fill("Несохранённый опыт");
  const warning = page.waitForEvent("dialog");
  await page.close({ runBeforeUnload: true });
  const dialog = await warning;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  await expect(
    page.getByLabel("Название результата", { exact: true }),
  ).toHaveValue("Несохранённый опыт");
  expect(await rows(page, "activities")).toHaveLength(0);
  expect(await rows(page, "events")).toHaveLength(0);
  const closing = page.waitForEvent("close"),
    confirmation = page.waitForEvent("dialog");
  await page.close({ runBeforeUnload: true });
  await (await confirmation).accept();
  await closing;
});
