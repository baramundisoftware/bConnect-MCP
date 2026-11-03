/**
 * Gateway — the combined endpoint POST /mcp against bConnect-Mock (#131).
 * See docs/MOCK_INTEGRATION_TESTING.md.
 *
 * The gateway app runs in-process (the CI mock job builds the servers, not the
 * gateway), on a random loopback port, with the mock as its bMS. The checks are
 * those of scripts/check-combined.mjs, which the Windows live run uses against
 * a real bMS: /mcp lists exactly the per-domain tools, and a list tool per
 * domain answers the same on /mcp as on its own endpoint.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { combinedTools } from "@bconnect/mcp-core";
import { combinedParts, createApp, domains } from "../../app.js";
import { COMBINED_INFO, combinedDomains } from "../../combined.js";
import { closeGates } from "../../gates.js";
import { checkCombined, DOMAINS } from "../../../../scripts/check-combined.mjs";
import {
  getMockHealth,
  MOCK_BASE_URL,
  MOCK_CREDENTIALS,
  mockAvailable,
} from "../../../../__tests__/lib/mock-integration.js";

let available = false;
const servers: http.Server[] = [];

/** The gateway app with MCP_GATEWAY_COMBINED as given, on a random loopback port. */
async function startGateway(combined: string): Promise<string> {
  vi.stubEnv("MCP_GATEWAY_COMBINED", combined);
  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

/** The checks of scripts/check-combined.mjs; the report is printed for the tier's log. */
async function check(url: string, chosen: string[]): Promise<string[]> {
  const { lines, failures } = await checkCombined(url, { domains: chosen });
  console.info(`check-combined (${chosen.length} domains):\n${lines.join("\n")}`);
  return failures;
}

beforeAll(async () => {
  available = await mockAvailable('gateway');
  if (!available) {return;}
  const health = await getMockHealth();
  // The mock as the gateway's bMS, with the test credentials; the release the mock serves.
  vi.stubEnv("BCONNECT_BASE_URL", MOCK_BASE_URL);
  vi.stubEnv("BCONNECT_USERNAME", MOCK_CREDENTIALS.username);
  vi.stubEnv("BCONNECT_PASSWORD", MOCK_CREDENTIALS.password);
  vi.stubEnv("BCONNECT_API_KEY", "");
  vi.stubEnv("BCONNECT_RELEASE", String(health?.bmsVersion ?? "").toUpperCase());
  vi.stubEnv("MCP_GATEWAY_RATE_LIMIT_ENABLED", "false");
  // As gateway.ts does first: writes and secret reads stay off.
  closeGates();
});

afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  vi.unstubAllEnvs();
});

describe("Gateway — combined endpoint against the mock", () => {
  it("the check script knows the gateway's domains, in its order", (ctx) => {
    if (!available) {ctx.skip();}
    expect(DOMAINS).toEqual(domains);
  });

  it("the startup check passes: no tool name in two domains", async (ctx) => {
    if (!available) {ctx.skip();}
    const all = combinedDomains("all", domains) ?? [];
    const tools = await combinedTools(combinedParts(all), COMBINED_INFO);
    const names = Object.values(tools).flat();
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThan(0);
  });

  it("MCP_GATEWAY_COMBINED=all: /mcp matches the 13 domain endpoints", async (ctx) => {
    if (!available) {ctx.skip();}
    expect(await check(await startGateway("all"), domains)).toEqual([]);
  });

  it("MCP_GATEWAY_COMBINED=endpoints,assets,groups: /mcp matches those three", async (ctx) => {
    if (!available) {ctx.skip();}
    const chosen = ["assets", "endpoints", "groups"];
    expect(await check(await startGateway("endpoints,assets,groups"), chosen)).toEqual([]);
  });
});
