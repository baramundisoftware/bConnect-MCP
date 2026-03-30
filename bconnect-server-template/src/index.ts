#!/usr/bin/env node

/**
 * bconnect-DOMAIN-mcp
 *
 * A Model Context Protocol server that provides access to the baramundi
 * bConnect REST API for DOMAIN management.
 *
 * Replace DOMAIN with the actual domain name (e.g., assets, jobs, variables).
 * Replace DomainModule with the actual module class name.
 * Update the server name, description, and tool list accordingly.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as dotenv from "dotenv";
import { BConnectClient } from "./bconnect-client.js";
import { validateOrThrow } from "./utils/parameter-validator.js";

// ─── Factory exported for testing ───────────────────────────────────────────

export function createServer(): { server: Server } {
  const server = new Server(
    {
      name: "bconnect-DOMAIN-mcp",
      version: "26.1.0"
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
        // ── DOMAIN API ────────────────────────────────────────────────────
        // TODO: Add tool definitions here
        // Example:
        // {
        //   name: "list_DOMAIN",
        //   description: "List all DOMAIN items.",
        //   inputSchema: {
        //     type: "object",
        //     properties: {},
        //     required: []
        //   }
        // }
      ]
    };
  });

  // ── CallToolRequestSchema handler ─────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // Load configuration
    dotenv.config();
    const baseUrl = process.env.BCONNECT_BASE_URL;
    const username = process.env.BCONNECT_USERNAME;
    const password = process.env.BCONNECT_PASSWORD;
    const release = (process.env.BCONNECT_RELEASE as "25R2" | "26R1") ?? "26R1";

    if (!baseUrl || !username || !password) {
      throw new McpError(
        ErrorCode.InternalError,
        "Missing required environment variables: BCONNECT_BASE_URL, BCONNECT_USERNAME, BCONNECT_PASSWORD"
      );
    }

    // Optional: reject if this server is 26R1-only and release is 25R2
    // if (release === "25R2") {
    //   throw new McpError(ErrorCode.InternalError, "bconnect-DOMAIN-mcp requires BCONNECT_RELEASE=26R1");
    // }

    // Load optional CA cert
    let ca: Buffer | undefined;
    const caCertPath = process.env.BCONNECT_CA_CERT_PATH;
    if (caCertPath) {
      ca = fs.readFileSync(caCertPath);
    }

    const client = new BConnectClient({
      baseUrl,
      username,
      password,
      ca,
      rateLimit: {
        enabled: process.env.BCONNECT_RATE_LIMIT_ENABLED === "true",
        maxRequests: parseInt(process.env.BCONNECT_RATE_LIMIT_MAX_REQUESTS ?? "100"),
        windowMs: parseInt(process.env.BCONNECT_RATE_LIMIT_WINDOW_MS ?? "60000")
      },
      auditLog: {
        level: (process.env.BCONNECT_AUDIT_LEVEL as any) ?? "none"
      }
    });

    const { name: toolName, arguments: args } = request.params;

    try {
      switch (toolName) {
        // TODO: Add case for each tool
        // case "list_DOMAIN": {
        //   const result = await client.domain.listDomain(args as any);
        //   return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        // }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
      }
    } catch (error) {
      if (error instanceof McpError) throw error;
      throw new McpError(
        ErrorCode.InternalError,
        `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  return { server };
}

// ─── Entry point ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { server } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("bconnect-DOMAIN-mcp started\n");
}

main().catch((error) => {
  process.stderr.write(`Fatal error: ${error.message}\n`);
  process.exit(1);
});
