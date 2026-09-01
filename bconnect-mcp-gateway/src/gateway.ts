#!/usr/bin/env node

/**
 * bconnect-mcp-gateway
 *
 * Unified MCP gateway that serves all 13 bConnect MCP servers on a single
 * HTTP port. Each server is mounted under POST /<domain>/mcp using the
 * Streamable HTTP transport from the MCP SDK.
 *
 * SEC-7 — the gateway authenticates callers with a shared bearer token when
 * MCP_GATEWAY_AUTH_TOKEN is set, which is what docker-compose.gateway.yml and
 * both installers configure. TLS and per-user identity remain the operator's
 * responsibility: front it with a TLS-terminating, authenticating reverse proxy
 * / IdP (see docs/DOCKER.md → "TLS and authentication"). The gateway uses a
 * single BCONNECT_* service credential for downstream bMS calls; bMS RBAC
 * governs what that credential can do.
 *
 * Environment variables:
 *   MCP_GATEWAY_PORT       — listen port (default: 3001)
 *   MCP_GATEWAY_BIND       — bind address (default: 127.0.0.1)
 *   MCP_GATEWAY_AUTH_TOKEN — shared bearer token(s), comma-separated for
 *                            rotation. Also MCP_GATEWAY_AUTH_TOKEN_FILE.
 *   MCP_ALLOW_NO_AUTH      — "true" to permit a non-loopback bind with NO token,
 *                            asserting an authenticating proxy is in front.
 *                            Nothing we ship sets this (it used to be hard-coded
 *                            in the compose file, which disarmed the guard below).
 *   BCONNECT_BASE_URL / BCONNECT_API_KEY / BCONNECT_USERNAME / BCONNECT_PASSWORD
 *                          — the service credential (see secrets.ts for *_FILE support).
 *   BCONNECT_ALLOW_INSECURE_HTTP
 *                          — "true" to permit an http:// BCONNECT_BASE_URL. See
 *                            startup-config.ts: without it the gateway refuses,
 *                            exactly as the stdio servers do.
 */

import { createApp, domains, serverFactories } from "./app.js";
import { createLogger } from "./logger.js";
import { resolveFileSecrets } from "./secrets.js";
import { evaluateBindPosture } from "./auth.js";
import { runStartupChecks, type StartupProbeClient } from "./startup-config.js";
import { PROBE_PATH, runLeastPrivilegeChecks } from "./least-privilege.js";
import { resolveDomainCredentials } from "./domain-credentials.js";

const log = createLogger();

/**
 * The slice of the shared axios client the privilege probe uses. Structural
 * rather than an axios import: the gateway does not otherwise depend on axios,
 * and every server's client already exposes `getHttpClient()`.
 */
interface AxiosLike {
  get(path: string, config: { validateStatus: () => boolean }): Promise<{ status: number }>;
}

// audit M2: hydrate credential env vars from mounted secret files (*_FILE).
try {
  resolveFileSecrets();
} catch (err) {
  log.error("cannot read a *_FILE secret referenced in the environment", { error: String(err) });
  process.exit(1);
}

const port = parseInt(process.env.MCP_GATEWAY_PORT ?? "3001", 10);
const bind = process.env.MCP_GATEWAY_BIND ?? "127.0.0.1";

// Fail closed. The decision itself lives in auth.ts so it can be tested without
// a process.exit() taking the test runner with it; this is only the reporting.
const posture = evaluateBindPosture();
if (!posture.ok) {
  log.error(posture.reason ?? "Refusing to start.", { bind });
  for (const line of posture.detail) { log.error(line); }
  process.exit(1);
}

// SEC-1 — the bConnect configuration checks the thirteen stdio servers get from
// runServer: base URL, credential, the http:// clear-text refusal and the 26R1
// version gate. runServer cannot run them here (preload.ts suppresses the
// entrypoints so importing 13 servers does not start 13 stdio transports), so
// the gateway performs them itself. See startup-config.ts.
//
// The probe deliberately uses a real server's own client rather than a
// purpose-built one: it is the client the tools will use, so a gateway that
// starts is a gateway whose tools can reach bMS.
const startup = await runStartupChecks({
  error: (line) => log.error(line),
  warn: (line) => log.warn(line),
  info: (line) => log.info(line),
  probeClient: () => {
    const built = serverFactories.endpoints(undefined) as {
      getClient?: () => StartupProbeClient;
    };
    return built.getClient?.();
  },
});
if (!startup.ok) {
  process.exit(1);
}

// Least privilege, asserted rather than assumed (MCP_GATEWAY_ASSERT_LEAST_PRIVILEGE).
//
// Off by default: unset, nothing below runs and no request is made. When on,
// each domain's resolved credential is asked ONE read-only question — can it
// read the estate's own API-key inventory? — because bConnect offers no way for
// a process to look up its OWN key's profiles (least-privilege.ts explains what
// was measured and why the spec's design was impossible).
//
// The probe uses each domain's real server client, the same precedent the
// connectivity check above sets: the credential under test is the one the tools
// will use, not a purpose-built copy.
const privilege = await runLeastPrivilegeChecks(
  domains,
  (domain) => resolveDomainCredentials(domain),
  async (domain, credentials) => {
    try {
      const built = serverFactories[domain](credentials) as {
        getClient?: () => { getHttpClient?: () => AxiosLike } | undefined;
      };
      const http = built.getClient?.()?.getHttpClient?.();
      if (!http) {
        return { domain, error: "client exposes no HTTP client" };
      }
      // validateStatus: a 403 is the ANSWER here, not an error — without this
      // axios throws on it and the most interesting outcome becomes
      // indistinguishable from a network failure.
      const res = await http.get(PROBE_PATH, { validateStatus: () => true });
      return { domain, status: res.status };
    } catch (err) {
      // Never throws by contract: an unreachable bMS is "could not verify",
      // not a crash during startup.
      return { domain, error: String(err instanceof Error ? err.message : err) };
    }
  },
);
for (const line of privilege.lines) {
  ({ info: log.info, warn: log.warn, error: log.error })[line.level](line.text);
}
if (!privilege.ok) {
  process.exit(1);
}

// Built AFTER the posture and configuration checks: a refused configuration
// should not spend the time (or the memory) constructing 13 MCP servers before
// it exits.
const app = createApp();

app.listen(port, bind, () => {
  log.info("listening", { url: `http://${bind}:${port}`, servers: domains.length });
  log.info("domains", { domains: domains.join(",") });
  log.info("auth", { posture: posture.summary });
  for (const line of posture.detail) { log.warn(line); }
  if (!posture.authEnabled) {
    log.warn(
      "no built-in auth — authentication is delegated to the fronting reverse proxy (ADR-0003); " +
        "the gateway uses a single BCONNECT_* service credential",
    );
  }
  if (posture.loopback && process.env.MCP_GATEWAY_IN_CONTAINER === "true") {
    // A loopback bind inside a container is invisible to a published port, and
    // the symptom (connection refused on a port docker says is published) sends
    // people looking in the wrong place.
    log.warn(
      "bound to loopback inside a container: a published port will NOT reach it. Set " +
        "MCP_GATEWAY_BIND=0.0.0.0 — which requires MCP_GATEWAY_AUTH_TOKEN, by design.",
    );
  }
});
