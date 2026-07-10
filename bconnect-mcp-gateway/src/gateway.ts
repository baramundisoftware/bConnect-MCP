#!/usr/bin/env node

/**
 * bconnect-mcp-gateway
 *
 * Unified MCP gateway that serves all 13 bConnect MCP servers on a single
 * HTTP port. Each server is mounted under POST /<domain>/mcp using the
 * Streamable HTTP transport from the MCP SDK.
 *
 * The gateway has NO built-in authentication (ADR-0003). Authentication and
 * TLS are the operator's responsibility: front it with an authenticating,
 * TLS-terminating reverse proxy / IdP (see docs/DOCKER.md → "TLS and
 * authentication"). The gateway uses a single BCONNECT_* service credential for
 * downstream bMS calls; bMS RBAC governs what that credential can do.
 *
 * Environment variables:
 *   MCP_GATEWAY_PORT    — listen port (default: 3001)
 *   MCP_GATEWAY_BIND    — bind address (default: 127.0.0.1)
 *   MCP_ALLOW_NO_AUTH   — "true" to permit a non-loopback bind, asserting an
 *                         authenticating proxy is in front (fail-closed default).
 *   BCONNECT_BASE_URL / BCONNECT_API_KEY / BCONNECT_USERNAME / BCONNECT_PASSWORD
 *                       — the service credential (see secrets.ts for *_FILE support).
 */

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

const app = createApp();

const port = parseInt(process.env.MCP_GATEWAY_PORT ?? "3001", 10);
const bind = process.env.MCP_GATEWAY_BIND ?? "127.0.0.1";

// Fail closed: the gateway has no built-in auth, so a non-loopback bind is only
// safe behind an authenticating reverse proxy. Refuse to start on a non-loopback
// address unless the operator explicitly asserts a proxy is in front via
// MCP_ALLOW_NO_AUTH=true.
const isLoopbackBind = bind === "127.0.0.1" || bind === "::1" || bind === "localhost";
if (!isLoopbackBind && process.env.MCP_ALLOW_NO_AUTH !== "true") {
  log.error(
    "Refusing to start: non-loopback bind without MCP_ALLOW_NO_AUTH=true. The gateway has no " +
      "built-in auth — front it with an authenticating reverse proxy and keep the gateway on " +
      "loopback, or set MCP_ALLOW_NO_AUTH=true to assert a proxy is in front.",
    { bind },
  );
  process.exit(1);
}

app.listen(port, bind, () => {
  log.info("listening", { url: `http://${bind}:${port}`, servers: domains.length });
  log.info("domains", { domains: domains.join(",") });
  log.warn(
    "no built-in auth — authentication is delegated to the fronting reverse proxy (ADR-0003); " +
      "the gateway uses a single BCONNECT_* service credential",
  );
});
