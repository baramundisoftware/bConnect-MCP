#!/usr/bin/env node

/**
 * bconnect-servermanagement-mcp
 *
 * A Model Context Protocol server that provides access to the baramundi
 * bConnect REST API for Server Management — management server info,
 * microservices, security groups/profiles, API keys, and download jobs.
 *
 * Requires bConnect 26R1 or later. 25R2 is no longer supported. The seven
 * tools 26R1 added (list_api_keys, simulate_msw_cleanup, msw_cleanup,
 * list_download_jobs, get_download_job and their kin) used to be registered
 * only when BCONNECT_RELEASE=26R1 was set explicitly — this server's flag had
 * no default, so they were absent from the documented default posture. They
 * are unconditional now.
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
} from "@bconnect/mcp-core";
import { ServerManagementRules } from "./utils/mcp-tool-validation-rules.js";

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
      name: "bconnect-servermanagement-mcp",
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
  // The open annotation (rather than an inferred union) is deliberate: without
  // it TypeScript computes a best-common-type across every tool's inputSchema
  // and rejects any property no other tool happens to declare, which is a
  // structural reason a filter never gets added. See the D14b note on
  // list_download_jobs below. `name` is pinned because `defineToolCatalogue`
  // needs it to gate anything.

  const TOOLS: { name: string; [key: string]: unknown }[] = [

      // ── Server Information ────────────────────────────────────────────────
      {
        name: "get_management_server",
        description: "Get the baramundi Management Server's name, version, current operational state, and any planned restart times. Does NOT return a hostname or license information — the 200 response has neither field. For licensing, use list_microservices/get_microservice — and read its guidance on what a state can and cannot tell you.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "get_gateway",
        description: "Get the Gateway configuration and status for the baramundi Management Suite. Returns only configurationStatus, availability, and lastContact — NOT a hostname or other connection details; the 200 response declares no other fields.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "get_dip_status",
        description: "Get the status of all Distribution and Inventory Points (DIPs) configured in baramundi Management Suite. Returns a list of DIP servers with their synchronization status, availability, and operational state information.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "get_vpn_appliance",
        description: "Get the VPN Appliance configuration and status for the baramundi Management Suite. Returns only name and status — NOT a hostname or other connectivity information; the 200 response declares no other fields.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },

      // ── Microservices ─────────────────────────────────────────────────────
      {
        name: "list_microservices",
        description: "List all microservices registered and managed in the baramundi Management Suite. Returns each microservice's id, name, state, and message — NOT a version number; the 200 response has no version field. State is the reliable signal for AVAILABILITY, not for WHY. 'NotLicensed' and 'RunningNotLicensed' are the definitive licensing states. 'StoppedNotConfigured' is NOT one: measured on a live 26R1, 3 of 5 rows carrying it were unconfigured (an Apple push certificate, a VPP token) and 2 were licensing, so inferring 'unlicensed' from it is wrong more often than right. Treat any state other than 'Running' as 'this module is unavailable', quote 'message' verbatim as the operator's evidence, and do not claim the cause unless the state itself names it.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "get_microservice",
        description: "Get the details of a specific microservice by its GUID in baramundi Management Suite. Returns id, name, state, and message — NOT a version number; the 200 response has no version field.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the microservice to retrieve details for." }
          },
          required: ["id"]
        }
      },
      {
        name: "start_microservice",
        description: "Start a specific microservice identified by its GUID in baramundi Management Suite. Initiates the microservice startup process and requires server setting rights. Returns no content on successful start request.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the microservice to start." }
          },
          required: ["id"]
        }
      },
      {
        name: "stop_microservice",
        description: "Stop a specific microservice identified by its GUID in baramundi Management Suite. Initiates the microservice shutdown process and requires server setting rights. Returns no content on successful stop request.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the microservice to stop." }
          },
          required: ["id"]
        }
      },
      {
        name: "restart_microservice",
        description: "Restart a specific microservice identified by its GUID in baramundi Management Suite. Stops and restarts the microservice and requires server setting rights. Returns no content on successful restart request.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the microservice to restart." }
          },
          required: ["id"]
        }
      },

      // ── Infrastructure ────────────────────────────────────────────────────
      {
        name: "list_cloud_connectors",
        description: "List all Cloud Connectors configured in the baramundi Management Suite. Returns each connector's name and state only — NOT further configuration details; the 200 response declares no other fields.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "list_pxe_relays",
        description: "List all PXE Relay servers configured in the baramundi Management Suite. Returns each relay's name and state only — NOT an IP address; the 200 response declares no other fields.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },

      // ── Security Groups ───────────────────────────────────────────────────
      {
        name: "list_security_groups",
        description: "List all Security Groups defined in the baramundi Management Suite. Returns a paged list with each group's id, groupName, and assignedSecurityProfiles — NOT a member list or a permission breakdown; the 200 response declares neither. Permissions live per-object at get_access_rights. Mind the naming: the response field is `groupName`, but the exact-match filter below is `Name` and the creation body takes `name`. Reading `row.name` off a result yields undefined rather than an error.",
        inputSchema: {
          type: "object",
          properties: {
            OrderBy: { type: "string", description: "Sort by property name and direction." },
            SearchQuery: { type: "string", description: "Filter results by searchable properties." },
            ...pageProperties,
            ...exactMatchFilter("Name"),
            ...countOnlyProperty,
          },
          required: []
        }
      },
      {
        name: "get_security_group",
        description: "Get the details of a specific Security Group by its GUID in baramundi Management Suite. Returns the group's id, groupName and assignedSecurityProfiles — NOT a member list or a permission breakdown; the 200 response declares neither. Permissions live per-object at get_access_rights. The response field is `groupName`, not `name`; reading `.name` yields undefined rather than an error.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the security group to retrieve." }
          },
          required: ["id"]
        }
      },
      {
        name: "create_security_group",
        description: "Create a new Security Group in baramundi Management Suite. Accepts name (required) and profiles, an array of security-profile ids — the 26R1 SecurityGroupForCreation body declares no other fields and no member list, and rejects unknown keys. Returns id, groupName and assignedSecurityProfiles. Mind the naming: the body takes `name`, but the response calls it `groupName`.",
        inputSchema: {
          type: "object",
          properties: {
            groupData: {
              type: "object",
              description: "Security group creation data.",
              properties: {
                name: { type: "string", description: "Group name, 1-255 characters." },
                profiles: {
                  type: "array",
                  items: { type: "string" },
                  description: "Security-profile GUIDs to assign. From list_security_profiles."
                }
              },
              required: ["name"]
            }
          },
          required: ["groupData"]
        }
      },
      {
        name: "update_security_group",
        description: "Update an existing Security Group using a JSON Patch document in baramundi Management Suite. The patchable properties are name and profiles — the 26R1 schema declares no description and no member list, so a patch naming either has no path to target.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the security group to update." },
            patchOperations: { type: "array", description: "JSON Patch operations array with op, path, and value fields." }
          },
          required: ["id", "patchOperations"]
        }
      },
      {
        name: "delete_security_group",
        description: "Delete a Security Group by its GUID from baramundi Management Suite. Permanently removes the specified security group. Returns no content on successful deletion of the security group.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the security group to delete." }
          },
          required: ["id"]
        }
      },

      // ── Security Profiles ─────────────────────────────────────────────────
      {
        name: "list_security_profiles",
        description: "List all Security Profiles defined in the baramundi Management Suite. Returns a paged list with each profile's id, name, comment, and the administrator/endpoint-user identities it is displayed to — NOT a permission breakdown; the 200 response declares no permission list.",
        inputSchema: {
          type: "object",
          properties: {
            OrderBy: { type: "string", description: "Sort by property name and direction." },
            SearchQuery: { type: "string", description: "Filter results by searchable properties." },
            ...pageProperties,
            ...exactMatchFilter("Name"),
            ...countOnlyProperty,
          },
          required: []
        }
      },
      {
        name: "get_security_profile",
        description: "Get the details of a specific Security Profile by its GUID in baramundi Management Suite. Returns profile id, name, comment, and the administrator/endpoint-user identities it is displayed to — NOT a permission breakdown; the 200 response declares no permission list. Permissions live per-object at get_access_rights.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the security profile to retrieve." }
          },
          required: ["id"]
        }
      },
      {
        name: "create_security_profile",
        description: "Create a new Security Profile in baramundi Management Suite. Accepts name (required), comment, displayAdministratorIdentities and displayEndpointUserIdentities — the 26R1 SecurityProfileForCreation body declares no other fields and rejects unknown keys. It carries NO permission settings: permissions live per-object at update_object_permission. Returns id, name, comment and the two identity lists.",
        inputSchema: {
          type: "object",
          properties: {
            profileData: {
              type: "object",
              description: "Security profile creation data.",
              properties: {
                name: { type: "string", description: "Profile name." },
                comment: { type: "string", description: "Free-text comment. This is the field a 'description' belongs in." },
                displayAdministratorIdentities: {
                  type: "array",
                  items: { type: "string" },
                  description: "Identities the profile is displayed to as administrators."
                },
                displayEndpointUserIdentities: {
                  type: "array",
                  items: { type: "string" },
                  description: "Identities the profile is displayed to as endpoint users."
                }
              },
              required: ["name"]
            }
          },
          required: ["profileData"]
        }
      },
      {
        name: "update_security_profile",
        description: "Update an existing Security Profile using a JSON Patch document in baramundi Management Suite. The patchable properties are name, comment, displayAdministratorIdentities and displayEndpointUserIdentities — the 26R1 schema declares no description and no permission list, so a patch naming either has no path to target. Permissions live per-object at update_object_permission.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the security profile to update." },
            patchOperations: { type: "array", description: "JSON Patch operations array with op, path, and value fields." }
          },
          required: ["id", "patchOperations"]
        }
      },
      {
        name: "delete_security_profile",
        description: "Delete a Security Profile by its GUID from baramundi Management Suite. Permanently removes the specified security profile. Returns no content on successful deletion of the security profile.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the security profile to delete." }
          },
          required: ["id"]
        }
      },

      // ── Object Permissions ────────────────────────────────────────────────
      {
        name: "get_access_rights",
        description: "Get the object permissions and access rights for a specific object identified by its GUID in baramundi Management Suite. Returns permission assignments including read, modify, delete, and specialized operation rights.",
        inputSchema: {
          type: "object",
          properties: {
            objectId: { type: "string", description: "GUID of the object to retrieve access rights for." }
          },
          required: ["objectId"]
        }
      },
      {
        name: "update_object_permission",
        description: "Update the object permissions for a specific object using a JSON Patch document in baramundi Management Suite. Applies patch operations to modify permission assignments for the specified managed object.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the object to update permissions for." },
            patchOperations: { type: "array", description: "JSON Patch operations array with op, path, and value fields." }
          },
          required: ["id", "patchOperations"]
        }
      },

      // ── Server Restart ────────────────────────────────────────────────────
      {
        name: "restart_management_server",
        // INT4-11f — the 26R1 route declares utcScheduleRestartTime (ISO 8601)
        // to SCHEDULE the restart; this tool cannot offer it yet because the
        // module method it calls (modules/servermanagement.ts,
        // restartManagementServer()) takes no parameters and does not forward
        // one to POST /v2.0/Restart. Flagged, not silently promised: adding
        // the parameter to the schema without the module honouring it would
        // be worse than this gap — a caller who supplies it would have it
        // silently discarded and get an immediate restart anyway.
        description: "Restart the baramundi Management Server. Requires server setting rights. This call ALWAYS restarts the server IMMEDIATELY — every connected client and every running job is interrupted. This MCP server does not currently support scheduling a restart (the underlying bConnect route accepts a utcScheduleRestartTime parameter that is not exposed here); schedule one from the bMS console instead. cancel_scheduled_restart withdraws a restart scheduled that way; get_management_server reports plannedServerRestartTimes.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "cancel_scheduled_restart",
        description: "Cancel a previously scheduled restart of the baramundi Management Server. Cancels any pending restart operation and requires server setting rights. Returns no content on successful cancellation.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },

  ];

  // ── Tools added in 26R1 ───────────────────────────────────────────────
  //
  // Decision 2 — this block used to sit inside `if (is26R1)`, and this
  // server's flag was `process.env.BCONNECT_RELEASE === '26R1'` with no
  // default, unlike the other four. So these seven tools were hidden in the
  // documented default posture: an operator who never set BCONNECT_RELEASE
  // simply did not have list_api_keys, msw_cleanup or the download jobs.
  {
    TOOLS.push(
      {
        name: "list_api_keys",
        description: "List all API keys configured in the baramundi Management Suite. Returns each key's name, expirationDate, comment, isActive, isAvailableViaGateway, and assigned security profiles. Does NOT return a creation date — the 200 response has no such field; use expirationDate/isActive to find keys that are expiring or already inactive.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "simulate_msw_cleanup",
        description: "Simulate a Managed Software Wizard (MSW) cleanup of the MASTER DIP's managed software files (not a named branch DIP — this route takes no DIP id and always targets the Master DIP). Makes no changes, but the 200 body is NOT a boolean: it returns the list of files that WOULD be deleted — read the response. Answers HTTP 423 if a simulation or cleanup is already running.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "msw_cleanup",
        description: "Execute a Managed Software Wizard (MSW) cleanup of the MASTER DIP's managed software files (not a named branch DIP — this route takes no DIP id and always targets the Master DIP). Removes obsolete managed software packages. The 200 body carries wasSuccessful — read it; false means the cleanup did NOT complete. Answers HTTP 423 if a simulation or cleanup is already running. Use with caution.",
        inputSchema: { type: "object", properties: {}, required: [] }
      },
      {
        name: "list_download_jobs",
        description: "List all download jobs configured and queued in the baramundi Management Suite. Returns each job's id, name, interval, lastExecution, lastUpdate, stateValue/stateMessage, url, and localPathName — NOT a progress percentage, target package list, or distribution details; the 200 response has none of those.",
        // LOCAL FIX — D14b / D3. GET /v2.0/DownloadJobs declares OrderBy,
        // SearchQuery, Name, StateValue, LastExecution, Page and PageSize
        // (operations.GetDownloadJobs in
        // src/generated/servermanagement-types.ts); the tool declared none of
        // them and the module method accepted none, so the whole list came
        // back unfiltered and only ever page 0.
        inputSchema: {
          type: "object",
          properties: {
            SearchQuery: { type: "string", description: "Filters results by matching the given value against searchable properties. Searchable values are Name and LocalPathName." },
            OrderBy: { type: "string", description: "Sorts results by property name and sort direction. Possible values are Name or LastExecution (e.g. 'Name asc')." },
            Name: { type: "string", description: "Filters result by matching the exact value against Name." },
            StateValue: { type: "string", enum: ["Unknown","Running","Success","Error","RescheduledSuccess","RescheduledError"], description: "Filters result by matching StateValue." },
            LastExecution: { type: "string", description: "Filters on lastExecution. ISO 8601, optionally prefixed 'lt' or 'gt' (e.g. 'gt 2023-07-28T08:01:03.375Z')." },
            ...pageProperties,
            ...countOnlyProperty,
          },
          required: []
        }
      },
      {
        name: "get_download_job",
        description: "Get the details of a specific download job identified by its GUID in baramundi Management Suite. Returns id, name, interval, lastExecution, lastUpdate, stateValue/stateMessage, url, and localPathName — NOT a progress percentage or target package details; the 200 response has neither.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the download job to retrieve details for." }
          },
          required: ["id"]
        }
      }
    );
  }

  const catalogue = defineToolCatalogue({
    tools: TOOLS,
    write: [
      "start_microservice",
      "stop_microservice",
      "restart_microservice",
      "create_security_group",
      "update_security_group",
      "delete_security_group",
      "create_security_profile",
      "update_security_profile",
      "delete_security_profile",
      "update_object_permission",
      "restart_management_server",
      "cancel_scheduled_restart",
      // Naming a write that is absent from `tools` is a hard error in
      // defineToolCatalogue (the F21 drift class); these used to be spread in
      // conditionally for that reason, and are now always present.
      "simulate_msw_cleanup",
      "msw_cleanup",
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
      // Server Information
      case "get_management_server":
        validateOrThrow(args, ServerManagementRules.getManagementServer()); return;
      case "get_gateway":
        validateOrThrow(args, ServerManagementRules.getGateway()); return;
      case "get_dip_status":
        validateOrThrow(args, ServerManagementRules.getDipStatus()); return;
      case "get_vpn_appliance":
        validateOrThrow(args, ServerManagementRules.getVpnAppliance()); return;
      // Microservices
      case "list_microservices":
        validateOrThrow(args, ServerManagementRules.listMicroservices()); return;
      case "get_microservice":
        validateOrThrow(args, ServerManagementRules.getMicroservice()); return;
      case "start_microservice":
        validateOrThrow(args, ServerManagementRules.startMicroservice()); return;
      case "stop_microservice":
        validateOrThrow(args, ServerManagementRules.stopMicroservice()); return;
      case "restart_microservice":
        validateOrThrow(args, ServerManagementRules.restartMicroservice()); return;
      // Infrastructure
      case "list_cloud_connectors":
        validateOrThrow(args, ServerManagementRules.listCloudConnectors()); return;
      case "list_pxe_relays":
        validateOrThrow(args, ServerManagementRules.listPxeRelays()); return;
      // Security Groups
      case "list_security_groups":
        validateOrThrow(args, ServerManagementRules.listSecurityGroups()); return;
      case "get_security_group":
        validateOrThrow(args, ServerManagementRules.getSecurityGroup()); return;
      case "create_security_group":
        validateOrThrow(args, ServerManagementRules.createSecurityGroup()); return;
      case "update_security_group":
        validateOrThrow(args, ServerManagementRules.updateSecurityGroup()); return;
      case "delete_security_group":
        validateOrThrow(args, ServerManagementRules.deleteSecurityGroup()); return;
      // Security Profiles
      case "list_security_profiles":
        validateOrThrow(args, ServerManagementRules.listSecurityProfiles()); return;
      case "get_security_profile":
        validateOrThrow(args, ServerManagementRules.getSecurityProfile()); return;
      case "create_security_profile":
        validateOrThrow(args, ServerManagementRules.createSecurityProfile()); return;
      case "update_security_profile":
        validateOrThrow(args, ServerManagementRules.updateSecurityProfile()); return;
      case "delete_security_profile":
        validateOrThrow(args, ServerManagementRules.deleteSecurityProfile()); return;
      // Object Permissions
      case "get_access_rights":
        validateOrThrow(args, ServerManagementRules.getAccessRights()); return;
      case "update_object_permission":
        validateOrThrow(args, ServerManagementRules.updateObjectPermission()); return;
      // Server Restart
      case "restart_management_server":
        validateOrThrow(args, ServerManagementRules.restartManagementServer()); return;
      case "cancel_scheduled_restart":
        validateOrThrow(args, ServerManagementRules.cancelScheduledRestart()); return;
      // 26R1-only
      case "list_api_keys":
        validateOrThrow(args, ServerManagementRules.listApiKeys()); return;
      case "simulate_msw_cleanup":
        validateOrThrow(args, ServerManagementRules.simulateMswCleanup()); return;
      case "msw_cleanup":
        validateOrThrow(args, ServerManagementRules.mswCleanup()); return;
      case "list_download_jobs":
        validateOrThrow(args, ServerManagementRules.listDownloadJobs()); return;
      case "get_download_job":
        validateOrThrow(args, ServerManagementRules.getDownloadJob()); return;
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
    // (BCONNECT_API_KEY__SERVERMANAGEMENT); with no such variable set this
    // changes nothing. See mcp-core/server-scoped-credentials.ts.
    serverName: "bconnect-servermanagement-mcp",
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

    // 3. Secret-read gate — finding D1.
    //
    // `list_api_keys` issues GET /servermanagement/v2.0/ApiKeys, which returns
    // the bMS API-key inventory. It was the one genuinely credential-returning
    // route in the suite that neither gate covered: it matched neither
    // SECURITY_SENSITIVE_ROUTES (so it was not audited) nor
    // CREDENTIAL_RETURNING_ROUTES (so it was not blocked). The round-1
    // traversal exploit retrieved exactly this inventory; traversal is closed
    // by path-guard.ts, but the legitimate route was still open.
    //
    // This is the outer, tool-name layer — the same shape bconnect-defensecontrol-mcp
    // uses, and it answers with a readable isError result rather than the
    // transport's -32600. The route-table half (adding /ApiKeys to both sets in
    // packages/mcp-core/src/security-routes.ts) belongs to mcp-core and is
    // handed off; when it lands, this layer answers first and the transport
    // layer backs it up for any caller that reaches the route another way.
    if (name === "list_api_keys" && process.env.ALLOW_SECRET_READ !== "true") {
      return {
        content: [{
          type: "text" as const,
          text: `Secret-returning operation '${name}' is disabled because it returns the bMS API-key inventory. Set ALLOW_SECRET_READ=true to enable it.`
        }],
        isError: true
      };
    }


    try {
      const bconnect = getBconnect();
      const sm = bconnect.serverManagement;

      // Dispatch — arguments already validated by validateToolArguments above.
      switch (name) {

        case "get_management_server": {
          const result = await sm.getManagementServer();
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "get_gateway": {
          const result = await sm.getGateway();
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "get_dip_status": {
          const result = await sm.getDipStatus();
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "get_vpn_appliance": {
          const result = await sm.getVpnAppliance();
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        // ── Response shaping: examined 2026-08-13 and deliberately NOT done ──
        //
        // It topped the remaining response-byte backlog at 9,376 B, and it does
        // not pay. Recorded so the next reader does not re-derive it — the
        // kiosk-release arm in bconnect-jobs-mcp carries the same note for the
        // same reason, and this reader arrived here because a ranking table
        // said "9,348 B" without saying what the bytes were made of.
        //
        // Whole population, one call: 79 rows, FOUR columns, 118 B/row.
        //   id       3,160 B (33.7%)  79/79 distinct
        //   name     1,863 B (19.9%)  79/79 distinct
        //   message  1,863 B (19.9%)  null on 59/79, 15 distinct
        //   state    1,184 B (12.6%)  4 distinct (Running=72 + 7 others)
        //
        // It is large because there are 79 microservices, not because the rows
        // are fat. Nothing here is a projection candidate:
        //
        //   * `id` is the biggest column AND the declared id-producer for four
        //     tools — get/start/stop/restart_microservice (id-producers.ts).
        //     Dropping it by default would break that documented chain and put
        //     a `detail:true` round trip in front of every service restart.
        //   * `name` and `state` are the question this tool answers.
        //   * `message` is null on 59 rows, which is the only real slack
        //     (~944 B, ~10%) — but this tool's own description tells a caller to
        //     "quote `message` verbatim as the operator's evidence", so it is
        //     load-bearing on exactly the rows that carry it.
        //   * `dropConstantColumns` finds nothing: no column is single-valued.
        //
        // And the structural blocker, which is decisive on its own: this route
        // returns a BARE ARRAY (`getMicroservices(): Promise<Microservice[]>`),
        // not the paged envelope. `createListShaper` requires
        // `Array.isArray(payload.data)` and returns the payload untouched
        // otherwise, so it cannot apply here at all — and a bare array has
        // nowhere to carry the `meta` block that every projection in this suite
        // uses to say what it removed. Taking the 10% would mean either
        // dropping without disclosure, which this suite does not do, or
        // reshaping the response of a tool four others resolve ids through.
        case "list_microservices": {
          const result = await sm.getMicroservices();
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "get_microservice": {
          const result = await sm.getMicroservice(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        // ── Start and Restart are ASYNCHRONOUS; Stop is not ─────────────────
        // The spec's own 200 descriptions draw the line and these arms used to
        // ignore it: Start is "Microservice starting.", Restart is
        // "Microservice restarting.", Stop is "Microservice stopped." Two are
        // in progress, one is done — and all three routes return no body, so
        // nothing is read back either way.
        //
        // The old text asserted the completion the API declined to assert. A
        // microservice failing to come up is precisely why an operator runs
        // this, and `list_microservices` warns that any state other than
        // Running means the module is unavailable — told "started
        // successfully", nobody goes and looks. Same class as the msw_cleanup
        // constant fixed on 2026-08-11, two arms of this switch further down.
        //
        // Deliberately NOT read back with get_microservice: an immediate read
        // races the transition just requested and would report "Starting" — or
        // still "Stopped" — as though that were the outcome. Naming the
        // boundary and the tool that settles it beats inventing a result.
        case "start_microservice": {
          await sm.startMicroservice(args!.id as string);
          return {
            content: [{
              type: "text",
              text:
                "Start REQUEST accepted. The route returns no body, so this call read nothing " +
                "back and the outcome is not established here — bConnect documents this response " +
                "as 'starting', not 'started'. Confirm with get_microservice: 'Starting' is the " +
                "expected state for the first few seconds and is NOT a failure; 'Running' " +
                "confirms it came up; 'Stopped', 'Warning' or 'NotLicensed' mean it did not. " +
                "Quote the row's own message as the evidence rather than inferring a cause.",
            }],
          };
        }

        case "stop_microservice": {
          // Left asserting completion on purpose: the spec's 200 here is
          // "Microservice stopped." — past tense. Hedging this one would trade
          // a false claim for a false doubt, which is its own inaccuracy.
          await sm.stopMicroservice(args!.id as string);
          return { content: [{ type: "text", text: "Microservice stopped." }] };
        }

        case "restart_microservice": {
          await sm.restartMicroservice(args!.id as string);
          return {
            content: [{
              type: "text",
              text:
                "Restart REQUEST accepted. The route returns no body, so this call read nothing " +
                "back and the outcome is not established here — bConnect documents this response " +
                "as 'restarting', not 'restarted'. Confirm with get_microservice: 'Stopping' and " +
                "'Starting' are expected transients and are NOT failures; 'Running' confirms it " +
                "came back; 'Stopped', 'Warning' or 'NotLicensed' mean it did not. Quote the " +
                "row's own message as the evidence rather than inferring a cause.",
            }],
          };
        }

        case "list_cloud_connectors": {
          const result = await sm.getCloudConnectors();
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_pxe_relays": {
          const result = await sm.getPxeRelays();
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_security_groups": {
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((q) => sm.getSecurityGroups(q as never), args);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await sm.getSecurityGroups(apiParams(args) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "get_security_group": {
          const result = await sm.getSecurityGroup(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "create_security_group": {
          const result = await sm.createSecurityGroup(args!.groupData as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "update_security_group": {
          // ARCH-2: was `{ success: true }` beside a 200 that returns the NEW
          // values. A JSON-Patch that quietly failed to apply produced the same
          // answer as one that applied — on a permissions surface.
          const updated = await sm.updateSecurityGroup(args!.id as string, args!.patchOperations as never);
          return { content: [{ type: "text", text: serializeToolResult(updated) }] };
        }

        case "delete_security_group": {
          await sm.deleteSecurityGroup(args!.id as string);
          return { content: [{ type: "text", text: "Security group deleted successfully." }] };
        }

        case "list_security_profiles": {
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((q) => sm.getSecurityProfiles(q as never), args);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await sm.getSecurityProfiles(apiParams(args) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "get_security_profile": {
          const result = await sm.getSecurityProfile(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "create_security_profile": {
          const result = await sm.createSecurityProfile(args!.profileData as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "update_security_profile": {
          // ARCH-2: was `{ success: true }` beside a 200 that returns the NEW
          // values. A JSON-Patch that quietly failed to apply produced the same
          // answer as one that applied — on a permissions surface.
          const updated = await sm.updateSecurityProfile(args!.id as string, args!.patchOperations as never);
          return { content: [{ type: "text", text: serializeToolResult(updated) }] };
        }

        case "delete_security_profile": {
          await sm.deleteSecurityProfile(args!.id as string);
          return { content: [{ type: "text", text: "Security profile deleted successfully." }] };
        }

        case "get_access_rights": {
          const result = await sm.getAccessRights(args!.objectId as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "update_object_permission": {
          // ARCH-2: was `{ success: true }` beside a 200 that returns the NEW
          // values. A JSON-Patch that quietly failed to apply produced the same
          // answer as one that applied — on a permissions surface.
          const updated = await sm.updateObjectPermission(args!.id as string, args!.patchOperations as never);
          return { content: [{ type: "text", text: serializeToolResult(updated) }] };
        }

        case "restart_management_server": {
          // ARCH-2: the 200 is a date-time described as "Restart time of the
          // management server", and this said "restart initiated" — asserting an
          // IMMEDIATE restart the response never claims. If the server SCHEDULES
          // it, that timestamp is the only thing that says so.
          const restartTime = await sm.restartManagementServer();
          return {
            content: [
              {
                type: "text",
                text: serializeToolResult({
                  accepted: true,
                  restartTime: restartTime ?? null,
                  note: restartTime
                    ? `The management server reports its restart time as ${restartTime}. Read that as ` +
                      `the answer — it may be scheduled rather than immediate.`
                    : `The API accepted the restart and returned no time, although this route declares ` +
                      `one. Do not assume the server has restarted; check it.`,
                }),
              },
            ],
          };
        }

        case "cancel_scheduled_restart": {
          await sm.cancelScheduledRestart();
          return { content: [{ type: "text", text: "Scheduled restart cancelled." }] };
        }

        // ── 26R1-only tools ───────────────────────────────────────────────

        case "list_api_keys": {
          const result = await sm.getApiKeys();
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "simulate_msw_cleanup": {
          // The description says "read the response" — until 2026-08-11 the
          // arm returned a constant string and the filesToDelete[] list the
          // simulation exists to produce was discarded. Pinned by
          // msw-cleanup-honesty.test.ts through the real handler.
          const result = await sm.simulateMSWCleanup();
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "msw_cleanup": {
          // The 200 carries wasSuccessful. The pre-2026-08-11 constant
          // "MSW cleanup executed." asserted the one thing a false answer
          // denies — the verify-install exit-0 class.
          const result = await sm.mswCleanup();
          const text = result.wasSuccessful === false
            ? `Cleanup reported wasSuccessful:false — it did NOT complete. ${serializeToolResult(result)}`
            : serializeToolResult(result);
          return { content: [{ type: "text", text }] };
        }

        case "list_download_jobs": {
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((q) => sm.getDownloadJobs(q as never), args);
            return toolTextResult(serializeToolResult(count));
          }
          // LOCAL FIX — D14b / D3: forward the declared filters and paging.
          const result = await sm.getDownloadJobs(apiParams(args) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "get_download_job": {
          const result = await sm.getDownloadJob(args!.id as string);
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
    name: "bconnect-servermanagement-mcp",
    createServer,
    http: { express },
  }).catch((error) => {
    console.error(`Fatal error: ${describeConnectionFailure(error)}`);
    process.exit(1);
  });
}
