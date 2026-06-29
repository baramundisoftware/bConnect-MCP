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
import { createLogger } from "./logger.js";
import { resolveFileSecrets } from "./secrets.js";

const log = createLogger();

// audit M2: hydrate credential env vars from mounted secret files (*_FILE).
try {
  resolveFileSecrets();
} catch (err) {
  log.error("cannot read a *_FILE secret referenced in the environment", { error: String(err) });
  process.exit(1);
}

const tokenMap: TokenMap = loadTokenMap(process.env.MCP_AUTH_CONFIG);
const authEnabled = Object.keys(tokenMap).length > 0;
const app = createApp(tokenMap);

const port = parseInt(process.env.MCP_GATEWAY_PORT ?? "3001", 10);
const bind = process.env.MCP_GATEWAY_BIND ?? "127.0.0.1";

// Fail closed: an unauthenticated gateway reachable from a non-loopback address
// is an open proxy to bConnect (it would serve every tool using the env-fallback
// credentials). Refuse to start in that configuration unless the operator has
// explicitly accepted the risk via MCP_ALLOW_NO_AUTH=true.
const isLoopbackBind = bind === "127.0.0.1" || bind === "::1" || bind === "localhost";
if (!authEnabled && !isLoopbackBind && process.env.MCP_ALLOW_NO_AUTH !== "true") {
  log.error(
    "Refusing to start: auth disabled (no MCP_AUTH_CONFIG) on a non-loopback bind — " +
      "this is an open bConnect proxy. Provide MCP_AUTH_CONFIG, bind to loopback, or set MCP_ALLOW_NO_AUTH=true.",
    { bind },
  );
  process.exit(1);
}

app.listen(port, bind, () => {
  log.info("listening", { url: `http://${bind}:${port}`, servers: domains.length });
  log.info("domains", { domains: domains.join(",") });
  if (authEnabled) {
    log.info("auth enabled", { tokens: Object.keys(tokenMap).length });
  } else {
    log.warn("auth disabled — set MCP_AUTH_CONFIG to enable token-based auth");
  }
});
