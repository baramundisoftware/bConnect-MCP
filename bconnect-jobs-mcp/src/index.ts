#!/usr/bin/env node

/**
 * bconnect-jobs-mcp
 *
 * A Model Context Protocol server that provides access to the baramundi
 * bConnect REST API for jobs, server management, and variables modules.
 *
 * Module: Jobs
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import { BConnectClient } from "./bconnect-client.js";
import { validateOrThrow, toolErrorResult, lazyClient, BConnectApiError, withUnverifiedWriteMarker, pickArguments, declaredArgumentsOnly, queryParameters, withQueryProperties, withCountOnly, serverClients, runServer, withToolAnnotations, withWriteToolsHidden, toolJsonResult, selectedRelease } from "@bconnect/mcp-core";
import { QUERY_PARAMETERS } from "./query-params.js";
import { TOOL_METHODS } from "./tool-methods.js";

/** The query parameters a list tool sends: exactly what its route declares in the selected release (#179). */
const sends = (tool: string): string[] => queryParameters(QUERY_PARAMETERS, selectedRelease(), tool);
import type { BConnectCredentials } from "@bconnect/mcp-core";
import { TOOL_RULES } from "./utils/mcp-tool-validation-rules.js";
import type { paths as JobsPaths } from "./generated/jobs-types.js";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: true };

/**
 * Kiosk releases of one job definition (REQ-XC-005 AC 5, #166 AC 3). bMS 26R1
 * answers 200 with an empty list also for a job definition that doesn't exist
 * (live check 2026-10-02), so an empty answer leads to an existence check: it
 * exists → the empty result with a note; it doesn't → say so; the check fails
 * → the empty result with a note that existence is unconfirmed.
 */
async function kioskReleasesOfJobDefinition(
  list: () => Promise<unknown>,
  jobDefinitionExists: () => Promise<unknown>,
): Promise<ToolResult> {
  const answer = await list();
  const page = answer !== null && typeof answer === "object" && !Array.isArray(answer) ? answer as Record<string, unknown> : undefined;
  // Anything but an empty page passes through unchanged; an empty page beyond the
  // last one still has totalItems > 0: nothing to check.
  if (!page || !Array.isArray(page.data) || page.data.length > 0 || page.totalItems) {
    return toolJsonResult(answer);
  }
  const result: Record<string, unknown> = { ...page };
  try {
    await jobDefinitionExists();
    result.note = "The job definition exists and has no kiosk releases.";
  } catch (checkError) {
    const release = selectedRelease();
    if (checkError instanceof BConnectApiError && checkError.status === 404) {
      const missing = toolErrorResult(checkError, release);
      missing.content[0].text = `No job definition with this id exists, or it is not visible to the configured user.\n${missing.content[0].text}`;
      return missing;
    }
    const reason = toolErrorResult(checkError, release).content[0].text.split("\n")[0];
    result.note = "Could not confirm that the job definition exists; bMS answers with an empty list also " +
      `for a job definition that doesn't exist. ${reason}`;
  }
  return toolJsonResult(result);
}

// Type aliases for call-site casts (args are validated before use)
type AssignJobDefinitionRequest = JobsPaths["/v2.0/LogicalGroups/{logicalGroupId}/AssignJobDefinition"]["post"]["requestBody"]["content"]["application/json"];

/** The body of a group assignment: only the fields the API declares; the group id goes in the path. */
function assignmentBody(args: Record<string, unknown>): AssignJobDefinitionRequest {
  return {
    jobDefinitionId: args.jobDefinitionId as string,
    ...(args.startIfAlreadyAssigned !== undefined && { startIfAlreadyAssigned: args.startIfAlreadyAssigned as boolean }),
  };
}

/**
 * What a group assignment did. The API declares 207 ("fully or partially
 * succeeded") with a problem report that may list failed assignments; its
 * fields are passed on as they are. A list of created instances is counted.
 */
function assignmentReport(result: unknown): ToolResult {
  if (Array.isArray(result)) {
    return toolJsonResult(result, { lead: `Created ${result.length} job instances:` });
  }
  return toolJsonResult(result ?? {}, {
    lead: "Assignment finished: fully or partially succeeded (HTTP 207). Check the details below for assignments that failed.",
  });
}
type FolderForCreation = JobsPaths["/v2.0/Folders"]["post"]["requestBody"]["content"]["application/json"];

// ─── Factory exported for testing ───────────────────────────────────────────

export type { BConnectCredentials } from "@bconnect/mcp-core";

/** The server's bConnect clients: one shared by every tool call (REQ-SRV-023). */
const clients = serverClients(BConnectClient);

export function createServer(credentials?: BConnectCredentials): { server: Server } {
  const server = new Server(
    {
      name: "bconnect-jobs-mcp",
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
  "create_job_instance",
  "start_job_instance",
  "stop_job_instance",
  "resume_job_instance",
  "delete_job_instance",
  "create_job_folder",
  "update_job_folder",
  "delete_job_folder",
  "assign_job_to_logical_group",
  "assign_job_to_static_group",
  "assign_job_to_dynamic_group",
  "assign_job_to_universal_dynamic_group",
  "create_kiosk_release",
  "withdraw_kiosk_release",
  ]);

  const toolCatalog = declaredArgumentsOnly(withQueryProperties(QUERY_PARAMETERS, () => selectedRelease(), withUnverifiedWriteMarker(WRITE_TOOLS, async () => {
    return {
      tools: [
        // ── Jobs API ──────────────────────────────────────────────────────
        {
          name: "list_job_definitions",
          description: "List all job definitions in baramundi. Supports filtering, searching, and pagination. Returns job definitions with their GUIDs, names, and properties. Use this to find available software packages or scripts before deploying.",
          inputSchema: {
            type: "object",
            properties: {},
            required: []
          }
        },
        {
          name: "get_job_definition",
          description: "Get detailed information about a specific job definition by ID. Returns full properties including name, type, description, and folder location. Use this after list_job_definitions to inspect a particular software package or script.",
          inputSchema: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "Job definition ID (GUID)"
              }
            },
            required: ["id"]
          }
        },
        {
          name: "list_job_instances",
          description: "List all job instances (execution history) in baramundi. Supports filtering, searching, and pagination. Returns job instances with their status, endpoint, and timing information. Use this to monitor deployment progress across all endpoints.",
          inputSchema: {
            type: "object",
            properties: {},
            required: []
          }
        },
        {
          name: "get_job_instance",
          description: "Get detailed information about a specific job instance by ID. Returns full execution details including status, start/end times, result, and target endpoint. Use this after list_job_instances to inspect a particular deployment run.",
          inputSchema: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "Job instance ID (GUID)"
              }
            },
            required: ["id"]
          }
        },
        {
          name: "list_endpoint_job_instances",
          description: "List all job instances for a specific endpoint in baramundi. Returns all deployment runs (job executions) assigned to that endpoint with their status and timing. Use this to see all jobs running on a particular device.",
          inputSchema: {
            type: "object",
            properties: {
              endpointId: {
                type: "string",
                description: "Endpoint ID (GUID)"
              }
            },
            required: ["endpointId"]
          }
        },
        {
          name: "list_job_instances_by_definition",
          description: "List all job instances (execution history) for a specific job definition. Returns every deployment run of a given software package or script across all targeted endpoints. Use this for deployment tracking, rollout status, and identifying failed executions across your fleet.",
          inputSchema: {
            type: "object",
            properties: {
              jobDefinitionId: {
                type: "string",
                description: "Job definition ID (GUID)"
              }
            },
            required: ["jobDefinitionId"]
          }
        },
        {
          name: "list_job_instances_by_logical_group",
          description: "List all job instances assigned to endpoints within a specific logical group. Returns the deployment execution status for every job running against devices in the group. Essential for monitoring rollout progress and identifying failures across a managed group of endpoints.",
          inputSchema: {
            type: "object",
            properties: {
              logicalGroupId: {
                type: "string",
                description: "Logical group ID (GUID)"
              }
            },
            required: ["logicalGroupId"]
          }
        },
        {
          name: "list_job_definitions_by_folder",
          description: "List all job definitions contained in a specific job folder in baramundi. Returns a paged list of job definitions matching the folder scope. Use this to navigate the job library hierarchy and discover available software packages or scripts within a particular folder.",
          inputSchema: {
            type: "object",
            properties: {
              folderId: {
                type: "string",
                description: "Folder ID (GUID)"
              }
            },
            required: ["folderId"]
          }
        },
        // Jobs API - Write Operations
        {
          name: "create_job_instance",
          description: "Create a job instance by assigning a job definition to an endpoint in baramundi. The job starts as soon as the instance is created, unless the job definition itself defers it; it can't be scheduled through this tool. WARNING: This creates a new job assignment that will be executed on the target endpoint.",
          inputSchema: {
            type: "object",
            properties: {
              jobDefinitionId: {
                type: "string",
                description: "Job definition ID (GUID)"
              },
              endpointId: {
                type: "string",
                description: "Target endpoint ID (GUID)"
              },
              startIfAlreadyAssigned: {
                type: "boolean",
                description: "If the job definition is already assigned to the endpoint, start the existing job instance instead (optional)"
              }
            },
            required: ["jobDefinitionId", "endpointId"]
          }
        },
        {
          name: "start_job_instance",
          description: "Start a job instance by ID in baramundi. Triggers immediate execution of a pending or paused job on its assigned endpoint. WARNING: This starts job execution on the target device.",
          inputSchema: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "Job instance ID (GUID)"
              }
            },
            required: ["id"]
          }
        },
        {
          name: "stop_job_instance",
          description: "Stop a running job instance by ID in baramundi. Halts an in-progress job execution on the target endpoint. WARNING: This stops job execution and may leave the system in a partial state.",
          inputSchema: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "Job instance ID (GUID)"
              }
            },
            required: ["id"]
          }
        },
        {
          name: "resume_job_instance",
          description: "Resume a paused job instance by ID in baramundi (Windows endpoints only). Continues execution of a previously paused job. WARNING: This resumes job execution on the target device.",
          inputSchema: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "Job instance ID (GUID)"
              }
            },
            required: ["id"]
          }
        },
        {
          name: "delete_job_instance",
          description: "Delete a job instance by ID in baramundi. Permanently removes a job assignment from the system. WARNING: This permanently deletes the job instance and its execution history.",
          inputSchema: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "Job instance ID (GUID)"
              }
            },
            required: ["id"]
          }
        },
        // Folder management
        {
          name: "create_job_folder",
          description: "Create a new job folder in the baramundi job library hierarchy. Folders organize job definitions for better navigation and management. WARNING: Creates a new folder in the jobs structure.",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string", description: "Folder name (required)" },
              parentId: { type: "string", description: "Parent folder ID (optional, GUID)" },
              comment: { type: "string", description: "Comment or description (optional)" }
            },
            required: ["name"]
          }
        },
        {
          name: "update_job_folder",
          description: "Update an existing job folder by ID in baramundi. Modifies folder properties such as name and comment. WARNING: Modifies folder properties in the jobs structure.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "Folder ID (GUID)" },
              name: { type: "string", description: "New folder name (optional)" },
              comment: { type: "string", description: "New comment (optional)" }
            },
            required: ["id"],
            // id plus at least one field to change
            minProperties: 2
          }
        },
        {
          name: "delete_job_folder",
          description: "Delete a job folder by ID in baramundi. The folder must be empty before deletion. WARNING: Permanently deletes the folder and cannot be undone.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "Folder ID (GUID)" }
            },
            required: ["id"]
          }
        },
        // Assignment operations
        {
          name: "assign_job_to_logical_group",
          description: "Assign a job definition to every endpoint in a logical group in baramundi, including the endpoints in all of its sub-groups (a parent group with no direct members can still reach many endpoints). A job instance is created for every member, and each starts unless the job definition defers it. Check the reach first with list_endpoints_by_logical_group (includeSubfolders: true, PageSize: 1): its totalItems is the number of endpoints the assignment reaches, at all levels. Confirm it with the user before assigning. The answer lists the assignments that failed. WARNING: Triggers deployment on all of these endpoints.",
          inputSchema: {
            type: "object",
            properties: {
              logicalGroupId: { type: "string", description: "Logical group ID (GUID)" },
              jobDefinitionId: { type: "string", description: "Job definition ID (GUID)" },
              startIfAlreadyAssigned: { type: "boolean", description: "If the job definition is already assigned to an endpoint, start the existing job instance there (optional)" }
            },
            required: ["logicalGroupId", "jobDefinitionId"]
          }
        },
        {
          name: "assign_job_to_static_group",
          description: "Assign a job definition to every endpoint in a static group in baramundi. A job instance is created for every member, and each starts unless the job definition defers it. Check the reach first with list_endpoints_by_static_group (PageSize: 1): its totalItems is the number of endpoints the assignment reaches. Confirm it with the user before assigning. The answer lists the assignments that failed. WARNING: Triggers deployment on all of these endpoints.",
          inputSchema: {
            type: "object",
            properties: {
              staticGroupId: { type: "string", description: "Static group ID (GUID)" },
              jobDefinitionId: { type: "string", description: "Job definition ID (GUID)" },
              startIfAlreadyAssigned: { type: "boolean", description: "If the job definition is already assigned to an endpoint, start the existing job instance there (optional)" }
            },
            required: ["staticGroupId", "jobDefinitionId"]
          }
        },
        {
          name: "assign_job_to_dynamic_group",
          description: "Assign a job definition to every endpoint matching a Windows dynamic group in baramundi. A job instance is created for every member, and each starts unless the job definition defers it. Check the reach first with list_endpoints_by_dynamic_group (PageSize: 1): its totalItems is the number of endpoints the assignment reaches. Confirm it with the user before assigning. The answer lists the assignments that failed. WARNING: Triggers deployment on all of these endpoints.",
          inputSchema: {
            type: "object",
            properties: {
              dynamicGroupId: { type: "string", description: "Dynamic group ID (GUID)" },
              jobDefinitionId: { type: "string", description: "Job definition ID (GUID)" },
              startIfAlreadyAssigned: { type: "boolean", description: "If the job definition is already assigned to an endpoint, start the existing job instance there (optional)" }
            },
            required: ["dynamicGroupId", "jobDefinitionId"]
          }
        },
        {
          name: "assign_job_to_universal_dynamic_group",
          description: "Assign a job definition to every endpoint matching a universal dynamic group in baramundi. A job instance is created for every member, and each starts unless the job definition defers it. Check the reach first with list_endpoints_by_universal_dynamic_group (PageSize: 1): its totalItems is the number of endpoints the assignment reaches. Confirm it with the user before assigning. The answer lists the assignments that failed. WARNING: Triggers deployment on all of these endpoints.",
          inputSchema: {
            type: "object",
            properties: {
              universalDynamicGroupId: { type: "string", description: "Universal dynamic group ID (GUID)" },
              jobDefinitionId: { type: "string", description: "Job definition ID (GUID)" },
              startIfAlreadyAssigned: { type: "boolean", description: "If the job definition is already assigned to an endpoint, start the existing job instance there (optional)" }
            },
            required: ["universalDynamicGroupId", "jobDefinitionId"]
          }
        },
        // Kiosk releases
        {
          name: "create_kiosk_release",
          description: "Create a kiosk release to make a job definition available for execution via the baramundi Kiosk portal. Allows end users to self-service install software. WARNING: Creates a kiosk release that enables end-user triggered deployment.",
          inputSchema: {
            type: "object",
            properties: {
              jobDefinitionId: { type: "string", description: "Job definition ID (GUID)" },
              assignmentTargetId: { type: "string", description: "ID (GUID) of the endpoint, group or AD object the job is released to" }
            },
            required: ["assignmentTargetId", "jobDefinitionId"]
          }
        },
        {
          name: "withdraw_kiosk_release",
          description: "Withdraw (remove) a kiosk release by ID in baramundi. Removes the job from the Kiosk portal so end users can no longer trigger its execution. WARNING: Removes kiosk release and disables end-user self-service for that job.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "Kiosk release ID (GUID)" }
            },
            required: ["id"]
          }
        },
        {
          name: "list_kiosk_releases",
          description: "List all kiosk releases available in the baramundi Kiosk portal. Returns job definitions released for end-user self-service execution with their assignment targets. Use this to see what software users can install themselves.",
          inputSchema: {
            type: "object",
            properties: {},
            required: []
          }
        },
        {
          name: "get_kiosk_release",
          description: "Get detailed information about a specific kiosk release by ID in baramundi. Returns kiosk release details including the assignment target, job definition, and supported platforms.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "Kiosk release ID (GUID)" }
            },
            required: ["id"]
          }
        },
        // Phase 26: Folder navigation
        { name: "list_job_folders", description: "List the job folders in baramundi at every level, not only the top level. Each folder's parentId gives the hierarchy; use list_job_subfolders for the folders below one folder. Returns a paged list.", inputSchema: { type: "object", properties: {} } },
        { name: "get_job_folder", description: "Get details of a specific job folder by its GUID. Returns folder name, description, and parent folder information.", inputSchema: { type: "object", properties: { id: { type: "string", description: "Folder ID (GUID)" } }, required: ["id"] } },
        { name: "list_job_subfolders", description: "List all sub-folders within a specific job folder. Returns a paged list of child folders for the given parent folder GUID.", inputSchema: { type: "object", properties: { folderId: { type: "string", description: "Parent folder ID (GUID)" } }, required: ["folderId"] } },
        // Phase 26: Kiosk releases by context
        { name: "list_kiosk_releases_by_job_definition", description: "List all kiosk releases for a specific job definition. Returns releases that expose this job definition in the baramundi Kiosk portal.", inputSchema: { type: "object", properties: { jobDefinitionId: { type: "string", description: "Job definition ID (GUID)" } }, required: ["jobDefinitionId"] } },
        { name: "list_kiosk_releases_by_endpoint", description: "List all kiosk releases available to a specific endpoint. Returns releases the device can access via the baramundi Kiosk portal.", inputSchema: { type: "object", properties: { endpointId: { type: "string", description: "Endpoint ID (GUID)" } }, required: ["endpointId"] } },
        { name: "list_kiosk_releases_by_ad_object", description: "List all kiosk releases available to a specific AD object (user or group). Returns releases the AD object can access via the Kiosk portal.", inputSchema: { type: "object", properties: { adObjectId: { type: "string", description: "AD object ID (GUID)" } }, required: ["adObjectId"] } },
        { name: "list_kiosk_releases_by_logical_group", description: "List all kiosk releases available to endpoints in a specific logical group. Returns releases accessible by group members via the baramundi Kiosk portal.", inputSchema: { type: "object", properties: { logicalGroupId: { type: "string", description: "Logical group ID (GUID)" } }, required: ["logicalGroupId"] } },
        // Phase 26: Job instances by group
        { name: "list_job_instances_by_static_group", description: "List all job instances for endpoints in a specific static group. Returns a paged list of job execution history for the group.", inputSchema: { type: "object", properties: { staticGroupId: { type: "string", description: "Static group ID (GUID)" } }, required: ["staticGroupId"] } },
        { name: "list_job_instances_by_dynamic_group", description: "List all job instances for endpoints in a specific dynamic group. Returns a paged list of job execution history for the group.", inputSchema: { type: "object", properties: { dynamicGroupId: { type: "string", description: "Dynamic group ID (GUID)" } }, required: ["dynamicGroupId"] } },
        { name: "list_job_instances_by_universal_dynamic_group", description: "List all job instances for endpoints in a specific universal dynamic group. Returns a paged list of job execution history for the group.", inputSchema: { type: "object", properties: { universalDynamicGroupId: { type: "string", description: "Universal dynamic group ID (GUID)" } }, required: ["universalDynamicGroupId"] } },

      ]
    };
  })));
  // With writes off, tools/list leaves out the write tools; the gate still refuses them by name (REQ-SRV-026).
  server.setRequestHandler(ListToolsRequestSchema, withWriteToolsHidden(TOOL_METHODS, () => process.env.ALLOW_WRITE_OPERATIONS === "true",
    withToolAnnotations(TOOL_METHODS, toolCatalog.list)));

  // ── CallToolRequestSchema handler ─────────────────────────────────────────

  // ── Argument-validation pre-pass (runs before getBconnect) ─────────────────
  function validateToolArguments(name: string, args: Record<string, unknown> | undefined): void {
    // Own keys only: an inherited name such as "constructor" must not match.
    if (Object.hasOwn(TOOL_RULES, name)) {
      validateOrThrow(args, TOOL_RULES[name]());
    }
  }

  // countOnly (#165): count with one 1-row request instead of loading a page.
  server.setRequestHandler(CallToolRequestSchema, withCountOnly(QUERY_PARAMETERS, () => selectedRelease(), async (request) => {
    const { name, arguments: args } = request.params;
    // Refuse arguments the tool doesn't declare, before anything else (REQ-SRV-022).
    await toolCatalog.refuseUndeclared(name, args);

    // Validate arguments first — pure, no side effects, fails fast on bad input.
    validateToolArguments(name, args);

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

      switch (name) {
        // ── Jobs ──────────────────────────────────────────────────────────
        case "list_job_definitions": {
          const result = await bconnect.jobs.getJobDefinitions(pickArguments(args ?? {}, sends("list_job_definitions")));
          return toolJsonResult(result);
        }

        case "get_job_definition": {
          const result = await bconnect.jobs.getJobDefinition(args!.id as string);
          return toolJsonResult(result);
        }

        case "list_job_instances": {
          const result = await bconnect.jobs.getJobInstances(pickArguments(args ?? {}, sends("list_job_instances")));
          return toolJsonResult(result);
        }

        case "get_job_instance": {
          const result = await bconnect.jobs.getJobInstance(args!.id as string);
          return toolJsonResult(result);
        }

        case "list_endpoint_job_instances": {
          const result = await bconnect.jobs.getEndpointJobInstances(
            args!.endpointId as string,
            pickArguments(args ?? {}, sends("list_endpoint_job_instances"))
          );
          return toolJsonResult(result);
        }

        case "list_job_instances_by_definition": {
          const result = await bconnect.jobs.getJobInstancesByJobDefinition(
            args!.jobDefinitionId as string,
            pickArguments(args ?? {}, sends("list_job_instances_by_definition"))
          );
          return toolJsonResult(result);
        }

        case "list_job_instances_by_logical_group": {
          const result = await bconnect.jobs.getJobInstancesByLogicalGroup(
            args!.logicalGroupId as string,
            pickArguments(args ?? {}, sends("list_job_instances_by_logical_group"))
          );
          return toolJsonResult(result);
        }

        case "list_job_definitions_by_folder": {
          const result = await bconnect.jobs.getJobDefinitionsByFolder(
            args!.folderId as string,
            pickArguments(args ?? {}, sends("list_job_definitions_by_folder"))
          );
          return toolJsonResult(result);
        }

        case "create_job_instance": {
          const result = await bconnect.jobs.createJobInstance({
            jobDefinitionId: args!.jobDefinitionId as string,
            endpointId: args!.endpointId as string,
            ...(args!.startIfAlreadyAssigned !== undefined && { startIfAlreadyAssigned: args!.startIfAlreadyAssigned as boolean }),
          });
          return toolJsonResult(result);
        }

        case "start_job_instance": {
          await bconnect.jobs.startJobInstance(args!.id as string);
          return { content: [{ type: "text", text: `Job instance ${args!.id} started successfully` }] };
        }

        case "stop_job_instance": {
          await bconnect.jobs.stopJobInstance(args!.id as string);
          return { content: [{ type: "text", text: `Job instance ${args!.id} stopped successfully` }] };
        }

        case "resume_job_instance": {
          await bconnect.jobs.resumeJobInstance(args!.id as string);
          return { content: [{ type: "text", text: `Job instance ${args!.id} resumed successfully` }] };
        }

        case "delete_job_instance": {
          await bconnect.jobs.deleteJobInstance(args!.id as string);
          return { content: [{ type: "text", text: `Job instance ${args!.id} deleted successfully` }] };
        }

        case "create_job_folder": {
          const result = await bconnect.jobs.createFolder(args as unknown as FolderForCreation);
          return toolJsonResult(result);
        }

        case "update_job_folder": {
          const patch = (["name", "comment"] as const)
            .filter((field) => args![field] !== undefined)
            .map((field) => ({ op: "replace" as const, path: `/${field}`, value: args![field] as string }));
          if (patch.length === 0) {
            throw new McpError(ErrorCode.InvalidParams, "update_job_folder needs at least one field to change: name or comment.");
          }
          const result = await bconnect.jobs.updateFolder(args!.id as string, patch);
          return toolJsonResult(result);
        }

        case "delete_job_folder": {
          await bconnect.jobs.deleteFolder(args!.id as string);
          return { content: [{ type: "text", text: `Job folder ${args!.id} deleted successfully` }] };
        }

        case "assign_job_to_logical_group": {
          const result = await bconnect.jobs.assignJobDefinitionToLogicalGroup(
            args!.logicalGroupId as string,
            assignmentBody(args!)
          );
          return assignmentReport(result);
        }

        case "assign_job_to_static_group": {
          const result = await bconnect.jobs.assignJobDefinitionToStaticGroup(
            args!.staticGroupId as string,
            assignmentBody(args!)
          );
          return assignmentReport(result);
        }

        case "assign_job_to_dynamic_group": {
          const result = await bconnect.jobs.assignJobDefinitionToWindowsDynamicGroup(
            args!.dynamicGroupId as string,
            assignmentBody(args!)
          );
          return assignmentReport(result);
        }

        case "assign_job_to_universal_dynamic_group": {
          const result = await bconnect.jobs.assignJobDefinitionToUniversalDynamicGroup(
            args!.universalDynamicGroupId as string,
            assignmentBody(args!)
          );
          return assignmentReport(result);
        }

        case "create_kiosk_release": {
          const result = await bconnect.jobs.createKioskRelease({
            assignmentTargetId: args!.assignmentTargetId as string,
            jobDefinitionId: args!.jobDefinitionId as string,
          });
          return toolJsonResult(result);
        }

        case "withdraw_kiosk_release": {
          await bconnect.jobs.withdrawKioskRelease(args!.id as string);
          return { content: [{ type: "text", text: `Kiosk release ${args!.id} withdrawn successfully` }] };
        }

        case "list_kiosk_releases": {
          const result = await bconnect.jobs.getKioskReleases(pickArguments(args ?? {}, sends("list_kiosk_releases")));
          return toolJsonResult(result);
        }

        case "get_kiosk_release": {
          const result = await bconnect.jobs.getKioskRelease(args!.id as string);
          return toolJsonResult(result);
        }

        // Phase 26: Folder navigation
        case "list_job_folders": {
          const result = await bconnect.jobs.getJobFolders(pickArguments(args ?? {}, sends("list_job_folders")));
          return toolJsonResult(result);
        }

        case "get_job_folder": {
          const result = await bconnect.jobs.getJobFolder(args!.id as string);
          return toolJsonResult(result);
        }

        case "list_job_subfolders": {
          const result = await bconnect.jobs.getJobSubfolders(args!.folderId as string, pickArguments(args ?? {}, sends("list_job_subfolders")));
          return toolJsonResult(result);
        }

        // Phase 26: Kiosk releases by context
        case "list_kiosk_releases_by_job_definition": {
          // `return await`, so an error reaches the catch below.
          return await kioskReleasesOfJobDefinition(
            () => bconnect.jobs.getKioskReleasesByJobDefinition(args!.jobDefinitionId as string, pickArguments(args ?? {}, sends("list_kiosk_releases_by_job_definition"))),
            () => bconnect.jobs.getJobDefinition(args!.jobDefinitionId as string),
          );
        }

        case "list_kiosk_releases_by_endpoint": {
          const result = await bconnect.jobs.getKioskReleasesByEndpoint(args!.endpointId as string, pickArguments(args ?? {}, sends("list_kiosk_releases_by_endpoint")));
          return toolJsonResult(result);
        }

        case "list_kiosk_releases_by_ad_object": {
          const result = await bconnect.jobs.getKioskReleasesByAdObject(args!.adObjectId as string, pickArguments(args ?? {}, sends("list_kiosk_releases_by_ad_object")));
          return toolJsonResult(result);
        }

        case "list_kiosk_releases_by_logical_group": {
          const result = await bconnect.jobs.getKioskReleasesByLogicalGroup(args!.logicalGroupId as string, pickArguments(args ?? {}, sends("list_kiosk_releases_by_logical_group")));
          return toolJsonResult(result);
        }

        // Phase 26: Job instances by group
        case "list_job_instances_by_static_group": {
          const result = await bconnect.jobs.getJobInstancesByStaticGroup(args!.staticGroupId as string, pickArguments(args ?? {}, sends("list_job_instances_by_static_group")));
          return toolJsonResult(result);
        }

        case "list_job_instances_by_dynamic_group": {
          const result = await bconnect.jobs.getJobInstancesByDynamicGroup(args!.dynamicGroupId as string, pickArguments(args ?? {}, sends("list_job_instances_by_dynamic_group")));
          return toolJsonResult(result);
        }

        case "list_job_instances_by_universal_dynamic_group": {
          const result = await bconnect.jobs.getJobInstancesByUniversalDynamicGroup(args!.universalDynamicGroupId as string, pickArguments(args ?? {}, sends("list_job_instances_by_universal_dynamic_group")));
          return toolJsonResult(result);
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error: unknown) {
      // API errors, gate refusals and configuration errors are tool results the
      // model can read; only McpErrors stay protocol errors (REQ-XC-001).
      return toolErrorResult(error, selectedRelease());
    }
  }));

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

runServer({ name: "bconnect-jobs-mcp", createServer, clients });
