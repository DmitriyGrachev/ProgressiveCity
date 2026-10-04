import type { Page } from "@playwright/test";
export async function failWrites(page: Page, table: string) {
  await page.evaluate((table) => {
    const put = IDBObjectStore.prototype.put,
      add = IDBObjectStore.prototype.add;
    Object.assign(window, {
      restoreDailyWrites: () => {
        IDBObjectStore.prototype.put = put;
        IDBObjectStore.prototype.add = add;
      },
    });
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === table)
        throw new DOMException("Synthetic write failure", "QuotaExceededError");
      return put.call(this, value, key);
    };
    IDBObjectStore.prototype.add = function (value, key) {
      if (this.name === table)
        throw new DOMException("Synthetic write failure", "QuotaExceededError");
      return add.call(this, value, key);
    };
  }, table);
}
export async function restoreWrites(page: Page) {
  await page.evaluate(() =>
    (window as unknown as { restoreDailyWrites(): void }).restoreDailyWrites(),
  );
}
