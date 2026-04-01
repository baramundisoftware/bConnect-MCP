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
import { validateOrThrow } from "./utils/parameter-validator.js";
import type { paths as JobsPaths } from "./generated/jobs-types.js";
import {
  JobsRules
} from "./utils/mcp-tool-validation-rules.js";

// Type aliases for call-site casts (args are validated before use)
type AssignJobDefinitionRequest = JobsPaths["/v2.0/LogicalGroups/{logicalGroupId}/AssignJobDefinition"]["post"]["requestBody"]["content"]["application/json"];
type KioskReleaseForCreation = JobsPaths["/v2.0/KioskReleases"]["post"]["requestBody"]["content"]["application/json"];
type JsonPatchDocument = JobsPaths["/v2.0/Folders/{id}"]["patch"]["requestBody"]["content"]["application/json-patch+json"];
type JobInstanceForCreation = JobsPaths["/v2.0/JobInstances"]["post"]["requestBody"]["content"]["application/json"];
type FolderForCreation = JobsPaths["/v2.0/Folders"]["post"]["requestBody"]["content"]["application/json"];

// ─── Factory exported for testing ───────────────────────────────────────────

export function createServer(): { server: Server } {
  const server = new Server(
    {
      name: "bconnect-jobs-mcp",
      version: "1.0.0"
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
        // ── Jobs API ──────────────────────────────────────────────────────
        {
          name: "list_job_definitions",
          description: "List all job definitions in baramundi. Supports filtering, searching, and pagination. Returns job definitions with their GUIDs, names, and properties. Use this to find available software packages or scripts before deploying.",
          inputSchema: {
            type: "object",
            properties: {
              SearchQuery: {
                type: "string",
                description: "Search query to filter job definitions by name or description"
              },
              PageSize: {
                type: "number",
                description: "Number of results per page (default 20)"
              },
              Page: {
                type: "number",
                description: "Page number (zero-indexed)"
              },
              OrderBy: {
                type: "string",
                description: "Sort order (e.g., 'Name asc')"
              }
            },
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
            properties: {
              SearchQuery: {
                type: "string",
                description: "Search query to filter job instances"
              },
              PageSize: {
                type: "number",
                description: "Number of results per page (default 20)"
              },
              Page: {
                type: "number",
                description: "Page number (zero-indexed)"
              },
              OrderBy: {
                type: "string",
                description: "Sort order (e.g., 'Start desc')"
              }
            },
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
              },
              PageSize: {
                type: "number",
                description: "Number of results per page (default 20)"
              },
              Page: {
                type: "number",
                description: "Page number (zero-indexed)"
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
              },
              SearchQuery: {
                type: "string",
                description: "Filter by job definition name, endpoint name, or state description"
              },
              Page: {
                type: "number",
                description: "Page number (zero-indexed)"
              },
              PageSize: {
                type: "number",
                description: "Number of results per page (max 1000, default 20)"
              },
              OrderBy: {
                type: "string",
                description: "Sort order (e.g., 'EndpointName asc', 'Start desc')"
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
              },
              SearchQuery: {
                type: "string",
                description: "Filter by job definition name, endpoint name, or state description"
              },
              Page: {
                type: "number",
                description: "Page number (zero-indexed)"
              },
              PageSize: {
                type: "number",
                description: "Number of results per page (max 1000, default 20)"
              },
              OrderBy: {
                type: "string",
                description: "Sort order (e.g., 'EndpointName asc', 'Start desc')"
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
              },
              SearchQuery: {
                type: "string",
                description: "Filter by name, display name, category, description, or comment"
              },
              Page: {
                type: "number",
                description: "Page number (zero-indexed)"
              },
              PageSize: {
                type: "number",
                description: "Number of results per page (max 1000, default 20)"
              },
              OrderBy: {
                type: "string",
                description: "Sort order (e.g., 'DisplayName asc', 'Name asc')"
              },
              includeSubfolders: {
                type: "boolean",
                description: "If true, also includes job definitions from sub-folders (default: false)"
              }
            },
            required: ["folderId"]
          }
        },
        // Jobs API - Write Operations
        {
          name: "create_job_instance",
          description: "Create a job instance by assigning a job definition to an endpoint in baramundi. This initiates a deployment or script execution. WARNING: This creates a new job assignment that will be executed on the target endpoint.",
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
              scheduledStartTime: {
                type: "string",
                description: "Scheduled start time (ISO 8601 format, optional)"
              }
            },
            required: ["jobDefinitionId"]
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
            required: ["id"]
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
          description: "Assign a job definition to all endpoints in a logical group in baramundi. Creates job instances for each endpoint in the group. WARNING: Creates job instances for all endpoints in the group and triggers deployment.",
          inputSchema: {
            type: "object",
            properties: {
              logicalGroupId: { type: "string", description: "Logical group ID (GUID)" },
              jobDefinitionId: { type: "string", description: "Job definition ID (GUID)" }
            },
            required: ["logicalGroupId", "jobDefinitionId"]
          }
        },
        {
          name: "assign_job_to_static_group",
          description: "Assign a job definition to all endpoints in a static group in baramundi. Creates job instances for each endpoint in the static group. WARNING: Creates job instances for all endpoints in the group.",
          inputSchema: {
            type: "object",
            properties: {
              staticGroupId: { type: "string", description: "Static group ID (GUID)" },
              jobDefinitionId: { type: "string", description: "Job definition ID (GUID)" }
            },
            required: ["staticGroupId", "jobDefinitionId"]
          }
        },
        {
          name: "assign_job_to_dynamic_group",
          description: "Assign a job definition to all endpoints in a Windows dynamic group in baramundi. Creates job instances for each endpoint matching the dynamic group criteria. WARNING: Creates job instances for all matching endpoints.",
          inputSchema: {
            type: "object",
            properties: {
              dynamicGroupId: { type: "string", description: "Dynamic group ID (GUID)" },
              jobDefinitionId: { type: "string", description: "Job definition ID (GUID)" }
            },
            required: ["dynamicGroupId", "jobDefinitionId"]
          }
        },
        {
          name: "assign_job_to_universal_dynamic_group",
          description: "Assign a job definition to all endpoints in a universal dynamic group in baramundi. Creates job instances for each endpoint matching the universal dynamic group criteria. WARNING: Creates job instances for all matching endpoints.",
          inputSchema: {
            type: "object",
            properties: {
              universalDynamicGroupId: { type: "string", description: "Universal dynamic group ID (GUID)" },
              jobDefinitionId: { type: "string", description: "Job definition ID (GUID)" }
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
              targetId: { type: "string", description: "Target object ID (endpoint, group, or AD object, optional)" }
            },
            required: ["jobDefinitionId"]
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
            properties: {
              OrderBy: { type: "string", description: "Sort order (e.g., 'assignmentTargetName asc')" },
              SearchQuery: { type: "string", description: "Search query to filter kiosk releases" },
              Page: { type: "number", description: "Page number (zero-indexed)" },
              PageSize: { type: "number", description: "Number of results per page" }
            },
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
        { name: "list_job_folders", description: "List all top-level job folders in baramundi. Returns a paged list of root-level folders for organising job definitions.", inputSchema: { type: "object", properties: { SearchQuery: { type: "string" }, Page: { type: "number" }, PageSize: { type: "number" }, OrderBy: { type: "string" } } } },
        { name: "get_job_folder", description: "Get details of a specific job folder by its GUID. Returns folder name, description, and parent folder information.", inputSchema: { type: "object", properties: { id: { type: "string", description: "Folder ID (GUID)" } }, required: ["id"] } },
        { name: "list_job_subfolders", description: "List all sub-folders within a specific job folder. Returns a paged list of child folders for the given parent folder GUID.", inputSchema: { type: "object", properties: { folderId: { type: "string", description: "Parent folder ID (GUID)" }, Page: { type: "number" }, PageSize: { type: "number" } }, required: ["folderId"] } },
        // Phase 26: Kiosk releases by context
        { name: "list_kiosk_releases_by_job_definition", description: "List all kiosk releases for a specific job definition. Returns releases that expose this job definition in the baramundi Kiosk portal.", inputSchema: { type: "object", properties: { jobDefinitionId: { type: "string", description: "Job definition ID (GUID)" }, Page: { type: "number" }, PageSize: { type: "number" } }, required: ["jobDefinitionId"] } },
        { name: "list_kiosk_releases_by_endpoint", description: "List all kiosk releases available to a specific endpoint. Returns releases the device can access via the baramundi Kiosk portal.", inputSchema: { type: "object", properties: { endpointId: { type: "string", description: "Endpoint ID (GUID)" }, Page: { type: "number" }, PageSize: { type: "number" } }, required: ["endpointId"] } },
        { name: "list_kiosk_releases_by_ad_object", description: "List all kiosk releases available to a specific AD object (user or group). Returns releases the AD object can access via the Kiosk portal.", inputSchema: { type: "object", properties: { adObjectId: { type: "string", description: "AD object ID (GUID)" }, Page: { type: "number" }, PageSize: { type: "number" } }, required: ["adObjectId"] } },
        { name: "list_kiosk_releases_by_logical_group", description: "List all kiosk releases available to endpoints in a specific logical group. Returns releases accessible by group members via the baramundi Kiosk portal.", inputSchema: { type: "object", properties: { logicalGroupId: { type: "string", description: "Logical group ID (GUID)" }, Page: { type: "number" }, PageSize: { type: "number" } }, required: ["logicalGroupId"] } },
        // Phase 26: Job instances by group
        { name: "list_job_instances_by_static_group", description: "List all job instances for endpoints in a specific static group. Returns a paged list of job execution history for the group.", inputSchema: { type: "object", properties: { staticGroupId: { type: "string", description: "Static group ID (GUID)" }, Page: { type: "number" }, PageSize: { type: "number" } }, required: ["staticGroupId"] } },
        { name: "list_job_instances_by_dynamic_group", description: "List all job instances for endpoints in a specific dynamic group. Returns a paged list of job execution history for the group.", inputSchema: { type: "object", properties: { dynamicGroupId: { type: "string", description: "Dynamic group ID (GUID)" }, Page: { type: "number" }, PageSize: { type: "number" } }, required: ["dynamicGroupId"] } },
        { name: "list_job_instances_by_universal_dynamic_group", description: "List all job instances for endpoints in a specific universal dynamic group. Returns a paged list of job execution history for the group.", inputSchema: { type: "object", properties: { universalDynamicGroupId: { type: "string", description: "Universal dynamic group ID (GUID)" }, Page: { type: "number" }, PageSize: { type: "number" } }, required: ["universalDynamicGroupId"] } },

      ]
    };
  });

  // ── CallToolRequestSchema handler ─────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Lazily create BConnect client only when a tool is actually called.
    // This allows the server to be instantiated in tests without real credentials.
    const getBconnect = (): BConnectClient => {
      dotenv.config();
      const baseUrl = process.env.BCONNECT_BASE_URL || "https://bms-win22srv:444/bconnect";
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

      switch (name) {
        // ── Jobs ──────────────────────────────────────────────────────────
        case "list_job_definitions": {
          validateOrThrow(args, JobsRules.listJobDefinitions());
          const result = await bconnect.jobs.getJobDefinitions(args || {});
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_job_definition": {
          validateOrThrow(args, JobsRules.getJobDefinition());
          const result = await bconnect.jobs.getJobDefinition(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_job_instances": {
          validateOrThrow(args, JobsRules.listJobInstances());
          const result = await bconnect.jobs.getJobInstances(args || {});
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_job_instance": {
          validateOrThrow(args, JobsRules.getJobInstance());
          const result = await bconnect.jobs.getJobInstance(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_endpoint_job_instances": {
          validateOrThrow(args, JobsRules.getJobInstance());
          const result = await bconnect.jobs.getEndpointJobInstances(
            args!.endpointId as string,
            args || {}
          );
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_job_instances_by_definition": {
          validateOrThrow(args, JobsRules.listJobInstancesByDefinition());
          const result = await bconnect.jobs.getJobInstancesByJobDefinition(
            args!.jobDefinitionId as string,
            args || {}
          );
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_job_instances_by_logical_group": {
          validateOrThrow(args, JobsRules.listJobInstancesByLogicalGroup());
          const result = await bconnect.jobs.getJobInstancesByLogicalGroup(
            args!.logicalGroupId as string,
            args || {}
          );
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_job_definitions_by_folder": {
          validateOrThrow(args, JobsRules.listJobDefinitionsByFolder());
          const result = await bconnect.jobs.getJobDefinitionsByFolder(
            args!.folderId as string,
            args || {}
          );
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "create_job_instance": {
          validateOrThrow(args, JobsRules.createJobInstance());
          const result = await bconnect.jobs.createJobInstance(args as unknown as JobInstanceForCreation);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "start_job_instance": {
          validateOrThrow(args, JobsRules.getJobInstance());
          await bconnect.jobs.startJobInstance(args!.id as string);
          return { content: [{ type: "text", text: `Job instance ${args!.id} started successfully` }] };
        }

        case "stop_job_instance": {
          validateOrThrow(args, JobsRules.getJobInstance());
          await bconnect.jobs.stopJobInstance(args!.id as string);
          return { content: [{ type: "text", text: `Job instance ${args!.id} stopped successfully` }] };
        }

        case "resume_job_instance": {
          validateOrThrow(args, JobsRules.getJobInstance());
          await bconnect.jobs.resumeJobInstance(args!.id as string);
          return { content: [{ type: "text", text: `Job instance ${args!.id} resumed successfully` }] };
        }

        case "delete_job_instance": {
          validateOrThrow(args, JobsRules.deleteJobInstance());
          await bconnect.jobs.deleteJobInstance(args!.id as string);
          return { content: [{ type: "text", text: `Job instance ${args!.id} deleted successfully` }] };
        }

        case "create_job_folder": {
          validateOrThrow(args, JobsRules.createJobFolder());
          const result = await bconnect.jobs.createFolder(args as unknown as FolderForCreation);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "update_job_folder": {
          validateOrThrow(args, JobsRules.updateJobInstance());
          const result = await bconnect.jobs.updateFolder(args!.id as string, args! as unknown as JsonPatchDocument);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "delete_job_folder": {
          validateOrThrow(args, JobsRules.getJobFolder());
          await bconnect.jobs.deleteFolder(args!.id as string);
          return { content: [{ type: "text", text: `Job folder ${args!.id} deleted successfully` }] };
        }

        case "assign_job_to_logical_group": {
          validateOrThrow(args, JobsRules.assignJob());
          const result = await bconnect.jobs.assignJobDefinitionToLogicalGroup(
            args!.logicalGroupId as string,
            args! as unknown as AssignJobDefinitionRequest
          );
          return { content: [{ type: "text", text: `Created ${result.length} job instances:\n${JSON.stringify(result, null, 2)}` }] };
        }

        case "assign_job_to_static_group": {
          validateOrThrow(args, JobsRules.assignJob());
          const result = await bconnect.jobs.assignJobDefinitionToStaticGroup(
            args!.staticGroupId as string,
            args! as unknown as AssignJobDefinitionRequest
          );
          return { content: [{ type: "text", text: `Created ${result.length} job instances:\n${JSON.stringify(result, null, 2)}` }] };
        }

        case "assign_job_to_dynamic_group": {
          validateOrThrow(args, JobsRules.assignJob());
          const result = await bconnect.jobs.assignJobDefinitionToWindowsDynamicGroup(
            args!.dynamicGroupId as string,
            args! as unknown as AssignJobDefinitionRequest
          );
          return { content: [{ type: "text", text: `Created ${result.length} job instances:\n${JSON.stringify(result, null, 2)}` }] };
        }

        case "assign_job_to_universal_dynamic_group": {
          validateOrThrow(args, JobsRules.assignJob());
          const result = await bconnect.jobs.assignJobDefinitionToUniversalDynamicGroup(
            args!.universalDynamicGroupId as string,
            args! as unknown as AssignJobDefinitionRequest
          );
          return { content: [{ type: "text", text: `Created ${result.length} job instances:\n${JSON.stringify(result, null, 2)}` }] };
        }

        case "create_kiosk_release": {
          validateOrThrow(args, JobsRules.releaseKioskJob());
          const result = await bconnect.jobs.createKioskRelease(args! as unknown as KioskReleaseForCreation);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "withdraw_kiosk_release": {
          validateOrThrow(args, JobsRules.getJobDefinition());
          await bconnect.jobs.withdrawKioskRelease(args!.id as string);
          return { content: [{ type: "text", text: `Kiosk release ${args!.id} withdrawn successfully` }] };
        }

        case "list_kiosk_releases": {
          validateOrThrow(args, JobsRules.listJobDefinitions());
          const result = await bconnect.jobs.getKioskReleases(args || {});
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_kiosk_release": {
          validateOrThrow(args, JobsRules.getJobDefinition());
          const result = await bconnect.jobs.getKioskRelease(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        // Phase 26: Folder navigation
        case "list_job_folders": {
          validateOrThrow(args, JobsRules.listJobDefinitions());
          const result = await bconnect.jobs.getJobFolders(args || {});
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_job_folder": {
          validateOrThrow(args, JobsRules.getJobDefinition());
          const result = await bconnect.jobs.getJobFolder(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_job_subfolders": {
          validateOrThrow(args, JobsRules.listJobSubfolders());
          const result = await bconnect.jobs.getJobSubfolders(args!.folderId as string, args || {});
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        // Phase 26: Kiosk releases by context
        case "list_kiosk_releases_by_job_definition": {
          validateOrThrow(args, JobsRules.listKioskReleasesByContext('jobDefinitionId'));
          const result = await bconnect.jobs.getKioskReleasesByJobDefinition(args!.jobDefinitionId as string, args || {});
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_kiosk_releases_by_endpoint": {
          validateOrThrow(args, JobsRules.listKioskReleasesByContext('endpointId'));
          const result = await bconnect.jobs.getKioskReleasesByEndpoint(args!.endpointId as string, args || {});
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_kiosk_releases_by_ad_object": {
          validateOrThrow(args, JobsRules.listKioskReleasesByContext('adObjectId'));
          const result = await bconnect.jobs.getKioskReleasesByAdObject(args!.adObjectId as string, args || {});
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_kiosk_releases_by_logical_group": {
          validateOrThrow(args, JobsRules.listKioskReleasesByContext('logicalGroupId'));
          const result = await bconnect.jobs.getKioskReleasesByLogicalGroup(args!.logicalGroupId as string, args || {});
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        // Phase 26: Job instances by group
        case "list_job_instances_by_static_group": {
          validateOrThrow(args, JobsRules.listJobInstancesByGroup('staticGroupId'));
          const result = await bconnect.jobs.getJobInstancesByStaticGroup(args!.staticGroupId as string, args || {});
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_job_instances_by_dynamic_group": {
          validateOrThrow(args, JobsRules.listJobInstancesByGroup('dynamicGroupId'));
          const result = await bconnect.jobs.getJobInstancesByDynamicGroup(args!.dynamicGroupId as string, args || {});
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_job_instances_by_universal_dynamic_group": {
          validateOrThrow(args, JobsRules.listJobInstancesByGroup('universalDynamicGroupId'));
          const result = await bconnect.jobs.getJobInstancesByUniversalDynamicGroup(args!.universalDynamicGroupId as string, args || {});
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error: unknown) {
      if (error instanceof McpError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${message}`);
    }
  });

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

async function main() {
  dotenv.config();

  const baseUrl = process.env.BCONNECT_BASE_URL || "https://bms-win22srv:444/bconnect";
  const username = process.env.BCONNECT_USERNAME;
  const password = process.env.BCONNECT_PASSWORD;

  if (!username || !password) {
    throw new Error("BCONNECT_USERNAME and BCONNECT_PASSWORD environment variables are required");
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

  // Pre-construct a single BConnectClient for the long-running process
  const bconnect = new BConnectClient({
    baseUrl,
    username,
    password,
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

  // Verify client is initialised (unused var kept for side-effect)
  void bconnect;

  const { server } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("bconnect-jobs-mcp server running on stdio");
}

// Only run when this file is the entry point (not imported in tests)
if (process.env.VITEST === undefined) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
