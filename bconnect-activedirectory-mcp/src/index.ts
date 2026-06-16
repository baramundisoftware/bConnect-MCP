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
import * as fs from "fs";
import * as dotenv from "dotenv";
import { BConnectClient } from "./bconnect-client.js";
import { validateOrThrow } from "./utils/parameter-validator.js";
import { ActiveDirectoryRules } from "./utils/mcp-tool-validation-rules.js";

// ─── Factory exported for testing ───────────────────────────────────────────

export interface BConnectCredentials {
  baseUrl?: string;
  username?: string;
  password?: string;
  apiKey?: string;
}

export function createServer(credentials?: BConnectCredentials): { server: Server } {
  const server = new Server(
    {
      name: "bconnect-activedirectory-mcp",
      version: "26.1.4"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // ── ListToolsRequestSchema handler ────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [

        // ── AD Groups ─────────────────────────────────────────────────────
        {
          name: "list_ad_groups",
          description: "List all Active Directory groups synchronized into baramundi Management Suite. Returns a paged list of AD groups with their GUIDs, names, domains, SIDs, and types. Use this to browse all available AD groups before querying specific ones.",
          inputSchema: {
            type: "object",
            properties: {
              SearchQuery: {
                type: "string",
                description: "Filter results by matching against Name, SID, Domain, Comment, Type, or GUID."
              },
              OrderBy: {
                type: "string",
                description: "Sort results by property name and direction. Possible values: Name, SID, Domain, Type (e.g. 'Name asc')."
              },
              Page: {
                type: "integer",
                description: "Zero-based page index for pagination. Default is 0."
              },
              PageSize: {
                type: "integer",
                description: "Number of items per page. Default is 20, maximum is 1000."
              }
            },
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
              },
              SearchQuery: {
                type: "string",
                description: "Filter results by matching against Name, SID, Domain, Comment, Type, or GUID."
              },
              OrderBy: {
                type: "string",
                description: "Sort results by property name and direction (e.g. 'Name asc')."
              },
              Page: {
                type: "integer",
                description: "Zero-based page index for pagination. Default is 0."
              },
              PageSize: {
                type: "integer",
                description: "Number of items per page. Default is 20, maximum is 1000."
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
              },
              SearchQuery: {
                type: "string",
                description: "Filter results by matching against Name, SID, Domain, Comment, Type, or GUID."
              },
              OrderBy: {
                type: "string",
                description: "Sort results by property name and direction (e.g. 'Name asc')."
              },
              Page: {
                type: "integer",
                description: "Zero-based page index for pagination. Default is 0."
              },
              PageSize: {
                type: "integer",
                description: "Number of items per page. Default is 20, maximum is 1000."
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
            properties: {
              SearchQuery: {
                type: "string",
                description: "Filter results by matching against Name, SID, Domain, Comment, Type, or GUID."
              },
              OrderBy: {
                type: "string",
                description: "Sort results by property name and direction (e.g. 'Name asc')."
              },
              Page: {
                type: "integer",
                description: "Zero-based page index for pagination. Default is 0."
              },
              PageSize: {
                type: "integer",
                description: "Number of items per page. Default is 20, maximum is 1000."
              }
            },
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
              },
              Page: {
                type: "integer",
                description: "Zero-based page index for pagination. Default is 0."
              },
              PageSize: {
                type: "integer",
                description: "Number of items per page. Default is 20, maximum is 1000."
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
              },
              SearchQuery: {
                type: "string",
                description: "Filter results by matching against Name, SID, Domain, Comment, Type, or GUID."
              },
              Page: {
                type: "integer",
                description: "Zero-based page index for pagination. Default is 0."
              },
              PageSize: {
                type: "integer",
                description: "Number of items per page. Default is 20, maximum is 1000."
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
              },
              SearchQuery: {
                type: "string",
                description: "Filter results by matching against Name, SID, Domain, Comment, Type, or GUID."
              },
              Page: {
                type: "integer",
                description: "Zero-based page index for pagination. Default is 0."
              },
              PageSize: {
                type: "integer",
                description: "Number of items per page. Default is 20, maximum is 1000."
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
            properties: {
              SearchQuery: {
                type: "string",
                description: "Filter results by matching against Name, SID, Domain, Comment, LogonName, or GUID in Active Directory."
              },
              OrderBy: {
                type: "string",
                description: "Sort results by property name and direction. Possible values: Name, SID, Domain, LogonName (e.g. 'Name asc')."
              },
              Page: {
                type: "integer",
                description: "Zero-based page index for pagination. Default is 0."
              },
              PageSize: {
                type: "integer",
                description: "Number of items per page. Default is 20, maximum is 1000."
              }
            },
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
              },
              SearchQuery: {
                type: "string",
                description: "Filter results by matching against Name, SID, Domain, Comment, LogonName, or GUID."
              },
              OrderBy: {
                type: "string",
                description: "Sort results by property name and direction (e.g. 'Name asc')."
              },
              Page: {
                type: "integer",
                description: "Zero-based page index for pagination. Default is 0."
              },
              PageSize: {
                type: "integer",
                description: "Number of items per page. Default is 20, maximum is 1000."
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
              },
              SearchQuery: {
                type: "string",
                description: "Filter results by matching against Name, SID, Domain, Comment, LogonName, or GUID."
              },
              OrderBy: {
                type: "string",
                description: "Sort results by property name and direction (e.g. 'Name asc')."
              },
              Page: {
                type: "integer",
                description: "Zero-based page index for pagination. Default is 0."
              },
              PageSize: {
                type: "integer",
                description: "Number of items per page. Default is 20, maximum is 1000."
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
            properties: {
              SearchQuery: {
                type: "string",
                description: "Filter results by matching against Name, Domain, DistinguishedName, or GUID."
              },
              OrderBy: {
                type: "string",
                description: "Sort results by property name and direction (e.g. 'Name asc')."
              },
              Page: {
                type: "integer",
                description: "Zero-based page index for pagination. Default is 0."
              },
              PageSize: {
                type: "integer",
                description: "Number of items per page. Default is 20, maximum is 1000."
              }
            },
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
              },
              SearchQuery: {
                type: "string",
                description: "Filter results by matching against Name, Domain, DistinguishedName, or GUID."
              },
              OrderBy: {
                type: "string",
                description: "Sort results by property name and direction (e.g. 'Name asc')."
              },
              Page: {
                type: "integer",
                description: "Zero-based page index for pagination. Default is 0."
              },
              PageSize: {
                type: "integer",
                description: "Number of items per page. Default is 20, maximum is 1000."
              }
            },
            required: ["orgUnitId"]
          }
        }

      ]
    };
  });

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

    // Validate arguments first — pure, no side effects, fails fast on bad input.
    validateToolArguments(name, args);

    // Lazily create BConnect client — allows server instantiation in tests without real credentials.
    const getBconnect = (): BConnectClient => {
      dotenv.config();
      const baseUrl = credentials?.baseUrl ?? process.env.BCONNECT_BASE_URL ?? "https://bms-server/bconnect";
      const username = credentials?.username ?? process.env.BCONNECT_USERNAME;
      const password = credentials?.password ?? process.env.BCONNECT_PASSWORD;
      const apiKey = credentials?.apiKey ?? process.env.BCONNECT_API_KEY;

      if (!apiKey && (!username || !password)) {
        throw new McpError(
          ErrorCode.InternalError,
          "Either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD are required"
        );
      }

      const caCertPath = process.env.BCONNECT_CA_CERT_PATH;
      const caCert = caCertPath ? fs.readFileSync(caCertPath, "utf8") : undefined;

      const rateLimitEnabled = process.env.BCONNECT_RATE_LIMIT_ENABLED === "true";
      const rateLimitMaxRequests = parseInt(process.env.BCONNECT_RATE_LIMIT_MAX_REQUESTS ?? "", 10);
      const rateLimitWindowMs = parseInt(process.env.BCONNECT_RATE_LIMIT_WINDOW_MS ?? "", 10);

      const auditLevelRaw = process.env.BCONNECT_AUDIT_LEVEL ?? "none";
      const auditLevel = (["none", "security", "write", "all"] as const).includes(auditLevelRaw as never)
        ? (auditLevelRaw as "none" | "security" | "write" | "all")
        : "none";

      return new BConnectClient({
        baseUrl,
        username,
        password,
        apiKey,
        rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
        ...(caCert && { ca: caCert }),
        ...(rateLimitEnabled && {
          rateLimit: {
            enabled: true,
            maxRequests: isNaN(rateLimitMaxRequests) ? 100 : rateLimitMaxRequests,
            windowMs: isNaN(rateLimitWindowMs) ? 60000 : rateLimitWindowMs,
          }
        }),
        auditLog: {
          level: auditLevel,
        },
      });
    };

    try {
      const bconnect = getBconnect();
      const ad = bconnect.activeDirectory;

      // Dispatch — arguments already validated by validateToolArguments above.
      switch (name) {

        // ── AD Groups ─────────────────────────────────────────────────────
        case "list_ad_groups": {
          const result = await ad.getADGroups((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_ad_group": {
          const result = await ad.getADGroup(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_ad_subgroups": {
          const result = await ad.getADGroupsByAdGroup(args!.adGroupId as string, (args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_ad_groups_by_org_unit": {
          const result = await ad.getADGroupsByOrgUnit(args!.orgUnitId as string, (args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        // ── AD Objects ────────────────────────────────────────────────────
        case "list_ad_objects": {
          const result = await ad.getADObjects((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_ad_object": {
          const result = await ad.getADObject(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_ad_object_memberships": {
          const result = await ad.getADObjectMemberships(args!.id as string, (args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_ad_objects_by_group": {
          const result = await ad.getADObjectsByAdGroup(args!.adGroupId as string, (args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_ad_objects_by_org_unit": {
          const result = await ad.getADObjectsByOrgUnit(args!.orgUnitId as string, (args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        // ── AD Users ──────────────────────────────────────────────────────
        case "list_ad_users": {
          const result = await ad.getADUsers((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_ad_user": {
          const result = await ad.getADUser(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_ad_users_by_group": {
          const result = await ad.getADUsersByGroup(args!.adGroupId as string, (args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_ad_users_by_org_unit": {
          const result = await ad.getADUsersByOrgUnit(args!.orgUnitId as string, (args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        // ── Org Units ─────────────────────────────────────────────────────
        case "list_org_units": {
          const result = await ad.getOrgUnits((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_org_unit": {
          const result = await ad.getOrgUnit(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_org_units_by_org_unit": {
          const result = await ad.getOrgUnitsByOrgUnit(args!.orgUnitId as string, (args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error: unknown) {
      if (error instanceof McpError) {throw error;}
      const message = error instanceof Error ? error.message : String(error);
      throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${message}`);
    }
  });

  return { server };
}

// ─── Entry point ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  

  
  // Startup connectivity check (REQ-SRV-013)
  dotenv.config();
  {
    const _startupUrl = process.env.BCONNECT_BASE_URL || "https://bms.example.com:444/bconnect";
    const _startupUser = process.env.BCONNECT_USERNAME;
    const _startupPass = process.env.BCONNECT_PASSWORD;
    const _startupApiKey = process.env.BCONNECT_API_KEY;
    if (!_startupApiKey && (!_startupUser || !_startupPass)) {
      console.error("bconnect-activedirectory-mcp: Either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD are required");
      process.exit(1);
    }
    const _caCertPath = process.env.BCONNECT_CA_CERT_PATH;
    const _caCert = _caCertPath ? fs.readFileSync(_caCertPath, "utf8") : undefined;
    const _startupClient = new BConnectClient({
      baseUrl: _startupUrl,
      username: _startupUser,
      password: _startupPass,
      apiKey: _startupApiKey,
      rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
      ...(_caCert && { ca: _caCert }),
    });
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

    app.listen(port, () => {
      console.error(`${serverName} listening on http://0.0.0.0:${port}/mcp`);
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
