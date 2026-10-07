/**
 * bconnect-mcp-gateway — write and secret gates stay closed (REQ-SRV-017 D3).
 *
 * The gateway hosts the servers in-process and has no authentication, so
 * ALLOW_WRITE_OPERATIONS / ALLOW_SECRET_READ must not take effect there, whether
 * they come from the environment or from a .env file the servers load per request.
 */

import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";
import { CLOSED_GATES, closeGates } from "../gates.js";
import { createApp } from "../app.js";

const saved = Object.fromEntries(CLOSED_GATES.map((gate) => [gate, process.env[gate]]));
afterEach(() => {
  for (const gate of CLOSED_GATES) {
    if (saved[gate] === undefined) {delete process.env[gate];} else {process.env[gate] = saved[gate];}
  }
});

describe("closeGates", () => {
  it("closes both gates and reports the ones that were set", () => {
    const env: NodeJS.ProcessEnv = { ALLOW_WRITE_OPERATIONS: "true", ALLOW_SECRET_READ: " " };
    expect(closeGates(env)).toEqual(["ALLOW_WRITE_OPERATIONS"]);
    expect(env).toMatchObject({ ALLOW_WRITE_OPERATIONS: "", ALLOW_SECRET_READ: "" });
  });

  it("reports nothing when neither was set", () => {
    expect(closeGates({})).toEqual([]);
  });

  it("keeps them closed when a .env file sets them later (the servers load .env per request)", () => {
    const dir = mkdtempSync(join(tmpdir(), "gates-"));
    try {
      const file = join(dir, ".env");
      writeFileSync(file, "ALLOW_WRITE_OPERATIONS=true\nALLOW_SECRET_READ=true\n");
      const env: NodeJS.ProcessEnv = {};
      closeGates(env);
      dotenv.config({ path: file, processEnv: env as dotenv.DotenvPopulateInput, quiet: true } as dotenv.DotenvConfigOptions);
      expect(env).toMatchObject({ ALLOW_WRITE_OPERATIONS: "", ALLOW_SECRET_READ: "" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("gateway with the gates closed", () => {
  it("refuses a write tool even when ALLOW_WRITE_OPERATIONS=true was set", async () => {
    process.env.ALLOW_WRITE_OPERATIONS = "true";
    closeGates();
    const server = http.createServer(createApp());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as { port: number };
      const res = await fetch(`http://127.0.0.1:${port}/endpoints/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "tools/call",
          params: { name: "delete_endpoint", arguments: { id: "00000000-0000-0000-0000-000000000001" } },
        }),
      });
      const text = await res.text();
      const data = text.split("\n").find((line) => line.startsWith("data: "));
      const body = JSON.parse((data ?? "data: {}").slice(6)) as { result?: { isError?: boolean; content?: Array<{ text: string }> } };
      expect(body.result?.isError).toBe(true);
      expect(body.result?.content?.[0]?.text).toMatch(/^Write operation 'delete_endpoint' is disabled/);
    } finally {
      server.close();
    }
  });

  it("lists only read tools even when ALLOW_WRITE_OPERATIONS=true was set (REQ-SRV-026)", async () => {
    process.env.ALLOW_WRITE_OPERATIONS = "true";
    closeGates();
    const server = http.createServer(createApp());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as { port: number };
      const res = await fetch(`http://127.0.0.1:${port}/endpoints/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      });
      const text = await res.text();
      const data = text.split("\n").find((line) => line.startsWith("data: "));
      const body = JSON.parse((data ?? "data: {}").slice(6)) as { result?: { tools?: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }> } };
      const tools = body.result?.tools ?? [];
      // Not vacuous: the endpoints server lists 10 read tools on 26R1, 7 on 25R2 (one tool per operation since #174).
      expect(tools.length).toBeGreaterThanOrEqual(7);
      expect(tools.filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name)).toEqual([]);
      expect(tools.map((t) => t.name)).not.toContain("delete_endpoint");
    } finally {
      server.close();
    }
  });

  it("gateway.ts checks BCONNECT_RELEASE before it creates the app", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "..", "gateway.ts"), "utf8");
    const check = source.search(/^  checkReleaseSetting\(\);$/m);
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(source.indexOf("createApp()"));
  });

  it("gateway.ts closes the gates before it creates the app", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "..", "gateway.ts"), "utf8");
    const close = source.search(/^const \w+ = closeGates\(\);$/m);
    expect(close).toBeGreaterThan(-1);
    expect(close).toBeLessThan(source.indexOf("createApp()"));
  });
});
