#!/usr/bin/env node

/**
 * bconnect-updatemanagement-mcp
 *
 * A Model Context Protocol server that provides access to the baramundi
 * bConnect REST API for Update Management — listing and managing Windows
 * endpoint update profiles (Microsoft Update Management integration).
 *
 * Supports both 25R2 and 26R1.
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
  // Phase 4 token-consumption §2 — orderByOver() exists specifically to
  // replace the hand-written 138 B sentence below (138 B -> 89 B, 49 B saved,
  // zero behaviour change: same field list, same example).
  orderByOver,
  createListShaper,
  detailProperty,
  fieldsProperty,
  type ListEnvelope,
} from "@bconnect/mcp-core";

/**
 * The compact projection for `list_update_management_endpoints`.
 *
 * Measured live: 11,999 B for a 20-row page, 17 columns. This is the second
 * fattest response in the suite.
 *
 * ── Why `dropConstantColumns` ALONE was rejected ─────────────────────────────
 * It is the obvious choice and it is a trap. On this estate `updateProfileId`
 * and `updateProfileName` are page-constant, so it saves 1,671 B (13.9%) — but
 * both are constant only because labcorp.local runs ONE update profile.
 * Re-measured through the shipped shaper against the same page rewritten with
 * three profiles, `dropConstantColumns` on its own saves **−32 B: a net LOSS**,
 * because with nothing constant to remove the `meta` block is pure overhead.
 * Shipping that would have handed most customers a regression AND charged them
 * ~503 B of catalogue for it.
 *
 * ── What is actually durable ─────────────────────────────────────────────────
 * The saving that survives a different estate is the STRUCTURAL one: three
 * columns that describe where the data came from rather than what it says.
 * `lastInventorySource` and `lastSuccessfulUpdateSource` (both `MicrosoftOnline`
 * here) and `updateDownloadMode` are configuration and provenance; this tool's
 * question is "which machines are missing critical patches", and none of the
 * three helps answer it. Dropping them measures:
 *
 *   this estate (1 profile)   11,999 -> 8,049 B   −3,950 B (−32.9%)
 *   a 3-profile estate        11,928 -> 9,732 B   −2,196 B (−18.4%)
 *
 * Every compliance figure is kept — the three missing-update counts, deferred,
 * blocked, featureUpdatesAvailable, updateState, both timestamps,
 * targetReleaseVersion, endpointId, endpointName — and `updateProfileId` stays
 * because `update_update_management_endpoint` patches `/updateProfileId`, so it
 * is a value a caller writes back. When it is page-constant it moves to
 * `meta.constant` rather than being dropped, which is lossless.
 *
 * The drop is named in `meta.dropped` and `detail:true` returns the raw record.
 */
const shapeUpdateEndpoints = createListShaper({
  alwaysDrop: ["lastInventorySource", "lastSuccessfulUpdateSource", "updateDownloadMode"],
  dropConstantColumns: true,
});
import { UpdateManagementRules } from "./utils/mcp-tool-validation-rules.js";
// bConnect v1.1 slice — Microsoft Update profiles/inventories. The client is
// now SHARED, in @bconnect/mcp-core: it started local here, and moved when the
// endpoints inventory-scan slice became a second consumer, because a second
// hand-maintained copy is this project's most repeated defect. The
// path-containment guard is untouched — the v1.1 client takes a controller
// name, never a path, and refuses any method but GET, so it cannot express a
// /<module>/v2.0/ request. See packages/mcp-core/src/v11-client.ts for the
// auth rules and modules/microsoft-update-v11.ts for the live-verified facts.
import {
  MicrosoftUpdateV11Client,
  v11Enabled,
  gateV11Tool,
  shapeInventory,
} from "./modules/microsoft-update-v11.js";

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
      name: "bconnect-updatemanagement-mcp",
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
  // Declared once, gated once. `write` names the tools that mutate; they are
  // omitted from tools/list unless ALLOW_WRITE_OPERATIONS=true, and calling one
  // by name while the gate is shut still returns the same refusal it always did.

  const TOOLS = [
      {
        name: "list_update_management_endpoints",
        description: "The estate-wide Microsoft Update picture, one row per Windows endpoint: how many Critical, Security and Other updates each endpoint is MISSING, how many its profile defers or blocks, whether a feature update is available, the endpoint's updateState (including 'InventoryOutdated', which means the counts are as old as the last inventory rather than as old as today), the assigned update profile, and the last inventory and last successful update timestamps. START HERE for 'which machines are missing critical patches', 'who is behind on Windows updates', 'what is our patch compliance'. This is one read-only call and it covers the whole estate. Then use get_endpoint_microsoft_update_inventory (bConnect v1.1) for the individual update titles on one endpoint. NOT the same thing as get_unpatched_endpoints, which ranks by CVE detections from the vulnerability scanner rather than by outstanding Microsoft Updates. Compact by default: the update/inventory SOURCE and download-mode columns are omitted and named in meta.dropped, and columns holding one value across the page are reported once under meta.constant. Every compliance figure is kept. Use detail:true for the raw record, fields:[..] to pick columns, countOnly:true for the count alone.",
        inputSchema: {
          type: "object",
          properties: {
            ...orderByOver("EndpointName", "LastInventory", "LastSuccessfulUpdate"),
            SearchQuery: { type: "string", description: "Filter results by matching against EndpointName or UpdateProfileName." },
            ...pageProperties,
            ...countOnlyProperty,
            ...detailProperty,
            ...fieldsProperty,
          },
          required: []
        }
      },
      {
        name: "get_update_management_endpoint",
        description: "The Microsoft Update picture for ONE Windows endpoint, by GUID: how many Critical, Security and Other updates it is MISSING, how many its profile defers or blocks, whether a feature update is available, its updateState (including 'InventoryOutdated', which means these counts are as old as the last inventory rather than as old as today), the assigned update profile, and the last inventory and last successful update timestamps. Use list_update_management_endpoints first if you do not already have the endpoint GUID — it answers the same question for the whole estate in one call. For the individual update titles rather than the counts, use get_endpoint_microsoft_update_inventory (bConnect v1.1).",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the Windows endpoint to retrieve Update Management status for." }
          },
          required: ["id"]
        }
      },
      {
        name: "update_update_management_endpoint",
        description: "Update the Microsoft Update Management profile assignment for a specific Windows endpoint using a JSON Patch document. Allows changing the assigned update profile or resetting it to null (no profile). Returns the updated endpoint with its new update profile configuration.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the Windows endpoint to update the Update Management profile for." },
            patchOperations: {
              type: "array",
              description: "JSON Patch operations array. Use op=replace, path=/updateProfileId, value=<profile-guid> (or null to remove profile)."
            }
          },
          required: ["id", "patchOperations"]
        }
      },
  ];

  const catalogue = defineToolCatalogue({
    tools: TOOLS,
    write: ["update_update_management_endpoint"],
  });

  // ── bConnect v1.1 tools (gated on BCONNECT_ENABLE_V11 + credentials) ──────
  //
  // Advertised only when BCONNECT_ENABLE_V11=true AND both
  // BCONNECT_V11_USERNAME / BCONNECT_V11_PASSWORD are present — the
  // ALLOW_WRITE_OPERATIONS precedent: no credential means no v1.1 tools in
  // tools/list and no schema-token cost for deployments that cannot use them.
  // A second defineToolCatalogue keeps the duplicate-name guard; the v1.1
  // visibility decision itself is v11Enabled(), read per call.

  const V11_TOOLS = [
    {
      name: "list_microsoft_update_profiles",
      description: "List the Microsoft Update profiles configured in baramundi Management Suite (bConnect v1.1). Each profile describes a patch-deployment ring: the update deferral period in days, the blocked update classifications, and the blocked products. Useful next to the Update Management endpoint tools to understand which deferral policy an endpoint's assigned profile enforces. Requires BCONNECT_ENABLE_V11 and v1.1 credentials; LAN-only.",
      inputSchema: {
        type: "object",
        properties: {},
        required: []
      }
    },
    {
      name: "get_endpoint_microsoft_update_inventory",
      description: "Get the Microsoft Update inventory for ONE Windows endpoint (bConnect v1.1), identified by its GUID. Returns a compact digest by default: totals of installed vs missing updates, missing updates counted by classification and by MSRC severity, and the missing Critical-severity items with title, update id and installation deadline. Pass detail:true for the endpoint's full raw inventory record (~12 KB). There is deliberately no unfiltered variant — the whole-estate inventory is ~164 KB. Requires BCONNECT_ENABLE_V11 and v1.1 credentials; LAN-only.",
      inputSchema: {
        type: "object",
        properties: {
          endpointId: { type: "string", description: "GUID of the Windows endpoint whose Microsoft Update inventory to retrieve. Required — the server-side EndpointId filter keeps the response to one endpoint." },
          detail: { type: "boolean", description: "Return the endpoint's full raw v1.1 inventory record instead of the compact digest. Default false." }
        },
        required: ["endpointId"]
      }
    },
  ];

  const v11Catalogue = defineToolCatalogue({ tools: V11_TOOLS, write: [] });
  const V11_TOOL_NAMES = v11Catalogue.readToolNames;

  // ── ListToolsRequestSchema handler ────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        ...catalogue.listTools(),
        ...(v11Enabled() ? v11Catalogue.listTools() : []),
      ],
    };
  });

  // ── CallToolRequestSchema handler ─────────────────────────────────────────

  // ── Argument-validation pre-pass (runs before write-gate or bConnect setup) ─
  function validateToolArguments(name: string, args: Record<string, unknown> | undefined): void {
    switch (name) {
      case "list_update_management_endpoints":
        validateOrThrow(args, UpdateManagementRules.listUpdateManagementEndpoints());
        return;
      case "get_update_management_endpoint":
        validateOrThrow(args, UpdateManagementRules.getUpdateManagementEndpoint());
        return;
      case "update_update_management_endpoint":
        validateOrThrow(args, UpdateManagementRules.updateUpdateManagementEndpoint());
        return;
      case "list_microsoft_update_profiles":
        validateOrThrow(args, UpdateManagementRules.listMicrosoftUpdateProfiles());
        return;
      case "get_endpoint_microsoft_update_inventory":
        // Runs BEFORE the v1.1 gate and before any client or socket exists, so
        // a missing or non-GUID endpointId never costs a network round trip.
        validateOrThrow(args, UpdateManagementRules.getEndpointMicrosoftUpdateInventory());
        return;
      // Unknown tool names are not validated here; the dispatch switch below
      // handles them with MethodNotFound.
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
    // (BCONNECT_API_KEY__UPDATEMANAGEMENT); with no such variable set this
    // changes nothing. See mcp-core/server-scoped-credentials.ts.
    serverName: "bconnect-updatemanagement-mcp",
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
    // The v1.1 tools live in a SECOND catalogue, so the call above skips them —
    // it leaves a name it does not own alone, by design. Without this line the
    // two v1.1 tools would be the one hole in a suite-wide guard, which is the
    // same gated-tool blind spot that already had to be closed once for
    // `every-advertised-tool-dispatches`. The suite guard caught it here.
    v11Catalogue.assertKnownParameters(name, args);

    // 2. Write-operation gate (REQ-SRV-012). Hiding a write tool from
    //    tools/list is a token optimisation; this is the security control, and
    //    it answers a client that calls a hidden tool by name.
    const denied = catalogue.gateWriteTool(name);
    if (denied) {
      return denied;
    }

    // 3. v1.1 gate. Hiding the v1.1 tools from tools/list is the token
    //    optimisation; this is the control — a client that knows the name and
    //    calls it anyway gets an actionable refusal, not "unknown tool".
    const deniedV11 = gateV11Tool(name, V11_TOOL_NAMES);
    if (deniedV11) {
      return deniedV11;
    }


    try {
      const bconnect = getBconnect();
      const um = bconnect.updateManagement;

      // 4. Dispatch — arguments already validated by validateToolArguments above.
      switch (name) {

        case "list_update_management_endpoints": {
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((params) => um.getWindowsEndpoints(params as never), args);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await um.getWindowsEndpoints(apiParams(args) as never);
          return toolTextResult(
            serializeToolResult(
              shapeUpdateEndpoints(result as unknown as ListEnvelope, {
                full: args?.detail === true,
                fields: Array.isArray(args?.fields) ? (args.fields as string[]) : undefined,
                args,
              })
            )
          );
        }

        case "get_update_management_endpoint": {
          const result = await um.getWindowsEndpoint(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "update_update_management_endpoint": {
          const result = await um.updateWindowsEndpoint(args!.id as string, args!.patchOperations as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        // ── bConnect v1.1 (gated above; local read-only client) ─────────────
        //
        // The client is rebuilt per call on purpose: it holds no state, and
        // reading the environment at request time means a credential change is
        // honoured the same way the memoised v2.0 provider honours one (via
        // its fingerprint). It borrows ONLY baseURL + httpsAgent from the
        // v2.0 client — never the API key, which v1.1 rejects anyway.

        case "list_microsoft_update_profiles": {
          const v11 = new MicrosoftUpdateV11Client({ httpClient: bconnect.getHttpClient() });
          // 6 profiles, 1,230 bytes measured live — small enough to return raw.
          const result = await v11.request("MicrosoftUpdateProfiles");
          return toolTextResult(serializeToolResult(result));
        }

        case "get_endpoint_microsoft_update_inventory": {
          const v11 = new MicrosoftUpdateV11Client({ httpClient: bconnect.getHttpClient() });
          const endpointId = args!.endpointId as string;
          // Server-side filter, verified live: ?EndpointId=<guid> returns one
          // endpoint (12,548 bytes) instead of all 22 (164,470 bytes). The
          // parameter name is case-insensitive on the server; an unknown name
          // would be a 400, which the client maps to its own diagnosis.
          const raw = await v11.request("MicrosoftUpdateInventories", { EndpointId: endpointId });
          const shaped = shapeInventory(raw, { endpointId, detail: args?.detail === true });
          return toolTextResult(serializeToolResult(shaped));
        }

        default:
          throw new BareMcpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error) {
      // INT-53 — one error channel. 400/403/404/429 come back as a readable
      // isError result the model can act on; validation and gate errors are
      // rethrown as the protocol errors they already are; 401/5xx/TLS/bugs
      // become protocol InternalError.
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
    name: "bconnect-updatemanagement-mcp",
    createServer,
    http: { express },
  }).catch((error) => {
    console.error(`Fatal error: ${describeConnectionFailure(error)}`);
    process.exit(1);
  });
}
