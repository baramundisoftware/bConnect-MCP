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
  enumProperty,
} from "@bconnect/mcp-core";
import { VariablesRules } from "./utils/mcp-tool-validation-rules.js";

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
      name: "bconnect-variables-mcp",
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
  // LOCAL FIX — D14b. Name, Category and Scope are declared by every
  // VariableDefinitions/VariableInstances operation (see the generated
  // operations in src/generated/variables-types.ts) and none were exposed.
  //
  // `Scope` carries its allowed values, unlike the free-text filters: it is an
  // enum, and an enum is the one query parameter class bConnect does NOT
  // silently ignore — a bad value is rejected with HTTP 400, not answered with
  // an unfiltered 200. Without the value list a model has to guess and burns a
  // call on the error. The spec's `Deprecated_*` member is omitted deliberately:
  // the schema documents it as removed in 26.1 and retained only so the enum has
  // no numeric gaps.
  //
  // TOK-10 — the same seven filter properties were spelled out on all eight list
  // tools. They are now one fragment, built from the shared mcp-core vocabulary.

  const VARIABLE_SCOPES = [
    "ADObject",
    "AndroidEndpoint",
    "Endpoint",
    "IosEndpoint",
    "LogicalGroup",
    "NetworkEndpoint",
    "WindowsApplication",
    "WindowsJobDefinition",
    "LinuxEndpoint",
  ];

  const variableListProperties = {
    OrderBy: { type: "string", description: "Sort results by property name and direction (e.g. 'Name asc')." },
    SearchQuery: { type: "string", description: "Filter results by matching against searchable properties." },
    ...pageProperties,
    ...exactMatchFilter("Name"),
    ...exactMatchFilter("Category"),
    ...enumProperty("Scope", VARIABLE_SCOPES, "Exact-match filter on Scope."),
    ...countOnlyProperty,
  };

  const TOOLS = [

      // ── Variable Definitions ─────────────────────────────────────────
      {
        name: "list_variable_definitions",
        description: "List all variable definitions configured in baramundi Management Suite. Returns a paged list with variable id, name, data type, default value, and description for each defined variable available for assignment to endpoints and other objects.",
        inputSchema: {
          type: "object",
          properties: { ...variableListProperties },
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
        // LOCAL PATCH (F23): the original schema could never succeed. The API's
        // VariableDefinitionForCreation requires category, name and scopes —
        // but `category` and `scopes` were not exposed at all, and two other
        // fields were misnamed (`dataType` should be `type`, `description`
        // should be `comment`). The handler passes args straight through as the
        // POST body, so every call returned HTTP 400.
        description: "Create a new variable definition in baramundi Management Suite. Requires name, category and scopes. WARNING: this is a fleet-wide write, not creating a template — the call IMMEDIATELY creates a variable instance on every object inside the scopes you name. Choose scopes deliberately before you choose the name. Answers HTTP 409 if a definition with the same name + category + scope already exists.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Name of the new variable definition." },
            category: { type: "string", description: "Category the variable belongs to (required)." },
            scopes: {
              type: "array",
              items: { type: "string" },
              description: "Where the variable applies (required). One or more of: ADObject, AndroidEndpoint, Endpoint, IosEndpoint, LogicalGroup, NetworkEndpoint, WindowsApplication, WindowsJobDefinition, LinuxEndpoint."
            },
            type: {
              type: "string",
              description: "Data type: String, Integer, Password, Date, DropDownList, DropDownEditableList, Checkbox, FileLink or Folder."
            },
            defaultValue: { type: "string", description: "Optional default value for the variable." },
            comment: { type: "string", description: "Optional comment explaining the variable's purpose." }
          },
          required: ["name", "category", "scopes"]
        }
      },
      {
        name: "update_variable_definition",
        description: "Update an existing variable definition in baramundi Management Suite using a JSON Patch document. Allows modifying the variable name, default value, description, or scope settings. Returns the updated variable definition. Answers HTTP 409 if the resulting name + category + scope combination already exists on a different definition — renaming into a collision fails rather than merging.",
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
        description: "Delete a variable definition from baramundi Management Suite by its GUID. Returns no content on success (204: deleted or already absent). Answers HTTP 409 'The variable definition is still in use' if instance values still exist on it — this is NOT a cascading delete, and the spec states no such cascade; remove or reset the instance values first.",
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
        // The description names the filters because a measured session did not
        // use them. See the NARROW THIS FIRST note below — this tool is 859
        // instances over 43 pages on a 26-endpoint estate, and a model that
        // does not know it can filter will walk all of them.
        description: "List all variable instances across all objects in baramundi Management Suite. Returns a paged list with variable instance id, associated object, variable definition name, and current value for each assigned variable instance. NARROW THIS FIRST — the unfiltered list is one row per variable per object and runs to hundreds of rows on a small estate. Scope filters to Endpoint, WindowsJobDefinition, LogicalGroup or ADObject; Name filters to one variable; Category filters to one group of them; countOnly:true answers 'how many' without a page. Use list_variable_instances_by_endpoint / _by_logical_group / _by_ad_object / _by_job_definition when you already know the object.",
        inputSchema: {
          type: "object",
          properties: { ...variableListProperties },
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
            ...variableListProperties,
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
            ...variableListProperties,
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
            ...variableListProperties,
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
            ...variableListProperties,
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
            ...variableListProperties,
          },
          required: ["windowsApplicationId"]
        }
      },
      {
        name: "update_variable_instance",
        description: "Update the value of a specific variable instance by its GUID using a JSON Patch document. Allows changing the current value of a variable instance assigned to any object in baramundi Management Suite. To reset to the definition's default, set IsDefault:true — this works for every endpoint type EXCEPT Windows endpoints, where it does not reset the value (the opposite of most objects). Returns the updated variable instance.",
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

  const catalogue = defineToolCatalogue({
    tools: TOOLS,
    write: [
      "create_variable_definition",
      "update_variable_definition",
      "delete_variable_definition",
      "update_variable_instance",
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
      case "list_variable_definitions":
        validateOrThrow(args, VariablesRules.listVariableDefinitions());
        return;
      case "get_variable_definition":
        validateOrThrow(args, VariablesRules.getVariableDefinition());
        return;
      case "create_variable_definition":
        validateOrThrow(args, VariablesRules.createVariableDefinition());
        return;
      case "update_variable_definition":
        validateOrThrow(args, VariablesRules.updateVariableDefinition());
        return;
      case "delete_variable_definition":
        validateOrThrow(args, VariablesRules.deleteVariableDefinition());
        return;
      case "list_variable_instances":
        validateOrThrow(args, VariablesRules.listVariableInstances());
        return;
      case "get_variable_instance":
        validateOrThrow(args, VariablesRules.getVariableInstance());
        return;
      case "list_variable_instances_by_endpoint":
        validateOrThrow(args, VariablesRules.listVariableInstancesByEndpoint());
        return;
      case "list_variable_instances_by_logical_group":
        validateOrThrow(args, VariablesRules.listVariableInstancesByLogicalGroup());
        return;
      case "list_variable_instances_by_ad_object":
        validateOrThrow(args, VariablesRules.listVariableInstancesByAdObject());
        return;
      case "list_variable_instances_by_job_definition":
        validateOrThrow(args, VariablesRules.listVariableInstancesByJobDefinition());
        return;
      case "list_variable_instances_by_application":
        validateOrThrow(args, VariablesRules.listVariableInstancesByApplication());
        return;
      case "update_variable_instance":
        validateOrThrow(args, VariablesRules.updateVariableInstance());
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
    // (BCONNECT_API_KEY__VARIABLES); with no such variable set this
    // changes nothing. See mcp-core/server-scoped-credentials.ts.
    serverName: "bconnect-variables-mcp",
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
      const vars = bconnect.variables;

      // Dispatch — arguments already validated by validateToolArguments above.
      switch (name) {

        case "list_variable_definitions": {
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => vars.getVariableDefinitions(p as never), args);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await vars.getVariableDefinitions(apiParams(args) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "get_variable_definition": {
          const result = await vars.getVariableDefinition(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "create_variable_definition": {
          const result = await vars.createVariableDefinition(args as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "update_variable_definition": {
          const result = await vars.updateVariableDefinition(args!.id as string, args!.patchOperations as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "delete_variable_definition": {
          await vars.deleteVariableDefinition(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult({ success: true }) }] };
        }

        case "list_variable_instances": {
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => vars.getVariableInstances(p as never), args);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await vars.getVariableInstances(apiParams(args) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "get_variable_instance": {
          const result = await vars.getVariableInstance(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_variable_instances_by_endpoint": {
          const { endpointId, ...params } = args as Record<string, unknown>;
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => vars.getVariableInstancesByEndpoint(endpointId as string, p as never), params);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await vars.getVariableInstancesByEndpoint(endpointId as string, apiParams(params) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_variable_instances_by_logical_group": {
          const { logicalGroupId, ...params } = args as Record<string, unknown>;
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => vars.getVariableInstancesByLogicalGroup(logicalGroupId as string, p as never), params);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await vars.getVariableInstancesByLogicalGroup(logicalGroupId as string, apiParams(params) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_variable_instances_by_ad_object": {
          const { adObjectId, ...params } = args as Record<string, unknown>;
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => vars.getVariableInstancesByADObject(adObjectId as string, p as never), params);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await vars.getVariableInstancesByADObject(adObjectId as string, apiParams(params) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_variable_instances_by_job_definition": {
          const { windowsJobDefinitionId, ...params } = args as Record<string, unknown>;
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => vars.getVariableInstancesByWindowsJobDefinition(windowsJobDefinitionId as string, p as never), params);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await vars.getVariableInstancesByWindowsJobDefinition(windowsJobDefinitionId as string, apiParams(params) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_variable_instances_by_application": {
          const { windowsApplicationId, ...params } = args as Record<string, unknown>;
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => vars.getVariableInstancesByWindowsApplication(windowsApplicationId as string, p as never), params);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await vars.getVariableInstancesByWindowsApplication(windowsApplicationId as string, apiParams(params) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "update_variable_instance": {
          const result = await vars.updateVariableInstance(args!.id as string, args!.patchOperations as never);
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
    name: "bconnect-variables-mcp",
    createServer,
    http: { express },
  }).catch((error) => {
    console.error(`Fatal error: ${describeConnectionFailure(error)}`);
    process.exit(1);
  });
}
