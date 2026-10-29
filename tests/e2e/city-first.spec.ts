import { test, expect, type Page } from "@playwright/test";
import { createCity, rows, clickCell, gridPoint } from "./helpers";
import { readFile } from "node:fs/promises";
import { failWrites, restoreWrites } from "./daily-helpers";
import type {
  Building,
  District,
  Activity,
  ProgressEvent,
  Track,
} from "../../src/domain/model";
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
async function habit(page: Page) {
  await button(page, "Новое направление").click();
  await page.getByLabel("Название направления").fill("Прогулка");
  await page
    .getByRole("combobox", { name: "Тип направления", exact: true })
    .selectOption("habit");
  await page.getByLabel("Моя цель").fill("Прогуляться");
  await page.getByLabel("Единица", { exact: true }).fill("минут");
  await button(page, "Создать направление").click();
  await button(page, "Progress City").click();
}

test("city first: long research names keep compact controls within the narrow viewport", async ({
  page,
}) => {
  const name =
    "Свет и отражение — длинное название исследования с сохранёнными учебными материалами";
  await createCity(page, name);
  await button(page, name).click();
  await button(page, "Новая заметка").click();
  await page
    .getByRole("textbox", { name: "Текст заметки", exact: true })
    .fill("Синтетический материал для продолжения");
  await button(page, "Progress City").click();
  const resume = page.getByRole("region", { name: "Продолжить", exact: true });
  const quick = resume.getByRole("button", {
    name: `Продолжить «${name}»`,
    exact: true,
  });
  await expect(quick).toBeVisible();
  await expect(quick).toHaveAttribute("title", name);
  for (const width of [390, 320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const check = async () => {
      const bounds = await page.locator(".daily-panels").evaluate((panel) =>
        [...panel.querySelectorAll<HTMLElement>("section, button")]
          .filter((el) => el.getClientRects().length)
          .map((el) => {
            const r = el.getBoundingClientRect();
            const p = panel.getBoundingClientRect();
            return {
              name: el.getAttribute("aria-label") || el.textContent,
              fits:
                r.left >= p.left - 1 &&
                r.right <= innerWidth + 1 &&
                el.scrollWidth <= el.clientWidth + 1,
            };
          }),
      );
      expect(
        bounds.filter((r) => !r.fits),
        `width ${width}`,
      ).toEqual([]);
    };
    await check();
    await button(page, "Развернуть продолжение").focus();
    await page.keyboard.press("Enter");
    await check();
    await button(page, "Свернуть продолжение").click();
  }
});

test("city first: stale building form preserves input, rejects the write, reloads explicitly and supports undo", async ({
  page,
  context,
}) => {
  await createCity(page, "Оптика");
  const open = async (p: Page) => {
    await button(p, "Оптика").click();
    await button(p, "Оформление и перенос").click();
  };
  await open(page);
  const peer = await context.newPage();
  await peer.goto("/");
  await open(peer);
  await expect(
    peer.getByLabel("Свой акцент #RRGGBB", { exact: true }),
  ).toHaveValue("#bc7153");
  await page.getByLabel("Свой акцент #RRGGBB", { exact: true }).fill("#327a91");
  await button(page, "Сохранить оформление").click();
  await expect
    .poll(async () => (await rows<Building>(page, "buildings"))[0].color)
    .toBe("#327a91");
  const preserved = await Promise.all(
    ["tracks", "learningObjects", "notes", "activities", "events"].map((t) =>
      rows(peer, t),
    ),
  );
  await peer.getByLabel("Имя объекта", { exact: true }).fill("Моё имя");
  await button(peer, "Сохранить оформление").click();
  await expect(peer.getByRole("alert")).toContainText("другой вкладке");
  await expect(peer.getByLabel("Имя объекта", { exact: true })).toHaveValue(
    "Моё имя",
  );
  expect(
    await Promise.all(
      ["tracks", "learningObjects", "notes", "activities", "events"].map((t) =>
        rows(peer, t),
      ),
    ),
  ).toEqual(preserved);
  await expect(button(peer, "Отменить планировку")).toBeDisabled();
  await button(peer, "Загрузить актуальные поля").click();
  await expect(
    peer.getByLabel("Свой акцент #RRGGBB", { exact: true }),
  ).toHaveValue("#327a91");
  await peer
    .getByLabel("Имя объекта", { exact: true })
    .fill("Согласованное имя");
  await button(peer, "Сохранить оформление").click();
  await expect
    .poll(async () => (await rows<Building>(peer, "buildings"))[0].name)
    .toBe("Согласованное имя");
  await peer.getByLabel("Имя объекта", { exact: true }).fill("Дополненное имя");
  await button(peer, "Сохранить оформление").click();
  await expect
    .poll(async () => (await rows<Building>(peer, "buildings"))[0].name)
    .toBe("Дополненное имя");
  await button(peer, "Отменить планировку").click();
  await expect
    .poll(async () => (await rows<Building>(peer, "buildings"))[0].name)
    .toBe("Согласованное имя");
  expect((await rows<Building>(peer, "buildings"))[0].color).toBe("#327a91");
});

test("city first: stale district form cannot overwrite width and can explicitly reload", async ({
  page,
  context,
}) => {
  await createCity(page);
  await button(page, "Районы").click();
  await page.getByLabel("Имя района", { exact: true }).fill("Сад");
  await button(page, "Сохранить район").click();
  await page.locator(".district-row .list-row").first().click();
  const peer = await context.newPage();
  await peer.goto("/");
  await button(peer, "Районы").click();
  await peer.locator(".district-row .list-row").first().click();
  await expect(peer.getByLabel("Ширина", { exact: true })).toHaveValue("10");
  await page.getByLabel("Ширина", { exact: true }).fill("12");
  await button(page, "Сохранить район").click();
  await expect
    .poll(async () => (await rows<District>(page, "districts"))[0].w)
    .toBe(12);
  const before = await rows(peer, "events");
  await peer.getByLabel("Имя района", { exact: true }).fill("Сад B");
  await button(peer, "Сохранить район").click();
  await expect(peer.getByRole("alert")).toContainText("другой вкладке");
  expect((await rows<District>(peer, "districts"))[0].w).toBe(12);
  expect(await rows(peer, "events")).toEqual(before);
  await expect(peer.getByLabel("Имя района", { exact: true })).toHaveValue(
    "Сад B",
  );
  await button(peer, "Загрузить актуальные поля").click();
  await expect(peer.getByLabel("Ширина", { exact: true })).toHaveValue("12");
  await peer.getByLabel("Имя района", { exact: true }).fill("Новый сад");
  await button(peer, "Сохранить район").click();
  await expect
    .poll(async () => (await rows<District>(peer, "districts"))[0].name)
    .toBe("Новый сад");
  await button(peer, "Отменить планировку").click();
  await expect
    .poll(async () => (await rows<District>(peer, "districts"))[0].name)
    .toBe("Сад");
  expect((await rows<District>(peer, "districts"))[0].w).toBe(12);
});

test("city first: compact home and short habit form keep text, show persisted receipt and reload the same record", async ({
  page,
}, info) => {
  await createCity(page);
  await expect(button(page, "Развернуть продолжение")).toBeVisible();
  await expect(button(page, "Развернуть привычки")).toBeVisible();
  await habit(page);
  const homeHeight = await page
    .locator(".daily-panels")
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(homeHeight).toBeLessThan(180);
  await page.screenshot({ path: info.outputPath("compact-home.png") });
  await button(page, "Отметить «Прогулка»").click();
  await page
    .locator("canvas")
    .evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  const camera = await page.locator("canvas").getAttribute("data-camera");
  await expect(
    page.getByLabel("Название результата", { exact: true }),
  ).toBeHidden();
  await page
    .getByLabel("Что получилось", { exact: true })
    .fill("Прогулялся и заметил осенние деревья.");
  await page
    .getByRole("combobox", { name: "Тип результата", exact: true })
    .selectOption("apply");
  await page.getByLabel("Я считаю свою цель выполненной").check();
  await button(page, "Подробная запись").click();
  await page
    .getByLabel("Название результата", { exact: true })
    .fill("Прогулка у дома");
  await page.getByLabel("Минуты, необязательно", { exact: true }).fill("10");
  await button(page, "Короткая запись").click();
  await expect(
    page.getByRole("textbox", { name: "Что получилось", exact: true }),
  ).toHaveValue("Прогулялся и заметил осенние деревья.");
  expect(await rows(page, "activities")).toHaveLength(0);
  await button(page, "Подтвердить результат").click();
  await expect(page.getByTestId("habit-receipt")).toContainText("+3");
  await expect(page.getByTestId("habit-receipt")).toBeInViewport();
  await expect(page.getByTestId("balance")).toContainText("3");
  expect((await rows<Activity>(page, "activities"))[0]).toMatchObject({
    title: "Прогулка у дома",
    confirmed: true,
    duration: 10,
  });
  expect(
    (await rows<Track>(page, "tracks")).find((t) => t.name === "Прогулка")
      ?.balance,
  ).toBe(3);
  await expect(button(page, "Подтвердить результат")).toBeDisabled();
  expect(await page.locator("canvas").getAttribute("data-camera")).toBe(camera);
  await page.screenshot({ path: info.outputPath("habit-receipt.png") });
  await button(page, "Вернуться в город").click();
  await page.reload();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "1",
  );
  await button(page, "Открыть «Прогулка»").click();
  await expect(page.getByTestId("habit-receipt")).toContainText("+3");
  await button(page, "Подробная запись").click();
  await expect(
    page.getByLabel("Название результата", { exact: true }),
  ).toHaveValue("Прогулка у дома");
  await expect(
    page.getByLabel("Минуты, необязательно", { exact: true }),
  ).toHaveValue("10");
  expect(await rows(page, "activities")).toHaveLength(1);
  expect(
    (await rows<ProgressEvent>(page, "events")).filter(
      (e) => e.type === "activity",
    ),
  ).toHaveLength(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await button(page, "Короткая запись").click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath("habit-narrow.png") });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await button(page, "Выбрать место для здания").click();
  await page
    .getByRole("combobox", { name: "Тип объекта", exact: true })
    .selectOption("pavilion");
  await button(page, "Выбрать место на карте").click();
  await clickCell(page, 23, 19);
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "2",
  );
  await button(page, "Прогулка").click();
  await button(page, "Отметить сегодня").click();
  await button(page, "К развитию здания").click();
  await button(page, "Улучшить").click();
  await expect(page.getByTestId("stage")).toContainText("2");
  await expect(page.getByTestId("balance")).toContainText("0");
  await button(page, "Показать место").click();
  await expect(
    page.getByRole("complementary", { name: "Панель города", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "2",
  );
  await button(page, "Открыть «Прогулка»").click();
  await expect(page.getByTestId("stage")).toContainText("2");
  await expect(page.getByTestId("habit-receipt")).toContainText("+3");
});

test("city first: compact habit status shows the persisted daily outcome", async ({
  page,
}) => {
  await createCity(page);
  await habit(page);
  await button(page, "Отметить «Прогулка»").click();
  await page
    .getByRole("textbox", { name: "Что получилось", exact: true })
    .fill("Вышел на прогулку");
  await page
    .getByRole("combobox", { name: "Тип результата", exact: true })
    .selectOption("apply");
  await page.getByLabel("Я считаю свою цель выполненной").check();
  await button(page, "Подтвердить результат").click();
  await expect(page.getByTestId("habit-receipt")).toContainText("+3");
  await button(page, "Вернуться в город").click();
  await expect(button(page, "Открыть «Прогулка»")).toHaveAttribute(
    "title",
    /Подтверждено.*3/,
  );
  await expect(button(page, "Открыть «Прогулка»")).toContainText("+3");
});

test("city first: a new build request blocks the old form until its fresh controls are ready", async ({
  page,
}) => {
  await createCity(page);
  await button(page, "Строить").click();
  await page
    .getByRole("combobox", { name: "Тип объекта", exact: true })
    .selectOption("tree");
  await page.evaluate(async () => {
    const open = indexedDB.open("progress-city-v1");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const tx = db.transaction("metadata", "readwrite");
    let holding = true;
    Object.assign(window, {
      releaseMetadataLock: () => {
        holding = false;
      },
    });
    tx.oncomplete = () => db.close();
    tx.onabort = () => db.close();
    await new Promise<void>((resolve) => {
      let ready = false;
      const read = () => {
        const request = tx.objectStore("metadata").get("epoch");
        request.onsuccess = () => {
          if (!ready) {
            ready = true;
            resolve();
          }
          if (holding) read();
        };
      };
      read();
    });
  });
  try {
    await button(page, "Строить").click();
    await expect(
      page.getByRole("combobox", { name: "Тип объекта", exact: true }),
    ).toBeDisabled();
  } finally {
    await page.evaluate(() =>
      (
        window as unknown as { releaseMetadataLock(): void }
      ).releaseMetadataLock(),
    );
  }
  await page
    .getByRole("combobox", { name: "Тип объекта", exact: true })
    .selectOption("road");
  await button(page, "Выбрать место на карте").click();
  await expect(
    page.getByText("Проведите мышью маршрут и отпустите.", { exact: false }),
  ).toBeVisible();
});

test("city first: request day always returns from a selected old record to today", async ({
  page,
}) => {
  await createCity(page);
  await habit(page);
  await button(page, "Отметить «Прогулка»").click();
  await button(page, "Подробная запись").click();
  await page
    .getByLabel("Название результата", { exact: true })
    .fill("Сегодняшняя прогулка");
  await page
    .getByRole("textbox", { name: "Что получилось", exact: true })
    .fill("Сегодня гулял");
  await button(page, "Подтвердить результат").click();
  await expect(page.getByTestId("habit-receipt")).toBeVisible();
  const today = (await rows<Activity>(page, "activities"))[0].date;
  const prior = new Date(today + "T12:00:00Z");
  prior.setUTCDate(prior.getUTCDate() - 1);
  const yesterday = prior.toISOString().slice(0, 10);
  await button(page, "Новая запись").click();
  await button(page, "Подробная запись").click();
  await page
    .getByLabel("Название результата", { exact: true })
    .fill("Вчерашняя прогулка");
  await page.getByLabel("Дата результата", { exact: true }).fill(yesterday);
  await page
    .getByRole("textbox", { name: "Что получилось", exact: true })
    .fill("Вчера гулял");
  await button(page, "Подтвердить результат").click();
  await expect(page.getByTestId("habit-receipt")).toContainText(yesterday);
  await button(page, "Вернуться в город").click();
  await button(page, "Открыть «Прогулка»").click();
  await expect(
    page.getByRole("textbox", { name: "Что получилось", exact: true }),
  ).toHaveValue("Сегодня гулял");
  await page.getByRole("button", { name: /^Вчерашняя прогулка/ }).click();
  await expect(
    page.getByRole("textbox", { name: "Что получилось", exact: true }),
  ).toHaveValue("Вчера гулял");
  await button(page, "Отметить сегодня").click();
  await expect(
    page.getByRole("textbox", { name: "Что получилось", exact: true }),
  ).toHaveValue("Сегодня гулял");
  expect(await rows(page, "activities")).toHaveLength(2);
});

test("city first: map controls text fits its own buttons on desktop and narrow screen", async ({
  page,
}) => {
  await createCity(page);
  for (const [width, height] of [
    [1440, 1000],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    expect(
      await page
        .locator(".map-controls button")
        .evaluateAll((buttons) =>
          buttons.every(
            (button) => button.scrollWidth <= button.clientWidth + 1,
          ),
        ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("city first: a visible building above the right controls keeps its hovered name after pan", async ({
  page,
}) => {
  await createCity(page);
  const canvas = (await page.locator("canvas").boundingBox())!;
  const controls = (await page.locator(".map-controls").boundingBox())!;
  const heading = (await page.locator(".map-heading").boundingBox())!;
  const center = await gridPoint(page, 20, 20);
  const target = {
    x: controls.x + controls.width / 2,
    y: heading.y + heading.height + 160,
  };
  const start = { x: canvas.x + 80, y: canvas.y + canvas.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(
    start.x + target.x - center.x,
    start.y + target.y - center.y,
    { steps: 5 },
  );
  await page.mouse.up({ button: "right" });
  await page.mouse.move(target.x, target.y - 18);
  const building = (await rows<Building>(page, "buildings"))[0];
  await expect(
    page.locator(`.map-label[data-entity-id="${building.id}"]`),
  ).toBeVisible();
});

test("city first: progress focus excludes far decor and district while real canvas stays clickable", async ({
  page,
}, info) => {
  await createCity(page);
  for (const [x, y] of [
    [0, 0],
    [38, 38],
  ]) {
    await button(page, "Строить").click();
    await page
      .getByRole("combobox", { name: "Тип объекта", exact: true })
      .selectOption("tree");
    await page
      .getByText("Точное размещение по клеткам", { exact: true })
      .click();
    await page.getByLabel("X", { exact: true }).fill(String(x));
    await page.getByLabel("Y", { exact: true }).fill(String(y));
    await button(page, "Разместить по координатам").click();
    await expect
      .poll(async () =>
        (await rows<Building>(page, "buildings")).some(
          (b) => b.x === x && b.y === y,
        ),
      )
      .toBe(true);
  }
  await button(page, "Районы").click();
  await page.getByLabel("Имя района", { exact: true }).fill("Дальний сад");
  await page.getByLabel("X района", { exact: true }).fill("0");
  await page.getByLabel("Y района", { exact: true }).fill("0");
  await button(page, "Сохранить район").click();
  await button(page, "Progress City").click();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "3",
  );
  const before = await Promise.all(
    [
      "tracks",
      "learningObjects",
      "notes",
      "activities",
      "events",
      "snapshots",
    ].map((t) => rows(page, t)),
  );
  await button(page, "Показать застройку").click();
  const whole = JSON.parse(
    (await page.locator("canvas").getAttribute("data-camera"))!,
  );
  await button(page, "Мои постройки").click();
  const focused = JSON.parse(
    (await page.locator("canvas").getAttribute("data-camera"))!,
  );
  expect(focused.zoom).toBeGreaterThan(whole.zoom * 1.5);
  await page.screenshot({ path: info.outputPath("progress-focus.png") });
  const building = (await rows<Building>(page, "buildings")).find(
    (b) => b.trackId,
  )!;
  await clickCell(page, building.x, building.y);
  await expect(button(page, "Найти на карте")).toBeVisible();
  await button(page, "Закрыть панель").click();
  for (const [width, height] of [
    [1024, 700],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await button(page, "Мои постройки").click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath("focus-" + width + ".png") });
  }
  expect(
    await Promise.all(
      [
        "tracks",
        "learningObjects",
        "notes",
        "activities",
        "events",
        "snapshots",
      ].map((t) => rows(page, t)),
    ),
  ).toEqual(before);
});

test("city first: same-ID import invalidates building and district forms without discarding their input", async ({
  page,
  context,
}) => {
  await createCity(page, "Оптика");
  await button(page, "Районы").click();
  await page.getByLabel("Имя района", { exact: true }).fill("Сад");
  await button(page, "Сохранить район").click();
  const buildingTab = await context.newPage();
  await buildingTab.goto("/");
  await button(buildingTab, "Оптика").click();
  await button(buildingTab, "Оформление и перенос").click();
  await buildingTab
    .getByLabel("Имя объекта", { exact: true })
    .fill("Старый ввод здания");
  const districtTab = await context.newPage();
  await districtTab.goto("/");
  await button(districtTab, "Районы").click();
  await districtTab.locator(".district-row .list-row").first().click();
  await districtTab
    .getByLabel("Имя района", { exact: true })
    .fill("Старый ввод района");
  await button(page, "Настройки").click();
  const download = page.waitForEvent("download");
  await button(page, "Экспортировать город").click();
  const zip = await readFile((await (await download).path())!);
  const oldEpoch = await rows(page, "metadata");
  await page
    .getByLabel("Архив для восстановления", { exact: true })
    .setInputFiles({
      name: "same-city.zip",
      mimeType: "application/zip",
      buffer: zip,
    });
  await Promise.all([
    page.waitForEvent("load"),
    button(page, "Заменить текущий город").click(),
  ]);
  await expect.poll(() => rows(buildingTab, "metadata")).not.toEqual(oldEpoch);
  await expect(button(buildingTab, "Сохранить оформление")).toBeDisabled();
  await expect(
    buildingTab.getByLabel("Имя объекта", { exact: true }),
  ).toHaveValue("Старый ввод здания");
  await expect(button(districtTab, "Сохранить район")).toBeDisabled();
  await expect(
    districtTab.getByLabel("Имя района", { exact: true }),
  ).toHaveValue("Старый ввод района");
  expect((await rows<Building>(page, "buildings"))[0].name).toBe("Оптика");
  expect((await rows<District>(page, "districts"))[0].name).toBe("Сад");
  await button(buildingTab, "Загрузить актуальные поля").click();
  await buildingTab
    .getByLabel("Имя объекта", { exact: true })
    .fill("После импорта");
  await button(buildingTab, "Сохранить оформление").click();
  await expect
    .poll(async () => (await rows<Building>(page, "buildings"))[0].name)
    .toBe("После импорта");
  await button(districtTab, "Загрузить актуальные поля").click();
  await districtTab.getByLabel("Имя района", { exact: true }).fill("Новый сад");
  await button(districtTab, "Сохранить район").click();
  await expect
    .poll(async () => (await rows<District>(page, "districts"))[0].name)
    .toBe("Новый сад");
});

test("city first: a stale move tool refuses to revert another tab color, fresh move returns to city", async ({
  page,
  context,
}) => {
  await createCity(page, "Оптика");
  const peer = await context.newPage();
  await peer.goto("/");
  for (const tab of [page, peer]) {
    await button(tab, "Оптика").click();
    await button(tab, "Оформление и перенос").click();
  }
  await button(peer, "Перенести на карте").click();
  await page.getByLabel("Свой акцент #RRGGBB", { exact: true }).fill("#327a91");
  await button(page, "Сохранить оформление").click();
  await expect
    .poll(async () => (await rows<Building>(page, "buildings"))[0].color)
    .toBe("#327a91");
  const events = await rows(page, "events");
  await clickCell(peer, 23, 18);
  await expect(peer.getByRole("alert")).toContainText("другой вкладке");
  expect((await rows<Building>(peer, "buildings"))[0]).toMatchObject({
    color: "#327a91",
    x: 19,
    y: 19,
  });
  expect(await rows(peer, "events")).toEqual(events);
  await peer.keyboard.press("Escape");
  await button(peer, "Загрузить актуальные поля").click();
  await button(peer, "Перенести на карте").click();
  await clickCell(peer, 23, 18);
  await expect
    .poll(async () => (await rows<Building>(peer, "buildings"))[0])
    .toMatchObject({ color: "#327a91", x: 23, y: 18 });
  await expect(
    peer.getByRole("complementary", { name: "Панель города", exact: true }),
  ).toHaveCount(0);
  await button(peer, "Отменить планировку").click();
  await expect
    .poll(async () => (await rows<Building>(peer, "buildings"))[0])
    .toMatchObject({ color: "#327a91", x: 19, y: 19 });
});

test("city first: receipt waits for persistence and keeps the actual zero across another record and changed rules", async ({
  page,
}) => {
  await createCity(page);
  await habit(page);
  await button(page, "Отметить «Прогулка»").click();
  await page
    .getByRole("textbox", { name: "Что получилось", exact: true })
    .fill("Сегодня только наблюдение.");
  await failWrites(page, "events");
  await button(page, "Подтвердить результат").click();
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic write failure",
  );
  await expect(page.getByTestId("habit-receipt")).toHaveCount(0);
  expect((await rows<Activity>(page, "activities"))[0].confirmed).toBe(false);
  expect(
    (await rows<Track>(page, "tracks")).find((t) => t.name === "Прогулка")
      ?.balance,
  ).toBe(0);
  await restoreWrites(page);
  await button(page, "Подтвердить результат").click();
  await expect(page.getByTestId("habit-receipt")).toContainText(
    "учтено 0 очков",
  );
  const event = (await rows<ProgressEvent>(page, "events")).find(
    (e) => e.type === "activity",
  )!;
  await button(page, "Новая запись").click();
  await page
    .getByRole("textbox", { name: "Что получилось", exact: true })
    .fill("Дополнение к той же дате.");
  await page.getByLabel("Я считаю свою цель выполненной").check();
  await page
    .getByRole("combobox", { name: "Тип результата", exact: true })
    .selectOption("apply");
  await button(page, "Подтвердить результат").click();
  await expect(page.getByTestId("habit-receipt")).toContainText(
    "учтено 0 очков",
  );
  await expect(page.getByTestId("habit-receipt")).toContainText(
    "Повторно очки не начислялись",
  );
  expect(
    (await rows<Activity>(page, "activities")).filter((a) => a.confirmed),
  ).toHaveLength(2);
  await button(page, "Настройки").click();
  await page.getByLabel("Применение", { exact: true }).fill("7");
  await button(page, "Сохранить правила").click();
  await button(page, "Progress City").click();
  await button(page, "Открыть «Прогулка»").click();
  await expect(page.getByTestId("habit-receipt")).toContainText(
    "учтено 0 очков",
  );
  await expect(page.getByTestId("habit-receipt")).toContainText(
    `Правило версии ${event.ruleVersion}`,
  );
  expect(
    (await rows<ProgressEvent>(page, "events")).filter(
      (e) => e.type === "activity",
    ),
  ).toEqual([event]);
});

test("city first: final habit stage remains honest and confirmation after it preserves the earned city", async ({
  page,
}) => {
  await createCity(page);
  await habit(page);
  await button(page, "Отметить «Прогулка»").click();
  for (let offset = 0; offset < 3; offset++) {
    if (offset) await button(page, "Новая запись").click();
    await button(page, "Подробная запись").click();
    if (offset) {
      const first = (await rows<Activity>(page, "activities"))[0].date;
      const day = new Date(first + "T12:00:00Z");
      day.setUTCDate(day.getUTCDate() - offset);
      await page
        .getByLabel("Дата результата", { exact: true })
        .fill(day.toISOString().slice(0, 10));
    }
    await page
      .getByRole("textbox", { name: "Что получилось", exact: true })
      .fill(`Синтетическая прогулка ${offset + 1}`);
    await page
      .getByRole("combobox", { name: "Тип результата", exact: true })
      .selectOption("apply");
    await page.getByLabel("Я считаю свою цель выполненной").check();
    await button(page, "Подтвердить результат").click();
    await expect(page.getByTestId("habit-receipt")).toContainText("+3");
  }
  await button(page, "К развитию здания").click();
  await button(page, "Улучшить").click();
  await expect(page.getByTestId("stage")).toContainText("2");
  await button(page, "Улучшить").click();
  await expect(page.getByTestId("stage")).toContainText("3");
  await expect(page.getByTestId("habit-receipt")).toContainText(
    "Все три этапа открыты",
  );
  await expect(button(page, "Улучшить")).toBeDisabled();
  await expect(button(page, "К развитию здания")).toBeVisible();
  await expect(button(page, "Приобрести сад · 3 очка")).toBeDisabled();
  await page.reload();
  await button(page, "Открыть «Прогулка»").click();
  await expect(page.getByTestId("stage")).toContainText("3");
  await expect(page.getByTestId("habit-receipt")).toContainText(
    "Все три этапа открыты",
  );
  expect(
    (await rows<ProgressEvent>(page, "events")).filter(
      (e) => e.type === "activity",
    ),
  ).toHaveLength(3);
  expect(
    (await rows<Track>(page, "tracks")).find((t) => t.name === "Прогулка"),
  ).toMatchObject({ stage: 3, balance: 0 });
  await button(page, "Новая запись").click();
  await button(page, "Подробная запись").click();
  const dates = (await rows<Activity>(page, "activities"))
    .map((a) => a.date)
    .sort();
  const extra = new Date(dates[0] + "T12:00:00Z");
  extra.setUTCDate(extra.getUTCDate() - 1);
  await page
    .getByLabel("Дата результата", { exact: true })
    .fill(extra.toISOString().slice(0, 10));
  await page
    .getByRole("textbox", { name: "Что получилось", exact: true })
    .fill("Синтетическая прогулка после финального этапа");
  await page
    .getByRole("combobox", { name: "Тип результата", exact: true })
    .selectOption("apply");
  await page.getByLabel("Я считаю свою цель выполненной").check();
  await button(page, "Подтвердить результат").click();
  await expect(page.getByTestId("habit-receipt")).toContainText("+3");
  await expect(button(page, "Улучшить")).toBeDisabled();
  expect(
    (await rows<Track>(page, "tracks")).find((t) => t.name === "Прогулка"),
  ).toMatchObject({ stage: 3, balance: 3 });
  await expect(button(page, "Приобрести сад · 3 очка")).toBeEnabled();
  expect(
    (await rows<ProgressEvent>(page, "events")).filter(
      (e) => e.type === "activity",
    ),
  ).toHaveLength(4);
});
