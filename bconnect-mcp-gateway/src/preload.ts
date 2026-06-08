/**
 * Preload script — sets VITEST env var before any MCP server modules load.
 * Each server guards its main() with `if (process.env.VITEST === undefined)`.
 * This prevents 13 server entrypoints from running when imported by the gateway.
 *
 * Usage: node --import ./build/preload.js build/gateway.js
 */
process.env.VITEST = "gateway";
