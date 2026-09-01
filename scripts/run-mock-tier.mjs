#!/usr/bin/env node
/**
 * Run the whole mock-integration tier, with the mock managed for you.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The tier pointed at `bConnect-Mock`, an external service on port 13433 that
 * is not in this repository. Nobody could run the tier without first obtaining
 * and starting something the repo does not ship, so nobody did: measured
 * 2026-08-22, its first execution here reported 4 skipped and exit 0.
 *
 * This starts `scripts/bconnect-mock.mjs`, runs every workspace's tier against
 * it with BCONNECT_MOCK_REQUIRED=true, and stops it again. One command, no
 * external dependency, and no way to be green without having run.
 *
 * ── Why it counts twice ─────────────────────────────────────────────────────
 * "0 failed" is satisfied just as well by "nothing ran". So the runner counts
 * the tests it EXPECTS by reading `it(` out of the tier's own source, and
 * requires the number that actually passed to equal it. A tier that silently
 * stops discovering files fails here rather than reporting success — the
 * lesson from this project's `CALLS.length >= 9` canary, which moved in
 * lockstep with the blind spot it was meant to catch.
 *
 * Usage:
 *   node scripts/run-mock-tier.mjs [--port 13433] [--only <server>] [--keep-mock]
 */
import { spawn, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SUITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const PORT = Number(argOf("--port", 13433));
const ONLY = argOf("--only", null);
const KEEP = args.includes("--keep-mock");
const MOCK_URL = `http://127.0.0.1:${PORT}`;

/** Workspaces that carry a mock tier, discovered — never listed. */
function tierWorkspaces() {
  return readdirSync(SUITE, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^bconnect-.*-mcp$/.test(e.name))
    .map((e) => e.name)
    .filter((name) => existsSync(join(SUITE, name, "vitest.mock.config.ts")))
    .filter((name) => (ONLY ? name.includes(ONLY) : true))
    .sort();
}

/** The SECOND count: how many tests the tier's own source declares. */
function declaredTests(workspace) {
  const dir = join(SUITE, workspace, "src", "__tests__", "mock-integration");
  if (!existsSync(dir)) { return 0; }
  let n = 0;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".mock.test.ts")) { continue; }
    const src = readFileSync(join(dir, file), "utf8");
    n += (src.match(/^\s*it\(/gm) ?? []).length;
  }
  return n;
}

async function waitForMock(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${MOCK_URL}/health`);
      if (res.ok) { return true; }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

const strip = (s) => s.replace(/\[[0-9;]*[mK]/g, "");
const numberBefore = (line, word) => {
  const m = strip(line).match(new RegExp(`(\\d+) ${word}`));
  return m ? Number(m[1]) : 0;
};

// ── Start the mock ──────────────────────────────────────────────────────────

let mock = null;
const alreadyRunning = await waitForMock(300);
if (alreadyRunning) {
  console.log(`using the mock already listening on ${MOCK_URL}`);
} else {
  mock = spawn(process.execPath, [join(SUITE, "scripts", "bconnect-mock.mjs"), "--port", String(PORT), "--quiet"], {
    cwd: SUITE,
    stdio: "ignore",
    detached: false,
  });
  if (!(await waitForMock())) {
    console.error(`the mock did not answer on ${MOCK_URL} within 10s`);
    mock.kill();
    process.exit(1);
  }
  console.log(`started scripts/bconnect-mock.mjs on ${MOCK_URL}`);
}

// ── Run every tier ──────────────────────────────────────────────────────────

const workspaces = tierWorkspaces();
if (workspaces.length === 0) {
  console.error("no workspace carries a vitest.mock.config.ts — nothing to run");
  if (mock) { mock.kill(); }
  process.exit(1);
}

let totalPassed = 0, totalFailed = 0, totalSkipped = 0, totalDeclared = 0;
const rows = [];

for (const ws of workspaces) {
  const declared = declaredTests(ws);
  totalDeclared += declared;

  const res = spawnSync("npx", ["vitest", "run", "-c", "vitest.mock.config.ts"], {
    cwd: join(SUITE, ws),
    encoding: "utf8",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      BCONNECT_MOCK_URL: MOCK_URL,
      BCONNECT_MOCK_REQUIRED: "true",
    },
  });

  const out = strip(`${res.stdout ?? ""}${res.stderr ?? ""}`);
  const line = out.split(/\r?\n/).filter((l) => /^\s*Tests\s+/.test(l)).pop() ?? "";
  const passed = numberBefore(line, "passed");
  const failed = numberBefore(line, "failed");
  const skipped = numberBefore(line, "skipped");

  totalPassed += passed; totalFailed += failed; totalSkipped += skipped;
  rows.push({ ws, declared, passed, failed, skipped, code: res.status });

  const flag = failed > 0 || skipped > 0 || passed !== declared ? "  <-- " : "";
  console.log(
    `  ${ws.replace(/^bconnect-|-mcp$/g, "").padEnd(24)}` +
      `${String(passed).padStart(3)} passed  ${String(failed).padStart(2)} failed  ` +
      `${String(skipped).padStart(2)} skipped   (declares ${declared})${flag}`
  );
}

if (mock && !KEEP) { mock.kill(); }

// ── Verdict ─────────────────────────────────────────────────────────────────

console.log("  " + "-".repeat(70));
console.log(`  TOTAL ${totalPassed} passed, ${totalFailed} failed, ${totalSkipped} skipped ` +
  `(the tier declares ${totalDeclared})`);

const problems = [];
if (totalFailed > 0) { problems.push(`${totalFailed} test(s) failed`); }
if (totalSkipped > 0) { problems.push(`${totalSkipped} test(s) skipped — with the mock up, a skip is a defect`); }
if (totalPassed !== totalDeclared) {
  problems.push(
    `${totalPassed} passed but the tier declares ${totalDeclared} — the two counts disagree, ` +
      `so some tests were never discovered`
  );
}
if (totalDeclared === 0) { problems.push("the tier declares zero tests — nothing was checked"); }

if (problems.length) {
  console.error("\nFAILED:\n  - " + problems.join("\n  - "));
  process.exit(1);
}
console.log("\nOK — every declared mock-integration test ran and passed.");
