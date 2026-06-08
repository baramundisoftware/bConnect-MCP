#!/usr/bin/env node

/**
 * bconnect-mcp-gateway
 *
 * Unified MCP gateway that serves all 13 bConnect MCP servers on a single
 * HTTP port. Each server is mounted under POST /<domain>/mcp using the
 * Streamable HTTP transport from the MCP SDK.
 *
 * Environment variables:
 *   MCP_GATEWAY_PORT  — listen port (default: 3001)
 *   MCP_GATEWAY_BIND  — bind address (default: 127.0.0.1)
 *
 * All BCONNECT_* env vars are inherited by the server factories.
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

// ─── Server factory registry ───────────────────────────────────────────────
// Each factory returns { server: Server } where Server comes from each
// server's own @modelcontextprotocol/sdk copy. We use Record<string, Function>
// to avoid type conflicts between duplicate SDK installations.

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
const serverFactories: Record<string, Function> = {
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

const domains = Object.keys(serverFactories);

// ─── Express app ────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

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

  const { server } = factory() as { server: { connect: (t: unknown) => Promise<void>; close: () => Promise<void> } };
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

// Health endpoint
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", servers: domains, count: domains.length });
});

// ─── Start ──────────────────────────────────────────────────────────────────

const port = parseInt(process.env.MCP_GATEWAY_PORT ?? "3001", 10);
const bind = process.env.MCP_GATEWAY_BIND ?? "127.0.0.1";

app.listen(port, bind, () => {
  console.error(`[mcp-gateway] Listening on http://${bind}:${port} (${domains.length} servers)`);
  console.error(`[mcp-gateway] Domains: ${domains.join(", ")}`);
});
