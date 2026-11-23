#!/usr/bin/env node

/**
 * bconnect-universaldynamicgroups-mcp
 *
 * A Model Context Protocol server for the baramundi bConnect REST API's
 * Universal Dynamic Groups: listing and retrieving UDG definitions and their
 * folder hierarchy, and (bMS 26R2) reading and managing thresholds; the
 * threshold write tools are behind ALLOW_WRITE_OPERATIONS (#355).
 *
 * This server is ONLY available for bConnect 26R1 and later.
 * Universal Dynamic Groups do not exist in 25R2.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode
} from "@modelcontextprotocol/sdk/types.js";
import { BConnectClient } from "./bconnect-client.js";
import { validateOrThrow, toolErrorResult, lazyClient, declaredArgumentsOnly, pickArguments, queryParameters, queryProperties, withQueryProperties, withCountOnly, serverClients, runServer, withToolAnnotations, toolJsonResult, selectedRelease, withReleaseTools, refuseUnavailableTool, protocolError, withVariantSelectors, withToolVariants, variantKey, withUnverifiedWriteMarker, withWriteToolsHidden } from "@bconnect/mcp-core";
import { QUERY_PARAMETERS } from "./query-params.js";
import { TOOL_RELEASES } from "./tool-releases.js";
import { TOOL_METHODS } from "./tool-methods.js";
import { TOOL_VARIANTS } from "./tool-variants.js";

/** The query parameters a list tool sends: exactly what its route declares in the selected release (#179). */
const sends = (tool: string): string[] => queryParameters(QUERY_PARAMETERS, selectedRelease(), tool);
import type { BConnectCredentials } from "@bconnect/mcp-core";
import { UdgRules } from "./utils/mcp-tool-validation-rules.js";
import { createThresholdBody, createThresholdRules, createThresholdSchema, updateThresholdPatch, updateThresholdRules, updateThresholdSchema, UPDATABLE_THRESHOLD_FIELDS } from "./threshold-fields.js";

/** Write tools: gated by ALLOW_WRITE_OPERATIONS, hidden while it is off, marked unverified in tools/list (REQ-SRV-012, REQ-SRV-026). */
const WRITE_TOOLS = new Set<string>(["create_threshold", "update_threshold", "delete_threshold"]);

/**
 * The arguments a route of a merged tool takes besides its selectors (REQ-SRV-029): its query
 * parameters in the selected release. list_thresholds' dynamicGroupId is its selector (given or not).
 */
function routeArguments(key: string): string[] {
  return Object.keys(queryProperties(QUERY_PARAMETERS, selectedRelease(), key));
}

// ─── Factory exported for testing ───────────────────────────────────────────

export type { BConnectCredentials } from "@bconnect/mcp-core";

/** The server's bConnect clients: one shared by every tool call (REQ-SRV-023). */
const clients = serverClients(BConnectClient);

export function createServer(credentials?: BConnectCredentials): { server: Server } {
  const release = selectedRelease();

  const server = new Server(
    {
      name: "bconnect-universaldynamicgroups-mcp",
      version: "26.1.12"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // ── ListToolsRequestSchema handler ────────────────────────────────────────

  const toolCatalog = declaredArgumentsOnly(withVariantSelectors(TOOL_VARIANTS, TOOL_RELEASES, routeArguments, withQueryProperties(QUERY_PARAMETERS, () => selectedRelease(), withUnverifiedWriteMarker(WRITE_TOOLS, async () => {

    return {
      tools: [
        // ── Universal Dynamic Groups ─────────────────────────────────────
        {
          name: "list_universal_dynamic_groups",
          description: "[26R1] List all Universal Dynamic Groups defined in baramundi Management Suite. Returns a paged list with UDG id, name, comment, and folder assignment for each group. Universal Dynamic Groups are dynamic endpoint groups based on filter criteria. Available in bConnect 26R1 and later.",
          inputSchema: {
            type: "object",
            properties: {},
            required: []
          }
        },
        {
          name: "get_universal_dynamic_group",
          description: "[26R1] Get details of a specific Universal Dynamic Group by its GUID. Returns the UDG id, name, comment, folder id, and filter criteria definition from baramundi Management Suite. Available in bConnect 26R1 and later.",
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
          description: "[26R1] List all Universal Dynamic Groups contained in a specific folder identified by its GUID. Returns a paged list of UDGs within that folder with id, name, comment, and filter criteria details. Available in bConnect 26R1 and later.",
          inputSchema: {
            type: "object",
            properties: {
              folderId: { type: "string", description: "GUID of the folder to list Universal Dynamic Groups from." },
            },
            required: ["folderId"]
          }
        },

        // ── UDG Folders ──────────────────────────────────────────────────
        {
          name: "list_udg_folders",
          description: "[26R1] List all Universal Dynamic Groups folders in baramundi Management Suite. Returns a paged list with folder id, name, parent folder id, and comment for each folder in the UDG folder hierarchy. Available in bConnect 26R1 and later.",
          inputSchema: {
            type: "object",
            properties: {},
            required: []
          }
        },
        {
          name: "get_udg_folder",
          description: "[26R1] Get details of a specific Universal Dynamic Groups folder by its GUID. Returns folder id, name, parent folder id, and comment for the specified folder in the baramundi Management Suite UDG hierarchy. Available in bConnect 26R1 and later.",
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
          description: "[26R1] List all sub-folders contained within a specific Universal Dynamic Groups folder identified by its GUID. Returns a paged list of child folders with id, name, parent id, and comment. Available in bConnect 26R1 and later.",
          inputSchema: {
            type: "object",
            properties: {
              folderId: { type: "string", description: "GUID of the parent UDG folder to list sub-folders for." },
            },
            required: ["folderId"]
          }
        },

        // ── Thresholds (26R2, #354) ──────────────────────────────────────
        {
          name: "list_thresholds",
          description: "[26R2] List the thresholds configured on Universal Dynamic Groups: all of them, or one group's with dynamicGroupId. A threshold compares the group's endpoint count with a value (type UpperLimit or LowerLimit) and raises a notification (severity Info, Warning or Error) for a security profile. For each: id, group id and name, security profile id and name, severity, value, type, whether it is active, comment and who last modified it. Available in bConnect 26R2 and later.",
          inputSchema: {
            type: "object",
            properties: {
              dynamicGroupId: { type: "string", description: "GUID of a Universal Dynamic Group: list only its thresholds. Leave out for all." },
            },
            required: []
          }
        },
        {
          name: "get_threshold",
          description: "[26R2] Get one Universal Dynamic Group threshold by its GUID: group, security profile, severity, value, type (UpperLimit or LowerLimit), whether it is active, comment and who last modified it. Available in bConnect 26R2 and later.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "GUID of the threshold." }
            },
            required: ["id"]
          }
        },
        {
          name: "create_threshold",
          description: "[26R2] Create a threshold on a Universal Dynamic Group: bMS compares the group's endpoint count with value (type UpperLimit: notify above it; LowerLimit: below it) and raises a notification of the given severity for the security profile. Needs dynamicGroupId and securityProfileId; neither can be changed later. Returns the created threshold as bMS answers it. WARNING: Creates a new threshold. Available in bConnect 26R2 and later.",
          inputSchema: createThresholdSchema
        },
        {
          name: "update_threshold",
          description: "[26R2] Change a threshold: value, type, severity, isActive or comment (at least one). The group and the security profile can't be changed. Sends a JSON Patch with only the given fields and returns the threshold as bMS answers it. WARNING: Modifies an existing threshold. Available in bConnect 26R2 and later.",
          inputSchema: updateThresholdSchema
        },
        {
          name: "delete_threshold",
          description: "[26R2] Delete a threshold by its GUID. WARNING: Permanently removes the threshold; its notifications stop. Available in bConnect 26R2 and later.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "GUID of the threshold to delete." }
            },
            required: ["id"]
          }
        },
      ]
    };
  }))));
  // With writes off, tools/list leaves out the write tools; the gate still refuses them by name (REQ-SRV-026).
  server.setRequestHandler(ListToolsRequestSchema, withReleaseTools(TOOL_RELEASES, withWriteToolsHidden(TOOL_METHODS, () => process.env.ALLOW_WRITE_OPERATIONS === "true",
    withToolAnnotations(TOOL_METHODS, toolCatalog.list))));

  // ── CallToolRequestSchema handler ─────────────────────────────────────────

  // ── Argument-validation pre-pass (runs before getBconnect) ─────────────────
  function validateToolArguments(route: string, args: Record<string, unknown> | undefined): void {
    switch (route) {
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
      case "list_thresholds[dynamicGroupId=]":
        validateOrThrow(args, UdgRules.listThresholds());
        return;
      case "list_thresholds[dynamicGroupId=*]":
        validateOrThrow(args, UdgRules.listThresholdsForGroup());
        return;
      case "get_threshold":
        validateOrThrow(args, UdgRules.getThreshold());
        return;
      case "create_threshold":
        validateOrThrow(args, createThresholdRules());
        return;
      case "update_threshold":
        validateOrThrow(args, updateThresholdRules());
        if (updateThresholdPatch(args ?? {}).length === 0) {
          throw protocolError(ErrorCode.InvalidParams, `update_threshold needs at least one field to change: ${UPDATABLE_THRESHOLD_FIELDS.join(", ")}.`);
        }
        return;
      case "delete_threshold":
        validateOrThrow(args, UdgRules.getThreshold());
        return;
      // Unknown tool names are not validated here; dispatch handles MethodNotFound.
    }
  }

  // A merged tool's call is checked against its routes for the selected release first (REQ-SRV-029).
  // countOnly (#165): count with one 1-row request instead of loading a page.
  server.setRequestHandler(CallToolRequestSchema, withToolVariants(TOOL_VARIANTS, TOOL_RELEASES, routeArguments, withCountOnly(QUERY_PARAMETERS, () => selectedRelease(), async (request) => {
    const { name, arguments: args } = request.params;
    // A tool the selected release lacks is refused by name first, before its arguments are
    // checked against a schema the release doesn't list, and before anything is sent (#159).
    refuseUnavailableTool(TOOL_RELEASES, name);
    // Refuse arguments the tool doesn't declare, before anything else (REQ-SRV-022).
    await toolCatalog.refuseUndeclared(name, args);

    // The route a merged tool's arguments chose (checked by withToolVariants); any other tool is its own route.
    const route = variantKey(TOOL_VARIANTS, name, args) ?? name;
    // Validate arguments first — pure, no side effects, fails fast on bad input.
    validateToolArguments(route, args);
    // ── Write-operation gate (REQ-SRV-012) ───────────────────────────────────
    if (WRITE_TOOLS.has(name) && process.env.ALLOW_WRITE_OPERATIONS !== "true") {
      return {
        content: [{ type: "text" as const, text: `Write operation '${name}' is disabled. Set ALLOW_WRITE_OPERATIONS=true to enable write operations.` }],
        isError: true
      };
    }

    const getBconnect = (): BConnectClient => {
      // The server's shared client (REQ-SRV-023). A ClientConfigError (e.g. missing
      // credentials) reaches the catch below and becomes a tool result (REQ-XC-001).
      return clients.get(credentials);
    };

    try {
      const bconnect = lazyClient(getBconnect);
      const udg = lazyClient(() => bconnect.udg);

      // Dispatch — arguments already validated by validateToolArguments above.
      switch (route) {

        case "list_universal_dynamic_groups": {
          const result = await udg.getUniversalDynamicGroups(pickArguments(args ?? {}, sends("list_universal_dynamic_groups")));
          return toolJsonResult(result);
        }

        case "get_universal_dynamic_group": {
          const result = await udg.getUniversalDynamicGroup(args!.id as string);
          return toolJsonResult(result);
        }

        case "list_universal_dynamic_groups_by_folder": {
          const { folderId, ...params } = args as Record<string, unknown>;
          const result = await udg.getUniversalDynamicGroupsByFolder(folderId as string, pickArguments(params, sends("list_universal_dynamic_groups_by_folder")));
          return toolJsonResult(result);
        }

        case "list_udg_folders": {
          const result = await udg.getFolders(pickArguments(args ?? {}, sends("list_udg_folders")));
          return toolJsonResult(result);
        }

        case "get_udg_folder": {
          const result = await udg.getFolder(args!.id as string);
          return toolJsonResult(result);
        }

        case "list_udg_folders_by_folder": {
          const { folderId, ...params } = args as Record<string, unknown>;
          const result = await udg.getFoldersByFolder(folderId as string, pickArguments(params, sends("list_udg_folders_by_folder")));
          return toolJsonResult(result);
        }

        // ── Thresholds (26R2, #354) ─────────────────────────────────────
        case "list_thresholds[dynamicGroupId=]": {
          const result = await udg.getThresholds(pickArguments(args ?? {}, sends(route)));
          return toolJsonResult(result);
        }

        case "list_thresholds[dynamicGroupId=*]": {
          const { dynamicGroupId, ...params } = args as Record<string, unknown>;
          const result = await udg.getThresholdsForGroup(dynamicGroupId as string, pickArguments(params, sends(route)));
          return toolJsonResult(result);
        }

        case "get_threshold": {
          const result = await udg.getThreshold(args!.id as string);
          return toolJsonResult(result);
        }

        case "create_threshold": {
          const result = await udg.createThreshold(createThresholdBody(args ?? {}));
          return toolJsonResult(result, { lead: "Threshold created:" });
        }

        case "update_threshold": {
          const result = await udg.updateThreshold(args!.id as string, updateThresholdPatch(args ?? {}));
          return toolJsonResult(result, { lead: `Threshold ${args!.id} updated:` });
        }

        case "delete_threshold": {
          await udg.deleteThreshold(args!.id as string);
          return { content: [{ type: "text" as const, text: `Threshold ${args!.id} deleted.` }] };
        }

        default:
          throw protocolError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error) {
      // API errors, gate refusals and configuration errors are tool results the
      // model can read; only McpErrors stay protocol errors (REQ-XC-001).
      return toolErrorResult(error, release);
    }
  })));

  return { server };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

runServer({ name: "bconnect-universaldynamicgroups-mcp", createServer, clients, releases: TOOL_RELEASES });
