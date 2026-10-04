import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  readFile,
  readdir,
  realpath,
  mkdir,
  writeFile,
  rename,
  access,
} from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const sha = (value) => createHash("sha256").update(value).digest("hex");
export async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
export async function readJSON(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}
export async function atomicJSON(file, value) {
  const temp = `${file}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temp, file);
}
export async function project(root) {
  root = await realpath(root);
  const projectId = sha(
    process.platform === "win32" ? root.toLowerCase() : root,
  ).slice(0, 24);
  const home = path.join(root, ".progress-city");
  await mkdir(home, { recursive: true });
  return {
    root,
    home,
    projectId,
    pipe:
      process.platform === "win32"
        ? `\\\\.\\pipe\\progress-city-${projectId}`
        : path.join(home, "control.sock"),
    state: path.join(home, "runtime.json"),
    prepared: path.join(home, "prepared.json"),
  };
}
export async function filesIn(dir, prefix = "") {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isSymbolicLink())
      throw new Error(
        `Символическая ссылка не поддерживается в сборке: ${relative}`,
      );
    if (entry.isDirectory())
      files.push(
        ...(await filesIn(path.join(dir, entry.name), `${relative}/`)),
      );
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
}
export async function fingerprint(ctx) {
  const names = [];
  for (const dir of ["src", "public", "scripts/launcher"])
    if (await exists(path.join(ctx.root, dir)))
      names.push(
        ...(await filesIn(path.join(ctx.root, dir))).map((p) => `${dir}/${p}`),
      );
  for (const file of await readdir(ctx.root))
    if (
      /^(package(?:-lock)?\.json|index\.html|(?:vite|tsconfig|eslint)[^/]*\.(?:ts|js|json))$/.test(
        file,
      )
    )
      names.push(file);
  const hash = createHash("sha256");
  for (const name of names.sort()) {
    const bytes = await readFile(path.join(ctx.root, name));
    hash.update(`${name}\0${bytes.length}\0`).update(bytes);
  }
  return hash.digest("hex");
}
export function sign(secret, text) {
  return createHmac("sha256", secret).update(text).digest("hex");
}
export function same(a, b) {
  return (
    typeof a === "string" &&
    typeof b === "string" &&
    a.length === b.length &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
export function listen(server, endpoint) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint, () => {
      server.off("error", reject);
      resolve();
    });
  });
}
export async function locked(ctx, action) {
  const until = Date.now() + 120_000;
  for (;;) {
    const lock = net.createServer((socket) => socket.destroy());
    try {
      await listen(lock, `${ctx.pipe}-lock`);
    } catch (error) {
      if (error.code !== "EADDRINUSE" || Date.now() >= until)
        throw new Error(
          "Другое действие запуска ещё выполняется. Повторите позднее.",
          { cause: error },
        );
      await sleep(100);
      continue;
    }
    try {
      return await action();
    } finally {
      await new Promise((resolve) => lock.close(resolve));
    }
  }
}
export async function control(ctx, command = "status") {
  const state = await readJSON(ctx.state);
  if (
    !state ||
    state.project !== ctx.projectId ||
    typeof state.secret !== "string" ||
    typeof state.instance !== "string"
  )
    return null;
  const nonce = randomBytes(24).toString("hex");
  return new Promise((resolve) => {
    const socket = net.createConnection(ctx.pipe);
    let content = "",
      finished = false;
    const done = (value) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1500, () => done(null));
    socket.on("error", () => done(null));
    socket.on("connect", () =>
      socket.write(
        JSON.stringify({
          command,
          nonce,
          proof: sign(state.secret, `${command}:${nonce}`),
        }) + "\n",
      ),
    );
    socket.on("data", (data) => {
      content += data;
      if (content.length > 8192) return done(null);
      if (!content.includes("\n")) return;
      try {
        const reply = JSON.parse(content.trim());
        const valid = same(
          reply.proof,
          sign(state.secret, `${nonce}:${JSON.stringify(reply.status)}`),
        );
        done(
          valid &&
            reply.status.project === ctx.projectId &&
            reply.status.instance === state.instance &&
            reply.status.pid === state.pid
            ? reply.status
            : null,
        );
      } catch {
        done(null);
      }
    });
    socket.on("end", () => done(null));
  });
}
export async function portOccupied(port) {
  const probe = net.createServer();
  try {
    await listen(probe, { host: "127.0.0.1", port });
    await new Promise((resolve) => probe.close(resolve));
    return false;
  } catch (error) {
    if (error.code === "EADDRINUSE") return true;
    throw error;
  }
}
export async function packageManager(ctx, environment = {}) {
  const execPath = environment.execPath ?? process.execPath;
  const searchPath = environment.searchPath ?? process.env.PATH ?? "";
  const candidates = [
    path.join(ctx.root, ".tools/package/bin/npm-cli.js"),
    path.join(path.dirname(execPath), "node_modules/npm/bin/npm-cli.js"),
  ];
  for (const folder of searchPath.split(path.delimiter).filter(Boolean))
    candidates.push(path.join(folder, "node_modules/npm/bin/npm-cli.js"));
  for (const file of candidates) if (await exists(file)) return file;
  throw new Error(
    "npm не найден. Установите Node.js с npm либо используйте существующий .tools/package/bin/npm-cli.js. Ничего не загружено.",
  );
}
export function runNode(file, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], {
      cwd,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `Подготовка завершилась с кодом ${code}. Прежняя готовая сборка сохранена.`,
            ),
          ),
    );
  });
}
export async function preparedBuild(ctx) {
  const build = await readJSON(ctx.prepared);
  if (
    !build ||
    !/^[a-f0-9-]+$/.test(build.release || "") ||
    !Array.isArray(build.files)
  )
    throw new Error(
      "Готовая сборка отсутствует. Выполните Prepare Progress City.cmd.",
    );
  const directory = path.join(ctx.home, "releases", build.release);
  for (const name of build.files)
    if (
      typeof name !== "string" ||
      name.includes("\\") ||
      name.split("/").some((s) => !s || s.startsWith(".") || s.includes(":"))
    )
      throw new Error(
        "Некорректный список файлов готовой сборки. Выполните Prepare.",
      );
  if (
    !build.files.includes("index.html") ||
    !(await exists(path.join(directory, "index.html")))
  )
    throw new Error(
      "Готовая сборка неполна. Выполните Prepare Progress City.cmd.",
    );
  return { ...build, directory };
}
