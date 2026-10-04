import { execFileSync, spawn } from "node:child_process";
import { mkdir, writeFile, symlink, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
// Synthetic archive created by the actual previous application, never a user profile.
const base = "33a7f9e1fe57a5001798a23b75bff47a7abfba92";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkout = path.join(root, ".tools", "daily-baseline-33a7f9e");
const files = execFileSync(
  "git",
  [
    "ls-tree",
    "-r",
    "--name-only",
    base,
    "--",
    "src",
    "public",
    "index.html",
    "package.json",
    "vite.config.ts",
    "tsconfig.json",
  ],
  { cwd: root, encoding: "utf8", windowsHide: true },
)
  .trim()
  .split(/\r?\n/);
for (const file of files) {
  const target = path.join(checkout, file);
  if (!target.startsWith(checkout + path.sep))
    throw new Error("Unsafe fixture path");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    target,
    execFileSync("git", ["show", `${base}:${file}`], {
      cwd: root,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    }),
  );
}
try {
  await access(path.join(checkout, "node_modules"));
} catch {
  await symlink(
    path.join(root, "node_modules"),
    path.join(checkout, "node_modules"),
    "junction",
  );
}
const port = 4187,
  origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    checkout,
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  { cwd: root, windowsHide: true, stdio: "pipe" },
);
let output = "";
server.stderr.on("data", (bytes) => {
  output += bytes;
});
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null)
      throw new Error(output || "Baseline server exited");
    try {
      ready = (await fetch(origin)).ok;
    } catch {
      /* startup */
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("Baseline readiness timeout");
  browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(origin);
  const bytes = await page.evaluate(async () => {
    const servicePath = "/src/storage/service.ts",
      backupPath = "/src/storage/backup.ts",
      attachmentPath = "/src/storage/attachments.ts";
    const { service } = await import(servicePath),
      { exportCity } = await import(backupPath),
      { addAttachment } = await import(attachmentPath);
    await service.initialize("Город ежедневной работы", "Оптика");
    const track = (await service.db.tracks.toArray())[0];
    const workshop = (await service.db.buildings.toArray())[0];
    const result = await service.saveActivity({
      trackId: track.id,
      title: "Первый опыт",
      result: "Сравнил две тени",
      kind: "apply",
      date: "2026-09-30",
      noteIds: [],
      achieved: true,
    });
    await service.confirmActivity(result.id);
    await service.upgradeObject(track.id, "fixture-upgrade", result.id);
    await service.placeBuilding({ ...workshop, color: "#3867a2" });
    await service.snapshot("До ежедневной работы");
    const object = await service.createLearningObject(track.id, "Спектр");
    await service.updateLearningObject({
      ...object,
      nextQuestion: "Какие цвета видны?",
    });
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE2cAAAAASUVORK5CYII=",
      ),
      (c) => c.charCodeAt(0),
    );
    const attachment = await addAttachment(
      service.db,
      new File([png], "Синтетический пиксель.png", { type: "image/png" }),
    );
    const note = await service.createNote(track.id, object.id);
    await service.saveNote({
      ...note,
      title: "Спектр света",
      tags: ["свет", "spectrum"],
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Синтетический материал предыдущей версии.",
              },
            ],
          },
          {
            type: "attachmentImage",
            attrs: { attachmentId: attachment.id, alt: "Тестовый пиксель" },
          },
        ],
      },
    });
    await service.createTrack({
      name: "Прогулка",
      type: "habit",
      description: "",
      goal: "Пройтись на воздухе",
      schedule: "Когда удобно",
      unit: "минут",
      comparison: "min",
      limit: 10,
    });
    await service.createTrack({
      name: "Меньше экранов",
      type: "reduce",
      description: "",
      goal: "Отложить телефон",
      schedule: "Вечером",
      unit: "минут",
      comparison: "max",
      limit: 60,
    });
    return Array.from(
      new Uint8Array(await (await exportCity(service.db)).arrayBuffer()),
    );
  });
  const target = path.join(root, ".tools", "daily-legacy-v2.progresscity.zip");
  await writeFile(target, new Uint8Array(bytes));
  process.stdout.write(
    `Synthetic v2 from ${base}: ${bytes.length} bytes → ${target}\n`,
  );
  await context.close();
} finally {
  await browser?.close();
  server.kill();
}
