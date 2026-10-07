#!/usr/bin/env node

/**
 * bconnect-endpoints-mcp
 *
 * A Model Context Protocol server that provides access to the baramundi
 * bConnect REST API for endpoint management, Active Directory, and
 * Operating Systems modules.
 *
 * Module: Endpoints
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import { BConnectClient } from "./bconnect-client.js";
import { validateOrThrow, toolErrorResult, lazyClient, withUnverifiedWriteMarker, type JsonPatchOperation, pickArguments, declaredArgumentsOnly, queryParameters, withQueryProperties, withCountOnly, serverClients, runServer, withToolAnnotations, withWriteToolsHidden, toolJsonResult, selectedRelease, withReleaseTools, refuseUnavailableTool, withVariantSelectors, withToolVariants, variantKey, refuseReplacedTool } from "@bconnect/mcp-core";
import { QUERY_PARAMETERS } from "./query-params.js";
import { TOOL_RELEASES } from "./tool-releases.js";
import { TOOL_METHODS } from "./tool-methods.js";
import { INTERVAL_RULE, checkIntervalRule, intervalRule, withIntervalRemoval } from "./maintenance-window.js";

/** The query parameters a list tool (or route of a merged tool) sends: exactly what its route declares in the selected release (#179). */
const sends = (tool: string): string[] => queryParameters(QUERY_PARAMETERS, selectedRelease(), tool);

/** The `type` argument of a merged tool; its values are set per release by the core (withVariantSelectors). */
const typeProperty = (description: string): Record<string, unknown> => ({ type: "string", description });

/** Path arguments of each merged tool's routes. */
const PATH_ARGUMENTS: Readonly<Record<string, readonly string[]>> = {
  get_endpoint: ["id"], delete_endpoint: ["id"], update_endpoint: ["id"], start_enrollment: ["id"],
  list_endpoints_by_logical_group: ["logicalGroupId"],
};

/**
 * The arguments a route of a merged tool takes besides `type` (REQ-SRV-029): its path
 * arguments, its query parameters (selected release, else the other one's, as listed) and
 * its body fields. The core refuses any other tool argument for that route.
 */
function routeArguments(key: string): string[] {
  const tool = key.slice(0, key.indexOf("["));
  const release = selectedRelease();
  const query = QUERY_PARAMETERS[release]?.[key] ?? QUERY_PARAMETERS[release === "25R2" ? "26R1" : "25R2"]?.[key] ?? {};
  const body = tool === "update_endpoint" ? updateFieldNames(key) : tool === "start_enrollment" ? createFieldNames(key) : [];
  return [...(PATH_ARGUMENTS[tool] ?? []), ...Object.keys(query), ...body];
}

import { mergedUpdateInputSchema, updateFieldNames, updateInputSchema, updatePatch } from "./update-fields.js";
import { createBody, createFieldNames, createInputSchema, mergedCreateInputSchema } from "./create-fields.js";
import { TOOL_VARIANTS } from "./tool-variants.js";
import { REPLACED_TOOLS } from "./replaced-tools.js";
import type { BConnectCredentials } from "@bconnect/mcp-core";
import { TOOL_RULES } from "./utils/mcp-tool-validation-rules.js";

/**
 * The Mac enrollment answer without the QR code image: a base64 PNG only fills
 * the model's context, and qrCodeText carries the same content as text.
 */
function withoutQrImage(result: unknown): unknown {
  if (typeof result === "object" && result !== null && "qrCodeImageBase64" in result && typeof result.qrCodeImageBase64 === "string") {
    return { ...result, qrCodeImageBase64: `(omitted: ${result.qrCodeImageBase64.length} characters of base64 image data; use qrCodeText)` };
  }
  return result;
}

/** The JSON Patch for an update tool's given fields; refuses a call that changes nothing. */
function changes(tool: string, args: Record<string, unknown>): JsonPatchOperation[] {
  const patch = updatePatch(tool, args);
  if (patch.length === 0) {
    throw new McpError(ErrorCode.InvalidParams, `${tool} needs at least one field to change: ${updateFieldNames(tool).join(", ")}.`);
  }
  return patch;
}

// ─── Factory exported for testing ───────────────────────────────────────────

export type { BConnectCredentials } from "@bconnect/mcp-core";

/** The server's bConnect clients: one shared by every tool call (REQ-SRV-023). */
const clients = serverClients(BConnectClient);

export function createServer(credentials?: BConnectCredentials): { server: Server } {
  const release = selectedRelease();

  const server = new Server(
    {
      name: "bconnect-endpoints-mcp",
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
  "update_endpoint",
  "start_enrollment",
  "create_android_endpoint",
  "create_ios_endpoint",
  "create_windows_endpoint",
  "trigger_intune_installation",
  "create_linux_endpoint",
  "create_mac_endpoint",
  "create_logical_group",
  "update_logical_group",
  "delete_logical_group",
  "create_maintenance_window_for_endpoint",
  "update_maintenance_window_for_endpoint",
  "delete_maintenance_window_for_endpoint",
  "create_maintenance_window_for_logical_group",
  "update_maintenance_window_for_logical_group",
  "delete_maintenance_window_for_logical_group",
  "create_industrial_endpoint",
  "create_network_endpoint",
  "delete_endpoint",
  "delete_unmanaged_endpoint",
  "link_entra_id_data",
  "unlink_entra_id_data",
  ]);

  // A merged tool's type values and per-type properties follow the selected release (REQ-SRV-029).
  const toolCatalog = declaredArgumentsOnly(withVariantSelectors(TOOL_VARIANTS, TOOL_RELEASES, routeArguments, withQueryProperties(QUERY_PARAMETERS, () => selectedRelease(), withUnverifiedWriteMarker(WRITE_TOOLS, async () => {
    const tools: object[] = [
        // ── One tool per operation; the endpoint type is an argument (REQ-SRV-029) ──
        {
          name: "list_endpoints",
          description: "List endpoints (devices) managed by baramundi, one page at a time. Without type, all types with the common filters; with type, only that type's endpoints, with its own filters and fields. The type values are those of the type field in the results.",
          inputSchema: { type: "object", properties: { type: typeProperty("Endpoint type; leave out for all types.") }, required: [] }
        },
        {
          name: "get_endpoint",
          description: "Get an endpoint by its GUID. With type, the type-specific details (e.g. hardware, OS, management state); without, the common fields.",
          inputSchema: { type: "object", properties: { type: typeProperty("Endpoint type; leave out for the common fields."), id: { type: "string", description: "Endpoint ID (GUID)" } }, required: ["id"] }
        },
        {
          name: "delete_endpoint",
          description: "Delete an endpoint by its GUID; with type, through that type's route. WARNING: Permanently deletes the endpoint.",
          inputSchema: { type: "object", properties: { type: typeProperty("Endpoint type; leave out to delete through the common route."), id: { type: "string", description: "Endpoint ID (GUID)" } }, required: ["id"] }
        },
        {
          name: "update_endpoint",
          description: "Update an endpoint of the given type: sends a JSON Patch of the fields given (at least one). Which fields a type takes is listed with each field. WARNING: Modifies endpoint properties.",
          inputSchema: mergedUpdateInputSchema(Object.keys(TOOL_VARIANTS.update_endpoint), typeProperty("Endpoint type."), "Endpoint ID (GUID)")
        },
        {
          name: "start_enrollment",
          description: "Start the enrollment of an existing endpoint of the given type and return what the administrator needs (install command, token, URL or QR text). Which fields a type takes is listed with each field.",
          inputSchema: mergedCreateInputSchema(Object.keys(TOOL_VARIANTS.start_enrollment), typeProperty("Endpoint type."))
        },
        {
          name: "list_endpoints_by_logical_group",
          description: "List the endpoints of a logical group, one page at a time; with type, only that type's.",
          inputSchema: { type: "object", properties: { type: typeProperty("Endpoint type; leave out for all types."), logicalGroupId: { type: "string", description: "Logical group ID (GUID)" } }, required: ["logicalGroupId"] }
        },
        // ── Endpoints API ─────────────────────────────────────────────────
        {
          name: "list_logical_groups",
          description: "List the logical groups in baramundi, one page at a time. Filter by name, distribution point (Dip) or domain.",
          inputSchema: {
            type: "object",
            properties: {},
            required: []
          }
        },
        {
          name: "get_logical_group",
          description: "Get details of a specific logical group",
          inputSchema: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "Logical group ID"
              }
            },
            required: ["id"]
          }
        },
        // Android READ (Phase 24)
        // iOS READ (Phase 24)
        // Mobile enrollment
        // Android CRUD
        {
          name: "create_android_endpoint",
          description: "Create a new Android endpoint in baramundi. Requires displayName and optionally logicalGroupId to assign to a specific group.",
          inputSchema: {
            type: "object",
            properties: {
              displayName: {
                type: "string",
                description: "Display name of the Android endpoint (required)"
              },
              logicalGroupId: {
                type: "string",
                description: "ID of the logical group to assign the endpoint to (optional, GUID format)"
              },
              comment: {
                type: "string",
                description: "Comment or description for the endpoint (optional)"
              },
              serialNumber: {
                type: "string",
                description: "Serial number of the Android device (optional)"
              },
              androidEnterpriseProfileType: {
                type: "string",
                description: "Android enterprise profile type: 'None', 'DeviceOwner', 'WorkProfile', or 'DedicatedDevice' (optional)",
                enum: ["None", "DeviceOwner", "WorkProfile", "DedicatedDevice"]
              },
              registeredUser: {
                type: "string",
                description: "Registered user of the endpoint (optional)"
              }
            },
            required: ["displayName"]
          }
        },
        // iOS CRUD (Phase 24)
        {
          name: "create_ios_endpoint",
          description: "Create a new iOS/iPadOS endpoint in baramundi MDM. WARNING: Creates a new device record.",
          inputSchema: {
            type: "object",
            properties: {
              displayName: { type: "string", description: "Display name of the iOS endpoint (required)" },
              logicalGroupId: { type: "string", description: "ID of the logical group to assign the endpoint to (optional, GUID)" },
              comment: { type: "string", description: "Comment or description (optional)" }
            },
            required: ["displayName"]
          }
        },
        // Windows CRUD
        {
          name: "create_windows_endpoint",
          description: "Create a new Windows endpoint. WARNING: Creates a new endpoint in the system.",
          inputSchema: createInputSchema("create_windows_endpoint")
        },
        {
          name: "trigger_intune_installation",
          description: "Trigger baramundi Agent installation via Intune. Requires co-management configuration.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "Windows endpoint ID (GUID)" }
            },
            required: ["id"]
          }
        },
        // Linux CRUD
        {
          name: "create_linux_endpoint",
          description: "Create a new Linux endpoint. WARNING: Creates a new endpoint.",
          inputSchema: createInputSchema("create_linux_endpoint")
        },
        // Mac CRUD
        {
          name: "create_mac_endpoint",
          description: "Create a new Mac endpoint. WARNING: Creates a new endpoint.",
          inputSchema: {
            type: "object",
            properties: {
              displayName: { type: "string", description: "Display name" },
              logicalGroupId: { type: "string", description: "Logical group ID (GUID)" },
              comment: { type: "string", description: "Comment" }
            },
            required: ["displayName"]
          }
        },
        // Logical groups CRUD
        {
          name: "create_logical_group",
          description: "Create a new logical group. WARNING: Creates a new group in the hierarchy.",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string", description: "Group name" },
              parentId: { type: "string", description: "Parent group ID (GUID, optional)" },
              comment: { type: "string", description: "Comment (optional)" }
            },
            required: ["name"]
          }
        },
        {
          name: "update_logical_group",
          description: "Update a logical group. WARNING: Modifies group properties.",
          inputSchema: updateInputSchema("update_logical_group", "Group ID (GUID)")
        },
        {
          name: "delete_logical_group",
          description: "Delete a logical group. WARNING: Group must be empty. Permanently deletes the group.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "Group ID (GUID)" }
            },
            required: ["id"]
          }
        },
        // Maintenance windows (Phase 24: added GET)
        { name: "get_maintenance_window_for_endpoint", description: "Get the maintenance window configuration for a specific endpoint.", inputSchema: { type: "object", properties: { id: { type: "string", description: "Endpoint ID (GUID)" } }, required: ["id"] } },
        { name: "create_maintenance_window_for_endpoint", description: `Create a maintenance window for an endpoint. ${intervalRule(selectedRelease())} WARNING: Creates new maintenance window.`, inputSchema: createInputSchema("create_maintenance_window_for_endpoint") },
        { name: "update_maintenance_window_for_endpoint", description: `Update a maintenance window for an endpoint. ${INTERVAL_RULE} Changing the type to Anytime or Never removes the existing intervals. WARNING: Modifies existing maintenance window.`, inputSchema: updateInputSchema("update_maintenance_window_for_endpoint", "Endpoint ID (GUID)") },
        { name: "delete_maintenance_window_for_endpoint", description: "Delete a maintenance window for an endpoint. WARNING: Permanently deletes maintenance window.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
        { name: "get_maintenance_window_for_logical_group", description: "Get the maintenance window configuration for a specific logical group.", inputSchema: { type: "object", properties: { id: { type: "string", description: "Logical group ID (GUID)" } }, required: ["id"] } },
        { name: "create_maintenance_window_for_logical_group", description: `Create a maintenance window for a logical group. ${intervalRule(selectedRelease())} WARNING: Creates new maintenance window.`, inputSchema: createInputSchema("create_maintenance_window_for_logical_group") },
        { name: "update_maintenance_window_for_logical_group", description: `Update a maintenance window for a logical group. ${INTERVAL_RULE} Changing the type to Anytime or Never removes the existing intervals. WARNING: Modifies existing maintenance window.`, inputSchema: updateInputSchema("update_maintenance_window_for_logical_group", "Logical group ID (GUID)") },
        { name: "delete_maintenance_window_for_logical_group", description: "Delete a maintenance window for a logical group. WARNING: Permanently deletes maintenance window.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
        // Industrial & network endpoints (Phase 24: added GET for network)
        { name: "create_industrial_endpoint", description: "Create a new industrial endpoint (PLC, SCADA, etc.). WARNING: Creates a new endpoint.", inputSchema: createInputSchema("create_industrial_endpoint") },
        { name: "create_network_endpoint", description: "Create a new network endpoint (switch, router, printer, etc.). WARNING: Creates a new endpoint.", inputSchema: createInputSchema("create_network_endpoint") },
        // Generic delete
      ];

      // 26R1-only tools: Unmanaged Endpoints + EntraID (listed per TOOL_RELEASES, #159)
      tools.push(
        { name: "list_unmanaged_endpoints", description: "[26R1] List all unmanaged endpoints detected by baramundi. Returns the devices that are not yet enrolled into management; the route takes no paging or filter arguments. Available in bConnect 26R1 and later.", inputSchema: { type: "object", properties: {} } },
        { name: "get_unmanaged_endpoint", description: "[26R1] Get details of a specific unmanaged endpoint by its GUID. Available in bConnect 26R1 and later.", inputSchema: { type: "object", properties: { id: { type: "string", description: "Unmanaged endpoint ID (GUID)" } }, required: ["id"] } },
        { name: "delete_unmanaged_endpoint", description: "[26R1] Delete an unmanaged endpoint record. WARNING: Permanently removes the unmanaged device record. Available in bConnect 26R1 and later.", inputSchema: { type: "object", properties: { id: { type: "string", description: "Unmanaged endpoint ID (GUID)" } }, required: ["id"] } },
        { name: "get_entra_id_data", description: "[26R1] Get the Entra ID (formerly Azure AD) data bMS stores for a device, looked up by its Entra ID device ID (not the bMS endpoint ID). The API marks this as a temporary method; it applies to mobile devices (Android, iOS) whose Entra ID registration bMS tracks. Available in bConnect 26R1 and later.", inputSchema: { type: "object", properties: { deviceId: { type: "string", description: "Entra ID device ID (GUID), not the bMS endpoint ID" } }, required: ["deviceId"] } },
        { name: "link_entra_id_data", description: "[26R1] Link a baramundi endpoint to its Entra ID device, tenant and user. WARNING: Creates or replaces the Entra ID association of the endpoint. The API marks this as a temporary method; it applies to mobile devices (Android, iOS) whose Entra ID registration bMS tracks. Available in bConnect 26R1 and later.", inputSchema: { type: "object", properties: { endpointId: { type: "string", description: "bMS endpoint ID (GUID)" }, entraIdDeviceId: { type: "string", description: "Entra ID device ID (GUID)" }, entraIdTenantId: { type: "string", description: "Entra ID tenant ID (GUID)" }, entraIdUserId: { type: "string", description: "Entra ID user ID (GUID)" } }, required: ["endpointId", "entraIdDeviceId", "entraIdTenantId", "entraIdUserId"] } },
        { name: "unlink_entra_id_data", description: "[26R1] Remove the Entra ID association of a baramundi endpoint. WARNING: Removes the Entra association. The API marks this as a temporary method; it applies to mobile devices (Android, iOS) whose Entra ID registration bMS tracks. Available in bConnect 26R1 and later.", inputSchema: { type: "object", properties: { endpointId: { type: "string", description: "bMS endpoint ID (GUID)" } }, required: ["endpointId"] } },
      );

      return { tools };
  }, { variants: TOOL_VARIANTS, releases: TOOL_RELEASES }))));
  // With writes off, tools/list leaves out the write tools; the gate still refuses them by name (REQ-SRV-026).
  server.setRequestHandler(ListToolsRequestSchema, withReleaseTools(TOOL_RELEASES, withWriteToolsHidden(TOOL_METHODS, () => process.env.ALLOW_WRITE_OPERATIONS === "true",
    withToolAnnotations(TOOL_METHODS, toolCatalog.list))));

  // ── CallToolRequestSchema handler ─────────────────────────────────────────

  // ── Argument-validation pre-pass (runs before getBconnect) ─────────────────
  function validateToolArguments(name: string, args: Record<string, unknown> | undefined): void {
    // Own keys only: an inherited name such as "constructor" must not match.
    if (Object.hasOwn(TOOL_RULES, name)) {
      validateOrThrow(args, TOOL_RULES[name]());
    }
  }
  // A merged tool's call is checked against its routes for the selected release before anything else (REQ-SRV-029).
  // countOnly (#165): count with one 1-row request instead of loading a page.
  server.setRequestHandler(CallToolRequestSchema, withToolVariants(TOOL_VARIANTS, TOOL_RELEASES, routeArguments, withCountOnly(QUERY_PARAMETERS, () => selectedRelease(), async (request) => {
    const { name, arguments: args } = request.params;
    // A removed per-type tool answers with its replacement; it never runs (REQ-SRV-029).
    refuseReplacedTool(REPLACED_TOOLS, TOOL_RELEASES, name);
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
        content: [{
          type: "text" as const,
          text: `Write operation '${name}' is disabled. Set ALLOW_WRITE_OPERATIONS=true to enable write operations.`
        }],
        isError: true
      };
    }


    // Lazily create BConnect client only when a tool is actually called.
    // This allows the server to be instantiated in tests without real credentials.
    const getBconnect = (): BConnectClient => {
      // The server's shared client (REQ-SRV-023). A ClientConfigError (e.g. missing
      // credentials) reaches the catch below and becomes a tool result (REQ-XC-001).
      return clients.get(credentials);
    };

    try {
      const bconnect = lazyClient(getBconnect);

      switch (route) {
        // ── Endpoints ───────────────────────────────────────────────────
        case "list_endpoints[type=]": {
          const result = await bconnect.endpoints.getEndpoints(pickArguments(args ?? {}, sends(route)));
          return toolJsonResult(result);
        }

        case "get_endpoint[type=]": {
          const result = await bconnect.endpoints.getEndpoint(args!.id as string);
          return toolJsonResult(result);
        }


        case "list_endpoints[type=WindowsEndpoint]": {
          const result = await bconnect.endpoints.getWindowsEndpoints(pickArguments(args ?? {}, sends(route)));
          return toolJsonResult(result);
        }

        case "get_endpoint[type=WindowsEndpoint]": {
          const result = await bconnect.endpoints.getWindowsEndpoint(args!.id as string);
          return toolJsonResult(result);
        }

        case "list_logical_groups": {
          const result = await bconnect.endpoints.getLogicalGroups(pickArguments(args ?? {}, sends(route)));
          return toolJsonResult(result);
        }

        case "get_logical_group": {
          const result = await bconnect.endpoints.getLogicalGroup(args!.id as string);
          return toolJsonResult(result);
        }


        case "list_endpoints[type=LinuxEndpoint]": {
          const result = await bconnect.endpoints.getLinuxEndpoints(pickArguments(args ?? {}, sends(route)));
          return toolJsonResult(result);
        }

        case "list_endpoints[type=MacEndpoint]": {
          const result = await bconnect.endpoints.getMacEndpoints(pickArguments(args ?? {}, sends(route)));
          return toolJsonResult(result);
        }

        case "get_endpoint[type=LinuxEndpoint]": {
          const result = await bconnect.endpoints.getLinuxEndpoint(args!.id as string);
          return toolJsonResult(result);
        }

        case "get_endpoint[type=MacEndpoint]": {
          const result = await bconnect.endpoints.getMacEndpoint(args!.id as string);
          return toolJsonResult(result);
        }

        case "list_endpoints_by_logical_group[type=]": {
          const result = await bconnect.endpoints.getEndpointsByLogicalGroup(
            args!.logicalGroupId as string,
            pickArguments(args ?? {}, sends(route))
          );
          return toolJsonResult(result);
        }

        case "list_endpoints_by_logical_group[type=WindowsEndpoint]": {
          const result = await bconnect.endpoints.getWindowsEndpointsByLogicalGroup(
            args!.logicalGroupId as string,
            pickArguments(args ?? {}, sends(route))
          );
          return toolJsonResult(result);
        }

        case "list_endpoints[type=AndroidEndpoint]": {
          const result = await bconnect.endpoints.listAndroidEndpoints(pickArguments(args ?? {}, sends(route)));
          return toolJsonResult(result);
        }

        case "get_endpoint[type=AndroidEndpoint]": {
          const result = await bconnect.endpoints.getAndroidEndpoint(args!.id as string);
          return toolJsonResult(result);
        }

        case "list_endpoints[type=IOSEndpoint]": {
          const result = await bconnect.endpoints.listIosEndpoints(pickArguments(args ?? {}, sends(route)));
          return toolJsonResult(result);
        }

        case "get_endpoint[type=IOSEndpoint]": {
          const result = await bconnect.endpoints.getIosEndpoint(args!.id as string);
          return toolJsonResult(result);
        }

        case "start_enrollment[type=AndroidEndpoint]": {
          const result = await bconnect.endpoints.startAndroidEnrollment(
            args!.id as string,
            {
              enrollmentMailAddress: args!.enrollmentMailAddress as string | undefined ?? null,
              emailLanguageId: args!.emailLanguageId as string | undefined ?? null,
              forceMobileDataOnEnrollment: (args!.forceMobileDataOnEnrollment as boolean | undefined) ?? false,
              includeWifiInQrCode: (args!.includeWifiInQrCode as boolean | undefined) ?? false,
            }
          );
          return toolJsonResult(result);
        }

        case "start_enrollment[type=IOSEndpoint]": {
          const result = await bconnect.endpoints.startIosEnrollment(
            args!.id as string,
            {
              enrollmentMailAddress: args!.enrollmentMailAddress as string | undefined ?? null,
              emailLanguageId: args!.emailLanguageId as string | undefined ?? null,
            }
          );
          return toolJsonResult(result);
        }

        case "create_android_endpoint": {
          const data = {
            displayName: args!.displayName as string,
            logicalGroupId: args!.logicalGroupId as string | undefined,
            comment: args!.comment as string | undefined,
            serialNumber: args!.serialNumber as string | undefined,
            androidEnterpriseProfileType: args!.androidEnterpriseProfileType as never | undefined,
            registeredUser: args!.registeredUser as string | undefined
          };
          const result = await bconnect.endpoints.createAndroidEndpoint(data);
          return toolJsonResult(result);
        }

        case "update_endpoint[type=AndroidEndpoint]": {
          const patch = changes(route, args!); // checks the arguments before the client is built
          const result = await bconnect.endpoints.updateAndroidEndpoint(args!.id as string, patch);
          return toolJsonResult(result, { lead: `Android endpoint ${args!.id} updated:` });
        }

        case "delete_endpoint[type=AndroidEndpoint]": {
          await bconnect.endpoints.deleteAndroidEndpoint(args!.id as string);
          return toolJsonResult({ success: true, message: `Android endpoint ${args!.id} deleted successfully` });
        }

        case "create_ios_endpoint": {
          const iosData = {
            displayName: args!.displayName as string,
            logicalGroupId: args!.logicalGroupId as string | undefined,
            comment: args!.comment as string | undefined,
          };
          const result = await bconnect.endpoints.createIosEndpoint(iosData as never);
          return toolJsonResult(result);
        }

        case "update_endpoint[type=IOSEndpoint]": {
          const patch = changes(route, args!); // checks the arguments before the client is built
          const result = await bconnect.endpoints.updateIosEndpoint(args!.id as string, patch);
          return toolJsonResult(result, { lead: `iOS endpoint ${args!.id} updated:` });
        }

        case "delete_endpoint[type=IOSEndpoint]": {
          await bconnect.endpoints.deleteIosEndpoint(args!.id as string);
          return toolJsonResult({ success: true, message: `iOS endpoint ${args!.id} deleted successfully` });
        }

        case "create_windows_endpoint": {
          const result = await bconnect.endpoints.createWindowsEndpoint(createBody("create_windows_endpoint", args!));
          return toolJsonResult(result);
        }

        case "update_endpoint[type=WindowsEndpoint]": {
          const patch = changes(route, args!); // checks the arguments before the client is built
          const result = await bconnect.endpoints.updateWindowsEndpoint(args!.id as string, patch);
          return toolJsonResult(result);
        }

        case "delete_endpoint[type=WindowsEndpoint]": {
          await bconnect.endpoints.deleteWindowsEndpoint(args!.id as string);
          return { content: [{ type: "text", text: `Windows endpoint ${args!.id} deleted successfully` }] };
        }

        case "start_enrollment[type=WindowsEndpoint]": {
          const result = await bconnect.endpoints.startWindowsEndpointEnrollment(args!.id as string, createBody(route, args!));
          return toolJsonResult(result, { lead: `Windows endpoint ${args!.id} enrollment started:` });
        }

        case "trigger_intune_installation": {
          const result = await bconnect.endpoints.triggerInstallationViaIntune(args!.id as string);
          const text = result === true
            ? `Intune installation triggered for endpoint ${args!.id}.`
            : result === false
              ? `Intune installation was not triggered for endpoint ${args!.id} (bMS answered false).`
              : `Intune installation for endpoint ${args!.id}: result unknown (bMS answered ${JSON.stringify(result)}).`;
          return { content: [{ type: "text", text }] };
        }

        case "create_linux_endpoint": {
          const result = await bconnect.endpoints.createLinuxEndpoint(createBody("create_linux_endpoint", args!));
          return toolJsonResult(result);
        }

        case "update_endpoint[type=LinuxEndpoint]": {
          const patch = changes(route, args!); // checks the arguments before the client is built
          const result = await bconnect.endpoints.updateLinuxEndpoint(args!.id as string, patch);
          return toolJsonResult(result);
        }

        case "delete_endpoint[type=LinuxEndpoint]": {
          await bconnect.endpoints.deleteLinuxEndpoint(args!.id as string);
          return { content: [{ type: "text", text: `Linux endpoint ${args!.id} deleted successfully` }] };
        }

        case "create_mac_endpoint": {
          const result = await bconnect.endpoints.createMacEndpoint(args! as never);
          return toolJsonResult(result);
        }

        case "update_endpoint[type=MacEndpoint]": {
          const patch = changes(route, args!); // checks the arguments before the client is built
          const result = await bconnect.endpoints.updateMacEndpoint(args!.id as string, patch);
          return toolJsonResult(result);
        }

        case "delete_endpoint[type=MacEndpoint]": {
          await bconnect.endpoints.deleteMacEndpoint(args!.id as string);
          return { content: [{ type: "text", text: `Mac endpoint ${args!.id} deleted successfully` }] };
        }

        case "start_enrollment[type=MacEndpoint]": {
          const result = await bconnect.endpoints.startMacEndpointEnrollment(args!.id as string, createBody(route, args!));
          return toolJsonResult(withoutQrImage(result), { lead: `Mac endpoint ${args!.id} enrollment started:` });
        }

        case "create_logical_group": {
          const result = await bconnect.endpoints.createLogicalGroup(args! as never);
          return toolJsonResult(result);
        }

        case "update_logical_group": {
          const patch = changes("update_logical_group", args!); // checks the arguments before the client is built
          const result = await bconnect.endpoints.updateLogicalGroup(args!.id as string, patch);
          return toolJsonResult(result);
        }

        case "delete_logical_group": {
          await bconnect.endpoints.deleteLogicalGroup(args!.id as string);
          return { content: [{ type: "text", text: `Logical group ${args!.id} deleted successfully` }] };
        }

        case "create_maintenance_window_for_endpoint": {
          checkIntervalRule(args!, selectedRelease());
          const result = await bconnect.endpoints.createMaintenanceWindowForEndpoint(args!.id as string, createBody("create_maintenance_window_for_endpoint", args!));
          return toolJsonResult(result);
        }

        case "update_maintenance_window_for_endpoint": {
          checkIntervalRule(args!, selectedRelease());
          const patch = withIntervalRemoval(args!, changes(route, args!)); // checks the arguments before the client is built
          const result = await bconnect.endpoints.updateMaintenanceWindowForEndpoint(args!.id as string, patch);
          return toolJsonResult(result, { lead: `Maintenance window for endpoint ${args!.id} updated:` });
        }

        case "delete_maintenance_window_for_endpoint": {
          await bconnect.endpoints.deleteMaintenanceWindowForEndpoint(args!.id as string);
          return { content: [{ type: "text", text: `Maintenance window for endpoint ${args!.id} deleted successfully` }] };
        }

        case "create_maintenance_window_for_logical_group": {
          checkIntervalRule(args!, selectedRelease());
          const result = await bconnect.endpoints.createMaintenanceWindowForLogicalGroup(args!.id as string, createBody("create_maintenance_window_for_logical_group", args!));
          return toolJsonResult(result);
        }

        case "update_maintenance_window_for_logical_group": {
          checkIntervalRule(args!, selectedRelease());
          const patch = withIntervalRemoval(args!, changes("update_maintenance_window_for_logical_group", args!)); // checks the arguments before the client is built
          const result = await bconnect.endpoints.updateMaintenanceWindowForLogicalGroup(args!.id as string, patch);
          return toolJsonResult(result, { lead: `Maintenance window for logical group ${args!.id} updated:` });
        }

        case "delete_maintenance_window_for_logical_group": {
          await bconnect.endpoints.deleteMaintenanceWindowForLogicalGroup(args!.id as string);
          return { content: [{ type: "text", text: `Maintenance window for logical group ${args!.id} deleted successfully` }] };
        }

        case "list_endpoints[type=IndustrialEndpoint]": {
          const result = await bconnect.endpoints.listIndustrialEndpoints(pickArguments(args ?? {}, sends(route)));
          return toolJsonResult(result);
        }

        case "get_endpoint[type=IndustrialEndpoint]": {
          if (!args?.id) {throw new McpError(ErrorCode.InvalidParams, "id is required");}
          const result = await bconnect.endpoints.getIndustrialEndpoint(args.id as string);
          return toolJsonResult(result);
        }

        case "create_industrial_endpoint": {
          const result = await bconnect.endpoints.createIndustrialEndpoint(createBody("create_industrial_endpoint", args!));
          return { content: [{ type: "text", text: `Industrial endpoint created successfully. ID: ${result.id}` }] };
        }

        case "update_endpoint[type=IndustrialEndpoint]": {
          const patch = changes(route, args!); // checks the arguments before the client is built
          const result = await bconnect.endpoints.updateIndustrialEndpoint(args!.id as string, patch);
          return toolJsonResult(result, { lead: `Industrial endpoint ${args!.id} updated:` });
        }

        case "delete_endpoint[type=IndustrialEndpoint]": {
          await bconnect.endpoints.deleteIndustrialEndpoint(args!.id as string);
          return { content: [{ type: "text", text: `Industrial endpoint ${args!.id} deleted successfully` }] };
        }

        case "create_network_endpoint": {
          const result = await bconnect.endpoints.createNetworkEndpoint(createBody("create_network_endpoint", args!));
          return { content: [{ type: "text", text: `Network endpoint created successfully. ID: ${result.id}` }] };
        }

        case "update_endpoint[type=NetworkEndpoint]": {
          const patch = changes(route, args!); // checks the arguments before the client is built
          const result = await bconnect.endpoints.updateNetworkEndpoint(args!.id as string, patch);
          return toolJsonResult(result, { lead: `Network endpoint ${args!.id} updated:` });
        }

        case "delete_endpoint[type=NetworkEndpoint]": {
          await bconnect.endpoints.deleteNetworkEndpoint(args!.id as string);
          return { content: [{ type: "text", text: `Network endpoint ${args!.id} deleted successfully` }] };
        }

        case "delete_endpoint[type=]": {
          await bconnect.endpoints.deleteEndpoint(args!.id as string);
          return { content: [{ type: "text", text: `Endpoint ${args!.id} deleted successfully` }] };
        }

        // Phase 24: Network READ
        case "list_endpoints[type=NetworkEndpoint]": {
          const result = await bconnect.endpoints.listNetworkEndpoints(pickArguments(args ?? {}, sends(route)));
          return toolJsonResult(result);
        }

        case "get_endpoint[type=NetworkEndpoint]": {
          const result = await bconnect.endpoints.getNetworkEndpoint(args!.id as string);
          return toolJsonResult(result);
        }

        // Phase 24: Maintenance Window GET
        case "get_maintenance_window_for_endpoint": {
          const result = await bconnect.endpoints.getMaintenanceWindowForEndpoint(args!.id as string);
          return toolJsonResult(result);
        }

        case "get_maintenance_window_for_logical_group": {
          const result = await bconnect.endpoints.getMaintenanceWindowForLogicalGroup(args!.id as string);
          return toolJsonResult(result);
        }

        // Phase 24: 26R1-only tools
        case "list_unmanaged_endpoints": {
          const result = await bconnect.endpoints.listUnmanagedEndpoints();
          return toolJsonResult(result);
        }

        case "get_unmanaged_endpoint": {
          const result = await bconnect.endpoints.getUnmanagedEndpoint(args!.id as string);
          return toolJsonResult(result);
        }

        case "delete_unmanaged_endpoint": {
          await bconnect.endpoints.deleteUnmanagedEndpoint(args!.id as string);
          return { content: [{ type: "text", text: `Unmanaged endpoint ${args!.id} deleted successfully` }] };
        }

        case "get_entra_id_data": {
          const result = await bconnect.endpoints.getEntraIdData(args!.deviceId as string);
          return toolJsonResult(result);
        }

        case "link_entra_id_data": {
          const result = await bconnect.endpoints.linkEntraIdData(
            args!.endpointId as string,
            pickArguments(args!, ["entraIdDeviceId", "entraIdTenantId", "entraIdUserId"])
          );
          return toolJsonResult(result);
        }

        case "unlink_entra_id_data": {
          await bconnect.endpoints.unlinkEntraIdData(args!.endpointId as string);
          return { content: [{ type: "text", text: `EntraID data unlinked from endpoint ${args!.endpointId} successfully` }] };
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error: unknown) {
      // API errors, gate refusals and configuration errors are tool results the
      // model can read; only McpErrors stay protocol errors (REQ-XC-001).
      return toolErrorResult(error, release);
    }
  })));

  // ── Direct handler dispatch for testing ──────────────────────────────────
  //
  // Override server.request() so that tests can call
  //   server.request({ method: 'tools/list', params: {} }, {} as never)
  // and get the server's registered ListTools handler result directly,
  // without going through the transport or schema-validation layers.
  //
  // In production the real stdio transport is used (see main()), so this override
  // only affects test scenarios that call the exported createServer() factory.
  const originalRequest = server.request.bind(server);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).request = async (req: { method: string; params?: unknown }, _schema: unknown) => {
    const handlers = (server as unknown as { _requestHandlers: Map<string, (req: unknown) => Promise<unknown>> })._requestHandlers;
    const handler = handlers.get(req.method);
    if (handler) {
      return handler({ ...req, jsonrpc: '2.0', id: 0 });
    }
    return originalRequest(req as never, _schema as never);
  };

  return { server };
}

// ─── Main entrypoint ─────────────────────────────────────────────────────────

// ─── Entry point ─────────────────────────────────────────────────────────────

runServer({ name: "bconnect-endpoints-mcp", createServer, clients, releases: TOOL_RELEASES });
