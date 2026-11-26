#!/usr/bin/env node
/**
 * Packs @baramundi/bconnect-mcp, installs the tarball into an empty folder and
 * starts it there, as `npx` would (#297 AC 1, AC 6).
 *
 *   node scripts/check-package.mjs        (after `npm ci` and `npm run build`)
 *
 * 1. `npm pack` in packages/bconnect-mcp (prepack: tsc and bundle.mjs): the tarball
 *    holds exactly dist/cli.js, README.md, LICENSE and package.json, so no tests,
 *    sources, maps or local configuration (.env); its dependencies are the
 *    third-party packages only, as the bundle carries core and the servers.
 * 2. `npm install <tarball>` into an empty folder outside the repository, so
 *    nothing resolves from the workspace; the bin shim exists.
 * 3. The installed command, with configuration from environment variables only,
 *    for one domain, several and `all`: the first stdout line answers `initialize`,
 *    tools/list lists tools. A wrong argument exits 1 with nothing on stdout.
 *
 * Exits 1 on the first failure, with what failed.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_DIR = join(ROOT, "packages", "bconnect-mcp");
const NAME = "@baramundi/bconnect-mcp";
const FILES = ["LICENSE", "README.md", "dist/cli.js", "package.json"];
const THIRD_PARTY = ["@modelcontextprotocol/sdk", "axios", "dotenv", "express"];
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const fail = (message) => {
  console.error(`✗ ${message}`);
  process.exit(1);
};
const ok = (message) => console.log(`✓ ${message}`);
const sameSet = (a, b) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

const work = mkdtempSync(join(tmpdir(), "bconnect-mcp-package-"));
try {
  // 1. Pack.
  const packed = JSON.parse(execFileSync(npm, ["pack", "--json", "--pack-destination", work], {
    cwd: PACKAGE_DIR, encoding: "utf8", shell: process.platform === "win32", stdio: ["ignore", "pipe", "inherit"],
  }))[0];
  const files = packed.files.map((f) => f.path);
  if (!sameSet(files, FILES)) {fail(`the tarball holds ${files.join(", ")}; expected ${FILES.join(", ")}`);}
  const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8"));
  const deps = Object.keys(manifest.dependencies ?? {});
  if (!sameSet(deps, THIRD_PARTY)) {fail(`dependencies are ${deps.join(", ")}; expected the third-party packages ${THIRD_PARTY.join(", ")}`);}
  if (manifest.bundleDependencies || manifest.bundledDependencies) {fail("bundleDependencies is set: the bundle carries core and the servers");}
  ok(`${packed.filename}: ${files.length} files, ${Math.round(packed.size / 1024)} kB, dependencies ${deps.join(", ")}`);

  // 2. Install into an empty folder.
  const app = join(work, "app");
  mkdirSync(app);
  writeFileSync(join(app, "package.json"), JSON.stringify({ name: "package-check", private: true }));
  execFileSync(npm, ["install", "--no-audit", "--no-fund", "--loglevel=error", join(work, packed.filename)], {
    cwd: app, stdio: ["ignore", "ignore", "inherit"], shell: process.platform === "win32",
  });
  const installed = join(app, "node_modules", ...NAME.split("/"));
  const bin = JSON.parse(readFileSync(join(installed, "package.json"), "utf8")).bin?.["bconnect-mcp"];
  const shim = join(app, "node_modules", ".bin", process.platform === "win32" ? "bconnect-mcp.cmd" : "bconnect-mcp");
  if (!bin || !existsSync(shim)) {fail(`the bin shim ${shim} is missing`);}
  ok(`installed into an empty folder; bin bconnect-mcp → ${bin}`);

  // 3. Start it, with settings from the environment only.
  const env = {
    PATH: process.env.PATH ?? "",
    ...(process.env.SYSTEMROOT && { SYSTEMROOT: process.env.SYSTEMROOT }),
    BCONNECT_BASE_URL: "https://bms.example.test/bconnect",
    BCONNECT_API_KEY: "package-check-key",
    BCONNECT_SKIP_CONNECTIVITY_CHECK: "true",
  };
  const cli = join(installed, bin);
  const start = (arg) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, arg], { cwd: app, env });
    let out = "";
    let err = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${arg}: no answer within 30 s; stderr: ${err}`)); }, 30_000);
    child.stderr.setEncoding("utf8").on("data", (chunk) => { err += chunk; });
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      out += chunk;
      // Complete lines only: a large answer (all: ~130 tools) arrives in several chunks.
      const lines = out.split("\n").slice(0, -1).filter((line) => line !== "");
      if (lines.length >= 2) {
        clearTimeout(timer);
        child.kill();
        resolve(lines.map((line) => JSON.parse(line)));
      }
    });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`${arg}: exited ${code}; stderr: ${err}`)); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "package-check", version: "0" } } })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`);
  });
  for (const [arg, serverName] of [["endpoints", "bconnect-endpoints-mcp"], ["endpoints,jobs", "bconnect-mcp"], ["all", "bconnect-mcp"]]) {
    const [init, list] = await start(arg).catch((error) => fail(error.message));
    if (init.id !== 1 || init.result?.serverInfo?.name !== serverName) {fail(`${arg}: the first stdout line isn't the initialize answer of ${serverName}: ${JSON.stringify(init)}`);}
    const count = list.result?.tools?.length ?? 0;
    if (list.id !== 2 || count === 0) {fail(`${arg}: tools/list listed no tools: ${JSON.stringify(list).slice(0, 300)}`);}
    ok(`${arg}: initialize answered by ${serverName}, ${count} tools`);
  }
  const wrong = spawnSync(process.execPath, [cli, "nodomain"], { cwd: app, env, encoding: "utf8", timeout: 30_000 });
  if (wrong.status !== 1 || wrong.stdout !== "" || !wrong.stderr.includes('domains="nodomain" isn\'t valid')) {
    fail(`a wrong argument: exit ${wrong.status}, stdout ${JSON.stringify(wrong.stdout)}, stderr ${JSON.stringify(wrong.stderr)}`);
  }
  ok("a wrong argument exits 1, nothing on stdout");
} finally {
  rmSync(work, { recursive: true, force: true });
}
