import { spawn } from "node:child_process";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const label = process.argv[2] || "after";
if (!/^[a-z-]+$/.test(label)) throw new Error("Use a simple report label");
const port = 4186,
  origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  { cwd: root, stdio: "pipe", windowsHide: true },
);
let serverOutput = "";
server.stderr.on("data", (data) => {
  serverOutput += data;
});
let browser;
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null)
      throw new Error(serverOutput || "Preview exited");
    try {
      ready = (await fetch(origin)).ok;
    } catch {
      /* Not listening yet. */
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("Preview readiness timeout");
  browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const runs = [];
  for (const state of ["empty", "filled"])
    for (let run = 0; run < 3; run++) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      await page.goto(origin);
      await page.getByLabel("Название города").waitFor();
      if (state === "filled") {
        await page.getByLabel("Первое направление").fill("Синтетический замер");
        await page
          .getByRole("button", { name: "Создать город", exact: true })
          .click();
        await page.locator('canvas[data-building-count="1"]').waitFor();
        await page.evaluate(async () => {
          const db = await new Promise((resolve, reject) => {
            const req = indexedDB.open("progress-city-v1");
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          try {
            const track = await new Promise((resolve) => {
              const req = db
                .transaction("tracks")
                .objectStore("tracks")
                .getAll();
              req.onsuccess = () => resolve(req.result[0]);
            });
            await new Promise((resolve, reject) => {
              const tx = db.transaction("notes", "readwrite");
              const text =
                "Синтетический материал для одинакового замера. ".repeat(100);
              for (let i = 0; i < 100; i++)
                tx.objectStore("notes").add({
                  id: `perf-note-${i}`,
                  trackId: track.id,
                  learningObjectId: track.id,
                  title: `Материал ${i}`,
                  text,
                  tags: ["замер"],
                  revision: 1,
                  createdAt: "2026-10-04T08:00:00.000Z",
                  updatedAt: "2026-10-04T08:00:00.000Z",
                  doc: {
                    type: "doc",
                    content: [
                      { type: "paragraph", content: [{ type: "text", text }] },
                    ],
                  },
                });
              tx.oncomplete = resolve;
              tx.onerror = () => reject(tx.error);
            });
          } finally {
            db.close();
          }
        });
      }
      const requested = new Map(),
        pending = [],
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("response", (response) => {
        if (new URL(response.url()).pathname.endsWith(".js"))
          pending.push(
            (async () => {
              const body = await response.body();
              requested.set(new URL(response.url()).pathname, {
                bytes: body.length,
                gzip: gzipSync(body).length,
              });
            })(),
          );
      });
      await page.reload();
      await (
        state === "filled"
          ? page.locator('canvas[data-building-count="1"]')
          : page.getByLabel("Название города")
      ).waitFor();
      const readyMs = await page.evaluate(() => performance.now());
      await page.waitForLoadState("networkidle");
      await Promise.all(pending);
      if (errors.length) throw new Error(errors.join("\n"));
      runs.push({
        state,
        run: run + 1,
        readyMs: Math.round(readyMs),
        js: [...requested].map(([file, sizes]) => ({ file, ...sizes })),
        bytes: [...requested.values()].reduce((n, v) => n + v.bytes, 0),
        gzip: [...requested.values()].reduce((n, v) => n + v.gzip, 0),
      });
      await context.close();
    }
  const assets = [];
  for (const file of await readdir(path.join(root, "dist/assets"))) {
    const body = await readFile(path.join(root, "dist/assets", file));
    assets.push({ file, bytes: body.length, gzip: gzipSync(body).length });
  }
  const report = {
    label,
    measuredAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    browser: browser.version(),
    viewport: "1440x1000",
    cache:
      "CDP HTTP cache disabled; fresh disposable context per run; reload after identical setup",
    fixture:
      "empty onboarding; filled: 1 workshop, 1 learning object, 100 notes x 4500 characters",
    repeats: 3,
    summaries: ["empty", "filled"].map((state) => ({
      state,
      readyMs: median(
        runs.filter((r) => r.state === state).map((r) => r.readyMs),
      ),
      jsBytes: median(
        runs.filter((r) => r.state === state).map((r) => r.bytes),
      ),
      jsGzip: median(runs.filter((r) => r.state === state).map((r) => r.gzip)),
    })),
    assets,
    runs,
  };
  await mkdir(path.join(root, ".tools"), { recursive: true });
  await writeFile(
    path.join(root, `.tools/perf-${label}.json`),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        label,
        summaries: report.summaries,
        report: `.tools/perf-${label}.json`,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const stopped = new Promise((resolve) => server.once("exit", resolve));
    server.kill();
    await stopped;
  }
}
