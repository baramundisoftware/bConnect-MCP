#!/usr/bin/env node

/**
 * bconnect-software-mcp
 *
 * A Model Context Protocol server that provides access to the baramundi
 * bConnect REST API for Software — installed Windows software inventory
 * and software bundle management (bundles, applications, folders).
 *
 * Requires bConnect 26R1 or later. 25R2 is no longer supported: the bundle and
 * folder tools, which 26R1 introduced, are registered unconditionally now.
 * BCONNECT_RELEASE used to select between the two and no longer exists.
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
// ── Composition layer (packages/mcp-core, finding TOK-30) ───────────────────
// TOK-20  defineToolCatalogue    — write schemas are not advertised unless
//                                  ALLOW_WRITE_OPERATIONS=true; the gate itself
//                                  is unchanged, hiding is not disabling.
// TOK-24  createListShaper       — the compact default projection for the
//                                  installed-software rows (see below).
// TOK-25  isCountOnlyRequest /   — "how many?" without paying for a page.
//         fetchCount
// TOK-29  schema fragments       — one canonical wording for Page/PageSize/
//                                  SearchQuery/OrderBy and the shaping flags.
// INT-53  handleToolError        — 400/403/404/429 come back as readable
//                                  isError results; faults stay protocol errors.
import {
  defineToolCatalogue,
  createListShaper,
  isCountOnlyRequest,
  fetchCount,
  handleToolError,
  toolTextResult,
  objectSchema,
  paginationProperties,
  exactMatchFilter,
  guidProperty,
  includeSubfoldersProperty,
  projectionProperties,
  countOnlyProperty,
  type SchemaProperties,
  type ListEnvelope,
  type ShapeOptions,
} from "@bconnect/mcp-core";
// Finding A2 / INT-53 — throw BareMcpError, never McpError, out of a request
// handler: McpError bakes "MCP error <code>: " into .message and the SDK adds
// it again client-side. `instanceof McpError` still holds, so `handleToolError`
// still recognises these as protocol errors and rethrows them untouched.
// See packages/mcp-core/src/protocol-error.ts.
import { BareMcpError } from "@bconnect/mcp-core";
import { SoftwareRules } from "./utils/mcp-tool-validation-rules.js";

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
      name: "bconnect-software-mcp",
      version: "26.1.8"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // ── Response shaping for the installed-software inventory (TOK-24) ────────
  //
  // Measured live on WORKSTATION1 (EVAL-2026-08-02.md, TOK-24): rows run ~430 B
  // of which ~270 B is either echoed straight back from the caller's own
  // arguments (`endpointId`, and `endpointName` which is constant for the whole
  // page) or null/constant on every row — `autFirstUse`, `autLastUse`,
  // `autLastData` are null and `autUsage` is "AutDeactivated" on every row
  // wherever application usage tracking is off, which is ~99.9% of estates.
  // 130 items over 7 pages costs ~63 KB (~16k tokens) to answer "what is
  // installed on X".
  //
  // The projection is declared HERE, in this server, not in mcp-core: the
  // evaluation's own warning about this finding is that a shaper wired into the
  // shared client would silently reshape every raw passthrough in all thirteen
  // servers. `createListShaper` is a function this server's case arms call, and
  // nothing else in the suite is affected.
  //
  // Lossless by construction: every dropped column's single value is reported
  // once in `meta` (`meta.echoed`, `meta.constant`), and `detail: true` returns
  // the API record unchanged. The constant-column rule is off below two rows,
  // so a one-row page cannot have every column declared "constant" and eaten.
  const shapeInstalledSoftware = createListShaper({
    dropEchoedArgs: ["endpointId"],
    dropConstantColumns: true,
    fullModeHint: "Pass detail:true for the full API record, or fields:[...] to choose columns.",
  });

  /** Caller-facing shaping flags. Ours, not bConnect's — never sent upstream. */
  const SHAPING_KEYS: ReadonlySet<string> = new Set(["detail", "fields", "countOnly"]);

  const apiParams = (args: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(args).filter(([key]) => !SHAPING_KEYS.has(key)));

  const shapeOptions = (args: Record<string, unknown>): ShapeOptions => ({
    full: args.detail === true,
    ...(Array.isArray(args.fields) ? { fields: args.fields as string[] } : {}),
    args,
  });

  const shaped = (payload: unknown, args: Record<string, unknown>): string =>
    serializeToolResult(shapeInstalledSoftware(payload as ListEnvelope, shapeOptions(args)));

  // ── Tool catalogue ────────────────────────────────────────────────────────

  /** Page/PageSize/SearchQuery/OrderBy + Category + detail/fields/countOnly. */
  const installedSoftwareProperties: SchemaProperties = {
    ...paginationProperties,
    ...exactMatchFilter("Category"),
    ...projectionProperties,
  };

  const READ_TOOLS = [

    // ── Installed Software ─────────────────────────────────────────────
    {
      name: "list_installed_windows_software",
      description: "List installed Windows software across every endpoint in baramundi Management Suite: name, vendor, version, install date, endpoint. Compact by default — columns null or identical on the whole page are reported once under meta. Use detail:true for the raw record, fields:[..] to pick columns, countOnly:true for the count alone.",
      inputSchema: objectSchema(installedSoftwareProperties),
    },
    {
      name: "list_installed_software_by_endpoint",
      description: "List installed Windows software on one Windows endpoint given its GUID: name, vendor, version, install date. Compact by default — the endpointId you supplied, endpointName and any column constant across the page are reported once under meta. Use detail:true for the raw record, fields:[..] to pick columns, countOnly:true for the count alone.",
      inputSchema: objectSchema(
        { ...guidProperty("endpointId", "Windows endpoint to list installed software for"), ...installedSoftwareProperties },
        ["endpointId"],
      ),
    },
    {
      name: "list_installed_software_by_logical_group",
      description: "List installed Windows software across the endpoints of one logical group given its GUID: name, vendor, version, endpoint. Compact by default — columns null or identical on the whole page are reported once under meta. Use detail:true for the raw record, fields:[..] to pick columns, countOnly:true for the count alone.",
      inputSchema: objectSchema(
        {
          ...guidProperty("logicalGroupId", "logical group to list installed software for"),
          ...includeSubfoldersProperty,
          ...installedSoftwareProperties,
        },
        ["logicalGroupId"],
      ),
    },
    {
      name: "list_installed_software_by_universal_dynamic_group",
      description: "List installed Windows software across the endpoints of one UNIVERSAL Dynamic Group given its GUID: name, vendor, version, endpoint. Universal Dynamic Groups are a DIFFERENT group kind from the Dynamic Groups used by assign_job_to_dynamic_group in bconnect-jobs, and their ids are not interchangeable — passing a Dynamic Group id here returns a 404 that looks like a missing route. Get the id from list_universal_dynamic_groups in bconnect-universaldynamicgroups. Compact by default — columns null or identical on the whole page are reported once under meta. Use detail:true for the raw record, fields:[..] to pick columns, countOnly:true for the count alone.",
      inputSchema: objectSchema(
        {
          ...guidProperty("universalDynamicGroupId", "Universal Dynamic Group to list installed software for"),
          ...installedSoftwareProperties,
        },
        ["universalDynamicGroupId"],
      ),
    },
  ];

  // Bundle and folder management, introduced in 26R1. Kept as a separate array
  // because the split is real history, not because it is still conditional —
  // see the composition at defineToolCatalogue below.
  const READ_TOOLS_26R1 = [
    {
      name: "list_software_bundles",
      description: "List all software bundles defined in baramundi Management Suite. Returns a paged list with bundle id, name, type, ignoreDependencies, parentId/parentName, and comment — NOT the applications it contains; the 200 response has no application list. Use list_bundle_applications_by_bundle for that. Pass countOnly:true for just the match count.",
      inputSchema: objectSchema({
        ...paginationProperties,
        ...exactMatchFilter("Name"),
        ...countOnlyProperty,
      }),
    },
    {
      name: "get_software_bundle",
      description: "Get details of a specific software bundle by its GUID in baramundi Management Suite. Returns bundle id, name, type, ignoreDependencies, parentId/parentName, and comment — NOT the applications it contains; the 200 response has no application list. Use list_bundle_applications_by_bundle for that.",
      inputSchema: objectSchema(guidProperty("bundleId", "software bundle to retrieve"), ["bundleId"]),
    },
    {
      name: "list_bundle_applications",
      description: "List all bundle application assignments across all software bundles in baramundi Management Suite. Returns a paged list with bundle name, application name, vendor and order index. Pass countOnly:true for just the match count.",
      inputSchema: objectSchema({ ...paginationProperties, ...countOnlyProperty }),
    },
    {
      name: "list_bundle_applications_by_bundle",
      description: "List all applications contained in one software bundle identified by its GUID. Returns a paged list with application id, name, vendor and order within the bundle. Pass countOnly:true for just the match count.",
      inputSchema: objectSchema(
        {
          ...guidProperty("bundleId", "software bundle to list applications for"),
          ...paginationProperties,
          ...countOnlyProperty,
        },
        ["bundleId"],
      ),
    },
    {
      name: "list_bundle_folders",
      description: "List all software bundle folders in baramundi Management Suite. Returns a paged list with folder id, name, parent folder id and optional comment for each folder in the hierarchy. Pass countOnly:true for just the match count.",
      inputSchema: objectSchema({
        ...paginationProperties,
        ...exactMatchFilter("Name"),
        ...countOnlyProperty,
      }),
    },
    {
      name: "get_bundle_folder",
      description: "Get details of a specific software bundle folder by its GUID. Returns folder id, name, parent folder id, and comment for the specified folder in the baramundi Management Suite bundle hierarchy.",
      inputSchema: objectSchema(guidProperty("id", "bundle folder to retrieve"), ["id"]),
    },
    {
      name: "list_bundle_folders_by_folder",
      description: "List the sub-folders contained in one software bundle folder identified by its GUID, optionally recursing through nested sub-folders. Returns folder id, name, parent id and comment for each. Pass countOnly:true for just the match count.",
      inputSchema: objectSchema(
        {
          ...guidProperty("folderId", "parent bundle folder to list sub-folders for"),
          ...includeSubfoldersProperty,
          ...paginationProperties,
          ...exactMatchFilter("Name"),
          ...countOnlyProperty,
        },
        ["folderId"],
      ),
    },
  ];

  const WRITE_TOOLS_26R1 = [
    {
      name: "create_software_bundle",
      description: "Create a new software bundle in baramundi Management Suite. Requires a name and optional parent folder id to place the bundle within the folder hierarchy. Returns the newly created bundle with its assigned GUID.",
      // Advertised (and sent) as `folderId` until 2026-08-11;
      // SoftwareBundleForCreation declares `parentId` and rejects unknown
      // keys, so the placement could never work as promised. Rule H pins the
      // name to the operation.
      inputSchema: objectSchema(
        {
          name: { type: "string", description: "Display name for the new software bundle." },
          ...guidProperty("parentId", "parent bundle folder to place the bundle in (optional)"),
        },
        ["name"],
      ),
    },
    {
      name: "delete_software_bundle",
      description: "Delete a software bundle from baramundi Management Suite by its GUID. The operation returns no content on success (204). If the bundle does not exist, the operation is treated as successful.",
      inputSchema: objectSchema(guidProperty("bundleId", "software bundle to delete"), ["bundleId"]),
    },
    {
      name: "add_application_to_bundle",
      description: "Assign an application to a software bundle in baramundi Management Suite. Requires the bundle GUID and the application GUID to add. Returns the created bundle application assignment with its order index — the index is assigned by bMS; the request cannot choose it.",
      // An `order` parameter was advertised here until 2026-08-11;
      // AddApplicationRequest accepts only applicationId and rejects unknown
      // keys, so a caller-chosen order was never transmittable. Rule H pins
      // every property here to the operation.
      inputSchema: objectSchema(
        {
          ...guidProperty("bundleId", "software bundle to add the application to"),
          ...guidProperty("applicationId", "application to assign to the bundle"),
        },
        ["bundleId", "applicationId"],
      ),
    },
    {
      name: "delete_bundle_application",
      description: "Remove an application assignment from a software bundle in baramundi Management Suite by the assignment GUID. Returns no content on success (204). If the assignment does not exist, the operation is treated as successful.",
      inputSchema: objectSchema(guidProperty("id", "bundle application assignment to delete"), ["id"]),
    },
    {
      name: "replace_application_in_bundle",
      description: "Replace an application within a software bundle using a JSON Patch document. Updates the ApplicationId field of the bundle application assignment to point to a different application. Answers HTTP 409 if the target application is already included in the bundle, or if the bundle does not contain the bundle application assignment named by id.",
      inputSchema: objectSchema(
        {
          ...guidProperty("bundleId", "software bundle containing the assignment"),
          ...guidProperty("id", "bundle application assignment to update"),
          patchOperations: {
            type: "array",
            description: "JSON Patch operations. Use op=replace, path=/ApplicationId, value=<new-app-guid>.",
          },
        },
        ["bundleId", "id", "patchOperations"],
      ),
    },
    {
      name: "create_bundle_folder",
      description: "Create a new software bundle folder in baramundi Management Suite. Requires a name and optional parent folder id and comment. Returns the newly created folder with its assigned GUID.",
      inputSchema: objectSchema(
        {
          name: { type: "string", description: "Display name for the new bundle folder." },
          ...guidProperty("parentId", "parent folder (creates in root if omitted)"),
          comment: { type: "string", description: "Optional comment or description for the folder." },
        },
        ["name"],
      ),
    },
    {
      name: "delete_bundle_folder",
      description: "Delete a software bundle folder from baramundi Management Suite by its GUID. The folder must be empty before deletion. Returns no content on success (204). If the folder does not exist, the operation is treated as successful.",
      inputSchema: objectSchema(guidProperty("id", "bundle folder to delete"), ["id"]),
    },
    {
      name: "update_bundle_folder",
      description: "Update a software bundle folder in baramundi Management Suite using a JSON Patch document. Supports modifying name, parentId (move folder), and comment fields. Returns the updated folder with all current properties.",
      inputSchema: objectSchema(
        {
          ...guidProperty("id", "bundle folder to update"),
          patchOperations: {
            type: "array",
            description: "JSON Patch operations. Supported paths: /name, /parentId, /comment. Use op=replace.",
          },
        },
        ["id", "patchOperations"],
      ),
    },
  ];

  // The catalogue is composed once, at construction: `defineToolCatalogue`
  // throws on a duplicate name and on a gated name that matches no advertised
  // tool (the F21 drift class — `replace_application_in_bundle` was missing
  // from the hand-written gate and executed ungated), so that mistake now fails
  // at startup rather than at the first write call.
  const catalogue = defineToolCatalogue({
    // Decision 2 — the product is 26R1-only. These two lines used to read
    // `is26R1 ? ... : ...`, so pointed at a 25R2 bMS this server advertised
    // READ_TOOLS only and NO write tools at all.
    read: [...READ_TOOLS, ...READ_TOOLS_26R1],
    write: WRITE_TOOLS_26R1,
  });

  // ── ListToolsRequestSchema handler ────────────────────────────────────────
  //
  // TOK-20: write schemas are advertised only when ALLOW_WRITE_OPERATIONS=true.
  // In the documented default posture (writes disabled) their only possible
  // answer is the refusal string, so their schemas are context paid for nothing.
  // The gate below is unchanged: a client that already knows a write tool's name
  // still gets the same refusal, byte for byte.
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: catalogue.listTools(),
  }));

  // ── CallToolRequestSchema handler ─────────────────────────────────────────

  // ── Argument-validation pre-pass (runs before write-gate or bConnect setup) ─
  function validateToolArguments(name: string, args: Record<string, unknown> | undefined): void {
    switch (name) {
      // Installed Software (base)
      case "list_installed_windows_software":
        validateOrThrow(args, SoftwareRules.listInstalledWindowsSoftware()); return;
      case "list_installed_software_by_endpoint":
        validateOrThrow(args, SoftwareRules.listInstalledSoftwareByEndpoint()); return;
      case "list_installed_software_by_logical_group":
        validateOrThrow(args, SoftwareRules.listInstalledSoftwareByLogicalGroup()); return;
      case "list_installed_software_by_universal_dynamic_group":
        validateOrThrow(args, SoftwareRules.listInstalledSoftwareByDynamicGroup()); return;
      // Software Bundles (26R1)
      case "list_software_bundles":
        validateOrThrow(args, SoftwareRules.listSoftwareBundles()); return;
      case "get_software_bundle":
        validateOrThrow(args, SoftwareRules.getSoftwareBundle()); return;
      case "create_software_bundle":
        validateOrThrow(args, SoftwareRules.createSoftwareBundle()); return;
      case "delete_software_bundle":
        validateOrThrow(args, SoftwareRules.deleteSoftwareBundle()); return;
      // Bundle Applications (26R1)
      case "list_bundle_applications":
        validateOrThrow(args, SoftwareRules.listBundleApplications()); return;
      case "list_bundle_applications_by_bundle":
        validateOrThrow(args, SoftwareRules.listBundleApplicationsByBundle()); return;
      case "add_application_to_bundle":
        validateOrThrow(args, SoftwareRules.addApplicationToBundle()); return;
      case "delete_bundle_application":
        validateOrThrow(args, SoftwareRules.deleteBundleApplication()); return;
      case "replace_application_in_bundle":
        validateOrThrow(args, SoftwareRules.replaceApplicationInBundle()); return;
      // Bundle Folders (26R1)
      case "list_bundle_folders":
        validateOrThrow(args, SoftwareRules.listBundleFolders()); return;
      case "get_bundle_folder":
        validateOrThrow(args, SoftwareRules.getBundleFolder()); return;
      case "list_bundle_folders_by_folder":
        validateOrThrow(args, SoftwareRules.listBundleFoldersByFolder()); return;
      case "create_bundle_folder":
        validateOrThrow(args, SoftwareRules.createBundleFolder()); return;
      case "delete_bundle_folder":
        validateOrThrow(args, SoftwareRules.deleteBundleFolder()); return;
      case "update_bundle_folder":
        validateOrThrow(args, SoftwareRules.updateBundleFolder()); return;
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
    // (BCONNECT_API_KEY__SOFTWARE); with no such variable set this
    // changes nothing. See mcp-core/server-scoped-credentials.ts.
    serverName: "bconnect-software-mcp",
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

    // 2. Write-operation gate (REQ-SRV-012). The declared write set now lives in
    //    the catalogue above, so the list that HIDES a write schema and the list
    //    that REFUSES the call can no longer disagree — which is exactly how
    //    `replace_application_in_bundle` (F21) came to execute ungated. The
    //    refusal text is unchanged.
    const denied = catalogue.gateWriteTool(name);
    if (denied) {
      return denied;
    }


    try {
      const bconnect = getBconnect();
      const sw = bconnect.software;

      // Dispatch — arguments already validated by validateToolArguments above.
      switch (name) {

        // ── Installed Software ─────────────────────────────────────────
        //
        // Three things happen in each of these four arms and nowhere else in
        // this server: countOnly short-circuits to the envelope-only probe
        // (TOK-25), the caller's shaping flags are stripped before the request
        // reaches bConnect, and the page is passed through the compact
        // projection (TOK-24). Every other tool below still returns the raw
        // payload.
        case "list_installed_windows_software": {
          const all = (args ?? {}) as Record<string, unknown>;
          if (isCountOnlyRequest(all)) {
            return toolTextResult(serializeToolResult(
              await fetchCount((p) => sw.getInstalledWindowsSoftware(p as never), all)
            ));
          }
          const result = await sw.getInstalledWindowsSoftware(apiParams(all) as never);
          return toolTextResult(shaped(result, all));
        }

        case "list_installed_software_by_endpoint": {
          const all = (args ?? {}) as Record<string, unknown>;
          const { endpointId, ...params } = all;
          if (isCountOnlyRequest(all)) {
            return toolTextResult(serializeToolResult(
              await fetchCount((p) => sw.getInstalledSoftwareByEndpoint(endpointId as string, p as never), params)
            ));
          }
          const result = await sw.getInstalledSoftwareByEndpoint(endpointId as string, apiParams(params) as never);
          return toolTextResult(shaped(result, all));
        }

        case "list_installed_software_by_logical_group": {
          const all = (args ?? {}) as Record<string, unknown>;
          const { logicalGroupId, ...params } = all;
          if (isCountOnlyRequest(all)) {
            return toolTextResult(serializeToolResult(
              await fetchCount((p) => sw.getInstalledSoftwareByLogicalGroup(logicalGroupId as string, p as never), params)
            ));
          }
          const result = await sw.getInstalledSoftwareByLogicalGroup(logicalGroupId as string, apiParams(params) as never);
          return toolTextResult(shaped(result, all));
        }

        case "list_installed_software_by_universal_dynamic_group": {
          const all = (args ?? {}) as Record<string, unknown>;
          const { universalDynamicGroupId, ...params } = all;
          if (isCountOnlyRequest(all)) {
            return toolTextResult(serializeToolResult(
              await fetchCount((p) => sw.getInstalledSoftwareByUniversalDynamicGroup(universalDynamicGroupId as string, p as never), params)
            ));
          }
          const result = await sw.getInstalledSoftwareByUniversalDynamicGroup(universalDynamicGroupId as string, apiParams(params) as never);
          return toolTextResult(shaped(result, all));
        }

        // ── Software Bundles (26R1) ────────────────────────────────────
        //
        // The bundle routes keep their raw passthrough — their rows carry no
        // echoed argument and no always-null block, so there is nothing for the
        // projection to remove. They take countOnly only.
        case "list_software_bundles": {
          const all = (args ?? {}) as Record<string, unknown>;
          if (isCountOnlyRequest(all)) {
            return toolTextResult(serializeToolResult(
              await fetchCount((p) => sw.getSoftwareBundles(p as never), all)
            ));
          }
          const result = await sw.getSoftwareBundles(apiParams(all) as never);
          return toolTextResult(serializeToolResult(result));
        }

        case "get_software_bundle": {
          const result = await sw.getSoftwareBundle(args!.bundleId as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "create_software_bundle": {
          const body: Record<string, unknown> = { name: args!.name };
          if (typeof args!.parentId === "string") {body.parentId = args!.parentId;}
          const result = await sw.createSoftwareBundle(body as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "delete_software_bundle": {
          await sw.deleteSoftwareBundle(args!.bundleId as string);
          return { content: [{ type: "text", text: serializeToolResult({ success: true }) }] };
        }

        // ── Bundle Applications (26R1) ─────────────────────────────────
        case "list_bundle_applications": {
          const all = (args ?? {}) as Record<string, unknown>;
          if (isCountOnlyRequest(all)) {
            return toolTextResult(serializeToolResult(
              await fetchCount((p) => sw.getBundleApplications(p as never), all)
            ));
          }
          const result = await sw.getBundleApplications(apiParams(all) as never);
          return toolTextResult(serializeToolResult(result));
        }

        case "list_bundle_applications_by_bundle": {
          const all = (args ?? {}) as Record<string, unknown>;
          const { bundleId, ...params } = all;
          if (isCountOnlyRequest(all)) {
            return toolTextResult(serializeToolResult(
              await fetchCount((p) => sw.getBundleApplicationsByBundle(bundleId as string, p as never), params)
            ));
          }
          const result = await sw.getBundleApplicationsByBundle(bundleId as string, apiParams(params) as never);
          return toolTextResult(serializeToolResult(result));
        }

        case "add_application_to_bundle": {
          // AddApplicationRequest accepts exactly applicationId; the order
          // index is assigned by bMS and was never transmittable.
          const body: Record<string, unknown> = { applicationId: args!.applicationId };
          const result = await sw.addApplicationToBundle(args!.bundleId as string, body as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "delete_bundle_application": {
          await sw.deleteBundleApplication(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult({ success: true }) }] };
        }

        case "replace_application_in_bundle": {
          const result = await sw.replaceApplicationInBundle(args!.bundleId as string, args!.id as string, args!.patchOperations as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        // ── Bundle Folders (26R1) ──────────────────────────────────────
        case "list_bundle_folders": {
          const all = (args ?? {}) as Record<string, unknown>;
          if (isCountOnlyRequest(all)) {
            return toolTextResult(serializeToolResult(
              await fetchCount((p) => sw.getBundleFolders(p as never), all)
            ));
          }
          const result = await sw.getBundleFolders(apiParams(all) as never);
          return toolTextResult(serializeToolResult(result));
        }

        case "get_bundle_folder": {
          const result = await sw.getBundleFolder(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_bundle_folders_by_folder": {
          const all = (args ?? {}) as Record<string, unknown>;
          const { folderId, ...params } = all;
          if (isCountOnlyRequest(all)) {
            return toolTextResult(serializeToolResult(
              await fetchCount((p) => sw.getBundleFoldersByFolder(folderId as string, p as never), params)
            ));
          }
          const result = await sw.getBundleFoldersByFolder(folderId as string, apiParams(params) as never);
          return toolTextResult(serializeToolResult(result));
        }

        case "create_bundle_folder": {
          const body: Record<string, unknown> = { name: args!.name };
          if (typeof args!.parentId === "string") {body.parentId = args!.parentId;}
          if (typeof args!.comment === "string") {body.comment = args!.comment;}
          const result = await sw.createBundleFolder(body as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "delete_bundle_folder": {
          await sw.deleteBundleFolder(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult({ success: true }) }] };
        }

        case "update_bundle_folder": {
          const result = await sw.updateBundleFolder(args!.id as string, args!.patchOperations as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        default:
          throw new BareMcpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error) {
      // INT-53 — one error channel. An expected API failure the model can act
      // on (400 bad filter, 403 denied, 404 wrong id, 429 back off) comes back
      // as an isError tool result — the same shape the write gate above
      // returns. Protocol errors (validation, the unknown-tool and 26R1 guards)
      // are rethrown untouched, and everything else (401, 5xx, TLS, transport,
      // a bug here) stays a protocol InternalError, because no argument the
      // model can choose fixes bad credentials or a bMS that is down.
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
    name: "bconnect-software-mcp",
    createServer,
    http: { express },
  }).catch((error) => {
    console.error(`Fatal error: ${describeConnectionFailure(error)}`);
    process.exit(1);
  });
}
