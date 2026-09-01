#!/usr/bin/env node

/**
 * bconnect-operatingsystems-mcp
 *
 * A Model Context Protocol server that provides access to the baramundi
 * bConnect REST API for Operating Systems — OS folders and Windows endpoint
 * OS installation information.
 *
 * All 9 tools work in both 25R2 and 26R1.
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
  exactMatchFilter,
  includeSubfoldersProperty,
  // TOK-24 — response shaping. See the shaper declaration below for what was
  // measured and why the nested OS block is flattened before it runs.
  createListShaper,
  projectionProperties,
  type ListEnvelope,
  type Row,
} from "@bconnect/mcp-core";
import { OperatingSystemsRules } from "./utils/mcp-tool-validation-rules.js";

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
      name: "bconnect-operatingsystems-mcp",
      version: "26.1.8"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // ── Response shaping (TOK-24) ───────────────────────────────────────────
  //
  // Measured live against labcorp.local 2026-08-13 (PageSize:20, 20 rows):
  // `list_os_windows_endpoints` returned 8,298 B, and the single nested
  // `operatingSystem` object was 3,822 B of it — 46% of the response in one
  // field. Inside that object the version is stated TWICE:
  //
  //   "version": { "full": "10.0.19045.6093",
  //                "major": 10, "minor": 0, "build": 19045, "patchLevel": 6093 }
  //
  // `major`/`minor`/`build`/`patchLevel` are the dotted string split on ".",
  // so they are not four extra facts, they are the same fact four more times.
  //
  // `shapeRows`'s flat `compactFields` cannot reach into a nested path (the
  // same limit defensecontrol's BitLocker/Defender shapers hit), so the row is
  // flattened to the OS facts a fleet question asks for BEFORE the shaper
  // runs, and ONLY on the non-`detail` path: `detail:true` is handed the
  // untouched raw envelope, so the escape hatch stays byte-for-byte exact.
  // `meta.projectedAway` then names every field the projection removed —
  // `localeId` and `releaseId` are dropped from the compact view and are one
  // `detail:true` call away, never silently gone.
  function flattenOsRow(row: Row): Row {
    const os = (row.operatingSystem as Row | null | undefined) ?? null;
    const version = (os?.version as Row | null | undefined) ?? null;
    return {
      ...row,
      osName: os?.name ?? null,
      // `full` is the whole version; the four numeric parts it decomposes into
      // are dropped rather than repeated.
      osVersion: version?.full ?? null,
      osDisplayVersion: os?.displayVersion ?? null,
    };
  }

  const shapeOsWindowsEndpoints = createListShaper({
    compactFields: [
      "endpointId", "endpointName",
      "osName", "osVersion", "osDisplayVersion",
      // The OS-install configuration this tool exists to report. Kept whole:
      // these are the fields the tool is FOR, not incidental payload.
      "isOSInstallAllowed", "inheritsAutoInstallation",
      "bootEnvironmentId", "hardwareProfileId",
    ],
    fullModeHint: "Pass detail:true for the full record, including the decomposed version, releaseId and localeId.",
  });

  /** Flatten every row unless the caller asked for the untouched record. */
  function forShaping<T extends ListEnvelope>(
    payload: T, full: boolean, flatten: (row: Row) => Row
  ): T {
    if (full || !Array.isArray(payload.data)) {return payload;}
    return { ...payload, data: payload.data.map((r) => flatten(r as Row)) };
  }

  // ── Tool catalogue ────────────────────────────────────────────────────────

  const TOOLS = [

      // ── OS Folders ────────────────────────────────────────────────────────
      {
        name: "list_os_folders",
        description: "List all Operating Systems folders in baramundi Management Suite. Returns a paged list of OS folders used to organize operating system configurations with their names, IDs, and hierarchy structure.",
        inputSchema: {
          type: "object",
          properties: {
            OrderBy: { type: "string", description: "Sort results by property name and direction (e.g. 'Name asc')." },
            SearchQuery: { type: "string", description: "Filter results by matching against searchable properties." },
            ...pageProperties,
            ...exactMatchFilter("Name"),
            ...countOnlyProperty,
          },
          required: []
        }
      },
      {
        name: "get_os_folder",
        description: "Get the details of a specific Operating Systems folder by its GUID. Returns the folder name, ID, parent folder reference, and other metadata for the specified OS folder in baramundi Management Suite.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the OS folder to retrieve." }
          },
          required: ["id"]
        }
      },
      {
        name: "list_os_folders_by_folder",
        description: "List all sub-folders within a specific Operating Systems folder identified by its GUID. Returns a paged list of child OS folders contained within the specified parent folder in baramundi Management Suite.",
        inputSchema: {
          type: "object",
          properties: {
            folderId: { type: "string", description: "GUID of the parent OS folder whose sub-folders should be listed." },
            OrderBy: { type: "string", description: "Sort results by property name and direction." },
            SearchQuery: { type: "string", description: "Filter results by matching against searchable properties." },
            ...pageProperties,
            ...exactMatchFilter("Name"),
            ...includeSubfoldersProperty,
            ...countOnlyProperty,
          },
          required: ["folderId"]
        }
      },

      // ── Windows Endpoints OS Info ─────────────────────────────────────────
      {
        name: "list_os_windows_endpoints",
        // The flattened field names are deliberately NOT spelled here. They are
        // ours, not the route's, and `descriptions-match-routes` rightly flags a
        // description promising a field the 200 schema cannot return — the same
        // reason defensecontrol's shaped tools describe their shape without
        // naming the aliases they synthesise.
        description: "List all Windows endpoints with Operating System installation information managed in baramundi Management Suite. Returns a paged list of Windows endpoints including their OS installation configuration, target OS details, and installation status. Compact by default: the nested OS block is flattened and every removed field is named in meta.projectedAway. Pass detail:true for the raw record, fields:[..] to pick columns, countOnly:true for the count.",
        inputSchema: {
          type: "object",
          properties: {
            OrderBy: { type: "string", description: "Sort results by property name and direction." },
            SearchQuery: { type: "string", description: "Filter results by matching against searchable properties." },
            ...pageProperties,
            ...projectionProperties,
          },
          required: []
        }
      },
      {
        name: "get_os_windows_endpoint",
        description: "Get the Operating System installation configuration for a specific Windows endpoint identified by its GUID. Returns the target OS details, installation parameters, and configuration settings for the specified Windows endpoint in baramundi Management Suite.",
        inputSchema: {
          type: "object",
          properties: {
            endpointId: { type: "string", description: "GUID of the Windows endpoint to retrieve OS installation configuration for." }
          },
          required: ["endpointId"]
        }
      },

      // ── OS Folder Write Operations ────────────────────────────────────────
      {
        name: "create_os_folder",
        description: "Create a new Operating Systems folder in baramundi Management Suite. Accepts folder creation data including name and optional parent folder ID, and returns the newly created OS folder with its assigned GUID and metadata.",
        inputSchema: {
          type: "object",
          properties: {
            folderData: {
              type: "object",
              // The body keys are lowercase — this prose said "Name and
              // optional ParentId" until 2026-08-11, and bConnect drops
              // wrong-case keys silently (D6), so a model following it built
              // a body whose name never arrived.
              description: "Folder creation properties: name (required), parentId (optional GUID), comment (optional)."
            }
          },
          required: ["folderData"]
        }
      },
      {
        name: "update_os_folder",
        description: "Update an existing Operating Systems folder using a JSON Patch document. Applies patch operations to modify the specified OS folder properties such as name or parent folder in baramundi Management Suite and returns the updated folder.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the OS folder to update." },
            patchOperations: {
              type: "array",
              description: "JSON Patch operations array. Each item has op (replace/add/remove), path (JSON path), and value fields."
            }
          },
          required: ["id", "patchOperations"]
        }
      },
      {
        name: "delete_os_folder",
        description: "Delete an Operating Systems folder by its GUID. The folder must be empty before deletion. Permanently removes the specified OS folder from baramundi Management Suite. Returns no content on success.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the OS folder to delete. The folder must be empty." }
          },
          required: ["id"]
        }
      },

      // ── Windows Endpoint OS Write Operations ─────────────────────────────
      {
        name: "update_os_windows_endpoint",
        description: "Update the Operating System installation configuration for a specific Windows endpoint using a JSON Patch document. Applies patch operations to modify the OS installation settings for the specified Windows endpoint in baramundi Management Suite.",
        inputSchema: {
          type: "object",
          properties: {
            endpointId: { type: "string", description: "GUID of the Windows endpoint to update OS installation configuration for." },
            patchOperations: {
              type: "array",
              description: "JSON Patch operations array. Each item has op (replace/add/remove), path (JSON path), and value fields."
            }
          },
          required: ["endpointId", "patchOperations"]
        }
      },
  ];

  const catalogue = defineToolCatalogue({
    tools: TOOLS,
    write: [
      "create_os_folder",
      "update_os_folder",
      "delete_os_folder",
      "update_os_windows_endpoint",
    ],
  });

  // ── ListToolsRequestSchema handler ────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: catalogue.listTools() };
  });

  // ── CallToolRequestSchema handler ─────────────────────────────────────────

  // ── Argument-validation pre-pass (runs before write-gate or bConnect setup) ─
  function validateToolArguments(name: string, args: Record<string, unknown> | undefined): void {
    switch (name) {
      case "list_os_folders":
        validateOrThrow(args, OperatingSystemsRules.listOsFolders());
        return;
      case "get_os_folder":
        validateOrThrow(args, OperatingSystemsRules.getOsFolder());
        return;
      case "list_os_folders_by_folder":
        validateOrThrow(args, OperatingSystemsRules.listOsFoldersByFolder());
        return;
      case "list_os_windows_endpoints":
        validateOrThrow(args, OperatingSystemsRules.listOsWindowsEndpoints());
        return;
      case "get_os_windows_endpoint":
        validateOrThrow(args, OperatingSystemsRules.getOsWindowsEndpoint());
        return;
      case "create_os_folder":
        validateOrThrow(args, OperatingSystemsRules.createOsFolder());
        return;
      case "update_os_folder":
        validateOrThrow(args, OperatingSystemsRules.updateOsFolder());
        return;
      case "delete_os_folder":
        validateOrThrow(args, OperatingSystemsRules.deleteOsFolder());
        return;
      case "update_os_windows_endpoint":
        validateOrThrow(args, OperatingSystemsRules.updateOsWindowsEndpoint());
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
    // (BCONNECT_API_KEY__OPERATINGSYSTEMS); with no such variable set this
    // changes nothing. See mcp-core/server-scoped-credentials.ts.
    serverName: "bconnect-operatingsystems-mcp",
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

    // 1. Validate arguments first — pure, no side effects, fails fast on bad input.
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

    // 2. Write-operation gate (REQ-SRV-012). Hiding a write tool from
    //    tools/list is a token optimisation; this is the security control.
    const denied = catalogue.gateWriteTool(name);
    if (denied) {
      return denied;
    }


    try {
      const bconnect = getBconnect();
      const os = bconnect.operatingSystems;

      // Dispatch — arguments already validated by validateToolArguments above.
      switch (name) {

        case "list_os_folders": {
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => os.getFolders(p as never), args);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await os.getFolders(apiParams(args) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "get_os_folder": {
          const result = await os.getFolder(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_os_folders_by_folder": {
          const { folderId, ...params } = args as Record<string, unknown>;
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => os.getFoldersByFolderId(folderId as string, p as never), params);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await os.getFoldersByFolderId(folderId as string, apiParams(params) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_os_windows_endpoints": {
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => os.getWindowsEndpoints(p as never), args);
            return toolTextResult(serializeToolResult(count));
          }
          const raw = await os.getWindowsEndpoints(apiParams(args) as never);
          const full = args?.detail === true;
          const shaped = shapeOsWindowsEndpoints(
            forShaping(raw as unknown as ListEnvelope, full, flattenOsRow),
            { full, fields: args?.fields as string[] | undefined, args }
          );
          return toolTextResult(serializeToolResult(shaped));
        }

        case "get_os_windows_endpoint": {
          const result = await os.getWindowsEndpoint(args!.endpointId as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "create_os_folder": {
          const result = await os.createFolder(args!.folderData as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "update_os_folder": {
          const result = await os.updateFolder(args!.id as string, args!.patchOperations as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "delete_os_folder": {
          await os.deleteFolder(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult({ success: true }) }] };
        }

        case "update_os_windows_endpoint": {
          const result = await os.updateWindowsEndpoint(args!.endpointId as string, args!.patchOperations as never);
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
    name: "bconnect-operatingsystems-mcp",
    createServer,
    http: { express },
  }).catch((error) => {
    console.error(`Fatal error: ${describeConnectionFailure(error)}`);
    process.exit(1);
  });
}
