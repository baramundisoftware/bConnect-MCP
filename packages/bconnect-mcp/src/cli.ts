#!/usr/bin/env node
/**
 * The `bconnect-mcp` command (#297). Sets VITEST before the domain servers are
 * imported, so their own entry points don't start (see domains.ts), then runs
 * `main` (index.ts). stdout carries only JSON-RPC; every message goes to stderr.
 */
process.env.VITEST ??= "bconnect-mcp";

const { main } = await import("./index.js");
await main(process.argv.slice(2));
