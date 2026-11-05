/**
 * Checks a running gateway's combined endpoint against its per-domain endpoints (#131).
 *
 *   node scripts/check-combined.mjs <gateway-url> [--domains a,b,…]
 *
 * <gateway-url> is the gateway's base URL, e.g. http://127.0.0.1:3001; the gateway
 * must run with MCP_GATEWAY_COMBINED set. --domains names the domains it was set to
 * (default: all 13). Read-only: it lists tools and calls one list tool per domain.
 *
 * - tools/list on /mcp is exactly the per-domain lists of those domains, in the
 *   gateway's domain order (names, schemas, annotations: the whole tool);
 * - per domain, one list tool without required arguments (countOnly when it offers
 *   it, so a real bMS sends one row) answers the same on /mcp as on /<domain>/mcp;
 * - an unknown tool gets the same error on both;
 * - how long tools/list on /mcp takes (reported, not checked).
 *
 * Prints one line per check and exits 1 when one fails. The mock tier runs it
 * against bConnect-Mock (bconnect-mcp-gateway/src/__tests__/mock-integration/);
 * the Windows live run before a release runs it against a real bMS.
 *
 * No `#!` line: a test imports this module (see mock-tier.mjs for why).
 */
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/** The gateway's domains, in its order (bconnect-mcp-gateway/src/app.ts; a guard compares them). */
export const DOMAINS = [
  "activedirectory", "assets", "compliance", "defensecontrol", "endpoints", "groups", "jobs",
  "operatingsystems", "servermanagement", "software", "universaldynamicgroups", "updatemanagement", "variables",
];

/** A tool name no domain has. */
const UNKNOWN_TOOL = "no_such_tool_check_combined";

/** The list tool a domain is probed with, and its arguments; undefined when it has none to call. */
export function probeOf(tools) {
  const tool = tools.find((t) => t.name.startsWith("list_") && (t.inputSchema?.required ?? []).length === 0);
  if (!tool) {
    return undefined;
  }
  const offersCount = Object.hasOwn(tool.inputSchema?.properties ?? {}, "countOnly");
  return { name: tool.name, arguments: offersCount ? { countOnly: true } : {} };
}

/** What a call answered: its result, or its protocol error (code and message). */
async function answer(client, call) {
  try {
    return { result: await client.callTool(call) };
  } catch (error) {
    return { error: { code: error?.code, message: error instanceof Error ? error.message : String(error) } };
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Runs the checks against the gateway at `baseUrl`. Returns the report lines and
 * the failed checks; throws only when an endpoint can't be reached at all.
 */
export async function checkCombined(baseUrl, { domains = DOMAINS } = {}) {
  // Without trailing slashes; a loop, not a regex, so a long argument can't cost quadratic time.
  let base = baseUrl;
  while (base.endsWith("/")) {base = base.slice(0, -1);}
  const clients = [];
  const connect = async (path) => {
    const client = new Client({ name: "check-combined", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}${path}`)));
    clients.push(client);
    return client;
  };
  const lines = [];
  const failures = [];
  const check = (ok, line) => {
    lines.push(`${ok ? "ok  " : "FAIL"} ${line}`);
    if (!ok) {failures.push(line);}
  };

  try {
    const chosen = DOMAINS.filter((d) => domains.includes(d));
    const own = {};
    const domainClients = {};
    for (const domain of chosen) {
      domainClients[domain] = await connect(`/${domain}/mcp`);
      own[domain] = (await domainClients[domain].listTools()).tools;
    }
    const combined = await connect("/mcp");
    const started = performance.now();
    const listed = (await combined.listTools()).tools;
    const ms = Math.round(performance.now() - started);
    const expected = chosen.flatMap((d) => own[d]);

    const names = listed.map((t) => t.name);
    check(new Set(names).size === names.length, `tool names on /mcp are unique (${names.length})`);
    check(same(listed, expected),
      `/mcp lists exactly the tools of ${chosen.length} domain endpoints: ${listed.length} on /mcp, ${expected.length} on the domains`);
    lines.push(`info tools/list on /mcp took ${ms} ms`);

    for (const domain of chosen) {
      const probe = probeOf(own[domain]);
      if (!probe) {
        lines.push(`info ${domain}: no list tool without required arguments (${own[domain].length} tools); not called`);
        continue;
      }
      const viaDomain = await answer(domainClients[domain], probe);
      const viaCombined = await answer(combined, probe);
      const outcome = viaDomain.error ? `error ${viaDomain.error.code}` : viaDomain.result.isError ? "tool error" : "result";
      check(same(viaCombined, viaDomain), `${domain}: ${probe.name}(${JSON.stringify(probe.arguments)}) answers the same on /mcp (${outcome})`);
    }

    if (chosen.length > 0) {
      const call = { name: UNKNOWN_TOOL, arguments: {} };
      const viaDomain = await answer(domainClients[chosen[0]], call);
      const viaCombined = await answer(combined, call);
      check(viaDomain.error?.code === -32601 && same(viaCombined, viaDomain),
        `an unknown tool gets the same error on /mcp as on /${chosen[0]}/mcp (${viaCombined.error?.message ?? "no error"})`);
    }
  } finally {
    await Promise.allSettled(clients.map((c) => c.close()));
  }
  return { lines, failures };
}

/** The command line: <gateway-url> [--domains a,b]. */
export function parseArgs(argv) {
  const [url, ...rest] = argv;
  if (!url || url.startsWith("--")) {
    throw new Error("usage: node scripts/check-combined.mjs <gateway-url> [--domains a,b,…]");
  }
  let domains = DOMAINS;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--domains" && rest[i + 1] !== undefined) {
      domains = rest[++i].split(",").map((d) => d.trim().toLowerCase()).filter((d) => d !== "");
      const unknown = domains.filter((d) => !DOMAINS.includes(d));
      if (unknown.length > 0 || domains.length === 0) {
        throw new Error(`--domains: not a domain: ${unknown.join(", ") || "(none given)"}`);
      }
    } else {
      throw new Error(`unknown argument "${rest[i]}"`);
    }
  }
  return { url, domains };
}

async function main() {
  const { url, domains } = parseArgs(process.argv.slice(2));
  const { lines, failures } = await checkCombined(url, { domains });
  console.log(`check-combined: ${url}\n${lines.join("\n")}`);
  console.log(failures.length === 0 ? "check-combined: all checks passed" : `check-combined: ${failures.length} check(s) failed`);
  if (failures.length > 0) {process.exitCode = 1;}
}

// Run, unless a test imports it; a path through a symlink still counts as running it.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`check-combined: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
