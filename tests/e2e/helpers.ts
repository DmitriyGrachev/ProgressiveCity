import { expect, type Page } from "@playwright/test";
export async function createCity(page: Page, track = "Акварель") {
  await page.goto("/");
  await page.getByLabel("Название города").fill("Город открытий");
  await page.getByLabel("Первое направление").fill(track);
  await page
    .getByRole("button", { name: "Создать город", exact: true })
    .click();
  await expect(page.locator("canvas")).toHaveAttribute(
    "data-building-count",
    "1",
  );
}
export async function gridPoint(page: Page, x: number, y: number) {
  const canvas = page.locator("canvas");
  const bounds = await canvas.boundingBox();
  const c = JSON.parse((await canvas.getAttribute("data-camera"))!) as {
    x: number;
    y: number;
    zoom: number;
  };
  return {
    x: bounds!.x + c.x + (x - y) * 32 * c.zoom,
    y: bounds!.y + c.y + (x + y) * 16 * c.zoom,
  };
}
export async function clickCell(page: Page, x: number, y: number) {
  const p = await gridPoint(page, x + 0.5, y + 0.5);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
}
// Read-only access to the real IndexedDB for invariant assertions. No production test hooks.
export async function rows<T>(page: Page, table: string): Promise<T[]> {
  return page.evaluate(async (table) => {
    const request = indexedDB.open("progress-city-v1");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<T[]>((resolve, reject) => {
        const query = db.transaction(table).objectStore(table).getAll();
        query.onsuccess = () => resolve(query.result as T[]);
        query.onerror = () => reject(query.error);
      });
    } finally {
      db.close();
    }
  }, table);
}
