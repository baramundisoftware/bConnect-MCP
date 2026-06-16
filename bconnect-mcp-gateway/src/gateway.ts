#!/usr/bin/env node

/**
 * bconnect-mcp-gateway
 *
 * Unified MCP gateway that serves all 13 bConnect MCP servers on a single
 * HTTP port. Each server is mounted under POST /<domain>/mcp using the
 * Streamable HTTP transport from the MCP SDK.
 *
 * Environment variables:
 *   MCP_GATEWAY_PORT    — listen port (default: 3001)
 *   MCP_GATEWAY_BIND    — bind address (default: 127.0.0.1)
 *   MCP_AUTH_CONFIG     — path to a JSON file mapping Bearer tokens to bConnect
 *                         credentials (see docs). When set, every MCP request
 *                         must carry a valid Authorization: Bearer <token> header.
 *                         When unset the gateway falls back to BCONNECT_* env vars
 *                         (single-user / backwards-compatible mode).
 *
 * Token map file format (MCP_AUTH_CONFIG):
 *   {
 *     "<bearer-token>": {
 *       "baseUrl":  "https://bms.example.com/bconnect",   // optional — falls back to env
 *       "apiKey":   "your-bconnect-api-key"               // apiKey OR username+password
 *     },
 *     "<another-token>": {
 *       "username": "svc-readonly",
 *       "password": "secret"
 *     }
 *   }
 *
 * Multiple MCP tokens can share the same bConnect credentials (n:m mapping).
 * bConnect credentials never leave the server — clients only know their token.
 */

import { loadTokenMap, type TokenMap } from "./auth.js";
import { createApp, domains } from "./app.js";

const tokenMap: TokenMap = loadTokenMap(process.env.MCP_AUTH_CONFIG);
const authEnabled = Object.keys(tokenMap).length > 0;
const app = createApp(tokenMap);

const port = parseInt(process.env.MCP_GATEWAY_PORT ?? "3001", 10);
const bind = process.env.MCP_GATEWAY_BIND ?? "127.0.0.1";

app.listen(port, bind, () => {
  console.error(`[mcp-gateway] Listening on http://${bind}:${port} (${domains.length} servers)`);
  console.error(`[mcp-gateway] Domains: ${domains.join(", ")}`);
  if (authEnabled) {
    console.error(`[mcp-gateway] Auth: enabled (${Object.keys(tokenMap).length} token(s))`);
  } else {
    console.error(`[mcp-gateway] Auth: disabled — set MCP_AUTH_CONFIG to enable token-based auth`);
  }
});
