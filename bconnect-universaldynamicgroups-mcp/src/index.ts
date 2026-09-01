#!/usr/bin/env node

/**
 * bconnect-universaldynamicgroups-mcp
 *
 * A Model Context Protocol server that provides read-only access to the
 * baramundi bConnect REST API for Universal Dynamic Groups — listing and
 * retrieving UDG definitions and their folder hierarchy.
 *
 * Requires bConnect 26R1 or later, like the rest of the suite. Universal
 * Dynamic Groups did not exist in 25R2, which is why this server used to gate
 * its ENTIRE surface on BCONNECT_RELEASE — tools/list answered [] otherwise.
 * 25R2 is no longer supported, so the gate is gone.
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
import {
  defineToolCatalogue,
  handleToolError,
  toolTextResult,
  apiParams,
  isCountOnlyRequest,
  fetchCount,
  countOnlyProperty,
  pageProperties,
  includeSubfoldersProperty,
} from "@bconnect/mcp-core";
import { UdgRules } from "./utils/mcp-tool-validation-rules.js";

// ─── Factory exported for testing ───────────────────────────────────────────

export interface BConnectCredentials {
  baseUrl?: string;
  username?: string;
  password?: string;
  apiKey?: string;
}

export function createServer(credentials?: BConnectCredentials): { server: Server; getClient: () => BConnectClient } {
  const server = new Server(
    {
      name: "bconnect-universaldynamicgroups-mcp",
      version: "26.1.8"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // ── Tool catalogue ────────────────────────────────────────────────────────
  //
  // This server is read-only — every route is a GET. The catalogue is still used
  // for its duplicate-name check and so that a write added later is gated by
  // construction rather than by remembering a hand-maintained set (F21).

  const TOOLS = [
        // ── Universal Dynamic Groups ─────────────────────────────────────
        {
          name: "list_universal_dynamic_groups",
          description: "List all Universal Dynamic Groups defined in baramundi Management Suite. Returns a paged list with UDG id, name, comment, and folder assignment for each group. Universal Dynamic Groups are dynamic endpoint groups based on filter criteria. countOnly:true answers 'how many' without fetching a page.",
          inputSchema: {
            type: "object",
            properties: {
              Name: { type: "string", description: "Filter results to match this exact Universal Dynamic Group name." },
              OrderBy: { type: "string", description: "Sort results by property name and direction (e.g. 'Name asc'). Possible values: Name, Comment." },
              SearchQuery: { type: "string", description: "Filter results by matching against searchable properties (Name, Comment)." },
              ...pageProperties,
              ...countOnlyProperty,
            },
            required: []
          }
        },
        {
          name: "get_universal_dynamic_group",
          description: "Get details of a specific Universal Dynamic Group by its GUID. Returns the UDG id, name, comment, folder id, and filter criteria definition from baramundi Management Suite.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "GUID of the Universal Dynamic Group to retrieve." }
            },
            required: ["id"]
          }
        },
        {
          name: "list_universal_dynamic_groups_by_folder",
          description: "List all Universal Dynamic Groups contained in a specific folder identified by its GUID. Returns a paged list of UDGs within that folder with id, name, comment, and filter criteria details.",
          inputSchema: {
            type: "object",
            properties: {
              folderId: { type: "string", description: "GUID of the folder to list Universal Dynamic Groups from." },
              Name: { type: "string", description: "Filter results to match this exact UDG name." },
              OrderBy: { type: "string", description: "Sort results by property name and direction." },
              SearchQuery: { type: "string", description: "Filter results by matching against searchable properties." },
              ...pageProperties,
              ...includeSubfoldersProperty,
              ...countOnlyProperty,
            },
            required: ["folderId"]
          }
        },

        // ── UDG Folders ──────────────────────────────────────────────────
        {
          name: "list_udg_folders",
          description: "List all Universal Dynamic Groups folders in baramundi Management Suite. Returns a paged list with folder id, name, parent folder id, and comment for each folder in the UDG folder hierarchy.",
          inputSchema: {
            type: "object",
            properties: {
              Name: { type: "string", description: "Filter results to match this exact folder name." },
              OrderBy: { type: "string", description: "Sort results by property name and direction (e.g. 'Name asc')." },
              SearchQuery: { type: "string", description: "Filter results by matching against folder name or comment." },
              ...pageProperties,
              ...countOnlyProperty,
            },
            required: []
          }
        },
        {
          name: "get_udg_folder",
          description: "Get details of a specific Universal Dynamic Groups folder by its GUID. Returns folder id, name, parent folder id, and comment for the specified folder in the baramundi Management Suite UDG hierarchy.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "GUID of the UDG folder to retrieve." }
            },
            required: ["id"]
          }
        },
        {
          name: "list_udg_folders_by_folder",
          description: "List all sub-folders contained within a specific Universal Dynamic Groups folder identified by its GUID. Returns a paged list of child folders with id, name, parent id, and comment.",
          inputSchema: {
            type: "object",
            properties: {
              folderId: { type: "string", description: "GUID of the parent UDG folder to list sub-folders for." },
              Name: { type: "string", description: "Filter results to match this exact folder name." },
              OrderBy: { type: "string", description: "Sort results by property name and direction." },
              SearchQuery: { type: "string", description: "Filter results by matching against folder name or comment." },
              ...pageProperties,
              // Not a typo: the bConnect operation for THIS route spells the
              // parameter `includeSubFolders` (capital F) while the UDG-by-folder
              // route above spells it `includeSubfolders`. Both are mirrored
              // exactly from the generated operation types — normalising either
              // one would silently drop the filter, since bConnect answers 200
              // and ignores a parameter it does not recognise (finding D6).
              includeSubFolders: { type: "boolean", description: "If true, also returns objects contained in sub-folders of the given folder (default: false)." },
              ...countOnlyProperty,
            },
            required: ["folderId"]
          }
        },
  ];

  const catalogue = defineToolCatalogue({ tools: TOOLS, write: [] });

  // ── ListToolsRequestSchema handler ────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Decision 2 — this used to return `[]` unless BCONNECT_RELEASE was 26R1,
    // so the whole server advertised nothing on a 25R2 deployment.
    return { tools: catalogue.listTools() };
  });

  // ── CallToolRequestSchema handler ─────────────────────────────────────────

  // ── Argument-validation pre-pass (runs before getBconnect) ─────────────────
  function validateToolArguments(name: string, args: Record<string, unknown> | undefined): void {
    switch (name) {
      case "list_universal_dynamic_groups":
        validateOrThrow(args, UdgRules.listUniversalDynamicGroups());
        return;
      case "get_universal_dynamic_group":
        validateOrThrow(args, UdgRules.getUniversalDynamicGroup());
        return;
      case "list_universal_dynamic_groups_by_folder":
        validateOrThrow(args, UdgRules.listUniversalDynamicGroupsByFolder());
        return;
      case "list_udg_folders":
        validateOrThrow(args, UdgRules.listUdgFolders());
        return;
      case "get_udg_folder":
        validateOrThrow(args, UdgRules.getUdgFolder());
        return;
      case "list_udg_folders_by_folder":
        validateOrThrow(args, UdgRules.listUdgFoldersByFolder());
        return;
      // Unknown tool names are not validated here; dispatch handles MethodNotFound.
    }
  }

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
    // (BCONNECT_API_KEY__UNIVERSALDYNAMICGROUPS); with no such variable set this
    // changes nothing. See mcp-core/server-scoped-credentials.ts.
    serverName: "bconnect-universaldynamicgroups-mcp",
    factory: (config) => new BConnectClient(config),
    credentials,
    defaultBaseUrl: "https://bms-server/bconnect",
    onMissingCredentials: () => {
      throw new BareMcpError(
        ErrorCode.InternalError,
        "Either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD are required"
      );
    },
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Validate arguments first — pure, no side effects, fails fast on bad input.
    validateToolArguments(name, args);

    // D6 — refuse an argument key this tool's schema does not declare.
    // validateParameters() iterates over RULES, so a key with no rule was never
    // examined by anything; bConnect then answers 200 and silently ignores an
    // unrecognised query key. Measured live, one transposed character in a filter
    // name returned 37,571 rows instead of 1, labelled as a filtered result.
    catalogue.assertKnownParameters(name, args);
    // SEC-0 — every id-shaped argument must be a single, traversal-free path
    // segment. This lived in 3 of 13 servers; it is on the catalogue now so a
    // server cannot be built without it.
    catalogue.assertSafePathParameters(name, args);

    // Write gate. This server declares no writes, so it never refuses today —
    // it is here so that adding one cannot skip the gate.
    const denied = catalogue.gateWriteTool(name);
    if (denied) {
      return denied;
    }

    try {
      const bconnect = getBconnect();
      const udg = bconnect.udg;

      // Dispatch — arguments already validated by validateToolArguments above.
      switch (name) {

        case "list_universal_dynamic_groups": {
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => udg.getUniversalDynamicGroups(p as never), args);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await udg.getUniversalDynamicGroups(apiParams(args) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "get_universal_dynamic_group": {
          const result = await udg.getUniversalDynamicGroup(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_universal_dynamic_groups_by_folder": {
          const { folderId, ...params } = args as Record<string, unknown>;
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => udg.getUniversalDynamicGroupsByFolder(folderId as string, p as never), params);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await udg.getUniversalDynamicGroupsByFolder(folderId as string, apiParams(params) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_udg_folders": {
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => udg.getFolders(p as never), args);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await udg.getFolders(apiParams(args) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "get_udg_folder": {
          const result = await udg.getFolder(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_udg_folders_by_folder": {
          const { folderId, ...params } = args as Record<string, unknown>;
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => udg.getFoldersByFolder(folderId as string, p as never), params);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await udg.getFoldersByFolder(folderId as string, apiParams(params) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        default:
          throw new BareMcpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error) {
      // INT-53 — one error channel. See packages/mcp-core/src/tool-error.ts.
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
    name: "bconnect-universaldynamicgroups-mcp",
    createServer,
    http: { express },
  }).catch((error) => {
    console.error(`Fatal error: ${describeConnectionFailure(error)}`);
    process.exit(1);
  });
}
