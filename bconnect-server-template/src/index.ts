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
 *   3. Add tool definitions to the TOOLS array.
 *   4. Name every mutating tool in `defineToolCatalogue`'s `write` list. It is a
 *      hard error to name one that is not in TOOLS, which is the check that
 *      would have caught finding F21 (a write tool the hand-maintained set
 *      silently failed to cover).
 *   5. Add one validation case per tool to validateToolArguments().
 *   6. Add the matching dispatch case (no inline argument validation —
 *      validateToolArguments has already done it).
 *
 * Three suite-wide behaviours come from @bconnect/mcp-core and should not be
 * reimplemented here:
 *   - TOK-20  write tools are omitted from tools/list unless
 *             ALLOW_WRITE_OPERATIONS=true, and `gateWriteTool` still refuses a
 *             hidden write called by name. Hiding is not disabling.
 *   - TOK-25  `countOnly: true` on a list tool answers "how many?" with the
 *             envelope count instead of a page of rows.
 *   - INT-53  `handleToolError` is the only catch-all: 400/403/404/429 become
 *             readable isError results, everything else stays a protocol error.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import express from "express";
// OPT-32 — the unified bootstrap. Read packages/mcp-core/src/run-server.ts
// before changing anything below: it records which behaviour each of the
// thirteen hand-written main()s had and which one survived.
import { runServer, shouldAutoStart, describeConnectionFailure } from "@bconnect/mcp-core";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode
} from "@modelcontextprotocol/sdk/types.js";
import { BConnectClient } from "./bconnect-client.js";
import { createClientProvider } from "@bconnect/mcp-core";
import { validateOrThrow, serializeToolResult } from "@bconnect/mcp-core";
// Finding A2 / INT-53 — throw BareMcpError, never McpError, out of a request
// handler: McpError bakes "MCP error <code>: " into .message and the SDK adds
// it again client-side. `instanceof McpError` still holds, so the catch-all
// guards below are unaffected. See packages/mcp-core/src/protocol-error.ts.
import { BareMcpError } from "@bconnect/mcp-core";
// TOK-20 / TOK-25 / TOK-10 / INT-53 — the shared composition layer. See
// packages/mcp-core/src/{tool-catalogue,count-only,schema-fragments,tool-error}.ts.
// `pageProperties` and `countOnlyProperty` are unused until a tool is added, and
// are imported here so the first tool has one obvious way to declare paging.
import {
  defineToolCatalogue,
  handleToolError,
  toolTextResult,
  isCountOnlyRequest,
  fetchCount,
  countOnlyProperty,
  pageProperties,
} from "@bconnect/mcp-core";
import { DomainRules } from "./utils/mcp-tool-validation-rules.js";

// The imports above are the template's point; reference them so an unmodified
// template still type-checks and lints without an unused-import error.
void toolTextResult;
void isCountOnlyRequest;
void fetchCount;
void countOnlyProperty;
void pageProperties;

// ─── Factory exported for testing ───────────────────────────────────────────

/** Per-session credentials. Injected by the caller; they win over the environment. */
export interface BConnectCredentials {
  baseUrl?: string;
  username?: string;
  password?: string;
  apiKey?: string;
}

/**
 * OPT-32 — the parameter is not optional decoration.
 *
 * The template used to be the one factory of the thirteen that took NO
 * credentials, so a new server copied from it could only ever read the process
 * environment. Two things that costs: its tests cannot construct a server
 * without mutating `process.env` (which is how credential-isolation regressions
 * go unnoticed), and `runServer` — which passes the credentials it resolved into
 * every `createServer()` call, including the per-request one in HTTP mode —
 * would have had them silently ignored here.
 */
export function createServer(credentials?: BConnectCredentials): { server: Server; getClient: () => BConnectClient } {
  const server = new Server(
    {
      name: "bconnect-DOMAIN-mcp",
      version: "26.1.8"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // ── Tool catalogue ────────────────────────────────────────────────────────

  const TOOLS: { name: string; [key: string]: unknown }[] = [
    // TODO: Add tool definitions here. Each tool needs a corresponding case in
    // validateToolArguments() below AND in the dispatch switch.
    //
    // Take the pagination and shaping wording from mcp-core rather than
    // retyping it — that is what stops the suite drifting back into six
    // spellings of "page number" (finding TOK-10), and it is where the
    // 1-based/zero-indexed contradiction was settled: Page is ZERO-INDEXED.
    //
    // Example:
    // {
    //   name: "list_DOMAIN",
    //   description: "List all DOMAIN items in baramundi Management Suite ...",
    //   inputSchema: {
    //     type: "object",
    //     properties: {
    //       ...pageProperties,
    //       ...countOnlyProperty,
    //     },
    //     required: []
    //   }
    // }
  ];

  // `write` names every tool that mutates state (REQ-SRV-012). Those tools are
  // omitted from tools/list unless ALLOW_WRITE_OPERATIONS=true — a token
  // optimisation, not the security control; `gateWriteTool` below is the
  // control, and it still answers a client that calls a hidden tool by name.
  const catalogue = defineToolCatalogue({
    tools: TOOLS,
    write: [
      // "create_DOMAIN",
      // "update_DOMAIN",
      // "delete_DOMAIN",
    ],
  });

  // ── ListToolsRequestSchema handler ────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: catalogue.listTools() };
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

  // ── Client lifetime (upstream finding R3) ─────────────────────────────────
  // Built lazily on first tool call, but held HERE, in createServer() scope,
  // not inside the tool-call handler where this used to live. A client
  // constructed per call rebuilt everything stateful it owned on every call,
  // which is why rate limiting never limited (B8) and why the response cache
  // could not have worked even once wired up (B7). The provider is per
  // session and re-keys itself if the resolved credentials change, so a
  // longer-lived client cannot leak across differently-credentialed callers.
  // See packages/mcp-core/src/client-provider.ts.
  const getBconnect = createClientProvider<BConnectClient>({
    // Enables the optional per-server credential convention
    // (BCONNECT_API_KEY__<DOMAIN>); with no such variable set this changes
    // nothing. See packages/mcp-core/src/server-scoped-credentials.ts.
    //
    // In the TEMPLATE because a server that omits it keeps the shared
    // credential while its operator believes it was scoped down — silent, and
    // asymmetric: twelve servers scoped and one not reads as least privilege
    // and is not. `__tests__/suite-server-scoped-credentials.ts` enforces it on
    // every real server, and found this omission the first time a server was
    // scaffolded from this file.
    serverName: "bconnect-DOMAIN-mcp",
    factory: (config) => new BConnectClient(config),
    credentials,
    defaultBaseUrl: "https://bms-server/bconnect",
    onMissingCredentials: () => {
      throw new BareMcpError(
        ErrorCode.InternalError,
        "Either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD environment variables are required"
      );
    },
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // 1. Validate arguments first — pure, no side effects, fails fast on bad input.
    validateToolArguments(name, args);

    // 2. Write-operation gate (REQ-SRV-012). Names come from the catalogue
    //    above, so a write tool cannot be advertised and left ungated.
    const denied = catalogue.gateWriteTool(name);
    if (denied) {
      return denied;
    }


    // 3. Dispatch — arguments already validated by validateToolArguments above.
    try {
      const bconnect = getBconnect();
      // const domain = bconnect.domain; // TODO: replace `.domain` with actual module accessor

      switch (name) {
        // TODO: Add one case per tool. Example:
        // case "list_DOMAIN": {
        //   // TOK-25 — answer "how many?" from the envelope instead of paging.
        //   if (isCountOnlyRequest(args)) {
        //     const count = await fetchCount((p) => domain.listDomain(p as never), args);
        //     return toolTextResult(serializeToolResult(count));
        //   }
        //   const result = await domain.listDomain((args ?? {}) as never);
        //   return { content: [{ type: "text", text: serializeToolResult(result) }] };
        // }
        // case "get_DOMAIN": {
        //   const result = await domain.getDomain(args!.id as string);
        //   return { content: [{ type: "text", text: serializeToolResult(result) }] };
        // }

        default:
          throw new BareMcpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error) {
      // INT-53 — one error channel. Expected API failures (400/403/404/429)
      // become readable isError results the model can act on; validation and
      // gate errors are rethrown as the protocol errors they already are; and
      // 401/5xx/TLS/bugs become protocol InternalError. Do not add a second
      // catch-all here — a per-server one is what produced two channels.
      return handleToolError(error);
    }
  });

  // Difference 3 — hand the memoised provider back so runServer's startup
  // connectivity check probes the very client tool dispatch will use.
  return { server, getClient: getBconnect };
}

// ─── Entry point (OPT-32) ────────────────────────────────────────────────────
//
// This server used to hand-write ~85 lines of bootstrap. Every line of it is
// now in `runServer()`, which resolves the six ways the thirteen copies had
// drifted. Two consequences are visible from here and are deliberate:
//
//   - BCONNECT_BASE_URL has NO default any more. The old
//     `|| "https://bms.example.com:443/bconnect"` fallback sent real
//     credentials to a host the vendor does not control whenever the variable
//     was unset. Absent base URL is now exit 1, before any client is built.
//   - The startup connectivity check probes `getClient()` above — the client
//     tool dispatch uses — not a throwaway built from a second reading of the
//     environment. That is why `createServer` returns it.
//
// `express` is injected because mcp-core does not depend on it: this package
// pins ^4.21.0 while the workspace root hoists 5.x.
if (shouldAutoStart()) {
  void runServer({
    name: "bconnect-DOMAIN-mcp",
    createServer,
    http: { express },
  }).catch((error) => {
    console.error(`Fatal error: ${describeConnectionFailure(error)}`);
    process.exit(1);
  });
}
