#!/usr/bin/env node

/**
 * bconnect-activedirectory-mcp
 *
 * A Model Context Protocol server that provides access to the baramundi
 * bConnect REST API for Active Directory management — AD groups, users,
 * objects, and organizational units synchronized via AD sync.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import * as dotenv from "dotenv";
import { BConnectClient } from "./bconnect-client.js";
import { validateOrThrow, clientConfigFromEnv, ClientConfigError, toolErrorResult, lazyClient, pickArguments, declaredArgumentsOnly, queryParameters, withQueryProperties } from "@bconnect/mcp-core";
import { QUERY_PARAMETERS } from "./query-params.js";

/** The query parameters a list tool sends: exactly what its route declares in the selected release (#179). */
const sends = (tool: string): string[] => queryParameters(QUERY_PARAMETERS, process.env.BCONNECT_RELEASE, tool);
import type { BConnectConfig, BConnectCredentials } from "@bconnect/mcp-core";
import { ActiveDirectoryRules } from "./utils/mcp-tool-validation-rules.js";

// ─── Factory exported for testing ───────────────────────────────────────────

export type { BConnectCredentials } from "@bconnect/mcp-core";

export function createServer(credentials?: BConnectCredentials): { server: Server } {
  const server = new Server(
    {
      name: "bconnect-activedirectory-mcp",
      version: "26.1.7"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // ── ListToolsRequestSchema handler ────────────────────────────────────────

  const toolCatalog = declaredArgumentsOnly(withQueryProperties(QUERY_PARAMETERS, () => process.env.BCONNECT_RELEASE, async () => {
    return {
      tools: [

        // ── AD Groups ─────────────────────────────────────────────────────
        {
          name: "list_ad_groups",
          description: "List all Active Directory groups synchronized into baramundi Management Suite. Returns a paged list of AD groups with their GUIDs, names, domains, SIDs, and types. Use this to browse all available AD groups before querying specific ones.",
          inputSchema: {
            type: "object",
            properties: {},
            required: []
          }
        },

        {
          name: "get_ad_group",
          description: "Get detailed information for a specific Active Directory group by its GUID. Returns the AD group name, domain, SID, type, comment, and GUID in Active Directory. Use list_ad_groups to discover group GUIDs.",
          inputSchema: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "GUID of the AD group to retrieve."
              }
            },
            required: ["id"]
          }
        },

        {
          name: "list_ad_subgroups",
          description: "List all Active Directory sub-groups (nested groups) directly contained within a specific parent AD group. Returns a paged list of AD groups belonging to the given parent group GUID. Use get_ad_group to find the parent group GUID first.",
          inputSchema: {
            type: "object",
            properties: {
              adGroupId: {
                type: "string",
                description: "GUID of the parent AD group whose sub-groups to list."
              }
            },
            required: ["adGroupId"]
          }
        },

        {
          name: "list_ad_groups_by_org_unit",
          description: "List all Active Directory groups contained within a specific organizational unit (OU). Returns a paged list of AD groups scoped to the given OU GUID. Use list_org_units to find the OU GUID first.",
          inputSchema: {
            type: "object",
            properties: {
              orgUnitId: {
                type: "string",
                description: "GUID of the organizational unit whose AD groups to list."
              }
            },
            required: ["orgUnitId"]
          }
        },

        // ── AD Objects ────────────────────────────────────────────────────
        {
          name: "list_ad_objects",
          description: "List all Active Directory objects (both users and groups) synchronized into baramundi. Returns a paged list of AD objects with their GUIDs, names, domains, and types. Use this when you need a combined view of AD users and groups.",
          inputSchema: {
            type: "object",
            properties: {},
            required: []
          }
        },

        {
          name: "get_ad_object",
          description: "Get detailed information for a specific Active Directory object (user or group) by its GUID. Returns the AD object name, domain, SID, type, and related attributes. Use list_ad_objects to discover object GUIDs.",
          inputSchema: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "GUID of the AD object to retrieve."
              }
            },
            required: ["id"]
          }
        },

        {
          name: "list_ad_object_memberships",
          description: "List all Active Directory groups that a specific AD object (user or group) is a member of. Returns a paged list of AD group memberships for the given object GUID. Useful for auditing group membership and access rights.",
          inputSchema: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "GUID of the AD object whose group memberships to retrieve."
              }
            },
            required: ["id"]
          }
        },

        {
          name: "list_ad_objects_by_group",
          description: "List all Active Directory objects (users and groups) that are direct members of a specific AD group. Returns a paged list of AD objects for the given group GUID. Use get_ad_group to find the group GUID first.",
          inputSchema: {
            type: "object",
            properties: {
              adGroupId: {
                type: "string",
                description: "GUID of the AD group whose member objects to list."
              }
            },
            required: ["adGroupId"]
          }
        },

        {
          name: "list_ad_objects_by_org_unit",
          description: "List all Active Directory objects (users and groups) contained within a specific organizational unit. Returns a paged list of AD objects scoped to the given OU GUID. Use list_org_units to find the OU GUID first.",
          inputSchema: {
            type: "object",
            properties: {
              orgUnitId: {
                type: "string",
                description: "GUID of the organizational unit whose AD objects to list."
              }
            },
            required: ["orgUnitId"]
          }
        },

        // ── AD Users ──────────────────────────────────────────────────────
        {
          name: "list_ad_users",
          description: "List all Active Directory users synchronized into baramundi Management Suite. Returns a paged list of AD users with their GUIDs, names, domains, SIDs, and logon names. Use this to browse available AD users before querying specific ones.",
          inputSchema: {
            type: "object",
            properties: {},
            required: []
          }
        },

        {
          name: "get_ad_user",
          description: "Get detailed information for a specific Active Directory user by their GUID. Returns the AD user name, domain, SID, logon name, email, and other synchronized attributes. Use list_ad_users to discover user GUIDs.",
          inputSchema: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "GUID of the AD user to retrieve."
              }
            },
            required: ["id"]
          }
        },

        {
          name: "list_ad_users_by_group",
          description: "List all Active Directory users who are direct members of a specific AD group. Returns a paged list of AD users belonging to the given group GUID. Use list_ad_groups or get_ad_group to find the group GUID first.",
          inputSchema: {
            type: "object",
            properties: {
              adGroupId: {
                type: "string",
                description: "GUID of the AD group whose member users to list."
              }
            },
            required: ["adGroupId"]
          }
        },

        {
          name: "list_ad_users_by_org_unit",
          description: "List all Active Directory users contained within a specific organizational unit. Returns a paged list of AD users scoped to the given OU GUID. Use list_org_units to discover the OU GUID first.",
          inputSchema: {
            type: "object",
            properties: {
              orgUnitId: {
                type: "string",
                description: "GUID of the organizational unit whose AD users to list."
              }
            },
            required: ["orgUnitId"]
          }
        },

        // ── Org Units ─────────────────────────────────────────────────────
        {
          name: "list_org_units",
          description: "List all Active Directory organizational units (OUs) synchronized into baramundi Management Suite. Returns a paged list of OUs with their GUIDs, names, distinguished names, and domains. Use this to browse the AD OU hierarchy.",
          inputSchema: {
            type: "object",
            properties: {},
            required: []
          }
        },

        {
          name: "get_org_unit",
          description: "Get detailed information for a specific Active Directory organizational unit by its GUID. Returns the OU name, domain, distinguished name, and GUID. Use list_org_units to discover OU GUIDs.",
          inputSchema: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "GUID of the organizational unit to retrieve."
              }
            },
            required: ["id"]
          }
        },

        {
          name: "list_org_units_by_org_unit",
          description: "List all child organizational units (OUs) directly contained within a specific parent OU. Returns a paged list of sub-OUs for the given parent OU GUID. Use list_org_units to find the parent OU GUID first.",
          inputSchema: {
            type: "object",
            properties: {
              orgUnitId: {
                type: "string",
                description: "GUID of the parent organizational unit whose child OUs to list."
              }
            },
            required: ["orgUnitId"]
          }
        }

      ]
    };
  }));
  server.setRequestHandler(ListToolsRequestSchema, toolCatalog.list);

  // ── CallToolRequestSchema handler ─────────────────────────────────────────

  // ── Argument-validation pre-pass (runs before getBconnect) ─────────────────
  function validateToolArguments(name: string, args: Record<string, unknown> | undefined): void {
    switch (name) {
      // AD Groups
      case "list_ad_groups":
        validateOrThrow(args, ActiveDirectoryRules.listAdGroups()); return;
      case "get_ad_group":
        validateOrThrow(args, ActiveDirectoryRules.getAdGroup()); return;
      case "list_ad_subgroups":
        validateOrThrow(args, ActiveDirectoryRules.listAdSubgroups()); return;
      case "list_ad_groups_by_org_unit":
        validateOrThrow(args, ActiveDirectoryRules.listAdGroupsByOrgUnit()); return;
      // AD Objects
      case "list_ad_objects":
        validateOrThrow(args, ActiveDirectoryRules.listAdObjects()); return;
      case "get_ad_object":
        validateOrThrow(args, ActiveDirectoryRules.getAdObject()); return;
      case "list_ad_object_memberships":
        validateOrThrow(args, ActiveDirectoryRules.listAdObjectMemberships()); return;
      case "list_ad_objects_by_group":
        validateOrThrow(args, ActiveDirectoryRules.listAdObjectsByGroup()); return;
      case "list_ad_objects_by_org_unit":
        validateOrThrow(args, ActiveDirectoryRules.listAdObjectsByOrgUnit()); return;
      // AD Users
      case "list_ad_users":
        validateOrThrow(args, ActiveDirectoryRules.listAdUsers()); return;
      case "get_ad_user":
        validateOrThrow(args, ActiveDirectoryRules.getAdUser()); return;
      case "list_ad_users_by_group":
        validateOrThrow(args, ActiveDirectoryRules.listAdUsersByGroup()); return;
      case "list_ad_users_by_org_unit":
        validateOrThrow(args, ActiveDirectoryRules.listAdUsersByOrgUnit()); return;
      // Org Units
      case "list_org_units":
        validateOrThrow(args, ActiveDirectoryRules.listOrgUnits()); return;
      case "get_org_unit":
        validateOrThrow(args, ActiveDirectoryRules.getOrgUnit()); return;
      case "list_org_units_by_org_unit":
        validateOrThrow(args, ActiveDirectoryRules.listOrgUnitsByOrgUnit()); return;
      // Unknown tool names are not validated here; dispatch handles MethodNotFound.
    }
  }

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    // Refuse arguments the tool doesn't declare, before anything else (REQ-SRV-022).
    await toolCatalog.refuseUndeclared(name, args);

    // Validate arguments first — pure, no side effects, fails fast on bad input.
    validateToolArguments(name, args);

    // Lazily create BConnect client — allows server instantiation in tests without real credentials.
    const getBconnect = (): BConnectClient => {
      dotenv.config();
      // A ClientConfigError (e.g. missing credentials) reaches the catch below
      // and becomes a tool result (REQ-XC-001).
      return new BConnectClient(clientConfigFromEnv(process.env, credentials));
    };

    try {
      const bconnect = lazyClient(getBconnect);
      const ad = lazyClient(() => bconnect.activeDirectory);

      // Dispatch — arguments already validated by validateToolArguments above.
      switch (name) {

        // ── AD Groups ─────────────────────────────────────────────────────
        case "list_ad_groups": {
          const result = await ad.getADGroups(pickArguments(args ?? {}, sends("list_ad_groups")));
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_ad_group": {
          const result = await ad.getADGroup(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_ad_subgroups": {
          const result = await ad.getADGroupsByAdGroup(args!.adGroupId as string, pickArguments(args ?? {}, sends("list_ad_subgroups")));
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_ad_groups_by_org_unit": {
          const result = await ad.getADGroupsByOrgUnit(args!.orgUnitId as string, pickArguments(args ?? {}, sends("list_ad_groups_by_org_unit")));
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        // ── AD Objects ────────────────────────────────────────────────────
        case "list_ad_objects": {
          const result = await ad.getADObjects(pickArguments(args ?? {}, sends("list_ad_objects")));
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_ad_object": {
          const result = await ad.getADObject(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_ad_object_memberships": {
          const result = await ad.getADObjectMemberships(args!.id as string, pickArguments(args ?? {}, sends("list_ad_object_memberships")));
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_ad_objects_by_group": {
          const result = await ad.getADObjectsByAdGroup(args!.adGroupId as string, pickArguments(args ?? {}, sends("list_ad_objects_by_group")));
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_ad_objects_by_org_unit": {
          const result = await ad.getADObjectsByOrgUnit(args!.orgUnitId as string, pickArguments(args ?? {}, sends("list_ad_objects_by_org_unit")));
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        // ── AD Users ──────────────────────────────────────────────────────
        case "list_ad_users": {
          const result = await ad.getADUsers(pickArguments(args ?? {}, sends("list_ad_users")));
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_ad_user": {
          const result = await ad.getADUser(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_ad_users_by_group": {
          const result = await ad.getADUsersByGroup(args!.adGroupId as string, pickArguments(args ?? {}, sends("list_ad_users_by_group")));
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_ad_users_by_org_unit": {
          const result = await ad.getADUsersByOrgUnit(args!.orgUnitId as string, pickArguments(args ?? {}, sends("list_ad_users_by_org_unit")));
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        // ── Org Units ─────────────────────────────────────────────────────
        case "list_org_units": {
          const result = await ad.getOrgUnits(pickArguments(args ?? {}, sends("list_org_units")));
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_org_unit": {
          const result = await ad.getOrgUnit(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_org_units_by_org_unit": {
          const result = await ad.getOrgUnitsByOrgUnit(args!.orgUnitId as string, pickArguments(args ?? {}, sends("list_org_units_by_org_unit")));
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error: unknown) {
      // API errors, gate refusals and configuration errors are tool results the
      // model can read; only McpErrors stay protocol errors (REQ-XC-001).
      return toolErrorResult(error, process.env.BCONNECT_RELEASE ?? "26R1");
    }
  });

  return { server };
}

// ─── Entry point ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  

  
  // Startup connectivity check (REQ-SRV-013)
  dotenv.config();
  {
    let _config: Readonly<BConnectConfig>;
    try {
      _config = clientConfigFromEnv(process.env);
    } catch (error) {
      if (!(error instanceof ClientConfigError)) { throw error; }
      console.error(`bconnect-activedirectory-mcp: ${error.message}`);
      process.exit(1);
    }
    const _startupUrl = _config.baseUrl;
    const _startupClient = new BConnectClient(_config);
    console.error(`bconnect-activedirectory-mcp: verifying bConnect API connectivity...`);
    const _connected = await _startupClient.testConnection();
    if (!_connected) {
      console.error(`bconnect-activedirectory-mcp: cannot reach bConnect API at ${_startupUrl}. Check BCONNECT_BASE_URL, credentials, and network.`);
      process.exit(1);
    }
    console.error(`bconnect-activedirectory-mcp: API connectivity verified.`);
  }

  const transportMode = process.env.MCP_TRANSPORT ?? "stdio";
  const port = parseInt(process.env.MCP_PORT ?? "3000", 10);
  const serverName = "bconnect-activedirectory-mcp";

  if (transportMode === "http") {
    const app = express();
    app.use(express.json());

    app.post("/mcp", async (req, res) => {
      const { server } = createServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });

    app.get("/mcp", async (req, res) => {
      res.writeHead(405).end(JSON.stringify({ error: "Method Not Allowed. Use POST for MCP requests." }));
    });

    app.delete("/mcp", async (req, res) => {
      res.writeHead(405).end(JSON.stringify({ error: "Method Not Allowed. Session management not supported in stateless mode." }));
    });

    const bind = process.env.MCP_BIND ?? "127.0.0.1";
    // Standalone HTTP mode has no client authentication. Binding to a non-loopback
    // address would expose an unauthenticated bConnect proxy, so fail closed unless
    // the operator explicitly opts in (front it with the authenticated gateway instead).
    const isLoopbackBind = bind === "127.0.0.1" || bind === "::1" || bind === "localhost";
    if (!isLoopbackBind && process.env.MCP_ALLOW_NO_AUTH !== "true") {
      console.error(
        `${serverName}: refusing to bind ${bind} — standalone HTTP mode is unauthenticated. ` +
          `Bind to loopback (the default) and front it with the authenticated gateway, ` +
          `or set MCP_ALLOW_NO_AUTH=true to override.`,
      );
      process.exit(1);
    }
    app.listen(port, bind, () => {
      console.error(`${serverName} listening on http://${bind}:${port}/mcp`);
    });
  } else {
    const { server } = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`${serverName} started on stdio`);
  }
}

if (!process.env.VITEST) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
