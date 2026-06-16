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
 *
 * All BCONNECT_* env vars are inherited by the server factories as fallback.
 */

import fs from "fs";
import express, { Request, Response, NextFunction } from "express";
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

// ─── Credential types ────────────────────────────────────────────────────────

interface BConnectCredentials {
  baseUrl?: string;
  username?: string;
  password?: string;
  apiKey?: string;
}

type TokenMap = Record<string, BConnectCredentials>;

// ─── Token map loading ───────────────────────────────────────────────────────

function loadTokenMap(): TokenMap {
  const configPath = process.env.MCP_AUTH_CONFIG;
  if (!configPath) {
    return {};
  }

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    console.error(`[mcp-gateway] Cannot read MCP_AUTH_CONFIG at '${configPath}':`, err);
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`[mcp-gateway] MCP_AUTH_CONFIG at '${configPath}' is not valid JSON:`, err);
    process.exit(1);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    console.error(`[mcp-gateway] MCP_AUTH_CONFIG must be a JSON object mapping tokens to credentials.`);
    process.exit(1);
  }

  const tokenCount = Object.keys(parsed as object).length;
  console.error(`[mcp-gateway] Auth: loaded ${tokenCount} token(s) from '${configPath}'`);
  return parsed as TokenMap;
}

const tokenMap = loadTokenMap();
const authEnabled = Object.keys(tokenMap).length > 0;

// ─── Server factory registry ─────────────────────────────────────────────────
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

// ─── Express app ─────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Auth middleware — resolves Bearer token → bConnect credentials.
// Skips /health. In single-user mode (no MCP_AUTH_CONFIG) passes through without auth.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path === "/health") {
    return next();
  }

  if (!authEnabled) {
    // Backwards-compatible: no token map configured, use env vars (set by each factory).
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authorization header required: Bearer <token>" });
    return;
  }

  const token = authHeader.slice(7);
  const credentials = tokenMap[token];
  if (!credentials) {
    res.status(401).json({ error: "Invalid or unknown token" });
    return;
  }

  res.locals["bconnectCredentials"] = credentials;
  next();
});

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

  // Pass resolved credentials (from token map) or undefined (env-var fallback mode).
  const credentials = res.locals["bconnectCredentials"] as BConnectCredentials | undefined;

  const { server } = factory(credentials) as { server: { connect: (t: unknown) => Promise<void>; close: () => Promise<void> } };
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

// ─── Start ───────────────────────────────────────────────────────────────────

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
