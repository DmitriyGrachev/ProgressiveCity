import http from "node:http";
import net from "node:net";
import path from "node:path";
import { readFile, realpath, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import {
  project,
  preparedBuild,
  listen,
  atomicJSON,
  sign,
  same,
  readJSON,
} from "./core.mjs";

const ctx = await project(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
);
const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid port");
const build = await preparedBuild(ctx);
const secret = randomBytes(32).toString("hex");
const status = {
  project: ctx.projectId,
  instance: randomBytes(16).toString("hex"),
  pid: process.pid,
  build: build.id,
  port,
};
const allowed = new Set(build.files);
const buildRoot = await realpath(build.directory);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
const httpServer = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  if (req.headers.host !== `127.0.0.1:${port}`) {
    res.writeHead(403).end();
    return;
  }
  if (!["GET", "HEAD"].includes(req.method)) {
    res.writeHead(405).end();
    return;
  }
  if (req.url === "/__progresscity/health") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        app: "progress-city",
        project: status.project,
        instance: status.instance,
        build: status.build,
        port,
      }),
    );
    return;
  }
  try {
    const decoded = decodeURIComponent((req.url || "/").split("?")[0]);
    if (
      !decoded.startsWith("/") ||
      /[\\\0:%]/.test(decoded) ||
      decoded.split("/").some((part) => part.startsWith("."))
    ) {
      res.writeHead(400).end();
      return;
    }
    const relative = decoded === "/" ? "index.html" : decoded.slice(1);
    if (!allowed.has(relative)) {
      res.writeHead(404).end();
      return;
    }
    const file = await realpath(path.join(buildRoot, relative));
    if (!file.startsWith(buildRoot + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    const content = await readFile(file);
    res.setHeader(
      "Content-Type",
      types[path.extname(file)] || "application/octet-stream",
    );
    res.setHeader("Content-Length", content.length);
    res.end(req.method === "HEAD" ? undefined : content);
  } catch {
    res.writeHead(404).end();
  }
});
let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  ipc.close();
  httpServer.close();
  httpServer.closeAllConnections();
  if ((await readJSON(ctx.state))?.instance === status.instance)
    await unlink(ctx.state).catch(() => {});
  process.exit(0);
}
const ipc = net.createServer((socket) => {
  let content = "";
  socket.setTimeout(1500, () => socket.destroy());
  socket.on("error", () => {});
  socket.on("data", (data) => {
    content += data;
    if (content.length > 4096) {
      socket.destroy();
      return;
    }
    if (!content.includes("\n")) return;
    try {
      const { command, nonce, proof } = JSON.parse(content.trim());
      if (
        !["status", "stop"].includes(command) ||
        !/^[a-f0-9]{48}$/.test(nonce) ||
        !same(proof, sign(secret, `${command}:${nonce}`))
      ) {
        socket.destroy();
        return;
      }
      socket.end(
        JSON.stringify({
          status,
          proof: sign(secret, `${nonce}:${JSON.stringify(status)}`),
        }) + "\n",
        () => {
          if (command === "stop") void stop();
        },
      );
    } catch {
      socket.destroy();
    }
  });
});
try {
  await listen(ipc, ctx.pipe);
  await listen(httpServer, { host: "127.0.0.1", port });
  await atomicJSON(ctx.state, { ...status, secret });
  console.log(`Progress City ${build.id}: http://127.0.0.1:${port}/`);
} catch (error) {
  ipc.close();
  httpServer.close();
  console.error(error.message);
  process.exit(1);
}
process.on("SIGTERM", () => void stop());
