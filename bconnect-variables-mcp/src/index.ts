#!/usr/bin/env node

/**
 * bconnect-variables-mcp
 *
 * A Model Context Protocol server that provides access to the baramundi
 * bConnect REST API for Variables — managing variable definitions and
 * variable instance values across endpoints, logical groups, AD objects,
 * job definitions, and applications.
 *
 * Supports both 25R2 and 26R1.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as dotenv from "dotenv";
import { BConnectClient } from "./bconnect-client.js";

// ─── Factory exported for testing ───────────────────────────────────────────

export function createServer(): { server: Server } {
  const server = new Server(
    {
      name: "bconnect-variables-mcp",
      version: "26.1.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // ── ListToolsRequestSchema handler ────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools: object[] = [

      // ── Variable Definitions ─────────────────────────────────────────
      {
        name: "list_variable_definitions",
        description: "List all variable definitions configured in baramundi Management Suite. Returns a paged list with variable id, name, data type, default value, and description for each defined variable available for assignment to endpoints and other objects.",
        inputSchema: {
          type: "object",
          properties: {
            OrderBy: { type: "string", description: "Sort results by property name and direction (e.g. 'Name asc')." },
            SearchQuery: { type: "string", description: "Filter results by matching against searchable variable properties." },
            Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
            PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
          },
          required: []
        }
      },
      {
        name: "get_variable_definition",
        description: "Get the details of a specific variable definition by its GUID. Returns the variable id, name, data type, default value, description, and scope settings for the specified variable defined in baramundi Management Suite.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the variable definition to retrieve." }
          },
          required: ["id"]
        }
      },
      {
        name: "create_variable_definition",
        description: "Create a new variable definition in baramundi Management Suite. Requires a name and data type. Variable definitions act as templates that can be instantiated with specific values on endpoints, groups, and other objects.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Name of the new variable definition." },
            dataType: { type: "string", description: "Data type of the variable (e.g. String, Integer, Boolean)." },
            defaultValue: { type: "string", description: "Optional default value for the variable." },
            description: { type: "string", description: "Optional description explaining the variable's purpose." }
          },
          required: ["name", "dataType"]
        }
      },
      {
        name: "update_variable_definition",
        description: "Update an existing variable definition in baramundi Management Suite using a JSON Patch document. Allows modifying the variable name, default value, description, or scope settings. Returns the updated variable definition.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the variable definition to update." },
            patchOperations: {
              type: "array",
              description: "JSON Patch operations array. Use op=replace and the property path to modify fields."
            }
          },
          required: ["id", "patchOperations"]
        }
      },
      {
        name: "delete_variable_definition",
        description: "Delete a variable definition from baramundi Management Suite by its GUID. Removing a variable definition also removes all its instance values across all associated objects. Returns no content on success (204).",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the variable definition to delete." }
          },
          required: ["id"]
        }
      },

      // ── Variable Instances ───────────────────────────────────────────
      {
        name: "list_variable_instances",
        description: "List all variable instances across all objects in baramundi Management Suite. Returns a paged list with variable instance id, associated object, variable definition name, and current value for each assigned variable instance.",
        inputSchema: {
          type: "object",
          properties: {
            OrderBy: { type: "string", description: "Sort results by property name and direction." },
            SearchQuery: { type: "string", description: "Filter results by matching against searchable properties." },
            Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
            PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
          },
          required: []
        }
      },
      {
        name: "get_variable_instance",
        description: "Get the details of a specific variable instance by its GUID. Returns the instance id, associated object reference, variable definition name, data type, and current value for the specified variable instance in baramundi Management Suite.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the variable instance to retrieve." }
          },
          required: ["id"]
        }
      },
      {
        name: "list_variable_instances_by_endpoint",
        description: "List all variable instances assigned to a specific endpoint identified by its GUID. Returns a paged list of variable instances with their definition names, data types, and current values for all variables configured on that endpoint.",
        inputSchema: {
          type: "object",
          properties: {
            endpointId: { type: "string", description: "GUID of the endpoint to retrieve variable instances for." },
            OrderBy: { type: "string", description: "Sort results by property name and direction." },
            SearchQuery: { type: "string", description: "Filter results by matching against searchable properties." },
            Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
            PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
          },
          required: ["endpointId"]
        }
      },
      {
        name: "list_variable_instances_by_logical_group",
        description: "List all variable instances assigned to a specific logical group identified by its GUID. Returns a paged list of variable instances with their definition names, data types, and current values configured for that logical group in baramundi Management Suite.",
        inputSchema: {
          type: "object",
          properties: {
            logicalGroupId: { type: "string", description: "GUID of the logical group to retrieve variable instances for." },
            OrderBy: { type: "string", description: "Sort results by property name and direction." },
            SearchQuery: { type: "string", description: "Filter results by matching against searchable properties." },
            Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
            PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
          },
          required: ["logicalGroupId"]
        }
      },
      {
        name: "list_variable_instances_by_ad_object",
        description: "List all variable instances assigned to a specific Active Directory object identified by its GUID. Returns a paged list of variable instances with their definition names, data types, and current values configured for that AD object in baramundi Management Suite.",
        inputSchema: {
          type: "object",
          properties: {
            adObjectId: { type: "string", description: "GUID of the Active Directory object to retrieve variable instances for." },
            OrderBy: { type: "string", description: "Sort results by property name and direction." },
            SearchQuery: { type: "string", description: "Filter results by matching against searchable properties." },
            Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
            PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
          },
          required: ["adObjectId"]
        }
      },
      {
        name: "list_variable_instances_by_job_definition",
        description: "List all variable instances assigned to a specific Windows job definition identified by its GUID. Returns a paged list of variable instances with their definition names, data types, and current values configured for that job definition in baramundi Management Suite.",
        inputSchema: {
          type: "object",
          properties: {
            windowsJobDefinitionId: { type: "string", description: "GUID of the Windows job definition to retrieve variable instances for." },
            OrderBy: { type: "string", description: "Sort results by property name and direction." },
            SearchQuery: { type: "string", description: "Filter results by matching against searchable properties." },
            Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
            PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
          },
          required: ["windowsJobDefinitionId"]
        }
      },
      {
        name: "list_variable_instances_by_application",
        description: "List all variable instances assigned to a specific Windows application identified by its GUID. Returns a paged list of variable instances with their definition names, data types, and current values configured for that application in baramundi Management Suite.",
        inputSchema: {
          type: "object",
          properties: {
            windowsApplicationId: { type: "string", description: "GUID of the Windows application to retrieve variable instances for." },
            OrderBy: { type: "string", description: "Sort results by property name and direction." },
            SearchQuery: { type: "string", description: "Filter results by matching against searchable properties." },
            Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
            PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
          },
          required: ["windowsApplicationId"]
        }
      },
      {
        name: "update_variable_instance",
        description: "Update the value of a specific variable instance by its GUID using a JSON Patch document. Allows changing the current value of a variable instance assigned to any object in baramundi Management Suite. Returns the updated variable instance.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "GUID of the variable instance to update." },
            patchOperations: {
              type: "array",
              description: "JSON Patch operations array. Use op=replace, path=/value, value=<new-value>."
            }
          },
          required: ["id", "patchOperations"]
        }
      },
    ];

    return { tools };
  });

  // ── CallToolRequestSchema handler ─────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // ── Write-operation gate (REQ-SRV-012) ───────────────────────────────────
    const WRITE_TOOLS = new Set<string>([
    "create_variable_definition",
    "update_variable_definition",
    "delete_variable_definition",
    "update_variable_instance",
    ]);
    if (WRITE_TOOLS.has(name) && process.env.ALLOW_WRITE_OPERATIONS !== "true") {
      return {
        content: [{
          type: "text" as const,
          text: `Write operation '${name}' is disabled. Set ALLOW_WRITE_OPERATIONS=true to enable write operations.`
        }],
        isError: true
      };
    }


    const getBconnect = (): BConnectClient => {
      dotenv.config();
      const baseUrl = process.env.BCONNECT_BASE_URL || "https://bms-server/bconnect";
      const username = process.env.BCONNECT_USERNAME;
      const password = process.env.BCONNECT_PASSWORD;

      if (!username || !password) {
        throw new McpError(
          ErrorCode.InternalError,
          "BCONNECT_USERNAME and BCONNECT_PASSWORD environment variables are required"
        );
      }

      const caCertPath = process.env.BCONNECT_CA_CERT_PATH;
      const caCert = caCertPath ? fs.readFileSync(caCertPath, "utf8") : undefined;

      const auditLevelRaw = process.env.BCONNECT_AUDIT_LEVEL ?? "none";
      const auditLevel = (["none", "security", "write", "all"] as const).includes(auditLevelRaw as never)
        ? (auditLevelRaw as "none" | "security" | "write" | "all")
        : "none";

      return new BConnectClient({
        baseUrl,
        username,
        password,
        rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
        ...(caCert && { ca: caCert }),
        auditLog: { level: auditLevel },
      });
    };

    try {
      const bconnect = getBconnect();
      const vars = bconnect.variables;

      switch (name) {

        case "list_variable_definitions": {
          const result = await vars.getVariableDefinitions((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_variable_definition": {
          if (!args?.id || typeof args.id !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "get_variable_definition requires an id (GUID) string parameter");
          }
          const result = await vars.getVariableDefinition(args.id);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "create_variable_definition": {
          if (!args?.name || typeof args.name !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "create_variable_definition requires a name string parameter");
          }
          if (!args?.dataType || typeof args.dataType !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "create_variable_definition requires a dataType string parameter");
          }
          const result = await vars.createVariableDefinition(args as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "update_variable_definition": {
          if (!args?.id || typeof args.id !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "update_variable_definition requires an id (GUID) string parameter");
          }
          if (!Array.isArray(args?.patchOperations)) {
            throw new McpError(ErrorCode.InvalidParams, "update_variable_definition requires a patchOperations array");
          }
          const result = await vars.updateVariableDefinition(args.id, args.patchOperations as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "delete_variable_definition": {
          if (!args?.id || typeof args.id !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "delete_variable_definition requires an id (GUID) string parameter");
          }
          await vars.deleteVariableDefinition(args.id);
          return { content: [{ type: "text", text: JSON.stringify({ success: true }, null, 2) }] };
        }

        case "list_variable_instances": {
          const result = await vars.getVariableInstances((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_variable_instance": {
          if (!args?.id || typeof args.id !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "get_variable_instance requires an id (GUID) string parameter");
          }
          const result = await vars.getVariableInstance(args.id);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_variable_instances_by_endpoint": {
          if (!args?.endpointId || typeof args.endpointId !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "list_variable_instances_by_endpoint requires an endpointId (GUID) string parameter");
          }
          const { endpointId, ...params } = args as Record<string, unknown>;
          const result = await vars.getVariableInstancesByEndpoint(endpointId as string, params as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_variable_instances_by_logical_group": {
          if (!args?.logicalGroupId || typeof args.logicalGroupId !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "list_variable_instances_by_logical_group requires a logicalGroupId (GUID) string parameter");
          }
          const { logicalGroupId, ...params } = args as Record<string, unknown>;
          const result = await vars.getVariableInstancesByLogicalGroup(logicalGroupId as string, params as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_variable_instances_by_ad_object": {
          if (!args?.adObjectId || typeof args.adObjectId !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "list_variable_instances_by_ad_object requires an adObjectId (GUID) string parameter");
          }
          const { adObjectId, ...params } = args as Record<string, unknown>;
          const result = await vars.getVariableInstancesByADObject(adObjectId as string, params as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_variable_instances_by_job_definition": {
          if (!args?.windowsJobDefinitionId || typeof args.windowsJobDefinitionId !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "list_variable_instances_by_job_definition requires a windowsJobDefinitionId (GUID) string parameter");
          }
          const { windowsJobDefinitionId, ...params } = args as Record<string, unknown>;
          const result = await vars.getVariableInstancesByWindowsJobDefinition(windowsJobDefinitionId as string, params as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_variable_instances_by_application": {
          if (!args?.windowsApplicationId || typeof args.windowsApplicationId !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "list_variable_instances_by_application requires a windowsApplicationId (GUID) string parameter");
          }
          const { windowsApplicationId, ...params } = args as Record<string, unknown>;
          const result = await vars.getVariableInstancesByWindowsApplication(windowsApplicationId as string, params as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "update_variable_instance": {
          if (!args?.id || typeof args.id !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "update_variable_instance requires an id (GUID) string parameter");
          }
          if (!Array.isArray(args?.patchOperations)) {
            throw new McpError(ErrorCode.InvalidParams, "update_variable_instance requires a patchOperations array");
          }
          const result = await vars.updateVariableInstance(args.id, args.patchOperations as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error) {
      if (error instanceof McpError) throw error;
      throw new McpError(
        ErrorCode.InternalError,
        `bConnect API error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  return { server };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  dotenv.config();
  

  
  // Startup connectivity check (REQ-SRV-013)
  dotenv.config();
  {
    const _startupUrl = process.env.BCONNECT_BASE_URL || "https://bms-win22srv:444/bconnect";
    const _startupUser = process.env.BCONNECT_USERNAME;
    const _startupPass = process.env.BCONNECT_PASSWORD;
    if (!_startupUser || !_startupPass) {
      console.error("bconnect-variables-mcp: BCONNECT_USERNAME and BCONNECT_PASSWORD are required");
      process.exit(1);
    }
    const _caCertPath = process.env.BCONNECT_CA_CERT_PATH;
    const _caCert = _caCertPath ? fs.readFileSync(_caCertPath, "utf8") : undefined;
    const _startupClient = new BConnectClient({
      baseUrl: _startupUrl,
      username: _startupUser,
      password: _startupPass,
      rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
      ...(_caCert && { ca: _caCert }),
    });
    console.error(`bconnect-variables-mcp: verifying bConnect API connectivity...`);
    const _connected = await _startupClient.testConnection();
    if (!_connected) {
      console.error(`bconnect-variables-mcp: cannot reach bConnect API at ${_startupUrl}. Check BCONNECT_BASE_URL, credentials, and network.`);
      process.exit(1);
    }
    console.error(`bconnect-variables-mcp: API connectivity verified.`);
  }

  const { server } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("bconnect-variables-mcp started");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
