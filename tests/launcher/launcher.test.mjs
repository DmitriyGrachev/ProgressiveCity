import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  mkdir,
  cp,
  writeFile,
  readFile,
  rm,
  mkdtemp,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import http from "node:http";
import { packageManager } from "../../scripts/launcher/core.mjs";
import { chromium } from "@playwright/test";
import { dailyJourney, importDailyFixture } from "../e2e/daily-journey.ts";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const homes = [];
const testPort = 45173;
function run(root, command, extra = [], env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.join(root, "scripts/launcher/cli.mjs"),
        command,
        "--test-port",
        String(testPort),
        "--no-browser",
        ...extra,
      ],
      { cwd: repo, windowsHide: true, env: { ...process.env, ...env } },
    );
    let output = "";
    child.stdout.on("data", (v) => {
      output += v;
    });
    child.stderr.on("data", (v) => {
      output += v;
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, output }));
  });
}
async function fixture(name = "Город с пробелами") {
  await mkdir(path.join(repo, ".tools"), { recursive: true });
  const base = await mkdtemp(path.join(repo, ".tools/launcher-test-"));
  const root = path.join(base, name);
  homes.push(base);
  await mkdir(root, { recursive: true });
  await cp(
    path.join(repo, "scripts/launcher"),
    path.join(root, "scripts/launcher"),
    { recursive: true },
  );
  for (const action of ["Prepare", "Start", "Stop"])
    await cp(
      path.join(repo, `${action} Progress City.cmd`),
      path.join(root, `${action} Progress City.cmd`),
    );
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src/test.js"), "export const version = 1;");
  await writeFile(
    path.join(root, "package.json"),
    '{"scripts":{"build":"fixture"}}',
  );
  await writeFile(path.join(root, "package-lock.json"), "{}");
  await mkdir(path.join(root, "node_modules/vite/bin"), { recursive: true });
  await writeFile(
    path.join(root, "node_modules/vite/bin/vite.js"),
    "// Dependency marker",
  );
  await mkdir(path.join(root, ".tools/package/bin"), { recursive: true });
  await writeFile(
    path.join(root, ".tools/package/bin/npm-cli.js"),
    `
const fs = require('node:fs'), path = require('node:path');
if (process.env.FIXTURE_BUILD_FAIL) process.exit(7);
const out = process.argv[process.argv.indexOf('--outDir') + 1];
fs.mkdirSync(path.join(out, 'assets'), {recursive:true});
fs.writeFileSync(path.join(out, 'index.html'), '<!doctype html><html><head></head><body>Synthetic city</body></html>');
fs.writeFileSync(path.join(out, 'assets/app.js'), 'console.log("Synthetic city");');
`,
  );
  return root;
}
after(async () => {
  for (const base of homes) {
    for (const name of ["Город с пробелами", "Другой проект"]) {
      const root = path.join(base, name);
      if (existsSync(root)) await run(root, "stop");
    }
    const checked = path.resolve(base);
    assert.ok(checked.startsWith(path.join(repo, ".tools") + path.sep));
    await rm(checked, { recursive: true, force: true });
  }
});

test("Windows commands exist and keep Prepare separate from Start/Stop", async () => {
  for (const action of ["Prepare", "Start", "Stop"]) {
    const filename = path.join(repo, `${action} Progress City.cmd`);
    assert.equal(existsSync(filename), true, `${action} command is missing`);
    const content = await readFile(filename, "utf8");
    assert.match(content, /%~dp0/);
    assert.ok(!content.includes("C:\\ProjectsForSelf"));
  }
});
test("actual Windows cmd wrappers work from another cwd and report missing Node/npm", async () => {
  assert.equal(
    process.platform,
    "win32",
    "Windows acceptance requires Windows",
  );
  const root = await fixture();
  const shell = (action, env = {}) =>
    new Promise((resolve, reject) => {
      const command = `""${path.join(root, `${action} Progress City.cmd`)}" --test-port ${testPort} --no-browser"`;
      const child = spawn(
        process.env.ComSpec || "cmd.exe",
        ["/d", "/s", "/c", command],
        {
          cwd: repo,
          windowsVerbatimArguments: true,
          windowsHide: true,
          env: { ...process.env, PROGRESS_CITY_NO_PAUSE: "1", ...env },
        },
      );
      let output = "";
      child.stdout.on("data", (v) => {
        output += v;
      });
      child.stderr.on("data", (v) => {
        output += v;
      });
      child.on("error", reject);
      child.on("exit", (code) => resolve({ code, output }));
    });
  const missing = await shell("Start", {
    PATH: path.join(process.env.SystemRoot, "System32"),
  });
  assert.equal(missing.code, 2, missing.output);
  assert.match(missing.output, /Node.js/);
  for (const action of ["Prepare", "Start", "Start", "Stop", "Start", "Stop"]) {
    const result = await shell(action);
    assert.equal(result.code, 0, result.output);
  }
  await rm(path.join(root, ".tools/package"), { recursive: true });
  await assert.rejects(
    packageManager(
      { root },
      { execPath: path.join(root, "missing/node.exe"), searchPath: "" },
    ),
    /npm не найден/,
  );
});
test("prepare, concurrent start, readiness, static boundaries, stop and restart in a Cyrillic path", async () => {
  const root = await fixture();
  assert.notEqual((await run(root, "start")).code, 0);
  assert.equal((await run(root, "prepare")).code, 0);
  const prepared = await readFile(
    path.join(root, ".progress-city/prepared.json"),
    "utf8",
  );
  const started = await Promise.all([run(root, "start"), run(root, "start")]);
  for (const result of started) assert.equal(result.code, 0, result.output);
  const health = await (
    await fetch(`http://127.0.0.1:${testPort}/__progresscity/health`)
  ).json();
  assert.equal(health.app, "progress-city");
  assert.ok(health.build);
  assert.ok(!JSON.stringify(health).includes("secret"));
  assert.equal((await run(root, "start")).code, 0);
  assert.equal(
    await readFile(path.join(root, ".progress-city/prepared.json"), "utf8"),
    prepared,
  );
  for (const p of [
    "/.git/config",
    "/src/test.js",
    "/.tools/package/bin/npm-cli.js",
    "/%2e%2e/package.json",
    "/..%5cpackage.json",
    "/%252e%252e%255cpackage.json",
    "/C:%5cWindows%5cwin.ini",
  ]) {
    // Send raw paths so the client does not normalise encoded dot segments away.
    const status = await new Promise((resolve, reject) => {
      const req = http.get(
        { hostname: "127.0.0.1", port: testPort, path: p },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
    });
    assert.ok(status >= 400, `${p} returned ${status}`);
  }
  assert.equal(
    (await fetch(`http://127.0.0.1:${testPort}/`, { method: "POST" })).status,
    405,
  );
  assert.notEqual(
    (await run(root, "prepare")).code,
    0,
    "must not replace a served build",
  );
  assert.equal((await run(root, "stop")).code, 0);
  assert.equal((await run(root, "start")).code, 0);
  assert.equal((await run(root, "stop")).code, 0);
});
test("stale sources and failed prepare keep the old build, while missing tools explain installation", async () => {
  const root = await fixture();
  assert.equal((await run(root, "prepare")).code, 0);
  const before = await readFile(
    path.join(root, ".progress-city/prepared.json"),
    "utf8",
  );
  await writeFile(path.join(root, "src/test.js"), "export const version = 2;");
  assert.match((await run(root, "start")).output, /Prepare|устарел/);
  assert.notEqual(
    (await run(root, "prepare", [], { FIXTURE_BUILD_FAIL: "1" })).code,
    0,
  );
  assert.equal(
    await readFile(path.join(root, ".progress-city/prepared.json"), "utf8"),
    before,
  );
  await rm(path.join(root, "node_modules"), { recursive: true });
  assert.match((await run(root, "prepare")).output, /install|зависимост/);
});
test("real prepared application preserves a synthetic city through Stop/Start on Windows", async () => {
  const root = await fixture();
  for (const name of [
    "src",
    "index.html",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "vite.config.ts",
  ]) {
    await cp(path.join(repo, name), path.join(root, name), { recursive: true });
  }
  for (const relative of ["node_modules", ".tools/package"]) {
    const target = path.resolve(root, relative);
    assert.ok(target.startsWith(path.resolve(root) + path.sep));
    await rm(target, { recursive: true, force: true });
    await symlink(path.join(repo, relative), target, "junction");
  }
  const prep = await run(root, "prepare");
  assert.equal(prep.code, 0, prep.output);
  const browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  try {
    assert.equal((await run(root, "start")).code, 0);
    const context = await browser.newContext({
      baseURL: `http://127.0.0.1:${testPort}`,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await importDailyFixture(page);
    await dailyJourney(page);
    await page.locator('canvas[data-building-count="1"]').waitFor();
    assert.match(await page.locator(".sidebar-footer").textContent(), /Сборка/);
    assert.equal((await run(root, "stop")).code, 0);
    assert.equal((await run(root, "start")).code, 0);
    await page.reload();
    await page.locator('canvas[data-building-count="1"]').waitFor();
    assert.equal(
      await page
        .getByRole("heading", { name: "Город ежедневной работы", exact: true })
        .count(),
      1,
    );
    await page
      .getByRole("button", { name: "Продолжить «Спектр»", exact: true })
      .click();
    assert.match(
      await page.locator(".tiptap").textContent(),
      /Продолжение сегодняшней работы/,
    );
    assert.equal(await page.locator(".note-image img").count(), 1);
    assert.match(
      await page.locator(".research-details").textContent(),
      /Как изменится спектр через воду/,
    );
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
    await run(root, "stop");
  }
});
test("foreign port, another project and stale PID never stop a foreign server", async () => {
  const root = await fixture();
  assert.equal((await run(root, "prepare")).code, 0);
  const foreign = http.createServer((_req, res) => res.end("foreign"));
  await new Promise((resolve) =>
    foreign.listen(testPort, "127.0.0.1", resolve),
  );
  try {
    await writeFile(
      path.join(root, ".progress-city/runtime.json"),
      JSON.stringify({ pid: process.pid, project: "foreign", secret: "wrong" }),
    );
    assert.notEqual((await run(root, "start")).code, 0);
    await run(root, "stop");
    assert.equal(
      await (await fetch(`http://127.0.0.1:${testPort}`)).text(),
      "foreign",
    );
  } finally {
    await new Promise((resolve) => foreign.close(resolve));
  }
  assert.equal((await run(root, "start")).code, 0);
  const other = await fixture("Другой проект");
  assert.equal((await run(other, "prepare")).code, 0);
  assert.notEqual((await run(other, "start")).code, 0);
  await run(other, "stop");
  assert.equal(
    (await fetch(`http://127.0.0.1:${testPort}/__progresscity/health`)).status,
    200,
  );
  assert.equal((await run(root, "stop")).code, 0);
});
