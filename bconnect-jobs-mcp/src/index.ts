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
import { serializeToolResult } from "@bconnect/mcp-core";
// TOK-20 — write tools are advertised only when ALLOW_WRITE_OPERATIONS=true.
// Hiding is not disabling: `catalogue.gateWriteTool()` still answers a call by
// name with the same refusal string the hand-written gate returned.
// TOK-25 — `countOnly` asks bConnect for a page past the end of the result set,
// which returns the envelope (totalItems) with no rows.
// INT-53 — one error channel: 400/403/404/429 come back as readable tool
// results, everything else stays a protocol error with its text unchanged.
import {
  defineToolCatalogue,
  countOnlyProperty,
  detailProperty,
  fetchCount,
  handleToolError,
  isCountOnlyRequest,
  toolErrorResult,
  // Phase 4 token-consumption §2 — dateFilterProperty() exists specifically to
  // replace the 166 B hand-written LastAction sentence repeated at the 7
  // sites below (166 B -> 91 B each, 525 B suite-wide, zero behaviour change).
  dateFilterProperty,
} from "@bconnect/mcp-core";
// TOK-27 — job-instance pages drop steps[] and per-page-constant columns by
// default. See modules/job-instance-projection.ts for the measurement.
import {
  shapeJobInstanceList,
  // TOK-27's rule 3, reused rather than reimplemented. `list_job_definitions`
  // carries the same duplicate-display-name shape as a job instance page: on
  // the reference estate `displayName` equals `name` on 138 of 170 definitions
  // (81.2%) and genuinely differs on the rest.
  collapseDuplicateDisplayNames,
} from "./modules/job-instance-projection.js";
// The Destructive gate. preview_assignment computed a REFUSE verdict for these
// and nothing enforced it; the two dynamic-group tools had no preview at all.
import {
  isDestructiveJob,
  destructiveAssignmentAllowed,
  destructiveRefusalMessage,
  destructiveUncheckedNote,
} from "./modules/v11.js";
// LOCAL FIX (A2 / INT-53) — an McpError thrown out of a request handler reaches
// the caller double-prefixed ("MCP error -32602: MCP error -32602: …"): the
// constructor bakes the prefix into `.message`, the server copies `.message`
// onto the wire, and the client's own McpError rebuild prefixes it again.
// BareMcpError keeps the bare text on `.message` so the client adds the prefix
// exactly once. It still IS an McpError, so `handleToolError`'s protocol branch
// and every `err.code` assertion behave identically.
// See packages/mcp-core/src/protocol-error.ts.
import { BareMcpError } from "@bconnect/mcp-core";
// LOCAL FIX (OPT-31 / SEC-1 / INT-49) — this file used to define its own
// validateToolArguments() whose switch had ~37 fall-through case labels and no
// statements, while the fully implemented rules beside it were imported by
// nothing. See src/utils/mcp-tool-validation-rules.ts.
import { validateToolParameters } from "./utils/mcp-tool-validation-rules.js";
// LOCAL ADDITION — read-only assignment preview (see modules/preview-assignment.ts).
import { previewAssignment } from "./modules/preview-assignment.js";
// LOCAL ADDITION — read-only failure diagnosis (see modules/explain-job-failure.ts).
import { explainJobFailure } from "./modules/explain-job-failure.js";
// LOCAL ADDITION — read-only per-job reliability diagnosis (see modules/diagnose-job.ts).
import { diagnoseJob } from "./modules/diagnose-job.js";
import type { paths as JobsPaths } from "./generated/jobs-types.js";

// Type aliases for call-site casts (args are validated before use)
type AssignJobDefinitionRequest = JobsPaths["/v2.0/LogicalGroups/{logicalGroupId}/AssignJobDefinition"]["post"]["requestBody"]["content"]["application/json"];
type KioskReleaseForCreation = JobsPaths["/v2.0/KioskReleases"]["post"]["requestBody"]["content"]["application/json"];
type JsonPatchDocument = JobsPaths["/v2.0/Folders/{id}"]["patch"]["requestBody"]["content"]["application/json-patch+json"];
type JobInstanceForCreation = JobsPaths["/v2.0/JobInstances"]["post"]["requestBody"]["content"]["application/json"];
type FolderForCreation = JobsPaths["/v2.0/Folders"]["post"]["requestBody"]["content"]["application/json"];

// ─── Factory exported for testing ───────────────────────────────────────────

export interface BConnectCredentials {
  baseUrl?: string;
  username?: string;
  password?: string;
  apiKey?: string;
}

// ─── Tool catalogue ──────────────────────────────────────────────────────────
//
// LOCAL FIX (TOK-20). This array used to be built inline inside the
// ListTools handler and returned wholesale, so all 14 write tools were
// advertised even in the documented default posture where every one of them can
// only answer "Write operation '...' is disabled". It is declared once here, in
// its original order, and handed to `defineToolCatalogue` — which returns the
// same array untouched when ALLOW_WRITE_OPERATIONS=true, so the gate-open
// surface is byte-identical to what it was, and the reads only when the gate is
// shut. With the gate open the advertised surface is unchanged, so nothing that
// worked against the pre-gate build stops working.

/**
 * TOK-27 — the shaping vocabulary every job-instance list tool declares.
 *
 * `detail` and `countOnly` are core's wording so all thirteen servers spell
 * them the same way; `includeSteps` is this row shape's own opt-in, because a
 * caller who wants step detail on a page almost never also wants the other
 * fifteen fields expanded back to the raw record.
 */
const jobInstanceShapingProperties = {
  ...detailProperty,
  includeSteps: {
    type: "boolean",
    description: "Include each instance's steps[] (default false; 34% of a 20-row page)."
  },
  ...countOnlyProperty
};

const TOOLS = [
        // ── Composite analysis (LOCAL ADDITION) ───────────────────────────
        {
          name: "preview_assignment",
          description:
            "Read-only preview of what assigning a job to a group WOULD do, before doing it. Pass exactly ONE " +
            "of logicalGroupId, staticGroupId, dynamicGroupId, universalDynamicGroupId — matching the " +
            "assign_job_to_* tool you are about to call. Reports endpoint reach, how many are online and would " +
            "run it immediately, whether the job is flagged Destructive, and whether execution is immediate, " +
            "scheduled or passive. LOGICAL groups include descendant groups, because assignment cascades while " +
            "membership queries show only direct members; the other three do not nest. Dynamic and universal " +
            "dynamic membership is server-computed, so this is a snapshot, and their ids are NOT " +
            "interchangeable — the wrong kind answers 404. ALWAYS call this before any assign_job_to_* tool — " +
            "assignment executes the job unless a schedule defers it. Makes no changes.",
          inputSchema: {
            type: "object",
            properties: {
              jobDefinitionId: { type: "string", description: "GUID of the job definition to preview." },
              logicalGroupId: { type: "string", description: "GUID of the target logical group." },
              staticGroupId: { type: "string", description: "GUID of the target static group." },
              dynamicGroupId: { type: "string", description: "GUID of the target dynamic group." },
              universalDynamicGroupId: { type: "string", description: "GUID of the target universal dynamic group." },
              liveWithinDays: {
                type: "number",
                description: "Treat an endpoint as online if seen within this many days (default: 7)."
              },
            },
            required: ["jobDefinitionId"]
          }
        },
        {
          name: "explain_job_failure",
          // ── DECLINED 2026-08-14: a "(job × endpoint)" composite ────────────
          // `BYTE-RANKING-2026-08-13.md` §6-B1 names "why is this job failing on
          // THIS endpoint, and will retrying help?" as an uncosted candidate. A
          // survey of the sources says it is already answered and should not be
          // built, so the decline is recorded HERE, where the next reader meets
          // the temptation, rather than only in a report:
          //   - this tool takes BOTH `jobDefinitionId` and `endpointName`, and
          //     that intersection IS the (job × endpoint) question, in one call;
          //   - `diagnose_job` already answers "will retrying help" for the job
          //     side — v1.1 JobExecutionTimeout/AbortOnError, timeout-vs-error
          //     split, and whether failures cluster on never-online endpoints;
          //   - `get_endpoint_briefing` answers the endpoint side, reading
          //     historical counters rather than current state.
          // Building it would be the composite-tier version of the §8-B
          // rejection: a new tool competing with a shipped one for a marginal
          // difference, paying permanent catalogue cost for it.
          //
          // TRIMMED 786 B -> 494 B. What went was the mechanism ("classifies
          // failures on the `state` field") and the inventory of sub-reports.
          // Both were describing the answer rather than the question.
          // What stayed verbatim: BOTH pieces of routing guidance. "PREFER THIS
          // over paging list_job_instances" with its reason, and the "Do NOT
          // filter by state" warning — that one is not style, it is a trap:
          // SearchQuery matches display text, so filtering on the literal
          // `FinishedWithError` returns an empty list that looks like good news.
          description:
            "Diagnose why jobs are failing across the estate. Clusters the job-instance history by " +
            "normalised root cause, so repeated failures collapse into one finding, and names the jobs and " +
            "endpoints affected — including those that have never once succeeded. PREFER THIS over paging " +
            "list_job_instances: even with its compact rows the history runs to dozens of pages. Do NOT try " +
            "to filter list_job_instances by state instead — SearchQuery matches display text, so the " +
            "literal value `FinishedWithError` returns nothing. Makes no changes.",
          inputSchema: {
            type: "object",
            properties: {
              sinceDays: {
                type: "number",
                description: "Only consider instances whose last action is within this many days. Omit for all history."
              },
              jobDefinitionId: {
                type: "string",
                description: "Restrict the diagnosis to one job definition (GUID)."
              },
              endpointName: {
                type: "string",
                description: "Restrict the diagnosis to one endpoint, by display name."
              },
              topClusters: {
                type: "number",
                description: "How many root-cause clusters to return (default: 10)."
              },
              includeInstanceIds: {
                type: "boolean",
                description: "Include the instance GUIDs behind each cluster (default: false)."
              },
            },
            required: []
          }
        },

        {
          name: "diagnose_job",
          // TRIMMED 1,122 B -> 610 B. What went was the output inventory — the
          // five verdict labels, the parenthetical definition of
          // SELF-PERPETUATING, the field list of the v1.1 config, and the
          // sentence listing which sub-reports the response contains. A model
          // reads none of that to decide whether to call; it reads it after.
          // What stayed, deliberately: the PREFER THIS line and its reason (it
          // is the only thing that stops a model reaching for get_job_definition
          // and getting a copy of the list entry), the v1.1 provenance (it is
          // why this tool can answer at all), and the degraded-mode sentence
          // (without it a model treats a partial answer as a failed call).
          description:
            "Diagnose why ONE specific job definition is unreliable. Combines the job's configuration — " +
            "read from bConnect v1.1, the only place JobExecutionTimeout, AbortOnError and Destructive " +
            "exist — with its recent instance history and per-step outcomes into a single verdict, from " +
            "RELIABLE to UNRELIABLE — SELF-PERPETUATING, plus the timeout-vs-error split and whether " +
            "failures cluster on endpoints that are never online. PREFER THIS over get_job_definition for " +
            "understanding one job's failures: get_job_definition is field-for-field identical to the list " +
            "entry. If v1.1 is unreachable it still answers from instance history alone and names the " +
            "missing signals in meta. Makes no changes.",
          inputSchema: {
            type: "object",
            properties: {
              jobDefinitionId: { type: "string", description: "GUID of the job definition to diagnose." },
              sinceDays: {
                type: "number",
                description: "Only consider instances whose last action is within this many days. Omit for all fetched history."
              },
              maxInstances: {
                type: "number",
                description: "Cap on instances fetched for this job (default: 300)."
              },
              staleAfterDays: {
                type: "number",
                description: "An endpoint with no check-in inside this many days counts as 'never online' for the self-perpetuating-failure check (default: 30)."
              },
            },
            required: ["jobDefinitionId"]
          }
        },
        // ── Jobs API ──────────────────────────────────────────────────────
        {
          name: "list_job_definitions",
          description: "List all job definitions in baramundi. Supports filtering, searching, and pagination. Returns job definitions with their GUIDs, names, and properties. Use this to find available software packages or scripts before deploying. displayName is omitted on rows where it is identical to name and kept where it differs; meta.omittedWhenEqual says so. countOnly:true answers 'how many' without fetching a page.",
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
              },
              Name: { type: "string", description: "Filters results by exactly matching name." },
              ...countOnlyProperty
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
        // LOCAL FIX — D14b. EndpointType and LastAction are declared by
        // GET /v2.0/JobInstances (operations.GetJobInstances in
        // src/generated/jobs-types.ts) and neither was exposed.
        //
        // EndpointType carries its allowed values because it is an enum, and
        // enums are the one query-parameter class bConnect does not silently
        // ignore — a bad value returns HTTP 400 rather than an unfiltered 200,
        // so a guessing model simply fails. `Deprecated_IndustrialEndpoint` is
        // omitted: the schema records it as removed in 26.1 and kept only to
        // avoid gaps in the enum's numeric values.
        //
        // Note for callers: neither of these is a state filter. **D15 still
        // applies** — job-instance state cannot be filtered server-side at all,
        // because SearchQuery matches the human-readable description rather
        // than the enum the API itself returns. Page and filter state
        // client-side, as explain_job_failure does.
        {
          name: "list_job_instances",
          description: "List all job instances (execution history) in baramundi. Supports filtering, searching, and pagination. Returns job instances with their status, endpoint, and timing information. Use this to monitor deployment progress across all endpoints. Rows are compact by default; meta names what was omitted.",
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
              },
              EndpointType: { type: "string", enum: ["WindowsEndpoint","AndroidEndpoint","IOSEndpoint","MacEndpoint","NetworkEndpoint","LinuxEndpoint"], description: "Filters result set by type of endpoint the job instance is executed on." },
              ...dateFilterProperty("LastAction"),
              ...jobInstanceShapingProperties
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
        // LOCAL FIX — INT-47. This tool was `list_endpoint_job_instances`,
        // the one member of the `list_job_instances_by_*` family that did not
        // follow the family's own naming (by_definition, by_logical_group,
        // by_static_group, by_dynamic_group, by_universal_dynamic_group). A
        // model that learned the convention guessed
        // `list_job_instances_by_endpoint` and got MethodNotFound, and the
        // outlier sorted away from its five siblings in a 284-tool catalogue.
        // Renamed, not aliased: this is a pre-publication breaking surface
        // revision, and shipping a deprecated alias would keep paying the
        // schema bytes for the mistake. It is not one of the thirteen
        // demo-protected names.
        {
          name: "list_job_instances_by_endpoint",
          description: "List all job instances for a specific endpoint in baramundi. Returns all deployment runs (job executions) assigned to that endpoint with their status and timing. Use this to see all jobs running on a particular device. Rows are compact by default; meta names what was omitted.",
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
              },
              ...dateFilterProperty("LastAction"),
              ...jobInstanceShapingProperties
            },
            required: ["endpointId"]
          }
        },
        {
          name: "list_job_instances_by_definition",
          // ── DECLINED 2026-08-14: a "where is this job deployed?" composite ──
          // There IS a real structural gap: assignment is WRITE-ONLY in bConnect
          // 26R1. `POST /v2.0/LogicalGroups/{id}/AssignJobDefinition` and its
          // static/dynamic/UDG siblings exist with no GET that lists a job
          // definition's assignment targets; `JobInstance` carries endpoint
          // fields but no assignment target, and only `KioskRelease` carries
          // `assignmentTargetId/Name/Type`. Compounding it, /StaticGroups and
          // /DynamicGroups both answer 404 (see endpoint-reach.ts), so those
          // group kinds cannot be enumerated at all.
          //
          // Declined anyway, and recorded here because THIS tool is why: it
          // already returns every endpoint carrying an instance of the job, in
          // one paged call, which is most of what "who gets this job" means. A
          // composite could only add WHICH group assignment caused it — the one
          // thing no route can answer. It would be a permanent catalogue cost
          // wrapped around an unenumerable blind spot.
          description: "List all job instances (execution history) for a specific job definition. Returns every deployment run of a given software package or script across all targeted endpoints. Use this for deployment tracking, rollout status, and identifying failed executions across your fleet. Rows are compact by default; meta names what was omitted.",
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
              },
              EndpointType: { type: "string", enum: ["WindowsEndpoint","AndroidEndpoint","IOSEndpoint","MacEndpoint","NetworkEndpoint","LinuxEndpoint"], description: "Filters result set by type of endpoint the job instance is executed on." },
              ...dateFilterProperty("LastAction"),
              ...jobInstanceShapingProperties
            },
            required: ["jobDefinitionId"]
          }
        },
        {
          name: "list_job_instances_by_logical_group",
          description: "List all job instances assigned to endpoints within a specific logical group. Returns the deployment execution status for every job running against devices in the group. Essential for monitoring rollout progress and identifying failures across a managed group of endpoints. Rows are compact by default; meta names what was omitted.",
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
              },
              JobDefinitionId: { type: "string", description: "Filters result set by the id of the job definition." },
              ...dateFilterProperty("LastAction"),
              includeSubfolders: { type: "boolean", description: "If true, also returns objects contained in sub-folders / sub-groups of the given container (default: false)." },
              ...jobInstanceShapingProperties
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
              },
              Name: { type: "string", description: "Filters results by exactly matching name." },
              ...countOnlyProperty
            },
            required: ["folderId"]
          }
        },
        // Jobs API - Write Operations
        {
          name: "create_job_instance",
          description: "Create a job instance by assigning a job definition to an endpoint in baramundi. This initiates a deployment or script execution. Execution is immediate on assignment — the 26R1 body offers no scheduling field. WARNING: This creates a new job assignment that will be executed on the target endpoint.",
          // scheduledStartTime was advertised here until 2026-08-11 and
          // JobInstanceForCreation declares no such field — bConnect answers
          // 200 and drops the unknown key (D6), so a model believed a
          // deployment deferred that was not. Rule H now pins every property
          // here to the operation; endpointId is required because the spec
          // requires it.
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
          description: "Assign a job definition to all endpoints in a logical group in baramundi. Creates job instances for each endpoint in the group. WARNING: Creates job instances for all endpoints in the group and triggers deployment. PARTIAL SUCCESS IS POSSIBLE: this route answers HTTP 207 when SOME endpoints were assigned and others were refused, and the refused ones are listed in the response body. A 2xx here does NOT mean every endpoint got the job. Always read the response body and report which endpoints were actually assigned, not the group as a whole.",
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
          description: "Assign a job definition to all endpoints in a static group in baramundi. Creates job instances for each endpoint in the static group. WARNING: Creates job instances for all endpoints in the group. PARTIAL SUCCESS IS POSSIBLE: this route answers HTTP 207 when SOME endpoints were assigned and others were refused, and the refused ones are listed in the response body. A 2xx here does NOT mean every endpoint got the job. Always read the response body and report which endpoints were actually assigned, not the group as a whole.",
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
          description: "Assign a job definition to all endpoints in a Windows dynamic group in baramundi. Creates job instances for each endpoint matching the dynamic group criteria. WARNING: Creates job instances for all matching endpoints. PARTIAL SUCCESS IS POSSIBLE: this route answers HTTP 207 when SOME endpoints were assigned and others were refused, and the refused ones are listed in the response body. A 2xx here does NOT mean every endpoint got the job. Always read the response body and report which endpoints were actually assigned, not the group as a whole.",
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
          description: "Assign a job definition to all endpoints in a universal dynamic group in baramundi. Creates job instances for each endpoint matching the universal dynamic group criteria. WARNING: Creates job instances for all matching endpoints. PARTIAL SUCCESS IS POSSIBLE: this route answers HTTP 207 when SOME endpoints were assigned and others were refused, and the refused ones are listed in the response body. A 2xx here does NOT mean every endpoint got the job. Always read the response body and report which endpoints were actually assigned, not the group as a whole.",
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
          description: "Create a kiosk release to make a job definition available for execution via the baramundi Kiosk portal. Allows end users to self-service install software. Requires JobAssignTarget rights on the job definition AND SystemOrAdObjectAssignJob rights on the target object — a credential with only one of the two gets refused. WARNING: Creates a kiosk release that enables end-user triggered deployment.",
          // This parameter was advertised as `targetId` (optional) until
          // 2026-08-11, while KioskReleaseForCreation REQUIRES
          // `assignmentTargetId` — the required key was never sent under its
          // right name on any call. Rule H pins the name; the spec pins the
          // requiredness.
          inputSchema: {
            type: "object",
            properties: {
              jobDefinitionId: { type: "string", description: "Job definition ID (GUID)" },
              assignmentTargetId: { type: "string", description: "Target object ID the release is assigned to (endpoint, group, or AD object GUID)" }
            },
            required: ["jobDefinitionId", "assignmentTargetId"]
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
              PageSize: { type: "number", description: "Number of results per page" },
              ...countOnlyProperty
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
        { name: "list_job_folders", description: "List job folders in baramundi. GET /v2.0/Folders has no parent/root filter — this returns the FLAT set of every folder at every depth, not just top-level ones; do not assume every row is a root folder. Each row carries id, name, comment, parentId (the parent folder's id) and parent (the parent folder's name). Do NOT identify roots by an absent or empty parentId: the Folder schema declares parentId optional but not nullable, so it promises nothing either way, and on the estate this was measured against every single row carried a non-empty parentId — that measurement is one estate at one moment and yours may differ. Because this response is the flat and complete set, derive roots instead: a row is a root of what you can see when its parentId matches no id in the returned rows. Pass a row's id as list_job_subfolders' folder-id argument to get that folder's direct children.", inputSchema: { type: "object", properties: {
          SearchQuery: { type: "string" }, Page: { type: "number" }, PageSize: { type: "number" }, OrderBy: { type: "string" },
          Name: { type: "string", description: "Filters result by matching the exact value against Name." },
          ...countOnlyProperty
        } } },
        { name: "get_job_folder", description: "Get details of a specific job folder by its GUID. Returns folder name, description, and parent folder information.", inputSchema: { type: "object", properties: { id: { type: "string", description: "Folder ID (GUID)" } }, required: ["id"] } },
        { name: "list_job_subfolders", description: "List all sub-folders within a specific job folder. Returns a paged list of child folders for the given parent folder GUID.", inputSchema: { type: "object", properties: {
          folderId: { type: "string", description: "Parent folder ID (GUID)" }, Page: { type: "number" }, PageSize: { type: "number" },
          Name: { type: "string", description: "Filters result by matching the exact value against Name." },
          includeSubfolders: { type: "boolean", description: "If true, also returns objects contained in sub-folders / sub-groups of the given container (default: false)." },
          ...countOnlyProperty
        }, required: ["folderId"] } },
        // Phase 26: Kiosk releases by context
        { name: "list_kiosk_releases_by_job_definition", description: "List all kiosk releases for a specific job definition. Returns releases that expose this job definition in the baramundi Kiosk portal.", inputSchema: { type: "object", properties: { jobDefinitionId: { type: "string", description: "Job definition ID (GUID)" }, Page: { type: "number" }, PageSize: { type: "number" }, ...countOnlyProperty }, required: ["jobDefinitionId"] } },
        { name: "list_kiosk_releases_by_endpoint", description: "List all kiosk releases available to a specific endpoint. Returns releases the device can access via the baramundi Kiosk portal.", inputSchema: { type: "object", properties: { endpointId: { type: "string", description: "Endpoint ID (GUID)" }, Page: { type: "number" }, PageSize: { type: "number" }, ...countOnlyProperty }, required: ["endpointId"] } },
        { name: "list_kiosk_releases_by_ad_object", description: "List all kiosk releases available to a specific AD object (user or group). Returns releases the AD object can access via the Kiosk portal.", inputSchema: { type: "object", properties: { adObjectId: { type: "string", description: "AD object ID (GUID)" }, Page: { type: "number" }, PageSize: { type: "number" }, ...countOnlyProperty }, required: ["adObjectId"] } },
        { name: "list_kiosk_releases_by_logical_group", description: "List all kiosk releases available to endpoints in a specific logical group. Returns releases accessible by group members via the baramundi Kiosk portal.", inputSchema: { type: "object", properties: { logicalGroupId: { type: "string", description: "Logical group ID (GUID)" }, Page: { type: "number" }, PageSize: { type: "number" }, ...countOnlyProperty }, required: ["logicalGroupId"] } },
        // Phase 26: Job instances by group
        { name: "list_job_instances_by_static_group", description: "List all job instances for endpoints in a specific static group. Returns a paged list of job execution history for the group. Rows are compact by default; meta names what was omitted.", inputSchema: { type: "object", properties: {
          staticGroupId: { type: "string", description: "Static group ID (GUID)" }, Page: { type: "number" }, PageSize: { type: "number" },
          JobDefinitionId: { type: "string", description: "Filters result set by the id of the job definition." },
          ...dateFilterProperty("LastAction"),
          ...jobInstanceShapingProperties
        }, required: ["staticGroupId"] } },
        { name: "list_job_instances_by_dynamic_group", description: "List all job instances for endpoints in a specific dynamic group. Returns a paged list of job execution history for the group. Rows are compact by default; meta names what was omitted.", inputSchema: { type: "object", properties: {
          dynamicGroupId: { type: "string", description: "Dynamic group ID (GUID)" }, Page: { type: "number" }, PageSize: { type: "number" },
          JobDefinitionId: { type: "string", description: "Filters result set by the id of the job definition." },
          ...dateFilterProperty("LastAction"),
          ...jobInstanceShapingProperties
        }, required: ["dynamicGroupId"] } },
        { name: "list_job_instances_by_universal_dynamic_group", description: "List all job instances for endpoints in a specific universal dynamic group. Returns a paged list of job execution history for the group. Rows are compact by default; meta names what was omitted.", inputSchema: { type: "object", properties: {
          universalDynamicGroupId: { type: "string", description: "Universal dynamic group ID (GUID)" }, Page: { type: "number" }, PageSize: { type: "number" },
          JobDefinitionId: { type: "string", description: "Filters result set by the id of the job definition." },
          ...dateFilterProperty("LastAction"),
          ...jobInstanceShapingProperties
        }, required: ["universalDynamicGroupId"] } },

];

/**
 * The mutating tools, by name (REQ-SRV-012).
 *
 * Declared, never inferred: `defineToolCatalogue` throws if a name here is not
 * in `TOOLS`, which is the drift that let `withdraw_kiosk_release` execute
 * ungated (finding F21).
 */
const WRITE_TOOL_NAMES = [
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
  // LOCAL PATCH (F21): withdrawing a kiosk release is a mutation, but it was
  // absent from the gate while create_kiosk_release was present, so it
  // executed with ALLOW_WRITE_OPERATIONS unset.
  "withdraw_kiosk_release",
] as const;

const catalogue = defineToolCatalogue({ tools: TOOLS, write: WRITE_TOOL_NAMES });

/**
 * Every job-instance list tool shares one row shape, so one projection.
 *
 * Exported so a test can assert the declared shaping vocabulary and the set of
 * tools that actually shape their response cannot drift apart.
 */
export const JOB_INSTANCE_LIST_TOOLS: ReadonlySet<string> = new Set([
  "list_job_instances",
  "list_job_instances_by_endpoint",
  "list_job_instances_by_definition",
  "list_job_instances_by_logical_group",
  "list_job_instances_by_static_group",
  "list_job_instances_by_dynamic_group",
  "list_job_instances_by_universal_dynamic_group",
]);

type ToolResult = { content: { type: "text"; text: string }[] };

/**
 * The shaping flags this server answers itself. They are never query
 * parameters.
 *
 * The list handlers forward the whole argument object to the client as
 * `params`, so without this every `detail` / `includeSteps` / `countOnly` would
 * be appended to the bConnect URL. bConnect answers 200 and silently drops a
 * parameter it does not know (finding D6), so nothing would visibly break — it
 * would just put the caller's shaping vocabulary on the wire forever, and
 * `__tests__/suite-schema-vs-types.test.ts` exists precisely to catch a tool
 * sending a parameter its operation does not declare.
 */
const CLIENT_SIDE_PARAMS = ["detail", "fields", "countOnly", "includeSteps"] as const;

/**
 * The four tools that assign a job definition to a whole GROUP.
 *
 * Named once rather than matched by prefix: `assign_` would also catch a future
 * per-endpoint assignment, where the destructive gate's reasoning (a
 * non-enumerable, server-computed blast radius) does not apply.
 */
const ASSIGNMENT_TOOLS = new Set([
  "assign_job_to_logical_group",
  "assign_job_to_static_group",
  "assign_job_to_dynamic_group",
  "assign_job_to_universal_dynamic_group",
]);

/** The caller's arguments with the client-side shaping flags removed. */
function apiParams(args: Record<string, unknown> | undefined): Record<string, unknown> {
  const params = { ...(args ?? {}) };
  for (const key of CLIENT_SIDE_PARAMS) {
    delete params[key];
  }
  return params;
}

/**
 * TOK-27 — serialise one page of job instances through the projection.
 *
 * `detail: true` short-circuits to the API payload unchanged; `includeSteps`
 * keeps `steps[]` without expanding everything else back.
 */
function jobInstanceListResult(
  payload: unknown,
  args: Record<string, unknown> | undefined
): ToolResult {
  const shaped = shapeJobInstanceList(payload as Record<string, unknown>, {
    full: args?.detail === true,
    includeSteps: args?.includeSteps === true,
    args,
  });
  return { content: [{ type: "text", text: serializeToolResult(shaped) }] };
}

/**
 * TOK-25 — answer "how many?" with the envelope from a page past the end of the
 * result set, preserving the caller's filters exactly.
 *
 * `includeSteps` is stripped first: core already drops `detail`/`fields`/
 * `countOnly`, but `includeSteps` is this server's own flag and would otherwise
 * be forwarded as a query parameter and echoed back as if it were a filter.
 */
async function countOnlyResult(
  fetchPage: (params: Record<string, unknown>) => Promise<unknown>,
  args: Record<string, unknown> | undefined
): Promise<ToolResult> {
  const filters = { ...(args ?? {}) };
  delete filters.includeSteps;
  const count = await fetchCount(fetchPage, filters);
  return { content: [{ type: "text", text: serializeToolResult(count) }] };
}

export function createServer(credentials?: BConnectCredentials): { server: Server; getClient: () => BConnectClient } {
  const server = new Server(
    {
      name: "bconnect-jobs-mcp",
      version: "26.1.8"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // ── ListToolsRequestSchema handler ────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: catalogue.listTools() };
  });

  // ── CallToolRequestSchema handler ─────────────────────────────────────────

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
    // (BCONNECT_API_KEY__JOBS); with no such variable set this
    // changes nothing. See mcp-core/server-scoped-credentials.ts.
    serverName: "bconnect-jobs-mcp",
    factory: (config) => new BConnectClient(config),
    credentials,
    defaultBaseUrl: "https://bms.example.com:443/bconnect",
    onMissingCredentials: () => {
      throw new BareMcpError(
        ErrorCode.InternalError,
        "Either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD are required"
      );
    },
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Validate arguments first — pure, no side effects, fails fast on bad input.
    // This now genuinely does that: the local stub it replaces was an empty
    // switch that returned silently for every tool (OPT-31 / SEC-1 / INT-49).
    validateToolParameters(name, args);

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

    // ── Write-operation gate (REQ-SRV-012) ───────────────────────────────────
    // TOK-20: the set of write tools now lives in WRITE_TOOL_NAMES beside the
    // catalogue, so the same declaration both hides them from tools/list and
    // refuses them here. The refusal string is byte-identical to the one this
    // block built by hand — hiding a tool is not disabling it, and a client
    // that already knows the name still gets the same answer.
    const denied = catalogue.gateWriteTool(name);
    if (denied) {
      return denied;
    }

    // LOCAL ADDITION — a second, finer-grained gate on top of the vendor's
    // all-or-nothing ALLOW_WRITE_OPERATIONS flag (upstream finding D4).
    //
    // ALLOW_WRITE_OPERATIONS=true unlocks all 14 write tools in this server at
    // once — there is no way to permit "assign a job" without also permitting
    // "delete a job folder". ALLOWED_WRITE_TOOLS narrows that to an explicit,
    // comma-separated subset for this process. It only ever narrows: an entry
    // that is not a real write tool name grants nothing, since this check only
    // runs for names the catalogue already declares as writes. Unset (the
    // default) changes nothing — existing deployments keep today's
    // all-or-nothing behaviour.
    const allowedWriteToolsRaw = process.env.ALLOWED_WRITE_TOOLS;
    if (catalogue.isWriteTool(name) && allowedWriteToolsRaw !== undefined) {
      const allowedWriteTools = new Set(
        allowedWriteToolsRaw.split(",").map((s) => s.trim()).filter(Boolean)
      );
      if (!allowedWriteTools.has(name)) {
        return {
          content: [{
            type: "text" as const,
            text:
              `Write operation '${name}' is not in this session's approved tool set. ` +
              `ALLOWED_WRITE_TOOLS permits: ${[...allowedWriteTools].sort().join(", ") || "(none)"}.`
          }],
          isError: true
        };
      }
    }


    try {
      const bconnect = getBconnect();

      // ── Destructive-assignment gate (a second gate INSIDE the write gate) ──
      //
      // `preview_assignment` already computes a REFUSE verdict for a job the
      // bMS flags Destructive, and that verdict was ADVISORY ONLY: nothing
      // checked it before the assignment ran. Worse, preview_assignment
      // accepted only a logical group id, so the two dynamic-group assignment
      // tools had no preview at all — and dynamic-group membership is computed
      // server-side, so the blast radius is not enumerable before the call.
      //
      // The path that closes: injected text in an estate string leads a model
      // to assign a job carrying a wipe or OS-deploy step to a broad dynamic
      // group; every matching endpoint runs it at next check-in. A deployer
      // who accepted writes has not thereby accepted that.
      //
      // Deliberately here rather than inside each case arm: every other policy
      // gate in this handler is pre-dispatch, and an `await` inside a case arm
      // is read by `readToolDispatch` as that tool's module method — which
      // silently unmapped all four tools from their routes and was caught by
      // the descriptions guard's own "the route mapping is probably broken"
      // canary.
      //
      // The gate refuses a job KNOWN to be destructive. When v1.1 cannot answer
      // it has nothing to refuse — v1.1 is optional and LAN-only, and refusing
      // every assignment whenever it is unreadable would break the default
      // posture for every deployer. So the assignment proceeds, and the result
      // says it was not checked: an unverified assignment must not come back
      // looking exactly like a verified one.
      let uncheckedNote: string | null = null;
      if (ASSIGNMENT_TOOLS.has(name)) {
        const { destructive, reason } = await isDestructiveJob(
          bconnect.getHttpClient(),
          args!.jobDefinitionId as string
        );
        if (destructive === true && !destructiveAssignmentAllowed()) {
          return toolErrorResult(
            destructiveRefusalMessage(name, args!.jobDefinitionId as string)
          );
        }
        if (destructive === null) {
          uncheckedNote = destructiveUncheckedNote(
            name,
            args!.jobDefinitionId as string,
            reason ?? "unknown reason"
          );
        }
      }
      /** Appends the "not checked" disclosure to an assignment's result text. */
      const withDestructiveCheck = (text: string): string =>
        uncheckedNote ? `${text}\n\n${uncheckedNote}` : text;

      /**
       * What a group assignment can HONESTLY be reported as.
       *
       * These four routes declare exactly one 2xx and it is 207: "Group
       * assignment fully or partially succeeded. Failed assignments may be
       * listed in the response body with reasons for the error." The body is
       * `ProblemDetails`, not `JobInstance[]`. There is no 200, so every
       * success takes this path.
       *
       * The old text was `Created ${result.length} job instances`, wrong in two
       * reachable ways: on the declared body `.length` is undefined, and when
       * an array IS returned the count describes what was created and says
       * nothing about what failed — which is the single thing a 207 exists to
       * report. An operator assigns a patch job to a group, reads a count, and
       * never learns that some endpoints did not get it.
       *
       * Deliberately phrased as what the route DECLARES, not as an observed
       * status: the module returns `response.data` and nothing here inspects
       * `response.status`. Writing "returned HTTP 207" would assert an
       * observation this code never makes — the same defect corrected in
       * servermanagement's start/restart text.
       */
      const describeAssignment = (result: unknown): string => {
        const rows = Array.isArray(result) ? result : null;
        // "Not every member" is not the whole warning. The only 207 captured
        // from this estate (phase3-rollback journals, 2026-07-28) created
        // NOTHING: every endpoint came back 403 "Missing rights for assigning
        // job definition to endpoint …" inside a `problems[]` array. Wording
        // that only hedges completeness lets a floor of zero read as "most of
        // it worked", which is the same missing-fact-as-good-fact this helper
        // exists to remove, one level up.
        const counted = rows
          ? `${rows.length} job instance(s) are listed below as created.`
          : `The response carried no job-instance list, so this call cannot say how many were ` +
            `created — the count may be ZERO. A 207 body is a problem report; where it names ` +
            `endpoints, each one named is an endpoint that did NOT get the job.`;
        // A JobInstance[] body structurally cannot carry failures, so pointing
        // at it for them would send a reader looking for something that is not
        // there and let the absence read as clean.
        const whereFailures = rows
          ? `This body lists creations only and cannot show refusals, so absence of an error here ` +
            `is not evidence there were none.`
          : `Read the body below for which endpoints were refused and why.`;
        return (
          `Assignment request sent. ${counted} This route declares exactly ONE success code — ` +
          `207, "fully or partially succeeded" — so a result here is NOT evidence that every ` +
          `member was assigned, and not evidence that any was. ${whereFailures} Confirm with ` +
          `list_job_instances_by_definition before reporting the group as done.` +
          `\n${serializeToolResult(result)}`
        );
      };

      switch (name) {
        // ── Jobs ──────────────────────────────────────────────────────────
        // LOCAL ADDITION — read-only preview; issues no writes.
        case "preview_assignment": {
          const result = await previewAssignment(bconnect.getHttpClient(), {
            jobDefinitionId: args!.jobDefinitionId as string,
            // One per assign_job_to_* tool. The module refuses zero and refuses
            // more than one rather than picking — see selectTarget().
            logicalGroupId: args?.logicalGroupId as string | undefined,
            staticGroupId: args?.staticGroupId as string | undefined,
            dynamicGroupId: args?.dynamicGroupId as string | undefined,
            universalDynamicGroupId: args?.universalDynamicGroupId as string | undefined,
            liveWithinDays: args?.liveWithinDays as number | undefined,
          });
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        // LOCAL ADDITION — read-only diagnosis; issues no writes.
        case "explain_job_failure": {
          const result = await explainJobFailure(bconnect.jobs, bconnect.getHttpClient(), {
            sinceDays: args?.sinceDays as number | undefined,
            jobDefinitionId: args?.jobDefinitionId as string | undefined,
            endpointName: args?.endpointName as string | undefined,
            topClusters: args?.topClusters as number | undefined,
            includeInstanceIds: args?.includeInstanceIds as boolean | undefined,
          });
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        // LOCAL ADDITION — read-only per-job diagnosis; issues no writes.
        case "diagnose_job": {
          const result = await diagnoseJob(bconnect.jobs, bconnect.getHttpClient(), {
            jobDefinitionId: args!.jobDefinitionId as string,
            sinceDays: args?.sinceDays as number | undefined,
            maxInstances: args?.maxInstances as number | undefined,
            staleAfterDays: args?.staleAfterDays as number | undefined,
          });
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_job_definitions": {
          if (isCountOnlyRequest(args)) {
            return countOnlyResult((params) => bconnect.jobs.getJobDefinitions(params), args);
          }
          const result = await bconnect.jobs.getJobDefinitions(apiParams(args));
          // Strictly lossless: `displayName` is omitted only where it is
          // byte-identical to `name` on the same row, so the value is still
          // there to read. No detail:true is added for it — there is nothing to
          // recover — which is why this tool costs ~150 catalogue bytes rather
          // than the ~490 a detail/fields projection costs.
          return {
            content: [
              {
                type: "text",
                text: serializeToolResult(
                  collapseDuplicateDisplayNames(result, "displayName", "name")
                ),
              },
            ],
          };
        }

        case "get_job_definition": {
          const result = await bconnect.jobs.getJobDefinition(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_job_instances": {
          if (isCountOnlyRequest(args)) {
            return countOnlyResult((params) => bconnect.jobs.getJobInstances(params), args);
          }
          const result = await bconnect.jobs.getJobInstances(apiParams(args));
          return jobInstanceListResult(result, args);
        }

        // get_job_instance is deliberately NOT projected: it is the one-record
        // escape hatch the list projection's hint points at, and its steps[] is
        // the reason a caller asked for one instance instead of a page.
        case "get_job_instance": {
          const result = await bconnect.jobs.getJobInstance(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        // INT-47 — was `list_endpoint_job_instances`; renamed to sort with its
        // five `list_job_instances_by_*` siblings.
        case "list_job_instances_by_endpoint": {
          const endpointId = args!.endpointId as string;
          if (isCountOnlyRequest(args)) {
            return countOnlyResult(
              (params) => bconnect.jobs.getEndpointJobInstances(endpointId, params),
              args
            );
          }
          const result = await bconnect.jobs.getEndpointJobInstances(endpointId, apiParams(args));
          return jobInstanceListResult(result, args);
        }

        case "list_job_instances_by_definition": {
          const jobDefinitionId = args!.jobDefinitionId as string;
          if (isCountOnlyRequest(args)) {
            return countOnlyResult(
              (params) => bconnect.jobs.getJobInstancesByJobDefinition(jobDefinitionId, params),
              args
            );
          }
          const result = await bconnect.jobs.getJobInstancesByJobDefinition(
            jobDefinitionId,
            apiParams(args)
          );
          return jobInstanceListResult(result, args);
        }

        case "list_job_instances_by_logical_group": {
          const logicalGroupId = args!.logicalGroupId as string;
          if (isCountOnlyRequest(args)) {
            return countOnlyResult(
              (params) => bconnect.jobs.getJobInstancesByLogicalGroup(logicalGroupId, params),
              args
            );
          }
          const result = await bconnect.jobs.getJobInstancesByLogicalGroup(
            logicalGroupId,
            apiParams(args)
          );
          return jobInstanceListResult(result, args);
        }

        case "list_job_definitions_by_folder": {
          const folderId = args!.folderId as string;
          if (isCountOnlyRequest(args)) {
            return countOnlyResult(
              (params) => bconnect.jobs.getJobDefinitionsByFolder(folderId, params),
              args
            );
          }
          const result = await bconnect.jobs.getJobDefinitionsByFolder(folderId, apiParams(args));
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "create_job_instance": {
          const result = await bconnect.jobs.createJobInstance(args as unknown as JobInstanceForCreation);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
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
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "update_job_folder": {
          // The route's only content type is application/json-patch+json — an
          // ARRAY of operations. Until 2026-08-11 this arm sent the raw
          // {id,name,comment} args object as that body, the exact shape
          // jobs-module-writes.test.ts forbids of the module; the arm is now
          // pinned by write-body-shapes.test.ts through the real handler.
          // The generated Operation type says `value: Record<string, never>`
          // (the generator's rendering of an untyped value), so the ops are
          // built with the real shape and cast once at the boundary.
          const ops: { op: "replace"; path: string; value: string }[] = [];
          if (typeof args!.name === "string") {ops.push({ op: "replace", path: "/name", value: args!.name });}
          if (typeof args!.comment === "string") {ops.push({ op: "replace", path: "/comment", value: args!.comment });}
          if (ops.length === 0) {
            throw new BareMcpError(
              ErrorCode.InvalidParams,
              "update_job_folder: pass name and/or comment — an empty patch would change nothing while reporting success."
            );
          }
          const result = await bconnect.jobs.updateFolder(args!.id as string, ops as unknown as JsonPatchDocument);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "delete_job_folder": {
          await bconnect.jobs.deleteFolder(args!.id as string);
          return { content: [{ type: "text", text: `Job folder ${args!.id} deleted successfully` }] };
        }

        case "assign_job_to_logical_group": {
          const result = await bconnect.jobs.assignJobDefinitionToLogicalGroup(
            args!.logicalGroupId as string,
            args! as unknown as AssignJobDefinitionRequest
          );
          return { content: [{ type: "text", text: withDestructiveCheck(describeAssignment(result)) }] };
        }

        case "assign_job_to_static_group": {
          const result = await bconnect.jobs.assignJobDefinitionToStaticGroup(
            args!.staticGroupId as string,
            args! as unknown as AssignJobDefinitionRequest
          );
          return { content: [{ type: "text", text: withDestructiveCheck(describeAssignment(result)) }] };
        }

        case "assign_job_to_dynamic_group": {
          const result = await bconnect.jobs.assignJobDefinitionToWindowsDynamicGroup(
            args!.dynamicGroupId as string,
            args! as unknown as AssignJobDefinitionRequest
          );
          return { content: [{ type: "text", text: withDestructiveCheck(describeAssignment(result)) }] };
        }

        case "assign_job_to_universal_dynamic_group": {
          const result = await bconnect.jobs.assignJobDefinitionToUniversalDynamicGroup(
            args!.universalDynamicGroupId as string,
            args! as unknown as AssignJobDefinitionRequest
          );
          return { content: [{ type: "text", text: withDestructiveCheck(describeAssignment(result)) }] };
        }

        case "create_kiosk_release": {
          const result = await bconnect.jobs.createKioskRelease(args! as unknown as KioskReleaseForCreation);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "withdraw_kiosk_release": {
          await bconnect.jobs.withdrawKioskRelease(args!.id as string);
          return { content: [{ type: "text", text: `Kiosk release ${args!.id} withdrawn successfully` }] };
        }

        // ── Deliberately NOT shaped, measured 2026-08-11 ────────────────────
        //
        // It ranked 5th on the response-byte backlog at 6,718 B (16 of 16 rows,
        // the complete population here), and it does not pay. Recorded so the
        // next reader does not spend the afternoon re-deriving it:
        //
        //   * `dropConstantColumns` is the only rule that fires at all, and only
        //     because every kiosk job on this estate is Windows:
        //         all-Windows estate   6,718 -> 6,124 B   -594 B (-8.8%)
        //         mixed-platform       6,748 -> 6,780 B   **+32 B, a LOSS**
        //     Against ~490 B of permanent catalogue cost for detail/fields, that
        //     is a permanent regression for any customer publishing macOS or
        //     mobile jobs to a kiosk. This is the trap
        //     `list_update_management_endpoints` avoided by having a structural
        //     drop to lead with. There is none here.
        //   * TOK-27's collapse does not apply: `jobDefinitionDisplayName` equals
        //     `jobDefinitionName` on **1 of 16 rows**. The other 15 differ
        //     ("Printer Spooler Fix" against "KIOSK: Restart Printer Spooler"),
        //     and the display name is the USER-FACING one a kiosk listing exists
        //     to show — the last field to drop, not the first.
        //   * `assignmentTargetId`/`Name`/`Type` were ranked as page-constant by
        //     the first analysis. They are not: 3 distinct values each across the
        //     complete 16-row population.
        //   * `jobDefinitionSupportedPlatforms` (736 B, the fattest column) is
        //     NOT dropped structurally on purpose: read against
        //     `assignmentTargetType` it is how a platform mismatch — a macOS job
        //     released to a Windows endpoint — becomes visible.
        //
        // Nine columns, no fat, 420 B/row. Leave it raw.
        case "list_kiosk_releases": {
          if (isCountOnlyRequest(args)) {
            return countOnlyResult((params) => bconnect.jobs.getKioskReleases(params), args);
          }
          const result = await bconnect.jobs.getKioskReleases(apiParams(args));
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "get_kiosk_release": {
          const result = await bconnect.jobs.getKioskRelease(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        // Phase 26: Folder navigation
        case "list_job_folders": {
          if (isCountOnlyRequest(args)) {
            return countOnlyResult((params) => bconnect.jobs.getJobFolders(params), args);
          }
          const result = await bconnect.jobs.getJobFolders(apiParams(args));
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "get_job_folder": {
          const result = await bconnect.jobs.getJobFolder(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_job_subfolders": {
          const folderId = args!.folderId as string;
          if (isCountOnlyRequest(args)) {
            return countOnlyResult(
              (params) => bconnect.jobs.getJobSubfolders(folderId, params),
              args
            );
          }
          const result = await bconnect.jobs.getJobSubfolders(folderId, apiParams(args));
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        // Phase 26: Kiosk releases by context
        case "list_kiosk_releases_by_job_definition": {
          const jobDefinitionId = args!.jobDefinitionId as string;
          if (isCountOnlyRequest(args)) {
            return countOnlyResult(
              (params) => bconnect.jobs.getKioskReleasesByJobDefinition(jobDefinitionId, params),
              args
            );
          }
          const result = await bconnect.jobs.getKioskReleasesByJobDefinition(jobDefinitionId, apiParams(args));
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_kiosk_releases_by_endpoint": {
          const endpointId = args!.endpointId as string;
          if (isCountOnlyRequest(args)) {
            return countOnlyResult(
              (params) => bconnect.jobs.getKioskReleasesByEndpoint(endpointId, params),
              args
            );
          }
          const result = await bconnect.jobs.getKioskReleasesByEndpoint(endpointId, apiParams(args));
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_kiosk_releases_by_ad_object": {
          const adObjectId = args!.adObjectId as string;
          if (isCountOnlyRequest(args)) {
            return countOnlyResult(
              (params) => bconnect.jobs.getKioskReleasesByAdObject(adObjectId, params),
              args
            );
          }
          const result = await bconnect.jobs.getKioskReleasesByAdObject(adObjectId, apiParams(args));
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_kiosk_releases_by_logical_group": {
          const logicalGroupId = args!.logicalGroupId as string;
          if (isCountOnlyRequest(args)) {
            return countOnlyResult(
              (params) => bconnect.jobs.getKioskReleasesByLogicalGroup(logicalGroupId, params),
              args
            );
          }
          const result = await bconnect.jobs.getKioskReleasesByLogicalGroup(logicalGroupId, apiParams(args));
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        // Phase 26: Job instances by group
        case "list_job_instances_by_static_group": {
          const staticGroupId = args!.staticGroupId as string;
          if (isCountOnlyRequest(args)) {
            return countOnlyResult(
              (params) => bconnect.jobs.getJobInstancesByStaticGroup(staticGroupId, params),
              args
            );
          }
          const result = await bconnect.jobs.getJobInstancesByStaticGroup(staticGroupId, apiParams(args));
          return jobInstanceListResult(result, args);
        }

        case "list_job_instances_by_dynamic_group": {
          const dynamicGroupId = args!.dynamicGroupId as string;
          if (isCountOnlyRequest(args)) {
            return countOnlyResult(
              (params) => bconnect.jobs.getJobInstancesByDynamicGroup(dynamicGroupId, params),
              args
            );
          }
          const result = await bconnect.jobs.getJobInstancesByDynamicGroup(dynamicGroupId, apiParams(args));
          return jobInstanceListResult(result, args);
        }

        case "list_job_instances_by_universal_dynamic_group": {
          const universalDynamicGroupId = args!.universalDynamicGroupId as string;
          if (isCountOnlyRequest(args)) {
            return countOnlyResult(
              (params) =>
                bconnect.jobs.getJobInstancesByUniversalDynamicGroup(universalDynamicGroupId, params),
              args
            );
          }
          const result = await bconnect.jobs.getJobInstancesByUniversalDynamicGroup(
            universalDynamicGroupId,
            apiParams(args)
          );
          return jobInstanceListResult(result, args);
        }

        default:
          throw new BareMcpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error: unknown) {
      // LOCAL FIX (INT-53) — one error channel. This catch-all used to fold
      // EVERY failure into McpError(InternalError, "Tool execution failed: …"),
      // so a 404 from a mistyped GUID and a 403 from an under-scoped API key
      // both arrived on the protocol channel reserved for "the server is
      // broken", while the write gate two blocks up answered a policy refusal
      // with a readable `isError` tool result. handleToolError routes the four
      // statuses a caller can actually act on (400/403/404/429) to that same
      // readable shape, rethrows protocol errors untouched, and folds
      // everything else — 401, 5xx, TLS, transport, bugs — into the identical
      // InternalError text this block produced, stripMcpErrorPrefix included.
      return handleToolError(error);
    }
  });

  // LOCAL FIX (B1 / OPT-39) — a `server.request()` override that reached into
  // the SDK's private `_requestHandlers` map used to live here, so tests could
  // dispatch handlers without a transport. It shipped in production, on an
  // undocumented SDK internal, to serve test convenience only. It is gone; the
  // tests connect over the InMemoryTransport pair the SDK supports publicly
  // (src/__tests__/lib/connect.ts), which also validates every request and
  // response against the protocol schemas on the way through. Do not
  // reintroduce it — see the identical removal in bconnect-endpoints-mcp.

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
    name: "bconnect-jobs-mcp",
    createServer,
    http: { express },
  }).catch((error) => {
    console.error(`Fatal error: ${describeConnectionFailure(error)}`);
    process.exit(1);
  });
}
