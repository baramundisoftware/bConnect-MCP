/**
 * bconnect-mcp-gateway — Express app factory
 *
 * Exported for testing. The gateway entry point (gateway.ts) calls
 * createApp().listen(...).
 *
 * SEC-7 — the gateway now authenticates callers itself when
 * MCP_GATEWAY_AUTH_TOKEN is set (see auth.ts), which is what everything we ship
 * configures. ADR-0003 still holds for identity: the token says "this caller may
 * talk to the gateway", not "this caller is Alice". Per-user identity, TLS and
 * edge policy remain the fronting proxy's job, and downstream bMS calls still use
 * a single BCONNECT_* service credential.
 */

import express, { NextFunction, Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createServer as createActivedirectoryServer } from "bconnect-activedirectory-mcp";
import { createServer as createAssetsServer } from "bconnect-assets-mcp";
import { createServer as createComplianceServer } from "bconnect-compliance-mcp";
import { createServer as createDefensecontrolServer } from "bconnect-defensecontrol-mcp";
import { createServer as createEndpointsServer } from "bconnect-endpoints-mcp";
import { createServer as createGroupsServer } from "bconnect-groups-mcp";
import { createServer as createInsightsServer } from "bconnect-insights-mcp";
import { createServer as createJobsServer } from "bconnect-jobs-mcp";
import { createServer as createOperatingsystemsServer } from "bconnect-operatingsystems-mcp";
import { createServer as createServermanagementServer } from "bconnect-servermanagement-mcp";
import { createServer as createSoftwareServer } from "bconnect-software-mcp";
import { createServer as createUniversaldynamicgroupsServer } from "bconnect-universaldynamicgroups-mcp";
import { createServer as createUpdatemanagementServer } from "bconnect-updatemanagement-mcp";
import { createServer as createVariablesServer } from "bconnect-variables-mcp";

import { createRateLimitMiddleware } from "./rate-limit.js";
import { createLogger } from "./logger.js";
import { createAccessLogMiddleware } from "./access-log.js";
import { createHostGuardMiddleware, resolveHostGuardConfig, sdkTransportOptions } from "./host-guard.js";
import { createAuthMiddleware, isAuthenticatedRequest } from "./auth.js";
import { resolveMaxBodyBytes } from "./body-limit.js";
import { createServerPool, type PoolableServer } from "./server-pool.js";
import { resolveDomainCredentials } from "./domain-credentials.js";

// ─── Server factory registry ──────────────────────────────────────────────────
 
export const serverFactories: Record<string, Function> = {
  activedirectory: createActivedirectoryServer,
  assets: createAssetsServer,
  compliance: createComplianceServer,
  defensecontrol: createDefensecontrolServer,
  endpoints: createEndpointsServer,
  groups: createGroupsServer,
  // The cross-module composite server (2026-08-12). Unlike the thirteen
  // above it owns no bConnect module of its own: it READS several modules'
  // routes through one client to answer a whole question. Mounted here on the
  // same footing as the rest — the credential resolver, the pool, the write
  // gate and the least-privilege probe all key on the domain name, so nothing
  // about it needs a special case.
  insights: createInsightsServer,
  jobs: createJobsServer,
  operatingsystems: createOperatingsystemsServer,
  servermanagement: createServermanagementServer,
  software: createSoftwareServer,
  universaldynamicgroups: createUniversaldynamicgroupsServer,
  updatemanagement: createUpdatemanagementServer,
  variables: createVariablesServer,
};

export const domains = Object.keys(serverFactories);

// ─── App factory ──────────────────────────────────────────────────────────────

export function createApp(): express.Application {
  const app = express();
  const logger = createLogger();

  // SEC-8 — without this, req.ip is the fronting proxy's address for every
  // request: all callers collapse into one rate-limit bucket and the access log
  // names a hop instead of a client. 'loopback' (the default) is
  // behaviour-identical for a directly-reached gateway and correct for a
  // co-located proxy; set MCP_GATEWAY_TRUST_PROXY (hop count, CIDR list, or
  // 'false') to match the real topology.
  app.set("trust proxy", process.env.MCP_GATEWAY_TRUST_PROXY ?? "loopback");

  // ── Middleware order is a security control, not a style choice ────────────
  //
  // SEC-4 — express.json() used to sit at the top of this stack, ahead of the
  // rate limiter and the auth guard. The consequences were both measurable: an
  // unauthenticated caller got a ~1 MB JSON parse per request that the limiter
  // never metered (a malformed body short-circuits to the error handler before
  // the limiter is reached, so five 2 MB POSTs against a limit of three cost
  // the caller nothing), and SEC-2 — body-parser's own errors reached Express's
  // default handler, which serialises the stack, before anything had decided
  // whether this caller was allowed to speak at all.
  //
  // The rule the order encodes: every CHEAP decision that can refuse a request
  // is taken before the one EXPENSIVE thing the gateway does for it. Nothing
  // above the parser reads the body.

  // Access log first so it records every request's final status (incl. 401/429).
  app.use(createAccessLogMiddleware(logger));
  // Per-client-IP inbound rate limiting, ahead of everything it protects — a
  // flood of rejected requests is still metered, so an unauthenticated caller
  // gets no unmetered oracle to hammer.
  app.use(createRateLimitMiddleware());
  // SEC-9 — DNS-rebinding / Origin protection. See host-guard.ts. Ahead of auth
  // so a browser-origin request is refused as a browser, whatever it carries.
  app.use(createHostGuardMiddleware(logger));
  // SEC-7 — bearer-token authentication when MCP_GATEWAY_AUTH_TOKEN is set. A
  // no-op when it is not, which is what keeps a loopback install a one-liner;
  // gateway.ts is the control that stops "no token" being a network deployment.
  app.use(createAuthMiddleware(logger));
  // Cap request body size (default 1mb) to bound per-request memory (audit H2).
  //
  // SC-1 — the limit is resolved to a NUMBER of bytes here, never handed to
  // body-parser as an operator-supplied string. body-parser resolves a string
  // limit with `bytes.parse()`, which returns null for values that do not begin
  // with a digit ('"1mb"' with the quotes kept, "unlimited", " "), and raw-body
  // then stops enforcing altogether — the cap SECURITY.md advertises silently
  // disappears (GHSA-v422-hmwv-36x6). A number bypasses that parser entirely on
  // every body-parser version, so the fix does not depend on winning a
  // dependency-resolution race the gateway does not control. See body-limit.ts.
  app.use(express.json({ limit: resolveMaxBodyBytes(process.env.MCP_GATEWAY_MAX_BODY, logger) }));

  const hostGuard = resolveHostGuardConfig();
  const pool = createServerPool();
  // Diagnostics hook (also used by the tests to assert servers are reused).
  app.locals.serverPoolStats = (): Record<string, number> => pool.stats();

  // MCP Streamable HTTP handler — stateless, one transport per request; the
  // server (and the bConnect client, agent and cache it owns) is pooled per
  // domain, see server-pool.ts.
  app.post("/:domain/mcp", async (req: Request, res: Response) => {
    const factory = serverFactories[req.params.domain];
    if (!factory) {
      res.status(404).json({
        error: `Unknown MCP domain '${req.params.domain}'`,
        available: domains,
      });
      return;
    }

    // Credentials are per DOMAIN, not per request. With
    // MCP_GATEWAY_DOMAIN_CREDENTIALS unset this resolves to undefined for every
    // domain and the behaviour is exactly what it was: each server falls back to
    // the single BCONNECT_* service credential, governed by bMS RBAC.
    //
    // The pool is keyed by domain, so a pooled server always carries the
    // credentials of the domain it was built for and cross-domain reuse is
    // structurally impossible. That is asserted in domain-credentials.test.ts
    // rather than left as a comment.
    const server = pool.acquire(req.params.domain, () => {
      const built = factory(resolveDomainCredentials(req.params.domain)) as { server: PoolableServer };
      return built.server;
    });

    // Second layer behind host-guard.ts: the SDK's own Origin check. It is
    // enabled only when there is a list for it to enforce — see
    // sdkTransportOptions(), which records why a flag with empty lists is worse
    // than no flag at all.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      ...sdkTransportOptions(hostGuard),
    });

    res.on("close", () => {
      // Return the server to the pool only after the transport has detached it,
      // so the next request's connect() cannot hit "Already connected".
      void Promise.resolve(transport.close())
        .catch(() => { /* transport already gone */ })
        .finally(() => pool.release(req.params.domain, server));
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // Method-not-allowed guards (MCP spec compliance)
  app.get("/:domain/mcp", (_req: Request, res: Response) => {
    res.status(405).json({ error: "Method Not Allowed. Use POST for MCP requests." });
  });

  app.delete("/:domain/mcp", (_req: Request, res: Response) => {
    res.status(405).json({ error: "Method Not Allowed. Session management not supported in stateless mode." });
  });

  // Health endpoint.
  //
  // SEC-10 — liveness only. This used to answer every unauthenticated caller
  // with the full list of thirteen mounted domains and their count, which is
  // free reconnaissance: it identifies the product, its version surface and its
  // reach on the one component that listens on a socket. A container or
  // orchestrator probe needs "is the process answering", nothing more. The list
  // is still served, to a caller that has presented a configured token —
  // meaning it is served exactly to callers who can already enumerate it by
  // POSTing to an unknown domain.
  app.get("/health", (req: Request, res: Response) => {
    if (isAuthenticatedRequest(req)) {
      res.json({ status: "ok", servers: domains, count: domains.length });
      return;
    }
    res.json({ status: "ok" });
  });

  // SEC-2 — terminal error handler.
  //
  // Without it, a malformed or oversized body reaches Express's default handler,
  // which serialises err.stack into the response whenever NODE_ENV is not
  // "production": absolute filesystem paths, the gateway's own build path and
  // nine frames of node_modules internals, to a caller that has not
  // authenticated. The Docker image sets NODE_ENV=production and was covered;
  // the shipped Windows launcher does not set it at all and was not. So this
  // does not consult NODE_ENV — an error handler whose safety depends on an
  // environment variable one of two shipped launchers forgets to set is not a
  // control.
  //
  // Four arguments is what makes Express treat this as an error handler; `next`
  // is unused but cannot be dropped.
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const type = (err as { type?: string } | null)?.type;
    const { status, code, message } =
      type === "entity.too.large"
        ? { status: 413, code: -32600, message: "Request body exceeds the configured size limit." }
        : type === "entity.parse.failed" || err instanceof SyntaxError
          ? { status: 400, code: -32700, message: "Parse error: request body is not valid JSON." }
          : { status: 500, code: -32603, message: "Internal error." };

    // The detail goes to the operator's log, never to the caller.
    logger.error("request failed", {
      status,
      type: type ?? (err instanceof Error ? err.name : typeof err),
    });

    // Same JSON-RPC-shaped envelope the host and auth guards return, so a client
    // sees one error shape from the gateway's edge whichever control refused it.
    res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });
  });

  return app;
}
