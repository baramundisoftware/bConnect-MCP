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
import * as dotenv from "dotenv";
import { BConnectClient } from "./bconnect-client.js";
import { validateOrThrow, clientConfigFromEnv, ClientConfigError, withUnverifiedWriteMarker } from "@bconnect/mcp-core";
import type { BConnectConfig, BConnectCredentials } from "@bconnect/mcp-core";
import { DomainRules } from "./utils/mcp-tool-validation-rules.js";

// ─── Factory exported for testing ───────────────────────────────────────────

export type { BConnectCredentials } from "@bconnect/mcp-core";

export function createServer(credentials?: BConnectCredentials): { server: Server } {
  const server = new Server(
    {
      name: "bconnect-DOMAIN-mcp",
      version: "26.1.7"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // ── ListToolsRequestSchema handler ────────────────────────────────────────

  // Write tools: gated by ALLOW_WRITE_OPERATIONS, and marked unverified in tools/list
  // until their live check is recorded (REQ-XC-003 AC 5).
  const WRITE_TOOLS = new Set<string>([
    // "create_DOMAIN",
    // "update_DOMAIN",
    // "delete_DOMAIN",
  ]);

  server.setRequestHandler(ListToolsRequestSchema, withUnverifiedWriteMarker(WRITE_TOOLS, async () => {
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
  }));

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
      try {
        return new BConnectClient(clientConfigFromEnv(process.env, credentials));
      } catch (error) {
        if (error instanceof ClientConfigError) {
          throw new McpError(ErrorCode.InternalError, error.message);
        }
        throw error;
      }
    };

    // 4. Dispatch — arguments already validated by validateToolArguments above.
    try {
      const bconnect = getBconnect();
      // const domain = bconnect.domain; // TODO: replace `.domain` with actual module accessor

      switch (name) {
        // TODO: Add one case per tool. Example:
        // case "list_DOMAIN": {
        //   // Build the request from the generated types, without type-defeating casts (REQ-QA-002).
        //   const result = await domain.listDomain({ Page: args?.Page as number | undefined });
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

  // Startup connectivity check (REQ-SRV-013). The configuration is always validated;
  // testConnection() skips the request when BCONNECT_SKIP_CONNECTIVITY_CHECK=true
  // (for a management server that is reachable only after a delay).
  {
    let _config: Readonly<BConnectConfig>;
    try {
      _config = clientConfigFromEnv(process.env);
    } catch (error) {
      if (!(error instanceof ClientConfigError)) { throw error; }
      console.error(`bconnect-DOMAIN-mcp: ${error.message}`);
      process.exit(1);
    }
    const _startupUrl = _config.baseUrl;
    const _startupClient = new BConnectClient(_config);
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
