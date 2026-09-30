/**
 * bconnect-mcp-gateway — Express app factory
 *
 * Exported for testing. The gateway entry point (gateway.ts) calls
 * createApp().listen(...). The gateway has no built-in auth (ADR-0003):
 * authentication is the fronting proxy's job; downstream calls use a single
 * BCONNECT_* service credential.
 */

import express, { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createServer as createActivedirectoryServer } from "bconnect-activedirectory-mcp";
import { createServer as createAssetsServer } from "bconnect-assets-mcp";
import { createServer as createComplianceServer } from "bconnect-compliance-mcp";
import { createServer as createDefensecontrolServer } from "bconnect-defensecontrol-mcp";
import { createServer as createEndpointsServer } from "bconnect-endpoints-mcp";
import { createServer as createGroupsServer } from "bconnect-groups-mcp";
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

// ─── Server factory registry ──────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export const serverFactories: Record<string, Function> = {
  activedirectory: createActivedirectoryServer,
  assets: createAssetsServer,
  compliance: createComplianceServer,
  defensecontrol: createDefensecontrolServer,
  endpoints: createEndpointsServer,
  groups: createGroupsServer,
  jobs: createJobsServer,
  operatingsystems: createOperatingsystemsServer,
  servermanagement: createServermanagementServer,
  software: createSoftwareServer,
  universaldynamicgroups: createUniversaldynamicgroupsServer,
  updatemanagement: createUpdatemanagementServer,
  variables: createVariablesServer,
};

export const domains = Object.keys(serverFactories);

/**
 * The factory for a domain named in the request path, or undefined.
 * Own keys only: `serverFactories` is a plain object, so a bare index would
 * also find inherited members such as `constructor` or `toString` (REQ-GW-002).
 */
export function getServerFactory(domain: string): Function | undefined {
  return Object.hasOwn(serverFactories, domain) ? serverFactories[domain] : undefined;
}

// ─── App factory ──────────────────────────────────────────────────────────────

export function createApp(): express.Application {
  const app = express();
  const logger = createLogger();
  // Access log first so it records every request's final status (incl. 401/429).
  app.use(createAccessLogMiddleware(logger));
  // Cap request body size (default 1mb) to bound per-request memory (audit H2).
  app.use(express.json({ limit: process.env.MCP_GATEWAY_MAX_BODY ?? "1mb" }));
  // Per-client-IP inbound rate limiting. The gateway has no built-in auth
  // (ADR-0003); identity/authN is the fronting proxy's job.
  app.use(createRateLimitMiddleware());

  // MCP Streamable HTTP handler — stateless, one server+transport per request
  app.post("/:domain/mcp", async (req: Request, res: Response) => {
    const factory = getServerFactory(req.params.domain);
    if (!factory) {
      res.status(404).json({
        error: `Unknown MCP domain '${req.params.domain}'`,
        available: domains,
      });
      return;
    }

    // Express 4 doesn't catch a rejected promise from an async handler; Node
    // would then terminate the whole gateway. Fail this request only (REQ-GW-002).
    let server: { connect: (t: unknown) => Promise<void>; close: () => Promise<void> } | undefined;
    let transport: StreamableHTTPServerTransport | undefined;
    // close() returns a promise; a rejection during cleanup must not become an
    // unhandled rejection either.
    const release = () => {
      void transport?.close().catch(() => undefined);
      void server?.close().catch(() => undefined);
    };
    try {
      // No per-request credential: each server falls back to the BCONNECT_*
      // service credential (single-credential mode). bMS RBAC governs it.
      ({ server } = factory(undefined) as { server: NonNullable<typeof server> });
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

      res.on("close", release);

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error("MCP request failed", {
        domain: req.params.domain,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal error" },
          id: null,
        });
      }
      release();
    }
  });

  // Method-not-allowed guards (MCP spec compliance)
  app.get("/:domain/mcp", (_req: Request, res: Response) => {
    res.status(405).json({ error: "Method Not Allowed. Use POST for MCP requests." });
  });

  app.delete("/:domain/mcp", (_req: Request, res: Response) => {
    res.status(405).json({ error: "Method Not Allowed. Session management not supported in stateless mode." });
  });

  // Health endpoint
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", servers: domains, count: domains.length });
  });

  return app;
}
