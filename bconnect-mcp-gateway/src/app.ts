/**
 * bconnect-mcp-gateway — Express app factory
 *
 * Exported for testing. The gateway entry point (gateway.ts) calls
 * createApp(loadTokenMap(...)).listen(...)
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

import { type BConnectCredentials, type TokenMap, createAuthMiddleware } from "./auth.js";
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

// ─── App factory ──────────────────────────────────────────────────────────────

export function createApp(tokenMap: TokenMap): express.Application {
  const authEnabled = Object.keys(tokenMap).length > 0;
  const app = express();
  // Access log first so it records every request's final status (incl. 401/429).
  app.use(createAccessLogMiddleware(createLogger()));
  // Cap request body size (default 1mb) to bound per-request memory (audit H2).
  app.use(express.json({ limit: process.env.MCP_GATEWAY_MAX_BODY ?? "1mb" }));
  app.use(createAuthMiddleware(tokenMap));
  // Per-token inbound rate limiting (runs after auth so the token is known).
  app.use(createRateLimitMiddleware());

  // MCP Streamable HTTP handler — stateless, one server+transport per request
  app.post("/:domain/mcp", async (req: Request, res: Response) => {
    const factory = serverFactories[req.params.domain];
    if (!factory) {
      res.status(404).json({
        error: `Unknown MCP domain '${req.params.domain}'`,
        available: domains,
      });
      return;
    }

    const credentials = res.locals["bconnectCredentials"] as BConnectCredentials | undefined;
    const { server } = factory(credentials) as {
      server: { connect: (t: unknown) => Promise<void>; close: () => Promise<void> };
    };
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on("close", () => {
      transport.close();
      server.close();
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

  // Health endpoint — always unauthenticated
  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", servers: domains, count: domains.length, authEnabled });
  });

  return app;
}
