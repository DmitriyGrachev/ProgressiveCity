import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, rename, open, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import {
  project,
  locked,
  control,
  portOccupied,
  fingerprint,
  packageManager,
  runNode,
  preparedBuild,
  filesIn,
  atomicJSON,
  exists,
  sleep,
} from "./core.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const [command, ...args] = process.argv.slice(2);
const index = args.indexOf("--test-port");
const port = index < 0 ? 5173 : Number(args[index + 1]);
const noBrowser = args.includes("--no-browser");
async function prepare(ctx) {
  if (await control(ctx))
    throw new Error(
      "Сначала сохраните работу и выполните Stop Progress City.cmd. Активная сборка не заменена.",
    );
  const npm = await packageManager(ctx);
  if (!(await exists(path.join(root, "node_modules/vite/bin/vite.js")))) {
    if (!args.includes("--install"))
      throw new Error(
        "Зависимости отсутствуют. Для явной установки по lockfile запустите Prepare Progress City.cmd --install.",
      );
    await runNode(npm, ["ci"], root);
  }
  const before = await fingerprint(ctx);
  const release = `${before.slice(0, 12)}-${randomBytes(6).toString("hex")}`;
  const stage = path.join(ctx.home, `staging-${release}`);
  if (
    path.dirname(stage) !== ctx.home ||
    !path.basename(stage).startsWith("staging-")
  )
    throw new Error("Unsafe cleanup target");
  await mkdir(stage);
  try {
    await runNode(npm, ["run", "build", "--", "--outDir", stage], root);
    if ((await fingerprint(ctx)) !== before)
      throw new Error(
        "Исходники изменились во время подготовки. Повторите Prepare; прежняя сборка сохранена.",
      );
    const html = await readFile(path.join(stage, "index.html"), "utf8");
    if (!html.includes("</head>"))
      throw new Error("Сборка не содержит корректный index.html.");
    await writeFile(
      path.join(stage, "index.html"),
      html.replace(
        "</head>",
        `<meta name="progress-city-build" content="${before.slice(0, 12)}"></head>`,
      ),
    );
    const files = await filesIn(stage);
    if (
      files.length > 3000 ||
      files.some((name) =>
        name.split("/").some((s) => s.startsWith(".") || s.includes(":")),
      )
    )
      throw new Error("Недопустимое содержимое сборки.");
    await mkdir(path.join(ctx.home, "releases"), { recursive: true });
    await rename(stage, path.join(ctx.home, "releases", release));
    await atomicJSON(ctx.prepared, {
      id: before.slice(0, 12),
      source: before,
      preparedAt: new Date().toISOString(),
      release,
      files,
    });
    console.log(
      `Подготовлена версия ${before.slice(0, 12)}. Теперь Start Progress City.cmd. Откат файлов приложения не откатывает базу города.`,
    );
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
async function start(ctx) {
  const build = await preparedBuild(ctx);
  if ((await fingerprint(ctx)) !== build.source)
    throw new Error(
      "Готовая сборка устарела. Сохраните работу, выполните Stop, затем Prepare Progress City.cmd. Старую версию не открываем.",
    );
  let owner = await control(ctx);
  if (owner && owner.port !== port)
    throw new Error(
      "Свой экземпляр уже работает на другом явно заданном порту. Сначала Stop.",
    );
  if (!owner) {
    if (await portOccupied(port))
      throw new Error(
        `Порт 127.0.0.1:${port} занят чужим процессом или dev-server. Он не остановлен; другой порт не выбран.`,
      );
    const log = await open(path.join(ctx.home, "server.log"), "a");
    const child = spawn(
      process.execPath,
      [path.join(root, "scripts/launcher/server.mjs"), String(port)],
      {
        cwd: root,
        detached: true,
        windowsHide: true,
        stdio: ["ignore", log.fd, log.fd],
      },
    );
    let launchError;
    child.on("error", (error) => {
      launchError = error;
    });
    child.unref();
    await log.close();
    for (let i = 0; i < 100 && !owner; i++) {
      if (launchError || child.exitCode !== null)
        throw new Error(
          "Сервер не запустился. Подробности: .progress-city/server.log.",
          { cause: launchError },
        );
      owner = await control(ctx);
      if (!owner) await sleep(100);
    }
    if (!owner)
      throw new Error(
        "Свой экземпляр не подтвердил готовность. Повторите Start или проверьте .progress-city/server.log.",
      );
  }
  const url = `http://127.0.0.1:${port}/`;
  const response = await fetch(`${url}__progresscity/health`, {
    signal: AbortSignal.timeout(3000),
  });
  const health = await response.json();
  if (
    health.app !== "progress-city" ||
    health.project !== ctx.projectId ||
    health.instance !== owner.instance ||
    health.build !== build.id
  )
    throw new Error(
      "Не подтверждена принадлежность HTTP-сервера. Браузер не открыт.",
    );
  console.log(
    `Готово: версия ${build.id}, подготовлена ${build.preparedAt}. ${url}\nИспользуйте прежний профиль браузера. Остановка: Stop Progress City.cmd.`,
  );
  if (!noBrowser) {
    if (process.platform !== "win32")
      throw new Error(
        "Откройте указанный адрес вручную; оболочка предназначена для Windows.",
      );
    const browser = spawn(
      "rundll32.exe",
      ["url.dll,FileProtocolHandler", url],
      { detached: true, windowsHide: true, stdio: "ignore" },
    );
    browser.on("error", () =>
      console.error(`Не удалось открыть браузер. Откройте ${url} вручную.`),
    );
    browser.unref();
  }
}
async function stop(ctx) {
  const owner = await control(ctx);
  if (!owner) {
    console.log(
      "Доказанно свой работающий экземпляр не найден. Чужие процессы и PID из файла не остановлены.",
    );
    return;
  }
  if (!(await control(ctx, "stop")))
    throw new Error(
      "Свой экземпляр не подтвердил остановку. Никакие PID не завершены.",
    );
  for (let i = 0; i < 100; i++) {
    if (!(await control(ctx))) {
      console.log(
        "Progress City остановлен. Сохранённый город остаётся в браузере.",
      );
      return;
    }
    await sleep(50);
  }
  throw new Error("Остановка не завершилась вовремя. Повторите Stop.");
}
try {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 12))
    throw new Error(
      "Нужен Node.js 22.12 или новее. Глобальные настройки не изменены.",
    );
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Некорректный явный тестовый порт.");
  if (!["prepare", "start", "stop"].includes(command))
    throw new Error("Используйте Prepare, Start или Stop Progress City.cmd.");
  const ctx = await project(root);
  await locked(ctx, () => ({ prepare, start, stop })[command](ctx));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
