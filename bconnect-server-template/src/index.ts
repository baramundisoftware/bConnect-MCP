#!/usr/bin/env node

/**
 * bconnect-DOMAIN-mcp (server template)
 *
 * Skeleton for a new bConnect MCP server. Mirrors the validation-first
 * dispatch architecture used by the 13 production servers (see
 * SECURITY.md → "Tool-argument validation").
 *
 * To create a real server from this template:
 *   1. Replace DOMAIN with the actual domain name (e.g. assets, jobs).
 *   2. Replace DomainRules with the real per-domain rules name in
 *      `src/utils/mcp-tool-validation-rules.ts`.
 *   3. Add tool definitions to ListToolsRequestSchema.
 *   4. Add one validation case per tool to validateToolArguments().
 *   5. Add the matching dispatch case (no inline argument validation —
 *      validateToolArguments has already done it).
 *   6. Populate WRITE_TOOLS with any tool that mutates state.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as dotenv from "dotenv";
import { BConnectClient } from "./bconnect-client.js";
import { validateOrThrow } from "@bconnect/mcp-core";
import { DomainRules } from "./utils/mcp-tool-validation-rules.js";

// ─── Factory exported for testing ───────────────────────────────────────────

export function createServer(): { server: Server } {
  const server = new Server(
    {
      name: "bconnect-DOMAIN-mcp",
      version: "26.1.5"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // ── ListToolsRequestSchema handler ────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        // TODO: Add tool definitions here. Each tool needs a corresponding
        // case in validateToolArguments() below AND in the dispatch switch.
        //
        // Example:
        // {
        //   name: "list_DOMAIN",
        //   description: "List all DOMAIN items in baramundi Management Suite ...",
        //   inputSchema: {
        //     type: "object",
        //     properties: {
        //       Page: { type: "number", description: "Zero-indexed page number." },
        //       PageSize: { type: "number", description: "Items per page (1-1000)." }
        //     },
        //     required: []
        //   }
        // }
      ]
    };
  });

  // ── Argument-validation pre-pass (runs before write-gate or bConnect setup) ─
  //
  // ARCHITECTURAL CONTRACT: every tool's arguments are validated here BEFORE
  // any side effect. Argument validation is pure; bConnect setup has side
  // effects (TLS, credentials, network); the pure step belongs first.
  //
  // This is the trust boundary against prompt-injection-induced malformed
  // arguments (see SECURITY.md → "Tool-argument validation"). Do not move
  // validation back into individual case bodies — that defers it past the
  // write gate and past credential setup.
  function validateToolArguments(name: string, args: Record<string, unknown> | undefined): void {
    switch (name) {
      // TODO: Add one case per tool. Example:
      // case "list_DOMAIN":
      //   validateOrThrow(args, DomainRules.exampleListDomain()); return;
      // case "get_DOMAIN":
      //   validateOrThrow(args, DomainRules.exampleGetDomain()); return;
      // Unknown tool names are not validated here; dispatch handles MethodNotFound.
    }
  }

  // ── CallToolRequestSchema handler ─────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // 1. Validate arguments first — pure, no side effects, fails fast on bad input.
    validateToolArguments(name, args);

    // 2. Write-operation gate (REQ-SRV-012). Add tool names that mutate state.
    const WRITE_TOOLS = new Set<string>([
      // "create_DOMAIN",
      // "update_DOMAIN",
      // "delete_DOMAIN",
    ]);
    if (WRITE_TOOLS.has(name) && process.env.ALLOW_WRITE_OPERATIONS !== "true") {
      return {
        content: [{
          type: "text" as const,
          text: `Write operation '${name}' is disabled. Set ALLOW_WRITE_OPERATIONS=true to enable write operations.`
        }],
        isError: true
      };
    }

    // 3. Lazily create BConnect client — allows server instantiation in tests
    // without real credentials.
    const getBconnect = (): BConnectClient => {
      dotenv.config();
      const baseUrl = process.env.BCONNECT_BASE_URL || "https://bms-server/bconnect";
      const username = process.env.BCONNECT_USERNAME;
      const password = process.env.BCONNECT_PASSWORD;
      const apiKey = process.env.BCONNECT_API_KEY;

      if (!apiKey && (!username || !password)) {
        throw new McpError(
          ErrorCode.InternalError,
          "Either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD environment variables are required"
        );
      }

      const caCertPath = process.env.BCONNECT_CA_CERT_PATH;
      const caCert = caCertPath ? fs.readFileSync(caCertPath, "utf8") : undefined;

      const auditLevelRaw = process.env.BCONNECT_AUDIT_LEVEL ?? "none";
      const auditLevel = (["none", "security", "write", "all"] as const).includes(auditLevelRaw as never)
        ? (auditLevelRaw as "none" | "security" | "write" | "all")
        : "none";

      return new BConnectClient({
        baseUrl,
        username,
        password,
        apiKey,
        rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
        ...(caCert && { ca: caCert }),
        auditLog: { level: auditLevel },
      });
    };

    // 4. Dispatch — arguments already validated by validateToolArguments above.
    try {
      const bconnect = getBconnect();
      // const domain = bconnect.domain; // TODO: replace `.domain` with actual module accessor

      switch (name) {
        // TODO: Add one case per tool. Example:
        // case "list_DOMAIN": {
        //   const result = await domain.listDomain((args ?? {}) as never);
        //   return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        // }
        // case "get_DOMAIN": {
        //   const result = await domain.getDomain(args!.id as string);
        //   return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        // }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error) {
      if (error instanceof McpError) throw error;
      throw new McpError(
        ErrorCode.InternalError,
        `bConnect API error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  return { server };
}

// ─── Entry point ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  dotenv.config();

  // Startup connectivity check (REQ-SRV-013). Set BCONNECT_SKIP_CONNECTIVITY_CHECK=true
  // to disable when the management server is reachable only after a delay.
  if (process.env.BCONNECT_SKIP_CONNECTIVITY_CHECK !== "true") {
    const _startupUrl = process.env.BCONNECT_BASE_URL || "https://bms.example.com:443/bconnect";
    const _startupUser = process.env.BCONNECT_USERNAME;
    const _startupPass = process.env.BCONNECT_PASSWORD;
    const _startupApiKey = process.env.BCONNECT_API_KEY;
    if (!_startupApiKey && (!_startupUser || !_startupPass)) {
      console.error("bconnect-DOMAIN-mcp: Either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD are required");
      process.exit(1);
    }
    const _caCertPath = process.env.BCONNECT_CA_CERT_PATH;
    const _caCert = _caCertPath ? fs.readFileSync(_caCertPath, "utf8") : undefined;
    const _startupClient = new BConnectClient({
      baseUrl: _startupUrl,
      username: _startupUser,
      password: _startupPass,
      apiKey: _startupApiKey,
      rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
      ...(_caCert && { ca: _caCert }),
    });
    console.error(`bconnect-DOMAIN-mcp: verifying bConnect API connectivity...`);
    const _connected = await _startupClient.testConnection();
    if (!_connected) {
      console.error(`bconnect-DOMAIN-mcp: cannot reach bConnect API at ${_startupUrl}. Check BCONNECT_BASE_URL, credentials, and network.`);
      process.exit(1);
    }
    console.error(`bconnect-DOMAIN-mcp: API connectivity verified.`);
  }

  const transportMode = process.env.MCP_TRANSPORT ?? "stdio";
  const port = parseInt(process.env.MCP_PORT ?? "3000", 10);
  const serverName = "bconnect-DOMAIN-mcp";

  if (transportMode === "http") {
    const app = express();
    app.use(express.json());

    app.post("/mcp", async (req, res) => {
      const { server } = createServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });

    app.get("/mcp", async (req, res) => {
      res.writeHead(405).end(JSON.stringify({ error: "Method Not Allowed. Use POST for MCP requests." }));
    });

    app.delete("/mcp", async (req, res) => {
      res.writeHead(405).end(JSON.stringify({ error: "Method Not Allowed. Session management not supported in stateless mode." }));
    });

    const bind = process.env.MCP_BIND ?? "127.0.0.1";
    // Standalone HTTP mode has no client authentication. Binding to a non-loopback
    // address would expose an unauthenticated bConnect proxy, so fail closed unless
    // the operator explicitly opts in (front it with the authenticated gateway instead).
    const isLoopbackBind = bind === "127.0.0.1" || bind === "::1" || bind === "localhost";
    if (!isLoopbackBind && process.env.MCP_ALLOW_NO_AUTH !== "true") {
      console.error(
        `${serverName}: refusing to bind ${bind} — standalone HTTP mode is unauthenticated. ` +
          `Bind to loopback (the default) and front it with the authenticated gateway, ` +
          `or set MCP_ALLOW_NO_AUTH=true to override.`,
      );
      process.exit(1);
    }
    app.listen(port, bind, () => {
      console.error(`${serverName} listening on http://${bind}:${port}/mcp`);
    });
  } else {
    const { server } = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`${serverName} started on stdio`);
  }
}

if (!process.env.VITEST) {
  main().catch((error) => {
    process.stderr.write(`Fatal error: ${error.message}\n`);
    process.exit(1);
  });
}
