#!/usr/bin/env node
/**
 * Runs the mock-integration tier against a running bConnect-Mock (REQ-CI-002).
 *
 *   node scripts/mock-tier.mjs <26r1|25r2>
 *
 * Expects the servers to be built (`npm run build`) and the mock to listen on
 * BCONNECT_MOCK_URL (default http://127.0.0.1:13433), started for that release
 * with its rate limit off. The CI `mock` job does exactly that; it works the
 * same by hand.
 *
 * - Checks /health first: the mock must answer within MOCK_TIER_WAIT_MS
 *   (default 30 s) and serve the release asked for.
 * - Runs `npm run test:mock` in each server that lists a tool in that
 *   release. On 25R2, compliance and universaldynamicgroups list none (their
 *   APIs are 26R1 only); __tests__/mock-tier.guard.test.ts checks this list
 *   against the generated release tables.
 * - Fails when a server's tests fail, and when they skipped because the mock
 *   wasn't reachable: those tests return early and vitest reports them passed.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Servers none of whose APIs exist in 25R2. */
const ONLY_26R1 = ["bconnect-compliance-mcp", "bconnect-universaldynamicgroups-mcp"];

const RELEASES = ["26r1", "25r2"];

/** The line a mock test prints when it skips because the mock isn't reachable. */
const SKIPPED = "not reachable";

/** The servers the tier runs for `release` (`26r1` or `25r2`). */
export function serversFor(release) {
  if (!RELEASES.includes(release)) {
    throw new Error(`unknown release "${release}": use ${RELEASES.join(" or ")}`);
  }
  const servers = readdirSync(ROOT)
    .filter((name) => name.startsWith("bconnect-") && name.endsWith("-mcp"))
    .sort();
  return release === "25r2" ? servers.filter((name) => !ONLY_26R1.includes(name)) : servers;
}

/** Why a server's run fails, or undefined when it passed. */
export function verdict(status, output) {
  if (status !== 0) {
    return "tests failed";
  }
  if (output.includes(SKIPPED)) {
    return `tests skipped: the mock was ${SKIPPED}`;
  }
  return undefined;
}

/** Waits until the mock answers /health for `release`; throws when it doesn't within `waitMs`. */
export async function checkHealth(baseUrl, release, waitMs) {
  const deadline = Date.now() + waitMs;
  let last = "no answer";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
      const body = res.ok ? await res.json() : undefined;
      const version = String(body?.bmsVersion ?? "").toLowerCase();
      if (version === release) {
        return;
      }
      if (res.ok) {
        throw new Error(`the mock at ${baseUrl} serves bMS ${version || "(none)"}, not ${release}`);
      }
      last = `HTTP ${res.status}`;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("the mock at")) {
        throw error;
      }
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`the mock at ${baseUrl} is not reachable (${last})`);
}

async function main() {
  const release = (process.argv[2] ?? "").toLowerCase();
  const baseUrl = process.env.BCONNECT_MOCK_URL ?? "http://127.0.0.1:13433";
  const servers = serversFor(release);
  await checkHealth(baseUrl, release, Number(process.env.MOCK_TIER_WAIT_MS ?? 30000));
  console.log(`mock tier: bMS ${release}, mock at ${baseUrl}, ${servers.length} servers`);

  const failed = [];
  for (const server of servers) {
    const run = spawnSync("npm", ["run", "-s", "test:mock"], {
      cwd: join(ROOT, server),
      env: { ...process.env, BCONNECT_MOCK_URL: baseUrl },
      encoding: "utf8",
    });
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
    process.stdout.write(`\n── ${server}\n${output}`);
    const reason = run.error ? run.error.message : verdict(run.status ?? 1, output);
    if (reason) {
      failed.push(`${server}: ${reason}`);
    }
  }

  console.log(`\nmock tier (${release}): ${servers.length - failed.length} of ${servers.length} servers passed`);
  if (failed.length > 0) {
    console.error(failed.map((line) => `  FAILED ${line}`).join("\n"));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`mock tier: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
