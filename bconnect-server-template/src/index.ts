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
 *   7. Declare the tool annotations (REQ-SRV-024): add `src/operations.ts`
 *      (tool → operationId), run `node scripts/generate-query-parameters.mjs`
 *      to generate `src/tool-methods.ts`, and register the tool list as
 *      `withToolAnnotations(TOOL_METHODS, toolCatalog.list)`. A destructive
 *      write without a DELETE goes into DESTRUCTIVE_WRITE_TOOLS in the core,
 *      with its reason. __tests__/tool-annotations.guard.test.ts fails until
 *      this is done.
 *   8. If WRITE_TOOLS isn't empty, hide the write tools while writes are off
 *      (REQ-SRV-026): wrap the list once more as
 *      `withWriteToolsHidden(TOOL_METHODS, () => process.env.ALLOW_WRITE_OPERATIONS === "true", …)`.
 *      __tests__/write-tools-hidden.guard.test.ts fails until this is done.
 *   9. Paged list tools (REQ-SRV-027): the generator also writes
 *      `src/query-params.ts`; list tools offer `withQueryProperties(QUERY_PARAMETERS, …)`
 *      and send `pickArguments(args, queryParameters(QUERY_PARAMETERS, …))`. Wrap the
 *      CallTool handler as `withCountOnly(QUERY_PARAMETERS, selectedRelease, …)`
 *      so they answer `countOnly`. __tests__/count-only.guard.test.ts fails until this is done.
 *  10. Tools per bMS release (REQ-SRV-028): the generator also writes `src/tool-releases.ts`.
 *      If a tool's routes are missing in a release, list the tools as
 *      `withReleaseTools(TOOL_RELEASES, …)` and call `refuseUnavailableTool(TOOL_RELEASES, name)`
 *      right after `refuseUndeclared`; never check the release by hand.
 *      __tests__/release-tools.guard.test.ts fails until this is done.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import { BConnectClient } from "./bconnect-client.js";
import { validateOrThrow, toolErrorResult, lazyClient, withUnverifiedWriteMarker, declaredArgumentsOnly, serverClients, runServer, selectedRelease } from "@bconnect/mcp-core";
import type { BConnectCredentials } from "@bconnect/mcp-core";
import { DomainRules } from "./utils/mcp-tool-validation-rules.js";

// ─── Factory exported for testing ───────────────────────────────────────────

export type { BConnectCredentials } from "@bconnect/mcp-core";

/** The server's bConnect clients: one shared by every tool call (REQ-SRV-023). */
const clients = serverClients(BConnectClient);

export function createServer(credentials?: BConnectCredentials): { server: Server } {
  const server = new Server(
    {
      name: "bconnect-DOMAIN-mcp",
      version: "26.1.9"
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

  const toolCatalog = declaredArgumentsOnly(withUnverifiedWriteMarker(WRITE_TOOLS, async () => {
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
  server.setRequestHandler(ListToolsRequestSchema, toolCatalog.list);

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
    // Refuse arguments the tool doesn't declare, before anything else (REQ-SRV-022).
    await toolCatalog.refuseUndeclared(name, args);

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
      // The server's shared client (REQ-SRV-023). A ClientConfigError (e.g. missing
      // credentials) reaches the catch below and becomes a tool result (REQ-XC-001).
      return clients.get(credentials);
    };

    // 4. Dispatch — arguments already validated by validateToolArguments above.
    try {
      const bconnect = lazyClient(getBconnect);
      // const domain = bconnect.domain; // TODO: replace `.domain` with actual module accessor

      switch (name) {
        // TODO: Add one case per tool. Example:
        // case "list_DOMAIN": {
        //   // Build the request from the generated types, without type-defeating casts (REQ-QA-002).
        //   const result = await domain.listDomain({ Page: args?.Page as number | undefined });
        //   return toolJsonResult(result); // compact JSON from @bconnect/mcp-core (REQ-SRV-025)
        // }
        // case "get_DOMAIN": {
        //   const result = await domain.getDomain(args!.id as string);
        //   return toolJsonResult(result);
        // }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error) {
      // API errors, gate refusals and configuration errors are tool results the
      // model can read; only McpErrors stay protocol errors (REQ-XC-001).
      return toolErrorResult(error, selectedRelease());
    }
  });

  return { server };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

runServer({ name: "bconnect-DOMAIN-mcp", createServer, clients });
