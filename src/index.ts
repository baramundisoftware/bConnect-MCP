#!/usr/bin/env node

/**
 * bConnect MCP Server
 *
 * A Model Context Protocol server that provides Claude with access to
 * the baramundi bConnect REST API for device management.
 *
 * Currently supports: Endpoints API
 * Future modules: Assets, Software, etc.
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
import { DocumentationSearchModule } from "./modules/documentation-search.js";
import { KnownIssuesSearch } from "./modules/known-issues-search.js";
import { validateOrThrow } from "./utils/parameter-validator.js";
import {
  EndpointsRules,
  JobsRules,
  AssetsRules,
  ActiveDirectoryRules,
  ServerManagementRules,
  VariablesRules,
  DefenseControlRules,
  OperatingSystemsRules,
  SoftwareRules,
  UpdateManagementRules,
  DocumentationSearchRules
} from "./utils/mcp-tool-validation-rules.js";

// Load environment variables
dotenv.config();

// Initialize bConnect API client
// API Documentation: https://bms-win22srv:444/bconnect/docs/
const baseUrl = process.env.BCONNECT_BASE_URL || "https://bms-win22srv:444/bconnect";
const username = process.env.BCONNECT_USERNAME;
const password = process.env.BCONNECT_PASSWORD;

if (!username || !password) {
  throw new Error("BCONNECT_USERNAME and BCONNECT_PASSWORD environment variables are required");
}

const caCertPath = process.env.BCONNECT_CA_CERT_PATH;
const caCert = caCertPath ? fs.readFileSync(caCertPath, 'utf8') : undefined;

const rateLimitEnabled = process.env.BCONNECT_RATE_LIMIT_ENABLED === 'true';
const rateLimitMaxRequests = parseInt(process.env.BCONNECT_RATE_LIMIT_MAX_REQUESTS ?? '', 10);
const rateLimitWindowMs = parseInt(process.env.BCONNECT_RATE_LIMIT_WINDOW_MS ?? '', 10);

// bConnect release target — determines which modules are available
// 26R1 includes compliance and universaldynamicgroups; 25R2 does not
const bconnectRelease = process.env.BCONNECT_RELEASE ?? '26R1';

const auditLevelRaw = process.env.BCONNECT_AUDIT_LEVEL ?? 'none';
const auditLevel = (['none', 'security', 'write', 'all'] as const).includes(auditLevelRaw as any)
  ? (auditLevelRaw as 'none' | 'security' | 'write' | 'all')
  : 'none';

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

// Initialize Documentation Search Module
// Searches across forum threads, feedback portal, and release notes
const docSearch = new DocumentationSearchModule();

// Initialize Known Issues Search Module
// Cross-references known issues from release notes with forum solutions
const knownIssuesSearch = new KnownIssuesSearch();

// Initialize MCP server
const server = new Server(
  {
    name: `bconnect-mcp-server/${bconnectRelease}`,
    version: "26.1.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

/**
 * Define available MCP tools
 * Endpoints API + Jobs API - extensible for future modules
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_endpoints",
        description: "List all endpoints (devices) managed by baramundi. Supports filtering, searching, and pagination.",
        inputSchema: {
          type: "object",
          properties: {
            SearchQuery: {
              type: "string",
              description: "Search across DisplayName, HostName, PrimaryIP, OSVersionString, SerialNumber, and Comment"
            },
            DisplayName: {
              type: "string",
              description: "Filter by exact DisplayName match"
            },
            PageSize: {
              type: "number",
              description: "Number of results per page (max 1000, default 20)"
            },
            Page: {
              type: "number",
              description: "Page number (zero-indexed)"
            },
            OrderBy: {
              type: "string",
              description: "Sort by: DisplayName, HostName, OperatingSystem, or LastSeen (e.g., 'DisplayName asc')"
            }
          }
        }
      },
      {
        name: "get_endpoint",
        description: "Get detailed information about a specific endpoint by ID",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Endpoint ID (GUID)"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "search_endpoints",
        description: "Search for endpoints. Searches across multiple fields including hostname, IP, serial number, etc.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query string"
            },
            pageSize: {
              type: "number",
              description: "Maximum number of results to return (default: 50)"
            }
          },
          required: ["query"]
        }
      },
      {
        name: "list_windows_endpoints",
        description: "List all Windows endpoints specifically",
        inputSchema: {
          type: "object",
          properties: {
            SearchQuery: {
              type: "string",
              description: "Search query"
            },
            PageSize: {
              type: "number",
              description: "Number of results per page"
            }
          }
        }
      },
      {
        name: "get_windows_endpoint",
        description: "Get detailed information about a specific Windows endpoint",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Windows endpoint ID (GUID)"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "list_logical_groups",
        description: "List all logical groups in baramundi",
        inputSchema: {
          type: "object",
          properties: {}
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
      {
        name: "list_group_endpoints",
        description: "List all endpoints in a specific logical group",
        inputSchema: {
          type: "object",
          properties: {
            logicalGroupId: {
              type: "string",
              description: "Logical group ID"
            },
            PageSize: {
              type: "number",
              description: "Number of results per page"
            }
          },
          required: ["logicalGroupId"]
        }
      },
      {
        name: "list_linux_endpoints",
        description: "List all Linux endpoints",
        inputSchema: {
          type: "object",
          properties: {
            SearchQuery: {
              type: "string",
              description: "Search query"
            },
            PageSize: {
              type: "number",
              description: "Number of results per page"
            }
          }
        }
      },
      {
        name: "list_mac_endpoints",
        description: "List all Mac endpoints",
        inputSchema: {
          type: "object",
          properties: {
            SearchQuery: {
              type: "string",
              description: "Search query"
            },
            PageSize: {
              type: "number",
              description: "Number of results per page"
            }
          }
        }
      },
      {
        name: "get_linux_endpoint",
        description: "Retrieve detailed information about a specific Linux endpoint by its GUID. Returns full endpoint properties including display name, hostname, IP address, OS version, management status, and group membership. Use this after list_linux_endpoints to inspect a particular device.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Linux endpoint ID (GUID)"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "get_mac_endpoint",
        description: "Retrieve detailed information about a specific macOS endpoint by its GUID. Returns full endpoint properties including display name, hostname, IP address, OS version, management status, and enrollment state. Use this after list_mac_endpoints to inspect a particular device.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "macOS endpoint ID (GUID)"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "list_endpoints_by_logical_group",
        description: "List all endpoints of any platform type (Windows, Linux, Mac, Android, iOS, etc.) that belong to a specific logical group. Returns a paged list of endpoints with basic information. Use this for cross-platform group inventory queries in baramundi.",
        inputSchema: {
          type: "object",
          properties: {
            logicalGroupId: {
              type: "string",
              description: "Logical group ID (GUID)"
            },
            SearchQuery: {
              type: "string",
              description: "Filter results by display name, hostname, IP, serial number, or comment"
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
              description: "Sort order (e.g., 'DisplayName asc', 'LastSeen desc')"
            }
          },
          required: ["logicalGroupId"]
        }
      },
      {
        name: "list_windows_endpoints_by_logical_group",
        description: "List all Windows endpoints belonging to a specific logical group in baramundi. Returns a paged list of Windows endpoints with full details. This is the primary tool for group-based Windows fleet queries and rollout status checks when managing endpoints via logical groups.",
        inputSchema: {
          type: "object",
          properties: {
            logicalGroupId: {
              type: "string",
              description: "Logical group ID (GUID)"
            },
            SearchQuery: {
              type: "string",
              description: "Filter by display name, hostname, IP, serial number, or comment"
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
              description: "Sort order (e.g., 'DisplayName asc', 'LastSeen desc')"
            },
            includeSubfolders: {
              type: "boolean",
              description: "If true, also includes endpoints from sub-groups (default: false)"
            }
          },
          required: ["logicalGroupId"]
        }
      },
      {
        name: "start_android_enrollment",
        description: "Start the enrollment process for an existing Android endpoint in baramundi MDM. Triggers sending of enrollment instructions to the device or optionally via email. This is the core MDM onboarding action for Android devices and completes the Android endpoint lifecycle.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Android endpoint ID (GUID)"
            },
            enrollmentMailAddress: {
              type: "string",
              description: "Email address to send enrollment instructions to (optional)"
            },
            emailLanguageId: {
              type: "string",
              description: "Language ID for the enrollment email, e.g. 'en-US' or 'de-DE' (optional)"
            },
            forceMobileDataOnEnrollment: {
              type: "boolean",
              description: "Force mobile data during enrollment (default: false)"
            },
            includeWifiInQrCode: {
              type: "boolean",
              description: "Include Wi-Fi credentials in the QR code (default: false)"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "start_ios_enrollment",
        description: "Start the enrollment process for an existing iOS or iPadOS endpoint in baramundi MDM. Triggers sending of enrollment instructions to the device or optionally via email. This completes the iOS endpoint lifecycle alongside create, update, and delete operations.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "iOS endpoint ID (GUID)"
            },
            enrollmentMailAddress: {
              type: "string",
              description: "Email address to send enrollment instructions to (optional)"
            },
            emailLanguageId: {
              type: "string",
              description: "Language ID for the enrollment email, e.g. 'en-US' or 'de-DE' (optional)"
            }
          },
          required: ["id"]
        }
      },
      // Android Endpoint Write Operations
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
      {
        name: "update_android_endpoint",
        description: "Update an existing Android endpoint in baramundi",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Android endpoint ID (GUID)"
            },
            displayName: {
              type: "string",
              description: "Display name of the Android endpoint"
            },
            logicalGroupId: {
              type: "string",
              description: "ID of the logical group to assign the endpoint to (GUID format)"
            },
            comment: {
              type: "string",
              description: "Comment or description for the endpoint"
            },
            serialNumber: {
              type: "string",
              description: "Serial number of the Android device"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "delete_android_endpoint",
        description: "Delete an Android endpoint from baramundi",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Android endpoint ID (GUID)"
            }
          },
          required: ["id"]
        }
      },
      // Endpoints API - Windows Write Operations
      {
        name: "create_windows_endpoint",
        description: "Create a new Windows endpoint. WARNING: Creates a new endpoint in the system.",
        inputSchema: {
          type: "object",
          properties: {
            displayName: { type: "string", description: "Display name" },
            logicalGroupId: { type: "string", description: "Logical group ID (GUID)" },
            comment: { type: "string", description: "Comment" },
            hostName: { type: "string", description: "Host name" },
            primaryMAC: { type: "string", description: "Primary MAC address" }
          },
          required: ["displayName"]
        }
      },
      {
        name: "update_windows_endpoint",
        description: "Update a Windows endpoint. WARNING: Modifies endpoint properties.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Endpoint ID (GUID)" },
            displayName: { type: "string", description: "Display name" },
            comment: { type: "string", description: "Comment" }
          },
          required: ["id"]
        }
      },
      {
        name: "delete_windows_endpoint",
        description: "Delete a Windows endpoint. WARNING: Permanently deletes the endpoint.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Endpoint ID (GUID)" }
          },
          required: ["id"]
        }
      },
      {
        name: "start_windows_enrollment",
        description: "Start Windows endpoint enrollment. Sets endpoint to Internet mode and generates enrollment data.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Endpoint ID (GUID)" },
            emailRecipient: { type: "string", description: "Email recipient for enrollment instructions (optional)" }
          },
          required: ["id"]
        }
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
      // Endpoints API - Linux Write Operations
      {
        name: "create_linux_endpoint",
        description: "Create a new Linux endpoint. WARNING: Creates a new endpoint.",
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
      {
        name: "update_linux_endpoint",
        description: "Update a Linux endpoint. WARNING: Modifies endpoint properties.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Endpoint ID (GUID)" },
            displayName: { type: "string", description: "Display name" },
            comment: { type: "string", description: "Comment" }
          },
          required: ["id"]
        }
      },
      {
        name: "delete_linux_endpoint",
        description: "Delete a Linux endpoint. WARNING: Permanently deletes the endpoint.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Endpoint ID (GUID)" }
          },
          required: ["id"]
        }
      },
      // Endpoints API - Mac Write Operations
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
      {
        name: "update_mac_endpoint",
        description: "Update a Mac endpoint. WARNING: Modifies endpoint properties.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Endpoint ID (GUID)" },
            displayName: { type: "string", description: "Display name" },
            comment: { type: "string", description: "Comment" }
          },
          required: ["id"]
        }
      },
      {
        name: "delete_mac_endpoint",
        description: "Delete a Mac endpoint. WARNING: Permanently deletes the endpoint.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Endpoint ID (GUID)" }
          },
          required: ["id"]
        }
      },
      {
        name: "start_mac_enrollment",
        description: "Start Mac endpoint enrollment.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Endpoint ID (GUID)" },
            emailRecipient: { type: "string", description: "Email recipient for enrollment instructions (optional)" }
          },
          required: ["id"]
        }
      },
      // Endpoints API - Logical Groups Write Operations
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
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Group ID (GUID)" },
            name: { type: "string", description: "Group name" },
            comment: { type: "string", description: "Comment" }
          },
          required: ["id"]
        }
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
      // Maintenance Windows - Phase 3
      { name: "create_maintenance_window_for_endpoint", description: "Create a maintenance window for an endpoint. WARNING: Creates new maintenance window.", inputSchema: { type: "object", properties: { id: { type: "string" }, maintenanceWindowData: { type: "object" } }, required: ["id", "maintenanceWindowData"] } },
      { name: "update_maintenance_window_for_endpoint", description: "Update a maintenance window for an endpoint. WARNING: Modifies existing maintenance window.", inputSchema: { type: "object", properties: { id: { type: "string" }, maintenanceWindowData: { type: "object" } }, required: ["id", "maintenanceWindowData"] } },
      { name: "delete_maintenance_window_for_endpoint", description: "Delete a maintenance window for an endpoint. WARNING: Permanently deletes maintenance window.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
      { name: "create_maintenance_window_for_logical_group", description: "Create a maintenance window for a logical group. WARNING: Creates new maintenance window.", inputSchema: { type: "object", properties: { id: { type: "string" }, maintenanceWindowData: { type: "object" } }, required: ["id", "maintenanceWindowData"] } },
      { name: "update_maintenance_window_for_logical_group", description: "Update a maintenance window for a logical group. WARNING: Modifies existing maintenance window.", inputSchema: { type: "object", properties: { id: { type: "string" }, maintenanceWindowData: { type: "object" } }, required: ["id", "maintenanceWindowData"] } },
      { name: "delete_maintenance_window_for_logical_group", description: "Delete a maintenance window for a logical group. WARNING: Permanently deletes maintenance window.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
      // Industrial & Network Endpoints - Phase 3
      { name: "create_industrial_endpoint", description: "Create a new industrial endpoint (PLC, SCADA, etc.). WARNING: Creates a new endpoint.", inputSchema: { type: "object", properties: { endpointData: { type: "object" } }, required: ["endpointData"] } },
      { name: "update_industrial_endpoint", description: "Update an existing industrial endpoint. WARNING: Modifies endpoint properties.", inputSchema: { type: "object", properties: { id: { type: "string" }, updateData: { type: "object" } }, required: ["id", "updateData"] } },
      { name: "delete_industrial_endpoint", description: "Delete an industrial endpoint. WARNING: Permanently deletes the endpoint.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
      { name: "create_network_endpoint", description: "Create a new network endpoint (switch, router, printer, etc.). WARNING: Creates a new endpoint.", inputSchema: { type: "object", properties: { endpointData: { type: "object" } }, required: ["endpointData"] } },
      { name: "update_network_endpoint", description: "Update an existing network endpoint. WARNING: Modifies endpoint properties.", inputSchema: { type: "object", properties: { id: { type: "string" }, updateData: { type: "object" } }, required: ["id", "updateData"] } },
      { name: "delete_network_endpoint", description: "Delete a network endpoint. WARNING: Permanently deletes the endpoint.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
      { name: "delete_endpoint", description: "Delete any endpoint by ID (generic delete for all endpoint types). WARNING: Permanently deletes the endpoint.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
      // Jobs API
      {
        name: "list_job_definitions",
        description: "List all job definitions. Supports filtering, searching, and pagination.",
        inputSchema: {
          type: "object",
          properties: {
            SearchQuery: {
              type: "string",
              description: "Search query"
            },
            PageSize: {
              type: "number",
              description: "Number of results per page"
            },
            Page: {
              type: "number",
              description: "Page number (zero-indexed)"
            },
            OrderBy: {
              type: "string",
              description: "Sort order (e.g., 'Name asc')"
            }
          }
        }
      },
      {
        name: "get_job_definition",
        description: "Get detailed information about a specific job definition by ID",
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
        description: "List all job instances (execution history). Supports filtering, searching, and pagination.",
        inputSchema: {
          type: "object",
          properties: {
            SearchQuery: {
              type: "string",
              description: "Search query"
            },
            PageSize: {
              type: "number",
              description: "Number of results per page"
            },
            Page: {
              type: "number",
              description: "Page number (zero-indexed)"
            },
            OrderBy: {
              type: "string",
              description: "Sort order"
            }
          }
        }
      },
      {
        name: "get_job_instance",
        description: "Get detailed information about a specific job instance by ID",
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
        description: "List all job instances for a specific endpoint",
        inputSchema: {
          type: "object",
          properties: {
            endpointId: {
              type: "string",
              description: "Endpoint ID (GUID)"
            },
            PageSize: {
              type: "number",
              description: "Number of results per page"
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
        description: "Create a job instance by assigning a job definition to an endpoint. WARNING: This creates a new job assignment.",
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
        description: "Start a job instance by ID. Requires appropriate permissions. WARNING: This starts job execution.",
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
        description: "Stop a running job instance by ID. WARNING: This stops job execution.",
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
        description: "Resume a job instance by ID (Windows endpoints only). WARNING: This resumes job execution.",
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
        description: "Delete a job instance by ID. WARNING: This permanently deletes the job instance.",
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
        name: "create_job_folder",
        description: "Create a job folder. WARNING: Creates a new folder in the jobs structure.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Folder name" },
            parentId: { type: "string", description: "Parent folder ID (optional)" },
            comment: { type: "string", description: "Comment (optional)" }
          },
          required: ["name"]
        }
      },
      {
        name: "update_job_folder",
        description: "Update a job folder by ID. WARNING: Modifies folder properties.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Folder ID (GUID)" },
            name: { type: "string", description: "Folder name" },
            comment: { type: "string", description: "Comment" }
          },
          required: ["id"]
        }
      },
      {
        name: "delete_job_folder",
        description: "Delete a job folder by ID. WARNING: Permanently deletes the folder (must be empty).",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Folder ID (GUID)" }
          },
          required: ["id"]
        }
      },
      {
        name: "assign_job_to_logical_group",
        description: "Assign a job definition to all endpoints in a logical group. WARNING: Creates job instances for all endpoints.",
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
        description: "Assign a job definition to all endpoints in a static group. WARNING: Creates job instances.",
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
        description: "Assign a job definition to all endpoints in a Windows dynamic group. WARNING: Creates job instances.",
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
        description: "Assign a job definition to all endpoints in a universal dynamic group. WARNING: Creates job instances.",
        inputSchema: {
          type: "object",
          properties: {
            universalDynamicGroupId: { type: "string", description: "Universal dynamic group ID (GUID)" },
            jobDefinitionId: { type: "string", description: "Job definition ID (GUID)" }
          },
          required: ["universalDynamicGroupId", "jobDefinitionId"]
        }
      },
      {
        name: "create_kiosk_release",
        description: "Create a kiosk release to allow job execution via baramundi Kiosk portal. WARNING: Creates kiosk release.",
        inputSchema: {
          type: "object",
          properties: {
            jobDefinitionId: { type: "string", description: "Job definition ID (GUID)" },
            targetId: { type: "string", description: "Target object ID (endpoint, group, or AD object)" }
          },
          required: ["jobDefinitionId"]
        }
      },
      {
        name: "withdraw_kiosk_release",
        description: "Withdraw a kiosk release by ID. WARNING: Removes kiosk release.",
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
        description: "List all kiosk releases (jobs available in baramundi Kiosk portal for end-user self-service execution). Supports filtering, searching, and pagination.",
        inputSchema: {
          type: "object",
          properties: {
            OrderBy: { type: "string", description: "Sort order (e.g., 'assignmentTargetName asc')" },
            SearchQuery: { type: "string", description: "Search query" },
            Page: { type: "number", description: "Page number (zero-indexed)" },
            PageSize: { type: "number", description: "Number of results per page" }
          }
        }
      },
      {
        name: "get_kiosk_release",
        description: "Get detailed information about a specific kiosk release by ID including assignment target, job definition, and supported platforms.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Kiosk release ID (GUID)" }
          },
          required: ["id"]
        }
      },
      // Assets API
      {
        name: "list_assets",
        description: "List all assets with support for filtering, searching, and pagination",
        inputSchema: {
          type: "object",
          properties: {
            SearchQuery: {
              type: "string",
              description: "Search across Name, InventoryNumber, Contact, and CostCenter"
            },
            PageSize: {
              type: "number",
              description: "Number of results per page"
            },
            Page: {
              type: "number",
              description: "Page number (zero-indexed)"
            },
            OrderBy: {
              type: "string",
              description: "Sort order"
            }
          }
        }
      },
      {
        name: "get_asset",
        description: "Get detailed information about a specific asset by ID",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Asset ID (GUID)"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "list_asset_types",
        description: "List all asset types with support for filtering and pagination",
        inputSchema: {
          type: "object",
          properties: {
            SearchQuery: {
              type: "string",
              description: "Search query"
            },
            PageSize: {
              type: "number",
              description: "Number of results per page"
            },
            ShowSummary: {
              type: "boolean",
              description: "Include summary data"
            }
          }
        }
      },
      {
        name: "get_asset_type",
        description: "Get detailed information about a specific asset type by ID",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Asset type ID (GUID)"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "list_assets_by_logical_group",
        description: "Get all assets assigned to a specific logical group",
        inputSchema: {
          type: "object",
          properties: {
            logicalGroupId: {
              type: "string",
              description: "Logical group ID (GUID)"
            },
            PageSize: {
              type: "number",
              description: "Number of results per page"
            }
          },
          required: ["logicalGroupId"]
        }
      },
      {
        name: "list_assets_by_endpoint",
        description: "Get all assets assigned to a specific Windows endpoint",
        inputSchema: {
          type: "object",
          properties: {
            endpointId: {
              type: "string",
              description: "Endpoint ID (GUID)"
            },
            PageSize: {
              type: "number",
              description: "Number of results per page"
            }
          },
          required: ["endpointId"]
        }
      },
      {
        name: "list_asset_stock_assets",
        description: "List all assets currently in stock (unassigned assets)",
        inputSchema: {
          type: "object",
          properties: {
            PageSize: {
              type: "number",
              description: "Number of results per page"
            },
            SearchQuery: {
              type: "string",
              description: "Search query"
            }
          }
        }
      },
      {
        name: "list_asset_stock_folders",
        description: "List all folders in the asset stock",
        inputSchema: {
          type: "object",
          properties: {
            PageSize: {
              type: "number",
              description: "Number of results per page"
            },
            SearchQuery: {
              type: "string",
              description: "Search query"
            }
          }
        }
      },
      // Assets API - Write Operations (Phase 2)
      {
        name: "create_asset",
        description: "Create a new asset. WARNING: This creates a new asset in the system.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Asset name"
            },
            assetTypeId: {
              type: "string",
              description: "Asset type ID (GUID)"
            },
            inventoryNumber: {
              type: "string",
              description: "Inventory number"
            },
            contact: {
              type: "string",
              description: "Contact information"
            }
          },
          required: ["name", "assetTypeId"]
        }
      },
      {
        name: "update_asset",
        description: "Update an existing asset. WARNING: This modifies asset data.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Asset ID (GUID)"
            },
            name: {
              type: "string",
              description: "Updated asset name"
            },
            contact: {
              type: "string",
              description: "Updated contact information"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "delete_asset",
        description: "Delete an asset by ID. WARNING: This permanently deletes the asset.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Asset ID (GUID)"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "create_asset_type",
        description: "Create a new asset type. WARNING: This creates a new asset type in the system.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Asset type name"
            },
            description: {
              type: "string",
              description: "Asset type description"
            }
          },
          required: ["name"]
        }
      },
      {
        name: "delete_asset_type",
        description: "Delete an asset type by ID. WARNING: This permanently deletes the asset type.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Asset type ID (GUID)"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "create_asset_stock_folder",
        description: "Create a new asset stock folder. WARNING: This creates a new folder in the asset stock.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Folder name"
            },
            parentFolderId: {
              type: "string",
              description: "Parent folder ID (GUID), optional"
            }
          },
          required: ["name"]
        }
      },
      {
        name: "update_asset_stock_folder",
        description: "Update an existing asset stock folder. WARNING: This modifies folder data.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Folder ID (GUID)"
            },
            name: {
              type: "string",
              description: "Updated folder name"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "delete_asset_stock_folder",
        description: "Delete an asset stock folder by ID. WARNING: This permanently deletes the folder.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Folder ID (GUID)"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "create_asset_type_folder",
        description: "Create a new asset type folder. WARNING: This creates a new folder in asset types.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Folder name"
            },
            parentFolderId: {
              type: "string",
              description: "Parent folder ID (GUID), optional"
            }
          },
          required: ["name"]
        }
      },
      {
        name: "update_asset_type_folder",
        description: "Update an existing asset type folder. WARNING: This modifies folder data.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Folder ID (GUID)"
            },
            name: {
              type: "string",
              description: "Updated folder name"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "delete_asset_type_folder",
        description: "Delete an asset type folder by ID. WARNING: This permanently deletes the folder.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Folder ID (GUID)"
            }
          },
          required: ["id"]
        }
      },
      // Active Directory API
      {
        name: "list_ad_groups",
        description: "List all Active Directory groups with support for filtering and pagination",
        inputSchema: {
          type: "object",
          properties: {
            SearchQuery: {
              type: "string",
              description: "Search across AD group name and properties"
            },
            PageSize: {
              type: "number",
              description: "Number of results per page"
            },
            Page: {
              type: "number",
              description: "Page number (zero-indexed)"
            },
            OrderBy: {
              type: "string",
              description: "Sort order"
            }
          }
        }
      },
      {
        name: "get_ad_group",
        description: "Get detailed information about a specific Active Directory group by ID",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "AD Group ID (GUID)"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "list_ad_users",
        description: "List all Active Directory users with support for filtering and pagination",
        inputSchema: {
          type: "object",
          properties: {
            SearchQuery: {
              type: "string",
              description: "Search across AD user name and properties"
            },
            PageSize: {
              type: "number",
              description: "Number of results per page"
            },
            Page: {
              type: "number",
              description: "Page number (zero-indexed)"
            },
            OrderBy: {
              type: "string",
              description: "Sort order"
            }
          }
        }
      },
      {
        name: "get_ad_user",
        description: "Get detailed information about a specific Active Directory user by ID",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "AD User ID (GUID)"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "list_ad_objects",
        description: "List all Active Directory objects with support for filtering and pagination",
        inputSchema: {
          type: "object",
          properties: {
            SearchQuery: {
              type: "string",
              description: "Search across AD object properties"
            },
            PageSize: {
              type: "number",
              description: "Number of results per page"
            },
            Page: {
              type: "number",
              description: "Page number (zero-indexed)"
            },
            OrderBy: {
              type: "string",
              description: "Sort order"
            }
          }
        }
      },
      {
        name: "get_ad_object",
        description: "Get detailed information about a specific Active Directory object by ID",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "AD Object ID (GUID)"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "list_org_units",
        description: "List all Active Directory organizational units with support for filtering and pagination",
        inputSchema: {
          type: "object",
          properties: {
            SearchQuery: {
              type: "string",
              description: "Search across organizational unit properties"
            },
            PageSize: {
              type: "number",
              description: "Number of results per page"
            },
            Page: {
              type: "number",
              description: "Page number (zero-indexed)"
            },
            OrderBy: {
              type: "string",
              description: "Sort order"
            }
          }
        }
      },
      {
        name: "get_org_unit",
        description: "Get detailed information about a specific Active Directory organizational unit by ID",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Organizational Unit ID (GUID)"
            }
          },
          required: ["id"]
        }
      },
      {
        name: "list_ad_users_by_group",
        description: "List all Active Directory users that belong to a specific AD group",
        inputSchema: {
          type: "object",
          properties: {
            adGroupId: {
              type: "string",
              description: "AD Group ID (GUID)"
            },
            SearchQuery: {
              type: "string",
              description: "Search query"
            },
            PageSize: {
              type: "number",
              description: "Number of results per page"
            }
          },
          required: ["adGroupId"]
        }
      },
      {
        name: "list_ad_groups_by_org_unit",
        description: "List all Active Directory groups within a specific organizational unit",
        inputSchema: {
          type: "object",
          properties: {
            orgUnitId: {
              type: "string",
              description: "Organizational Unit ID (GUID)"
            },
            SearchQuery: {
              type: "string",
              description: "Search query"
            },
            PageSize: {
              type: "number",
              description: "Number of results per page"
            }
          },
          required: ["orgUnitId"]
        }
      },
      {
        name: "get_ad_object_memberships",
        description: "Retrieve all Active Directory group memberships for a specific AD object (user, computer, or group). Returns a paged list of AD groups the object belongs to, including optional indirect memberships. Use this tool to audit group assignments for compliance or permission analysis.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "AD Object ID (GUID)"
            },
            includeIndirect: {
              type: "boolean",
              description: "If true, also returns indirect group memberships (default: false)"
            },
            SearchQuery: {
              type: "string",
              description: "Filter results by matching against group name"
            },
            Page: {
              type: "number",
              description: "Page number (zero-indexed)"
            },
            PageSize: {
              type: "number",
              description: "Number of results per page (max 1000, default 20)"
            }
          },
          required: ["id"]
        }
      },
      // Software API
      {
        name: "list_installed_windows_software",
        description: "List all installed Windows software across all endpoints with support for filtering and pagination",
        inputSchema: {
          type: "object",
          properties: {
            SearchQuery: {
              type: "string",
              description: "Search across software name and properties"
            },
            PageSize: {
              type: "number",
              description: "Number of results per page"
            },
            Page: {
              type: "number",
              description: "Page number (zero-indexed)"
            },
            OrderBy: {
              type: "string",
              description: "Sort order"
            }
          }
        }
      },
      {
        name: "list_installed_software_by_endpoint",
        description: "List all installed Windows software on a specific endpoint",
        inputSchema: {
          type: "object",
          properties: {
            endpointId: {
              type: "string",
              description: "Windows Endpoint ID (GUID)"
            },
            SearchQuery: {
              type: "string",
              description: "Search query"
            },
            PageSize: {
              type: "number",
              description: "Number of results per page"
            }
          },
          required: ["endpointId"]
        }
      },
      {
        name: "list_installed_software_by_logical_group",
        description: "List all installed Windows software on endpoints within a specific logical group",
        inputSchema: {
          type: "object",
          properties: {
            logicalGroupId: {
              type: "string",
              description: "Logical Group ID (GUID)"
            },
            SearchQuery: {
              type: "string",
              description: "Search query"
            },
            PageSize: {
              type: "number",
              description: "Number of results per page"
            }
          },
          required: ["logicalGroupId"]
        }
      },
      {
        name: "list_installed_software_by_universal_dynamic_group",
        description: "List all installed Windows software on endpoints within a specific universal dynamic group",
        inputSchema: {
          type: "object",
          properties: {
            universalDynamicGroupId: {
              type: "string",
              description: "Universal Dynamic Group ID (GUID)"
            },
            SearchQuery: {
              type: "string",
              description: "Search query"
            },
            PageSize: {
              type: "number",
              description: "Number of results per page"
            }
          },
          required: ["universalDynamicGroupId"]
        }
      },
      // Update Management API
      {
        name: "list_update_management_windows_endpoints",
        description: "List all Windows endpoints with Microsoft Update Management information including update status and profiles",
        inputSchema: {
          type: "object",
          properties: {
            SearchQuery: {
              type: "string",
              description: "Search across endpoint name and update profile name"
            },
            OrderBy: {
              type: "string",
              description: "Sort by: EndpointName, LastInventory, or LastSuccessfulUpdate"
            },
            PageSize: {
              type: "number",
              description: "Number of results per page"
            },
            Page: {
              type: "number",
              description: "Page number (zero-indexed)"
            }
          }
        }
      },
      {
        name: "get_update_management_windows_endpoint",
        description: "Get Microsoft Update Management information for a specific Windows endpoint including update status, profiles, and history",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Windows Endpoint ID (GUID)"
            }
          },
          required: ["id"]
        }
      },
      // UpdateManagement Write Operations - Phase 3
      { name: "update_update_management_windows_endpoint", description: "Update Windows endpoint update profile (set or reset to null). WARNING: Modifies update profile assignment.", inputSchema: { type: "object", properties: { id: { type: "string", description: "Windows Endpoint ID (GUID)" }, updateData: { type: "object", description: "JSON Patch document (e.g., [{\"op\":\"replace\",\"path\":\"/updateProfileId\",\"value\":\"profile-guid\"}])" } }, required: ["id", "updateData"] } },
      // Defense Control API
      {
        name: "list_bitlocker_windows_endpoints",
        description: "List BitLocker encryption status for all Windows endpoints",
        inputSchema: {
          type: "object",
          properties: {
            SearchQuery: { type: "string" },
            PageSize: { type: "number" },
            Page: { type: "number" },
            OrderBy: { type: "string" }
          }
        }
      },
      {
        name: "get_bitlocker_windows_endpoint",
        description: "Get BitLocker encryption status for a specific Windows endpoint",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"]
        }
      },
      {
        name: "get_local_admin_accounts",
        description: "Get local administrative accounts information for a specific Windows endpoint",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"]
        }
      },
      {
        name: "trigger_local_admin_accounts_update",
        description: "Trigger local administrative accounts update on a specific Windows endpoint",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"]
        }
      },
      // DefenseControl Write Operations - Phase 3
      {
        name: "trigger_update_on_client",
        description: "Request a client to immediately update the expiration date of its local administrative account. WARNING: Only works if client is online.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Windows endpoint ID (GUID)" },
            timeout: { type: "number", description: "Timeout in seconds (0-60, default: 30)" }
          },
          required: ["id"]
        }
      },
      {
        name: "patch_local_admin_user_credentials",
        description: "Change the expiration date of local admin account for a specific Windows endpoint. WARNING: Modifies security credentials.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Windows endpoint ID (GUID)" },
            updateData: { type: "object", description: "JSON Patch document to update RequestedExpirationDate" }
          },
          required: ["id", "updateData"]
        }
      },
      {
        name: "list_defender_threats",
        description: "List all Microsoft Defender threats detected across all endpoints",
        inputSchema: {
          type: "object",
          properties: {
            SearchQuery: { type: "string" },
            PageSize: { type: "number" },
            Page: { type: "number" }
          }
        }
      },
      {
        name: "get_defender_threat",
        description: "Get detailed information about a specific Microsoft Defender threat",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"]
        }
      },
      {
        name: "list_defender_threats_by_endpoint",
        description: "List Microsoft Defender threats for a specific Windows endpoint",
        inputSchema: {
          type: "object",
          properties: {
            endpointId: { type: "string" },
            SearchQuery: { type: "string" },
            PageSize: { type: "number" }
          },
          required: ["endpointId"]
        }
      },
      {
        name: "list_defender_threats_by_logical_group",
        description: "List Microsoft Defender threats for endpoints in a specific logical group",
        inputSchema: {
          type: "object",
          properties: {
            logicalGroupId: { type: "string" },
            SearchQuery: { type: "string" },
            PageSize: { type: "number" }
          },
          required: ["logicalGroupId"]
        }
      },
      {
        name: "list_defender_windows_endpoints",
        description: "List Microsoft Defender status for all Windows endpoints",
        inputSchema: {
          type: "object",
          properties: {
            SearchQuery: { type: "string" },
            PageSize: { type: "number" },
            Page: { type: "number" }
          }
        }
      },
      {
        name: "get_defender_windows_endpoint",
        description: "Get Microsoft Defender status for a specific Windows endpoint",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"]
        }
      },
      // Variables API
      { name: "list_variable_definitions", description: "List all variable definitions", inputSchema: { type: "object", properties: { SearchQuery: { type: "string" }, PageSize: { type: "number" } } } },
      { name: "get_variable_definition", description: "Get specific variable definition", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
      { name: "list_variable_instances", description: "List all variable instances", inputSchema: { type: "object", properties: { SearchQuery: { type: "string" }, PageSize: { type: "number" } } } },
      { name: "get_variable_instance", description: "Get specific variable instance", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
      { name: "list_variables_by_endpoint", description: "List variables for endpoint", inputSchema: { type: "object", properties: { endpointId: { type: "string" }, PageSize: { type: "number" } }, required: ["endpointId"] } },
      { name: "list_variables_by_logical_group", description: "List variables for logical group", inputSchema: { type: "object", properties: { logicalGroupId: { type: "string" }, PageSize: { type: "number" } }, required: ["logicalGroupId"] } },
      { name: "list_variables_by_ad_object", description: "List variables for AD object", inputSchema: { type: "object", properties: { adObjectId: { type: "string" }, PageSize: { type: "number" } }, required: ["adObjectId"] } },
      { name: "list_variables_by_windows_application", description: "List variables for Windows application", inputSchema: { type: "object", properties: { windowsApplicationId: { type: "string" }, PageSize: { type: "number" } }, required: ["windowsApplicationId"] } },
      { name: "list_variables_by_windows_job", description: "List variables for Windows job definition", inputSchema: { type: "object", properties: { windowsJobDefinitionId: { type: "string" }, PageSize: { type: "number" } }, required: ["windowsJobDefinitionId"] } },
      // Variables Write Operations - Phase 3
      { name: "create_variable_definition", description: "Create a new variable definition. WARNING: Creates a new variable definition.", inputSchema: { type: "object", properties: { varDefData: { type: "object", description: "Variable definition data (name, type, comment, etc.)" } }, required: ["varDefData"] } },
      { name: "update_variable_definition", description: "Update a variable definition. WARNING: Modifies variable definition properties.", inputSchema: { type: "object", properties: { id: { type: "string" }, updateData: { type: "object", description: "JSON Patch document" } }, required: ["id", "updateData"] } },
      { name: "delete_variable_definition", description: "Delete a variable definition by ID. WARNING: Permanently deletes the variable definition.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
      { name: "update_variable_instance", description: "Update a variable instance value. WARNING: Modifies variable instance value.", inputSchema: { type: "object", properties: { id: { type: "string" }, updateData: { type: "object", description: "JSON Patch document" } }, required: ["id", "updateData"] } },
      // Operating Systems API
      { name: "list_os_folders", description: "List all OS folders", inputSchema: { type: "object", properties: { SearchQuery: { type: "string" }, PageSize: { type: "number" } } } },
      { name: "get_os_folder", description: "Get specific OS folder by ID", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
      { name: "list_os_folders_by_parent", description: "List OS folders within a parent folder", inputSchema: { type: "object", properties: { folderId: { type: "string" }, PageSize: { type: "number" } }, required: ["folderId"] } },
      { name: "list_os_windows_endpoints", description: "List Windows endpoints with OS installation info", inputSchema: { type: "object", properties: { SearchQuery: { type: "string" }, PageSize: { type: "number" } } } },
      { name: "get_os_windows_endpoint", description: "Get OS installation info for specific Windows endpoint", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
      // OperatingSystems Write Operations - Phase 3
      { name: "create_os_folder", description: "Create a new operating systems folder. WARNING: Creates a new folder.", inputSchema: { type: "object", properties: { folderData: { type: "object", description: "Folder data (name, parentId, comment)" } }, required: ["folderData"] } },
      { name: "update_os_folder", description: "Update an operating systems folder. WARNING: Modifies folder properties.", inputSchema: { type: "object", properties: { id: { type: "string" }, updateData: { type: "object", description: "JSON Patch document" } }, required: ["id", "updateData"] } },
      { name: "delete_os_folder", description: "Delete an operating systems folder (must be empty). WARNING: Permanently deletes the folder.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
      { name: "update_os_windows_endpoint", description: "Update Windows endpoint OS install configuration (boot environment, hardware profile, etc.). WARNING: Modifies OS install settings.", inputSchema: { type: "object", properties: { id: { type: "string" }, updateData: { type: "object", description: "JSON Patch document" } }, required: ["id", "updateData"] } },
      // Server Management API
      { name: "get_management_server", description: "Get management server info", inputSchema: { type: "object", properties: {} } },
      { name: "get_gateway", description: "Get gateway info", inputSchema: { type: "object", properties: {} } },
      { name: "get_dip_status", description: "Get DIP status info", inputSchema: { type: "object", properties: {} } },
      { name: "get_vpn_appliance", description: "Get VPN appliance info", inputSchema: { type: "object", properties: {} } },
      { name: "list_microservices", description: "List all microservices", inputSchema: { type: "object", properties: {} } },
      { name: "get_microservice", description: "Get specific microservice", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
      { name: "list_cloud_connectors", description: "List all cloud connectors", inputSchema: { type: "object", properties: {} } },
      { name: "list_pxe_relays", description: "List all PxE relays", inputSchema: { type: "object", properties: {} } },
      { name: "list_security_groups", description: "List all security groups", inputSchema: { type: "object", properties: { SearchQuery: { type: "string" }, PageSize: { type: "number" } } } },
      { name: "get_security_group", description: "Get specific security group", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
      { name: "list_security_profiles", description: "List all security profiles", inputSchema: { type: "object", properties: { SearchQuery: { type: "string" }, PageSize: { type: "number" } } } },
      { name: "get_security_profile", description: "Get specific security profile", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
      { name: "get_object_access_rights", description: "Get access rights for an object", inputSchema: { type: "object", properties: { objectId: { type: "string" } }, required: ["objectId"] } },
      // ServerManagement API - Write Operations (Phase 2)
      { name: "restart_management_server", description: "Restart the baramundi Management Server. WARNING: This restarts the server.", inputSchema: { type: "object", properties: {} } },
      { name: "cancel_scheduled_restart", description: "Cancel scheduled server restart. WARNING: Cancels scheduled restart.", inputSchema: { type: "object", properties: {} } },
      { name: "start_microservice", description: "Start a microservice by ID. WARNING: Starts a microservice.", inputSchema: { type: "object", properties: { id: { type: "string", description: "Microservice ID (GUID)" } }, required: ["id"] } },
      { name: "stop_microservice", description: "Stop a microservice by ID. WARNING: Stops a microservice.", inputSchema: { type: "object", properties: { id: { type: "string", description: "Microservice ID (GUID)" } }, required: ["id"] } },
      { name: "restart_microservice", description: "Restart a microservice by ID. WARNING: Restarts a microservice.", inputSchema: { type: "object", properties: { id: { type: "string", description: "Microservice ID (GUID)" } }, required: ["id"] } },
      { name: "create_security_group", description: "Create a new security group. WARNING: Creates a new security group.", inputSchema: { type: "object", properties: { groupName: { type: "string" }, comment: { type: "string" } }, required: ["groupName"] } },
      { name: "update_security_group", description: "Update an existing security group. WARNING: Modifies security group.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
      { name: "delete_security_group", description: "Delete a security group by ID. WARNING: Permanently deletes security group.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
      { name: "create_security_profile", description: "Create a new security profile. WARNING: Creates a new security profile.", inputSchema: { type: "object", properties: { name: { type: "string" }, comment: { type: "string" } }, required: ["name"] } },
      { name: "update_security_profile", description: "Update an existing security profile. WARNING: Modifies security profile.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
      { name: "delete_security_profile", description: "Delete a security profile by ID. WARNING: Permanently deletes security profile.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
      { name: "update_object_permission", description: "Update object permissions. WARNING: Modifies object permissions.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },

      // Documentation Search Tools - Forum, Feedback Portal, Release Notes, Preview Documents
      {
        name: "search_documentation",
        description: "Search across all baramundi documentation including forum threads (baramundi Connect, Job Management), feedback portal (FAQ: 11, Knowledge Base: 283, Ideas: 1,233), release notes, preview documents (bMS 2024/2025 R1/R2), and website content (blog, products, solutions, resources). Returns ranked results with excerpts. Coverage: 6,031 documents including 4,036 forum threads, 1,527 feedback items, 10 release notes, 4 preview documents, and 456 website pages.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query (supports fuzzy matching and partial words)" },
            source: {
              type: "string",
              enum: ["all", "forum", "feedback", "release-notes", "preview", "website"],
              description: "Filter by content source (default: all)"
            },
            type: {
              type: "string",
              description: "Filter by document type (thread, faq, kb, idea, release-note, preview-doc, blog, product, solution, resource, company, event, news)"
            },
            category: {
              type: "string",
              description: "Filter by category (e.g., baramundi-connect, job-management, blog, products, solutions)"
            },
            limit: {
              type: "number",
              description: "Maximum results to return (default: 20)"
            }
          },
          required: ["query"]
        }
      },
      {
        name: "get_documentation_item",
        description: "Get the full content of a specific documentation item by ID. Returns complete markdown content with all metadata.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Document ID (e.g., forum-job-management-14037)" }
          },
          required: ["id"]
        }
      },
      {
        name: "list_documentation_sources",
        description: "List all available documentation sources with coverage statistics. Shows indexed forum categories, feedback portal types (FAQ/KB/Ideas), release note versions, preview document versions (bMS 2024/2025 R1/R2), and website content categories (blog, products, solutions, resources, company, case-studies). Useful for understanding what content is available to search.",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "get_popular_topics",
        description: "Get the most frequently discussed topics across documentation. Analyzes titles to extract common keywords and themes. Useful for discovering trending topics and common issues.",
        inputSchema: {
          type: "object",
          properties: {
            source: {
              type: "string",
              enum: ["all", "forum", "feedback", "release-notes", "preview"],
              description: "Filter by content source (default: all)"
            },
            limit: {
              type: "number",
              description: "Number of topics to return (default: 10)"
            }
          }
        }
      },

      // Known Issues Search Tools - Release Notes Known Issues with Forum Solutions
      {
        name: "search_known_issues",
        description: "Search known issues from baramundi release notes (2024R1-2025R2) and find related forum solutions. Cross-references 1,664 known issues with 9,856 forum threads using semantic search. Each issue is linked to top 5 relevant forum threads with solutions. Coverage: 100% (all issues have forum solutions).",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search keywords (e.g., 'Windows 11', 'installation error', 'patch management')" },
            version: {
              type: "string",
              description: "Filter by release version (e.g., '2024R2', '2024R2S1', '2025R1')"
            },
            language: {
              type: "string",
              enum: ["DE", "EN"],
              description: "Filter by language (DE or EN)"
            },
            limit: {
              type: "number",
              description: "Maximum number of results (default: 10)"
            }
          },
          required: ["query"]
        }
      },
      {
        name: "get_known_issues_summary",
        description: "Get summary statistics about the known issues database. Shows total issues, issues with solutions, and coverage percentage.",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      // 26R1-only modules: compliance and universaldynamicgroups
      // These modules are only present in the 26R1 OpenAPI spec and are excluded when
      // BCONNECT_RELEASE=25R2. They will be fully implemented in their dedicated servers
      // (bconnect-compliance-mcp and bconnect-universaldynamicgroups-mcp).
      ...(bconnectRelease === '26R1' ? [
        // compliance module placeholder — implemented in Phase 11 (bconnect-compliance-mcp)
        // {
        //   name: "list_compliance_rules",
        //   description: "...",
        //   inputSchema: { type: "object", properties: {}, required: [] }
        // }
      ] : []),
      ...(bconnectRelease === '26R1' ? [
        // universaldynamicgroups module placeholder — implemented in Phase 17
        // {
        //   name: "list_universal_dynamic_groups",
        //   description: "...",
        //   inputSchema: { type: "object", properties: {}, required: [] }
        // }
      ] : [])
    ]
  };
});

/**
 * Handle tool execution requests
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    switch (name) {
      case "list_endpoints":
        validateOrThrow(args, EndpointsRules.listEndpoints());
        const endpoints = await bconnect.endpoints.getEndpoints(args || {});
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(endpoints, null, 2)
            }
          ]
        };

      case "get_endpoint":
        validateOrThrow(args, EndpointsRules.getEndpoint());
        const endpoint = await bconnect.endpoints.getEndpoint(args!.id as string);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(endpoint, null, 2)
            }
          ]
        };

      case "search_endpoints":
        validateOrThrow(args, EndpointsRules.listEndpoints());
        const searchResults = await bconnect.endpoints.searchEndpoints(
          args!.query as string,
          args!.pageSize as number | undefined
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(searchResults, null, 2)
            }
          ]
        };

      case "list_windows_endpoints":
        validateOrThrow(args, EndpointsRules.listPlatformEndpoints());
        const windowsEndpoints = await bconnect.endpoints.getWindowsEndpoints(args || {});
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(windowsEndpoints, null, 2)
            }
          ]
        };

      case "get_windows_endpoint":
        validateOrThrow(args, EndpointsRules.getPlatformEndpoint());
        const windowsEndpoint = await bconnect.endpoints.getWindowsEndpoint(args!.id as string);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(windowsEndpoint, null, 2)
            }
          ]
        };

      case "list_logical_groups":
        validateOrThrow(args, EndpointsRules.listLogicalGroups());
        const groups = await bconnect.endpoints.getLogicalGroups();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(groups, null, 2)
            }
          ]
        };

      case "get_logical_group":
        validateOrThrow(args, EndpointsRules.getLogicalGroup());
        const group = await bconnect.endpoints.getLogicalGroup(args!.id as string);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(group, null, 2)
            }
          ]
        };

      case "list_group_endpoints":
        validateOrThrow(args, EndpointsRules.listGroupEndpoints());
        const groupEndpoints = await bconnect.endpoints.getLogicalGroupEndpoints(
          args!.logicalGroupId as string,
          args || {}
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(groupEndpoints, null, 2)
            }
          ]
        };

      case "list_linux_endpoints":
        validateOrThrow(args, EndpointsRules.listPlatformEndpoints());
        const linuxEndpoints = await bconnect.endpoints.getLinuxEndpoints(args || {});
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(linuxEndpoints, null, 2)
            }
          ]
        };

      case "list_mac_endpoints":
        validateOrThrow(args, EndpointsRules.listPlatformEndpoints());
        const macEndpoints = await bconnect.endpoints.getMacEndpoints(args || {});
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(macEndpoints, null, 2)
            }
          ]
        };

      case "get_linux_endpoint":
        validateOrThrow(args, EndpointsRules.getLinuxEndpoint());
        const linuxEndpoint = await bconnect.endpoints.getLinuxEndpoint(args!.id as string);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(linuxEndpoint, null, 2)
            }
          ]
        };

      case "get_mac_endpoint":
        validateOrThrow(args, EndpointsRules.getMacEndpoint());
        const macEndpoint = await bconnect.endpoints.getMacEndpoint(args!.id as string);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(macEndpoint, null, 2)
            }
          ]
        };

      case "list_endpoints_by_logical_group":
        validateOrThrow(args, EndpointsRules.listEndpointsByLogicalGroup());
        const endpointsByGroup = await bconnect.endpoints.getEndpointsByLogicalGroup(
          args!.logicalGroupId as string,
          args || {}
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(endpointsByGroup, null, 2)
            }
          ]
        };

      case "list_windows_endpoints_by_logical_group":
        validateOrThrow(args, EndpointsRules.listWindowsEndpointsByLogicalGroup());
        const windowsEndpointsByGroup = await bconnect.endpoints.getWindowsEndpointsByLogicalGroup(
          args!.logicalGroupId as string,
          args || {}
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(windowsEndpointsByGroup, null, 2)
            }
          ]
        };

      case "start_android_enrollment":
        validateOrThrow(args, EndpointsRules.startAndroidEnrollment());
        const androidEnrollmentResult = await bconnect.endpoints.startAndroidEnrollment(
          args!.id as string,
          {
            enrollmentMailAddress: args!.enrollmentMailAddress as string | undefined ?? null,
            emailLanguageId: args!.emailLanguageId as string | undefined ?? null,
            forceMobileDataOnEnrollment: (args!.forceMobileDataOnEnrollment as boolean | undefined) ?? false,
            includeWifiInQrCode: (args!.includeWifiInQrCode as boolean | undefined) ?? false,
          }
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(androidEnrollmentResult, null, 2)
            }
          ]
        };

      case "start_ios_enrollment":
        validateOrThrow(args, EndpointsRules.startIosEnrollment());
        const iosEnrollmentResult = await bconnect.endpoints.startIosEnrollment(
          args!.id as string,
          {
            enrollmentMailAddress: args!.enrollmentMailAddress as string | undefined ?? null,
            emailLanguageId: args!.emailLanguageId as string | undefined ?? null,
          }
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(iosEnrollmentResult, null, 2)
            }
          ]
        };

      // Android Endpoint Write Operations handlers
      case "create_android_endpoint":
        validateOrThrow(args, EndpointsRules.createEndpoint());
        const androidEndpointData = {
          displayName: args!.displayName as string,
          logicalGroupId: args!.logicalGroupId as string | undefined,
          comment: args!.comment as string | undefined,
          serialNumber: args!.serialNumber as string | undefined,
          androidEnterpriseProfileType: args!.androidEnterpriseProfileType as any | undefined,
          registeredUser: args!.registeredUser as string | undefined
        };
        const createdAndroidEndpoint = await bconnect.endpoints.createAndroidEndpoint(androidEndpointData);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(createdAndroidEndpoint, null, 2)
            }
          ]
        };

      case "update_android_endpoint":
        validateOrThrow(args, EndpointsRules.updateEndpoint());
        // Build JSON Patch operations for update
        const patchOperations: any[] = [];
        if (args!.displayName !== undefined) {
          patchOperations.push({ op: "replace", path: "/displayName", value: args!.displayName });
        }
        if (args!.logicalGroupId !== undefined) {
          patchOperations.push({ op: "replace", path: "/logicalGroupId", value: args!.logicalGroupId });
        }
        if (args!.comment !== undefined) {
          patchOperations.push({ op: "replace", path: "/comment", value: args!.comment });
        }
        if (args!.serialNumber !== undefined) {
          patchOperations.push({ op: "replace", path: "/serialNumber", value: args!.serialNumber });
        }
        await bconnect.endpoints.updateAndroidEndpoint(args!.id as string, patchOperations);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, message: `Android endpoint ${args!.id} updated successfully` }, null, 2)
            }
          ]
        };

      case "delete_android_endpoint":
        validateOrThrow(args, EndpointsRules.deleteEndpoint());
        await bconnect.endpoints.deleteAndroidEndpoint(args!.id as string);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, message: `Android endpoint ${args!.id} deleted successfully` }, null, 2)
            }
          ]
        };

      // Endpoints API - Windows Write Operations handlers
      case "create_windows_endpoint":
        validateOrThrow(args, EndpointsRules.createEndpoint());
        const createdWinEndpoint = await bconnect.endpoints.createWindowsEndpoint(args!);
        return {
          content: [{ type: "text", text: JSON.stringify(createdWinEndpoint, null, 2) }]
        };

      case "update_windows_endpoint":
        validateOrThrow(args, EndpointsRules.updateEndpoint());
        const updatedWinEndpoint = await bconnect.endpoints.updateWindowsEndpoint(args!.id as string, args!);
        return {
          content: [{ type: "text", text: JSON.stringify(updatedWinEndpoint, null, 2) }]
        };

      case "delete_windows_endpoint":
        validateOrThrow(args, EndpointsRules.deleteEndpoint());
        await bconnect.endpoints.deleteWindowsEndpoint(args!.id as string);
        return {
          content: [{ type: "text", text: `Windows endpoint ${args!.id} deleted successfully` }]
        };

      case "start_windows_enrollment":
        validateOrThrow(args, EndpointsRules.getPlatformEndpoint());
        await bconnect.endpoints.startWindowsEndpointEnrollment(args!.id as string, args!);
        return {
          content: [{ type: "text", text: `Windows endpoint ${args!.id} enrollment started` }]
        };

      case "trigger_intune_installation":
        validateOrThrow(args, EndpointsRules.getPlatformEndpoint());
        await bconnect.endpoints.triggerInstallationViaIntune(args!.id as string);
        return {
          content: [{ type: "text", text: `Intune installation triggered for endpoint ${args!.id}` }]
        };

      // Endpoints API - Linux Write Operations handlers
      case "create_linux_endpoint":
        validateOrThrow(args, EndpointsRules.createEndpoint());
        const createdLinuxEndpoint = await bconnect.endpoints.createLinuxEndpoint(args!);
        return {
          content: [{ type: "text", text: JSON.stringify(createdLinuxEndpoint, null, 2) }]
        };

      case "update_linux_endpoint":
        validateOrThrow(args, EndpointsRules.updateEndpoint());
        const updatedLinuxEndpoint = await bconnect.endpoints.updateLinuxEndpoint(args!.id as string, args!);
        return {
          content: [{ type: "text", text: JSON.stringify(updatedLinuxEndpoint, null, 2) }]
        };

      case "delete_linux_endpoint":
        validateOrThrow(args, EndpointsRules.deleteEndpoint());
        await bconnect.endpoints.deleteLinuxEndpoint(args!.id as string);
        return {
          content: [{ type: "text", text: `Linux endpoint ${args!.id} deleted successfully` }]
        };

      // Endpoints API - Mac Write Operations handlers
      case "create_mac_endpoint":
        validateOrThrow(args, EndpointsRules.createEndpoint());
        const createdMacEndpoint = await bconnect.endpoints.createMacEndpoint(args!);
        return {
          content: [{ type: "text", text: JSON.stringify(createdMacEndpoint, null, 2) }]
        };

      case "update_mac_endpoint":
        validateOrThrow(args, EndpointsRules.updateEndpoint());
        const updatedMacEndpoint = await bconnect.endpoints.updateMacEndpoint(args!.id as string, args!);
        return {
          content: [{ type: "text", text: JSON.stringify(updatedMacEndpoint, null, 2) }]
        };

      case "delete_mac_endpoint":
        validateOrThrow(args, EndpointsRules.deleteEndpoint());
        await bconnect.endpoints.deleteMacEndpoint(args!.id as string);
        return {
          content: [{ type: "text", text: `Mac endpoint ${args!.id} deleted successfully` }]
        };

      case "start_mac_enrollment":
        validateOrThrow(args, EndpointsRules.getPlatformEndpoint());
        await bconnect.endpoints.startMacEndpointEnrollment(args!.id as string, args!);
        return {
          content: [{ type: "text", text: `Mac endpoint ${args!.id} enrollment started` }]
        };

      // Endpoints API - Logical Groups Write Operations handlers
      case "create_logical_group":
        validateOrThrow(args, EndpointsRules.createLogicalGroup());
        const createdGroup = await bconnect.endpoints.createLogicalGroup(args!);
        return {
          content: [{ type: "text", text: JSON.stringify(createdGroup, null, 2) }]
        };

      case "update_logical_group":
        validateOrThrow(args, EndpointsRules.updateLogicalGroup());
        const updatedGroup = await bconnect.endpoints.updateLogicalGroup(args!.id as string, args!);
        return {
          content: [{ type: "text", text: JSON.stringify(updatedGroup, null, 2) }]
        };

      case "delete_logical_group":
        validateOrThrow(args, EndpointsRules.deleteLogicalGroup());
        await bconnect.endpoints.deleteLogicalGroup(args!.id as string);
        return {
          content: [{ type: "text", text: `Logical group ${args!.id} deleted successfully` }]
        };

      // Maintenance Windows - Phase 3
      case "create_maintenance_window_for_endpoint":
        validateOrThrow(args, EndpointsRules.createMaintenanceWindowForEndpoint());
        const mwEndpoint = await bconnect.endpoints.createMaintenanceWindowForEndpoint(args!.id as string, args!.maintenanceWindowData as any);
        return { content: [{ type: "text", text: JSON.stringify(mwEndpoint, null, 2) }] };

      case "update_maintenance_window_for_endpoint":
        validateOrThrow(args, EndpointsRules.updateMaintenanceWindowForEndpoint());
        await bconnect.endpoints.updateMaintenanceWindowForEndpoint(args!.id as string, args!.maintenanceWindowData as any);
        return { content: [{ type: "text", text: `Maintenance window for endpoint ${args!.id} updated successfully` }] };

      case "delete_maintenance_window_for_endpoint":
        validateOrThrow(args, EndpointsRules.deleteMaintenanceWindowForEndpoint());
        await bconnect.endpoints.deleteMaintenanceWindowForEndpoint(args!.id as string);
        return { content: [{ type: "text", text: `Maintenance window for endpoint ${args!.id} deleted successfully` }] };

      case "create_maintenance_window_for_logical_group":
        validateOrThrow(args, EndpointsRules.createMaintenanceWindowForLogicalGroup());
        const mwGroup = await bconnect.endpoints.createMaintenanceWindowForLogicalGroup(args!.id as string, args!.maintenanceWindowData as any);
        return { content: [{ type: "text", text: JSON.stringify(mwGroup, null, 2) }] };

      case "update_maintenance_window_for_logical_group":
        validateOrThrow(args, EndpointsRules.updateMaintenanceWindowForLogicalGroup());
        await bconnect.endpoints.updateMaintenanceWindowForLogicalGroup(args!.id as string, args!.maintenanceWindowData as any);
        return { content: [{ type: "text", text: `Maintenance window for logical group ${args!.id} updated successfully` }] };

      case "delete_maintenance_window_for_logical_group":
        validateOrThrow(args, EndpointsRules.deleteMaintenanceWindowForLogicalGroup());
        await bconnect.endpoints.deleteMaintenanceWindowForLogicalGroup(args!.id as string);
        return { content: [{ type: "text", text: `Maintenance window for logical group ${args!.id} deleted successfully` }] };

      // Industrial & Network Endpoints - Phase 3
      case "create_industrial_endpoint":
        validateOrThrow(args, EndpointsRules.createSpecializedEndpoint());
        const newIndustrialEndpoint = await bconnect.endpoints.createIndustrialEndpoint(args!.endpointData as any);
        return { content: [{ type: "text", text: `Industrial endpoint created successfully. ID: ${newIndustrialEndpoint.id}` }] };

      case "update_industrial_endpoint":
        validateOrThrow(args, EndpointsRules.updateSpecializedEndpoint());
        const updatedIndustrialEndpoint = await bconnect.endpoints.updateIndustrialEndpoint(args!.id as string, args!.updateData as any);
        return { content: [{ type: "text", text: `Industrial endpoint ${args!.id} updated successfully` }] };

      case "delete_industrial_endpoint":
        validateOrThrow(args, EndpointsRules.deleteEndpoint());
        await bconnect.endpoints.deleteIndustrialEndpoint(args!.id as string);
        return { content: [{ type: "text", text: `Industrial endpoint ${args!.id} deleted successfully` }] };

      case "create_network_endpoint":
        validateOrThrow(args, EndpointsRules.createSpecializedEndpoint());
        const newNetworkEndpoint = await bconnect.endpoints.createNetworkEndpoint(args!.endpointData as any);
        return { content: [{ type: "text", text: `Network endpoint created successfully. ID: ${newNetworkEndpoint.id}` }] };

      case "update_network_endpoint":
        validateOrThrow(args, EndpointsRules.updateSpecializedEndpoint());
        const updatedNetworkEndpoint = await bconnect.endpoints.updateNetworkEndpoint(args!.id as string, args!.updateData as any);
        return { content: [{ type: "text", text: `Network endpoint ${args!.id} updated successfully` }] };

      case "delete_network_endpoint":
        validateOrThrow(args, EndpointsRules.deleteEndpoint());
        await bconnect.endpoints.deleteNetworkEndpoint(args!.id as string);
        return { content: [{ type: "text", text: `Network endpoint ${args!.id} deleted successfully` }] };

      case "delete_endpoint":
        validateOrThrow(args, EndpointsRules.deleteEndpoint());
        await bconnect.endpoints.deleteEndpoint(args!.id as string);
        return { content: [{ type: "text", text: `Endpoint ${args!.id} deleted successfully` }] };

      // Jobs API handlers
      case "list_job_definitions":
        validateOrThrow(args, JobsRules.listJobDefinitions());
        const jobDefinitions = await bconnect.jobs.getJobDefinitions(args || {});
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(jobDefinitions, null, 2)
            }
          ]
        };

      case "get_job_definition":
        validateOrThrow(args, JobsRules.getJobDefinition());
        const jobDefinition = await bconnect.jobs.getJobDefinition(args!.id as string);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(jobDefinition, null, 2)
            }
          ]
        };

      case "list_job_instances":
        validateOrThrow(args, JobsRules.listJobInstances());
        const jobInstances = await bconnect.jobs.getJobInstances(args || {});
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(jobInstances, null, 2)
            }
          ]
        };

      case "get_job_instance":
        validateOrThrow(args, JobsRules.getJobInstance());
        const jobInstance = await bconnect.jobs.getJobInstance(args!.id as string);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(jobInstance, null, 2)
            }
          ]
        };

      case "list_endpoint_job_instances":
        validateOrThrow(args, JobsRules.getJobInstance());
        const endpointJobInstances = await bconnect.jobs.getEndpointJobInstances(
          args!.endpointId as string,
          args || {}
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(endpointJobInstances, null, 2)
            }
          ]
        };

      case "list_job_instances_by_definition":
        validateOrThrow(args, JobsRules.listJobInstancesByDefinition());
        const jobInstancesByDef = await bconnect.jobs.getJobInstancesByJobDefinition(
          args!.jobDefinitionId as string,
          args || {}
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(jobInstancesByDef, null, 2)
            }
          ]
        };

      case "list_job_instances_by_logical_group":
        validateOrThrow(args, JobsRules.listJobInstancesByLogicalGroup());
        const jobInstancesByGroup = await bconnect.jobs.getJobInstancesByLogicalGroup(
          args!.logicalGroupId as string,
          args || {}
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(jobInstancesByGroup, null, 2)
            }
          ]
        };

      case "list_job_definitions_by_folder":
        validateOrThrow(args, JobsRules.listJobDefinitionsByFolder());
        const jobDefinitionsByFolder = await bconnect.jobs.getJobDefinitionsByFolder(
          args!.folderId as string,
          args || {}
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(jobDefinitionsByFolder, null, 2)
            }
          ]
        };

      // Jobs API - Write Operations handlers
      case "create_job_instance":
        validateOrThrow(args, JobsRules.createJobInstance());
        const createdJobInstance = await bconnect.jobs.createJobInstance(args as any);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(createdJobInstance, null, 2)
            }
          ]
        };

      case "start_job_instance":
        validateOrThrow(args, JobsRules.getJobInstance());
        await bconnect.jobs.startJobInstance(args!.id as string);
        return {
          content: [
            {
              type: "text",
              text: `Job instance ${args!.id} started successfully`
            }
          ]
        };

      case "stop_job_instance":
        validateOrThrow(args, JobsRules.getJobInstance());
        await bconnect.jobs.stopJobInstance(args!.id as string);
        return {
          content: [
            {
              type: "text",
              text: `Job instance ${args!.id} stopped successfully`
            }
          ]
        };

      case "resume_job_instance":
        validateOrThrow(args, JobsRules.getJobInstance());
        await bconnect.jobs.resumeJobInstance(args!.id as string);
        return {
          content: [
            {
              type: "text",
              text: `Job instance ${args!.id} resumed successfully`
            }
          ]
        };

      case "delete_job_instance":
        validateOrThrow(args, JobsRules.deleteJobInstance());
        await bconnect.jobs.deleteJobInstance(args!.id as string);
        return {
          content: [
            {
              type: "text",
              text: `Job instance ${args!.id} deleted successfully`
            }
          ]
        };

      case "create_job_folder":
        validateOrThrow(args, JobsRules.createJobFolder());
        const createdFolder = await bconnect.jobs.createFolder(args as any);
        return {
          content: [{ type: "text", text: JSON.stringify(createdFolder, null, 2) }]
        };

      case "update_job_folder":
        validateOrThrow(args, JobsRules.updateJobInstance());
        const updatedFolder = await bconnect.jobs.updateFolder(args!.id as string, args!);
        return {
          content: [{ type: "text", text: JSON.stringify(updatedFolder, null, 2) }]
        };

      case "delete_job_folder":
        validateOrThrow(args, JobsRules.getJobFolder());
        await bconnect.jobs.deleteFolder(args!.id as string);
        return {
          content: [{ type: "text", text: `Job folder ${args!.id} deleted successfully` }]
        };

      case "assign_job_to_logical_group":
        validateOrThrow(args, JobsRules.assignJob());
        const logicalGroupInstances = await bconnect.jobs.assignJobDefinitionToLogicalGroup(args!.logicalGroupId as string, args!);
        return {
          content: [{ type: "text", text: `Created ${logicalGroupInstances.length} job instances:\n${JSON.stringify(logicalGroupInstances, null, 2)}` }]
        };

      case "assign_job_to_static_group":
        validateOrThrow(args, JobsRules.assignJob());
        const staticGroupInstances = await bconnect.jobs.assignJobDefinitionToStaticGroup(args!.staticGroupId as string, args!);
        return {
          content: [{ type: "text", text: `Created ${staticGroupInstances.length} job instances:\n${JSON.stringify(staticGroupInstances, null, 2)}` }]
        };

      case "assign_job_to_dynamic_group":
        validateOrThrow(args, JobsRules.assignJob());
        const dynamicGroupInstances = await bconnect.jobs.assignJobDefinitionToWindowsDynamicGroup(args!.dynamicGroupId as string, args!);
        return {
          content: [{ type: "text", text: `Created ${dynamicGroupInstances.length} job instances:\n${JSON.stringify(dynamicGroupInstances, null, 2)}` }]
        };

      case "assign_job_to_universal_dynamic_group":
        validateOrThrow(args, JobsRules.assignJob());
        const universalGroupInstances = await bconnect.jobs.assignJobDefinitionToUniversalDynamicGroup(args!.universalDynamicGroupId as string, args!);
        return {
          content: [{ type: "text", text: `Created ${universalGroupInstances.length} job instances:\n${JSON.stringify(universalGroupInstances, null, 2)}` }]
        };

      case "create_kiosk_release":
        validateOrThrow(args, JobsRules.releaseKioskJob());
        const createdKioskRelease = await bconnect.jobs.createKioskRelease(args!);
        return {
          content: [{ type: "text", text: JSON.stringify(createdKioskRelease, null, 2) }]
        };

      case "withdraw_kiosk_release":
        validateOrThrow(args, JobsRules.getJobDefinition());
        await bconnect.jobs.withdrawKioskRelease(args!.id as string);
        return {
          content: [{ type: "text", text: `Kiosk release ${args!.id} withdrawn successfully` }]
        };

      case "list_kiosk_releases":
        validateOrThrow(args, JobsRules.listJobDefinitions());
        const kioskReleases = await bconnect.jobs.getKioskReleases(args || {});
        return {
          content: [{ type: "text", text: JSON.stringify(kioskReleases, null, 2) }]
        };

      case "get_kiosk_release":
        validateOrThrow(args, JobsRules.getJobDefinition());
        const kioskRelease = await bconnect.jobs.getKioskRelease(args!.id as string);
        return {
          content: [{ type: "text", text: JSON.stringify(kioskRelease, null, 2) }]
        };

      // Assets API handlers
      case "list_assets":
        validateOrThrow(args, AssetsRules.listAssets());
        const assets = await bconnect.assets.getAssets(args || {});
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(assets, null, 2)
            }
          ]
        };

      case "get_asset":
        validateOrThrow(args, AssetsRules.getAsset());
        const asset = await bconnect.assets.getAsset(args!.id as string);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(asset, null, 2)
            }
          ]
        };

      case "list_asset_types":
        validateOrThrow(args, AssetsRules.listAssetTypes());
        const assetTypes = await bconnect.assets.getAssetTypes(args || {});
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(assetTypes, null, 2)
            }
          ]
        };

      case "get_asset_type":
        validateOrThrow(args, AssetsRules.getAssetType());
        const assetType = await bconnect.assets.getAssetType(args!.id as string);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(assetType, null, 2)
            }
          ]
        };

      case "list_assets_by_logical_group":
        validateOrThrow(args, AssetsRules.getAsset());
        const assetsByGroup = await bconnect.assets.getAssetsByLogicalGroup(
          args!.logicalGroupId as string,
          args || {}
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(assetsByGroup, null, 2)
            }
          ]
        };

      case "list_assets_by_endpoint":
        validateOrThrow(args, AssetsRules.getAsset());
        const assetsByEndpoint = await bconnect.assets.getAssetsByEndpoint(
          args!.endpointId as string,
          args || {}
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(assetsByEndpoint, null, 2)
            }
          ]
        };

      case "list_asset_stock_assets":
        validateOrThrow(args, AssetsRules.listAssets());
        const stockAssets = await bconnect.assets.getAssetStockAssets(args || {});
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(stockAssets, null, 2)
            }
          ]
        };

      case "list_asset_stock_folders":
        validateOrThrow(args, AssetsRules.listAssets());
        const stockFolders = await bconnect.assets.getAssetStockFolders(args || {});
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(stockFolders, null, 2)
            }
          ]
        };

      // Assets API - Write Operations (Phase 2)
      case "create_asset":
        validateOrThrow(args, AssetsRules.createAsset());
        const createdAsset = await bconnect.assets.createAsset(args as any);
        return {
          content: [{ type: "text", text: JSON.stringify(createdAsset, null, 2) }]
        };

      case "update_asset":
        validateOrThrow(args, AssetsRules.updateAsset());
        await bconnect.assets.updateAsset(args!.id as string, args as any);
        return {
          content: [{ type: "text", text: `Asset ${args!.id} updated successfully` }]
        };

      case "delete_asset":
        validateOrThrow(args, AssetsRules.deleteAsset());
        await bconnect.assets.deleteAsset(args!.id as string);
        return {
          content: [{ type: "text", text: `Asset ${args!.id} deleted successfully` }]
        };

      case "create_asset_type":
        validateOrThrow(args, AssetsRules.createAsset());
        const createdAssetType = await bconnect.assets.createAssetType(args as any);
        return {
          content: [{ type: "text", text: JSON.stringify(createdAssetType, null, 2) }]
        };

      case "delete_asset_type":
        validateOrThrow(args, AssetsRules.getAssetType());
        await bconnect.assets.deleteAssetType(args!.id as string);
        return {
          content: [{ type: "text", text: `Asset type ${args!.id} deleted successfully` }]
        };

      case "create_asset_stock_folder":
        validateOrThrow(args, AssetsRules.createAssetStockFolder());
        const createdStockFolder = await bconnect.assets.createAssetStockFolder(args! as any);
        return {
          content: [{ type: "text", text: JSON.stringify(createdStockFolder, null, 2) }]
        };

      case "update_asset_stock_folder":
        validateOrThrow(args, AssetsRules.updateAssetStockFolder());
        await bconnect.assets.updateAssetStockFolder(args!.id as string, args! as any);
        return {
          content: [{ type: "text", text: `Asset stock folder ${args!.id} updated successfully` }]
        };

      case "delete_asset_stock_folder":
        validateOrThrow(args, AssetsRules.deleteAssetStockFolder());
        await bconnect.assets.deleteAssetStockFolder(args!.id as string);
        return {
          content: [{ type: "text", text: `Asset stock folder ${args!.id} deleted successfully` }]
        };

      case "create_asset_type_folder":
        validateOrThrow(args, AssetsRules.createAssetTypeFolder());
        const createdTypeFolder = await bconnect.assets.createAssetTypeFolder(args! as any);
        return {
          content: [{ type: "text", text: JSON.stringify(createdTypeFolder, null, 2) }]
        };

      case "update_asset_type_folder":
        validateOrThrow(args, AssetsRules.updateAssetTypeFolder());
        await bconnect.assets.updateAssetTypeFolder(args!.id as string, args! as any);
        return {
          content: [{ type: "text", text: `Asset type folder ${args!.id} updated successfully` }]
        };

      case "delete_asset_type_folder":
        validateOrThrow(args, AssetsRules.deleteAssetTypeFolder());
        await bconnect.assets.deleteAssetTypeFolder(args!.id as string);
        return {
          content: [{ type: "text", text: `Asset type folder ${args!.id} deleted successfully` }]
        };

      // Active Directory API handlers
      case "list_ad_groups":
        validateOrThrow(args, ActiveDirectoryRules.listADGroups());
        const adGroups = await bconnect.activedirectory.getADGroups(args || {});
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(adGroups, null, 2)
            }
          ]
        };

      case "get_ad_group":
        validateOrThrow(args, ActiveDirectoryRules.getADGroup());
        const adGroup = await bconnect.activedirectory.getADGroup(args!.id as string);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(adGroup, null, 2)
            }
          ]
        };

      case "list_ad_users":
        validateOrThrow(args, ActiveDirectoryRules.listADUsers());
        const adUsers = await bconnect.activedirectory.getADUsers(args || {});
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(adUsers, null, 2)
            }
          ]
        };

      case "get_ad_user":
        validateOrThrow(args, ActiveDirectoryRules.getADUser());
        const adUser = await bconnect.activedirectory.getADUser(args!.id as string);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(adUser, null, 2)
            }
          ]
        };

      case "list_ad_objects":
        validateOrThrow(args, ActiveDirectoryRules.listADGroups());
        const adObjects = await bconnect.activedirectory.getADObjects(args || {});
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(adObjects, null, 2)
            }
          ]
        };

      case "get_ad_object":
        validateOrThrow(args, ActiveDirectoryRules.getADGroup());
        const adObject = await bconnect.activedirectory.getADObject(args!.id as string);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(adObject, null, 2)
            }
          ]
        };

      case "list_org_units":
        validateOrThrow(args, ActiveDirectoryRules.listADGroups());
        const orgUnits = await bconnect.activedirectory.getOrgUnits(args || {});
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(orgUnits, null, 2)
            }
          ]
        };

      case "get_org_unit":
        validateOrThrow(args, ActiveDirectoryRules.getADGroup());
        const orgUnit = await bconnect.activedirectory.getOrgUnit(args!.id as string);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(orgUnit, null, 2)
            }
          ]
        };

      case "list_ad_users_by_group":
        validateOrThrow(args, ActiveDirectoryRules.getADGroup());
        const adUsersByGroup = await bconnect.activedirectory.getADUsersByGroup(
          args!.adGroupId as string,
          args || {}
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(adUsersByGroup, null, 2)
            }
          ]
        };

      case "list_ad_groups_by_org_unit":
        validateOrThrow(args, ActiveDirectoryRules.getADGroup());
        const adGroupsByOrgUnit = await bconnect.activedirectory.getADGroupsByOrgUnit(
          args!.orgUnitId as string,
          args || {}
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(adGroupsByOrgUnit, null, 2)
            }
          ]
        };

      case "get_ad_object_memberships":
        validateOrThrow(args, ActiveDirectoryRules.getADObjectMemberships());
        const adObjectMemberships = await bconnect.activedirectory.getADObjectMemberships(
          args!.id as string,
          {
            includeIndirect: args!.includeIndirect as boolean | undefined,
            SearchQuery: args!.SearchQuery as string | undefined,
            Page: args!.Page as number | undefined,
            PageSize: args!.PageSize as number | undefined,
          }
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(adObjectMemberships, null, 2)
            }
          ]
        };

      // Software API handlers
      case "list_installed_windows_software":
        validateOrThrow(args, SoftwareRules.listInstalledWindowsSoftware());
        const installedSoftware = await bconnect.software.getInstalledWindowsSoftware(args || {});
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(installedSoftware, null, 2)
            }
          ]
        };

      case "list_installed_software_by_endpoint":
        validateOrThrow(args, SoftwareRules.listInstalledWindowsSoftware());
        const softwareByEndpoint = await bconnect.software.getInstalledSoftwareByEndpoint(
          args!.endpointId as string,
          args || {}
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(softwareByEndpoint, null, 2)
            }
          ]
        };

      case "list_installed_software_by_logical_group":
        validateOrThrow(args, SoftwareRules.listInstalledWindowsSoftware());
        const softwareByGroup = await bconnect.software.getInstalledSoftwareByLogicalGroup(
          args!.logicalGroupId as string,
          args || {}
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(softwareByGroup, null, 2)
            }
          ]
        };

      case "list_installed_software_by_universal_dynamic_group":
        validateOrThrow(args, SoftwareRules.listInstalledWindowsSoftware());
        const softwareByDynamicGroup = await bconnect.software.getInstalledSoftwareByUniversalDynamicGroup(
          args!.universalDynamicGroupId as string,
          args || {}
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(softwareByDynamicGroup, null, 2)
            }
          ]
        };

      // Update Management API handlers
      case "list_update_management_windows_endpoints":
        validateOrThrow(args, UpdateManagementRules.listWindowsEndpoints());
        const updateEndpoints = await bconnect.updatemanagement.getWindowsEndpoints(args || {});
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(updateEndpoints, null, 2)
            }
          ]
        };

      case "get_update_management_windows_endpoint":
        validateOrThrow(args, UpdateManagementRules.getWindowsEndpoint());
        const updateEndpoint = await bconnect.updatemanagement.getWindowsEndpoint(args!.id as string);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(updateEndpoint, null, 2)
            }
          ]
        };

      // UpdateManagement Write Operations - Phase 3
      case "update_update_management_windows_endpoint":
        validateOrThrow(args, UpdateManagementRules.getWindowsEndpoint());
        const updatedUpdateEndpoint = await bconnect.updatemanagement.updateWindowsEndpoint(args!.id as string, args!.updateData as any);
        return { content: [{ type: "text", text: `Windows endpoint ${args!.id} update profile updated successfully. New profile: ${updatedUpdateEndpoint.updateProfileName || 'None'}` }] };

      // Defense Control API handlers
      case "list_bitlocker_windows_endpoints":
        validateOrThrow(args, DefenseControlRules.listBitLockerEndpoints());
        const bitlockerEndpoints = await bconnect.defensecontrol.getBitLockerWindowsEndpoints(args || {});
        return { content: [{ type: "text", text: JSON.stringify(bitlockerEndpoints, null, 2) }] };

      case "get_bitlocker_windows_endpoint":
        validateOrThrow(args, DefenseControlRules.getBitLockerEndpoint());
        const bitlockerEndpoint = await bconnect.defensecontrol.getBitLockerWindowsEndpoint(args!.id as string);
        return { content: [{ type: "text", text: JSON.stringify(bitlockerEndpoint, null, 2) }] };

      case "get_local_admin_accounts":
        validateOrThrow(args, DefenseControlRules.getBitLockerEndpoint());
        const localAdminAccounts = await bconnect.defensecontrol.getLocalAdministrativeAccounts(args!.id as string);
        return { content: [{ type: "text", text: JSON.stringify(localAdminAccounts, null, 2) }] };

      case "trigger_local_admin_accounts_update":
        validateOrThrow(args, DefenseControlRules.getBitLockerEndpoint());
        const triggerResult = await bconnect.defensecontrol.triggerLocalAdminAccountsUpdate(args!.id as string);
        return { content: [{ type: "text", text: JSON.stringify(triggerResult, null, 2) }] };

      // DefenseControl Write Operations - Phase 3
      case "trigger_update_on_client":
        validateOrThrow(args, DefenseControlRules.getBitLockerEndpoint());
        const updateSuccess = await bconnect.defensecontrol.triggerUpdateOnClient(args!.id as string, args!.timeout as number | undefined);
        return { content: [{ type: "text", text: `Local admin account update ${updateSuccess ? 'successful' : 'failed (client offline or timeout reached)'}. Endpoint: ${args!.id}` }] };

      case "patch_local_admin_user_credentials":
        validateOrThrow(args, DefenseControlRules.getBitLockerEndpoint());
        const updatedLocalAdmin = await bconnect.defensecontrol.patchLocalAdminUserCredentials(args!.id as string, args!.updateData as any);
        return { content: [{ type: "text", text: JSON.stringify(updatedLocalAdmin, null, 2) }] };

      case "list_defender_threats":
        validateOrThrow(args, DefenseControlRules.listMicrosoftDefenderThreats());
        const defenderThreats = await bconnect.defensecontrol.getMicrosoftDefenderThreats(args || {});
        return { content: [{ type: "text", text: JSON.stringify(defenderThreats, null, 2) }] };

      case "get_defender_threat":
        validateOrThrow(args, DefenseControlRules.getMicrosoftDefenderThreat());
        const defenderThreat = await bconnect.defensecontrol.getMicrosoftDefenderThreat(args!.id as string);
        return { content: [{ type: "text", text: JSON.stringify(defenderThreat, null, 2) }] };

      case "list_defender_threats_by_endpoint":
        validateOrThrow(args, DefenseControlRules.getMicrosoftDefenderThreat());
        const threatsByEndpoint = await bconnect.defensecontrol.getMicrosoftDefenderThreatsByEndpoint(args!.endpointId as string, args || {});
        return { content: [{ type: "text", text: JSON.stringify(threatsByEndpoint, null, 2) }] };

      case "list_defender_threats_by_logical_group":
        validateOrThrow(args, DefenseControlRules.getMicrosoftDefenderThreat());
        const threatsByGroup = await bconnect.defensecontrol.getMicrosoftDefenderThreatsByLogicalGroup(args!.logicalGroupId as string, args || {});
        return { content: [{ type: "text", text: JSON.stringify(threatsByGroup, null, 2) }] };

      case "list_defender_windows_endpoints":
        validateOrThrow(args, DefenseControlRules.listMicrosoftDefenderEndpoints());
        const defenderEndpoints = await bconnect.defensecontrol.getMicrosoftDefenderWindowsEndpoints(args || {});
        return { content: [{ type: "text", text: JSON.stringify(defenderEndpoints, null, 2) }] };

      case "get_defender_windows_endpoint":
        validateOrThrow(args, DefenseControlRules.getBitLockerEndpoint());
        const defenderEndpoint = await bconnect.defensecontrol.getMicrosoftDefenderWindowsEndpoint(args!.id as string);
        return { content: [{ type: "text", text: JSON.stringify(defenderEndpoint, null, 2) }] };

      // Variables API handlers
      case "list_variable_definitions":
        validateOrThrow(args, VariablesRules.listVariableDefinitions());
        const varDefs = await bconnect.variables.getVariableDefinitions(args || {});
        return { content: [{ type: "text", text: JSON.stringify(varDefs, null, 2) }] };
      case "get_variable_definition":
        validateOrThrow(args, VariablesRules.getVariableDefinition());
        const varDef = await bconnect.variables.getVariableDefinition(args!.id as string);
        return { content: [{ type: "text", text: JSON.stringify(varDef, null, 2) }] };
      case "list_variable_instances":
        validateOrThrow(args, VariablesRules.listVariableInstances());
        const varInsts = await bconnect.variables.getVariableInstances(args || {});
        return { content: [{ type: "text", text: JSON.stringify(varInsts, null, 2) }] };
      case "get_variable_instance":
        validateOrThrow(args, VariablesRules.getVariableDefinition());
        const varInst = await bconnect.variables.getVariableInstance(args!.id as string);
        return { content: [{ type: "text", text: JSON.stringify(varInst, null, 2) }] };
      case "list_variables_by_endpoint":
        validateOrThrow(args, VariablesRules.listVariableInstances());
        const varsByEndpoint = await bconnect.variables.getVariableInstancesByEndpoint(args!.endpointId as string, args || {});
        return { content: [{ type: "text", text: JSON.stringify(varsByEndpoint, null, 2) }] };
      case "list_variables_by_logical_group":
        validateOrThrow(args, VariablesRules.listVariableInstances());
        const varsByGroup = await bconnect.variables.getVariableInstancesByLogicalGroup(args!.logicalGroupId as string, args || {});
        return { content: [{ type: "text", text: JSON.stringify(varsByGroup, null, 2) }] };
      case "list_variables_by_ad_object":
        validateOrThrow(args, VariablesRules.listVariableInstances());
        const varsByAD = await bconnect.variables.getVariableInstancesByADObject(args!.adObjectId as string, args || {});
        return { content: [{ type: "text", text: JSON.stringify(varsByAD, null, 2) }] };
      case "list_variables_by_windows_application":
        validateOrThrow(args, VariablesRules.listVariableInstances());
        const varsByApp = await bconnect.variables.getVariableInstancesByWindowsApplication(args!.windowsApplicationId as string, args || {});
        return { content: [{ type: "text", text: JSON.stringify(varsByApp, null, 2) }] };
      case "list_variables_by_windows_job":
        validateOrThrow(args, VariablesRules.listVariableInstances());
        const varsByJob = await bconnect.variables.getVariableInstancesByWindowsJobDefinition(args!.windowsJobDefinitionId as string, args || {});
        return { content: [{ type: "text", text: JSON.stringify(varsByJob, null, 2) }] };

      // Variables Write Operations - Phase 3
      case "create_variable_definition":
        validateOrThrow(args, VariablesRules.createVariableDefinition());
        const newVarDef = await bconnect.variables.createVariableDefinition(args!.varDefData as any);
        return { content: [{ type: "text", text: JSON.stringify(newVarDef, null, 2) }] };
      case "update_variable_definition":
        validateOrThrow(args, VariablesRules.updateVariableDefinition());
        const updatedVarDef = await bconnect.variables.updateVariableDefinition(args!.id as string, args!.updateData as any);
        return { content: [{ type: "text", text: JSON.stringify(updatedVarDef, null, 2) }] };
      case "delete_variable_definition":
        validateOrThrow(args, VariablesRules.deleteVariableDefinition());
        await bconnect.variables.deleteVariableDefinition(args!.id as string);
        return { content: [{ type: "text", text: "Variable definition deleted successfully" }] };
      case "update_variable_instance":
        validateOrThrow(args, VariablesRules.updateVariableDefinition());
        const updatedVarInst = await bconnect.variables.updateVariableInstance(args!.id as string, args!.updateData as any);
        return { content: [{ type: "text", text: JSON.stringify(updatedVarInst, null, 2) }] };

      // Operating Systems API handlers
      case "list_os_folders":
        validateOrThrow(args, OperatingSystemsRules.listWindowsEndpoints());
        const osFolders = await bconnect.operatingsystems.getFolders(args || {});
        return { content: [{ type: "text", text: JSON.stringify(osFolders, null, 2) }] };
      case "get_os_folder":
        validateOrThrow(args, OperatingSystemsRules.getWindowsEndpoint());
        const osFolder = await bconnect.operatingsystems.getFolder(args!.id as string);
        return { content: [{ type: "text", text: JSON.stringify(osFolder, null, 2) }] };
      case "list_os_folders_by_parent":
        validateOrThrow(args, OperatingSystemsRules.getWindowsEndpoint());
        const osFoldersByParent = await bconnect.operatingsystems.getFoldersByFolderId(args!.folderId as string, args || {});
        return { content: [{ type: "text", text: JSON.stringify(osFoldersByParent, null, 2) }] };
      case "list_os_windows_endpoints":
        validateOrThrow(args, OperatingSystemsRules.listWindowsEndpoints());
        const osWindowsEndpoints = await bconnect.operatingsystems.getWindowsEndpoints(args || {});
        return { content: [{ type: "text", text: JSON.stringify(osWindowsEndpoints, null, 2) }] };
      case "get_os_windows_endpoint":
        validateOrThrow(args, OperatingSystemsRules.getWindowsEndpoint());
        const osWindowsEndpoint = await bconnect.operatingsystems.getWindowsEndpoint(args!.id as string);
        return { content: [{ type: "text", text: JSON.stringify(osWindowsEndpoint, null, 2) }] };

      // OperatingSystems Write Operations - Phase 3
      case "create_os_folder":
        validateOrThrow(args, OperatingSystemsRules.createOsFolder());
        const newOsFolder = await bconnect.operatingsystems.createFolder(args!.folderData as any);
        return { content: [{ type: "text", text: `OS folder created successfully. ID: ${newOsFolder.id}, Name: ${newOsFolder.name}` }] };

      case "update_os_folder":
        validateOrThrow(args, OperatingSystemsRules.updateOsFolder());
        const updatedOsFolder = await bconnect.operatingsystems.updateFolder(args!.id as string, args!.updateData as any);
        return { content: [{ type: "text", text: `OS folder ${args!.id} updated successfully. New name: ${updatedOsFolder.name}` }] };

      case "delete_os_folder":
        validateOrThrow(args, OperatingSystemsRules.deleteOsFolder());
        await bconnect.operatingsystems.deleteFolder(args!.id as string);
        return { content: [{ type: "text", text: `OS folder ${args!.id} deleted successfully` }] };

      case "update_os_windows_endpoint":
        validateOrThrow(args, OperatingSystemsRules.updateOsWindowsEndpoint());
        const updatedOsEndpoint = await bconnect.operatingsystems.updateWindowsEndpoint(args!.id as string, args!.updateData as any);
        return { content: [{ type: "text", text: `Windows endpoint ${args!.id} OS install configuration updated successfully` }] };

      // Server Management API handlers
      case "get_management_server":
        validateOrThrow(args, ServerManagementRules.getManagementServer());
        const managementServer = await bconnect.servermanagement.getManagementServer();
        return { content: [{ type: "text", text: JSON.stringify(managementServer, null, 2) }] };
      case "get_gateway":
        validateOrThrow(args, ServerManagementRules.getGateway());
        const gateway = await bconnect.servermanagement.getGateway();
        return { content: [{ type: "text", text: JSON.stringify(gateway, null, 2) }] };
      case "get_dip_status":
        validateOrThrow(args, ServerManagementRules.getDipStatus());
        const dipStatus = await bconnect.servermanagement.getDipStatus();
        return { content: [{ type: "text", text: JSON.stringify(dipStatus, null, 2) }] };
      case "get_vpn_appliance":
        validateOrThrow(args, ServerManagementRules.getVpnAppliance());
        const vpnAppliance = await bconnect.servermanagement.getVpnAppliance();
        return { content: [{ type: "text", text: JSON.stringify(vpnAppliance, null, 2) }] };
      case "list_microservices":
        validateOrThrow(args, ServerManagementRules.listMicroservices());
        const microservices = await bconnect.servermanagement.getMicroservices();
        return { content: [{ type: "text", text: JSON.stringify(microservices, null, 2) }] };
      case "get_microservice":
        validateOrThrow(args, ServerManagementRules.getMicroservice());
        const microservice = await bconnect.servermanagement.getMicroservice(args!.id as string);
        return { content: [{ type: "text", text: JSON.stringify(microservice, null, 2) }] };
      case "list_cloud_connectors":
        validateOrThrow(args, ServerManagementRules.listCloudConnectors());
        const cloudConnectors = await bconnect.servermanagement.getCloudConnectors();
        return { content: [{ type: "text", text: JSON.stringify(cloudConnectors, null, 2) }] };
      case "list_pxe_relays":
        validateOrThrow(args, ServerManagementRules.listPxeRelays());
        const pxeRelays = await bconnect.servermanagement.getPxeRelays();
        return { content: [{ type: "text", text: JSON.stringify(pxeRelays, null, 2) }] };
      case "list_security_groups":
        validateOrThrow(args, ServerManagementRules.listSecurityGroups());
        const securityGroups = await bconnect.servermanagement.getSecurityGroups(args || {});
        return { content: [{ type: "text", text: JSON.stringify(securityGroups, null, 2) }] };
      case "get_security_group":
        validateOrThrow(args, ServerManagementRules.getSecurityGroup());
        const securityGroup = await bconnect.servermanagement.getSecurityGroup(args!.id as string);
        return { content: [{ type: "text", text: JSON.stringify(securityGroup, null, 2) }] };
      case "list_security_profiles":
        validateOrThrow(args, ServerManagementRules.listSecurityProfiles());
        const securityProfiles = await bconnect.servermanagement.getSecurityProfiles(args || {});
        return { content: [{ type: "text", text: JSON.stringify(securityProfiles, null, 2) }] };
      case "get_security_profile":
        validateOrThrow(args, ServerManagementRules.getSecurityProfile());
        const securityProfile = await bconnect.servermanagement.getSecurityProfile(args!.id as string);
        return { content: [{ type: "text", text: JSON.stringify(securityProfile, null, 2) }] };
      case "get_object_access_rights":
        validateOrThrow(args, ServerManagementRules.getObjectAccessRights());
        const accessRights = await bconnect.servermanagement.getAccessRights(args!.objectId as string);
        return { content: [{ type: "text", text: JSON.stringify(accessRights, null, 2) }] };

      // ServerManagement API - Write Operations (Phase 2)
      case "restart_management_server":
        validateOrThrow(args, ServerManagementRules.restartManagementServer());
        await bconnect.servermanagement.restartManagementServer();
        return { content: [{ type: "text", text: "Management server restart initiated successfully" }] };
      case "cancel_scheduled_restart":
        validateOrThrow(args, ServerManagementRules.cancelScheduledRestart());
        await bconnect.servermanagement.cancelScheduledRestart();
        return { content: [{ type: "text", text: "Scheduled restart cancelled successfully" }] };
      case "start_microservice":
        validateOrThrow(args, ServerManagementRules.startMicroservice());
        await bconnect.servermanagement.startMicroservice(args!.id as string);
        return { content: [{ type: "text", text: `Microservice ${args!.id} started successfully` }] };
      case "stop_microservice":
        validateOrThrow(args, ServerManagementRules.stopMicroservice());
        await bconnect.servermanagement.stopMicroservice(args!.id as string);
        return { content: [{ type: "text", text: `Microservice ${args!.id} stopped successfully` }] };
      case "restart_microservice":
        validateOrThrow(args, ServerManagementRules.restartMicroservice());
        await bconnect.servermanagement.restartMicroservice(args!.id as string);
        return { content: [{ type: "text", text: `Microservice ${args!.id} restarted successfully` }] };
      case "create_security_group":
        validateOrThrow(args, ServerManagementRules.createSecurityGroup());
        const createdSecurityGroup = await bconnect.servermanagement.createSecurityGroup(args as any);
        return { content: [{ type: "text", text: JSON.stringify(createdSecurityGroup, null, 2) }] };
      case "update_security_group":
        validateOrThrow(args, ServerManagementRules.updateSecurityGroup());
        await bconnect.servermanagement.updateSecurityGroup(args!.id as string, args as any);
        return { content: [{ type: "text", text: `Security group ${args!.id} updated successfully` }] };
      case "delete_security_group":
        validateOrThrow(args, ServerManagementRules.deleteSecurityGroup());
        await bconnect.servermanagement.deleteSecurityGroup(args!.id as string);
        return { content: [{ type: "text", text: `Security group ${args!.id} deleted successfully` }] };
      case "create_security_profile":
        validateOrThrow(args, ServerManagementRules.createSecurityProfile());
        const createdSecurityProfile = await bconnect.servermanagement.createSecurityProfile(args as any);
        return { content: [{ type: "text", text: JSON.stringify(createdSecurityProfile, null, 2) }] };
      case "update_security_profile":
        validateOrThrow(args, ServerManagementRules.updateSecurityProfile());
        await bconnect.servermanagement.updateSecurityProfile(args!.id as string, args as any);
        return { content: [{ type: "text", text: `Security profile ${args!.id} updated successfully` }] };
      case "delete_security_profile":
        validateOrThrow(args, ServerManagementRules.deleteSecurityProfile());
        await bconnect.servermanagement.deleteSecurityProfile(args!.id as string);
        return { content: [{ type: "text", text: `Security profile ${args!.id} deleted successfully` }] };
      case "update_object_permission":
        validateOrThrow(args, ServerManagementRules.updateObjectPermission());
        await bconnect.servermanagement.updateObjectPermission(args!.id as string, args as any);
        return { content: [{ type: "text", text: `Object permission ${args!.id} updated successfully` }] };

      // Documentation Search handlers
      case "search_documentation":
        validateOrThrow(args, DocumentationSearchRules.searchDocumentation());
        const docSearchResults = await docSearch.search(args!.query as string, {
          source: args!.source as any,
          type: args!.type as string | undefined,
          category: args!.category as string | undefined,
          limit: args!.limit as number | undefined
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              results: docSearchResults.results,
              coverage: docSearchResults.coverage,
              totalResults: docSearchResults.results.length,
              query: args!.query
            }, null, 2)
          }]
        };

      case "get_documentation_item":
        validateOrThrow(args, DocumentationSearchRules.getDocumentationItem());
        const doc = await docSearch.getDocument(args!.id as string);
        if (!doc) {
          throw new McpError(ErrorCode.InvalidParams, `Document not found: ${args!.id}`);
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              id: doc.id,
              title: doc.title,
              source: doc.source,
              type: doc.type,
              category: doc.category,
              url: doc.url,
              author: doc.author,
              date: doc.date,
              metadata: doc.metadata,
              content: doc.content
            }, null, 2)
          }]
        };

      case "list_documentation_sources":
        validateOrThrow(args, DocumentationSearchRules.listDocumentationSources());
        const sources = await docSearch.listSources();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              totalDocuments: sources.total,
              forum: {
                threads: sources.forum.indexed,
                categories: sources.forum.categories
              },
              feedback: {
                total: sources.feedback.indexed,
                faq: sources.feedback.types.faq,
                kb: sources.feedback.types.kb,
                ideas: sources.feedback.types.ideas
              },
              releaseNotes: {
                versions: sources.releaseNotes.indexed,
                available: sources.releaseNotes.versions
              }
            }, null, 2)
          }]
        };

      case "get_popular_topics":
        validateOrThrow(args, DocumentationSearchRules.getPopularTopics());
        const topics = await docSearch.getPopularTopics({
          source: args?.source as any,
          limit: args?.limit as number | undefined
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              topics,
              totalTopics: topics.length
            }, null, 2)
          }]
        };

      // Known Issues Search handlers
      case "search_known_issues":
        validateOrThrow(args, DocumentationSearchRules.searchKnownIssues());
        const knownIssuesResults = knownIssuesSearch.search(args!.query as string, {
          version: args!.version as string | undefined,
          language: args!.language as string | undefined,
          limit: args!.limit as number | undefined
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              results: knownIssuesResults.map(r => ({
                issue: {
                  version: r.issue.version,
                  language: r.issue.language,
                  category: r.issue.category,
                  description: r.issue.description,
                  originalReferences: r.issue.originalReferences,
                  relatedForumThreads: r.issue.relatedForumThreads.map(t => ({
                    title: t.title,
                    category: t.category,
                    url: t.url,
                    relevanceScore: t.score.toFixed(2)
                  }))
                },
                relevance: r.score
              })),
              totalResults: knownIssuesResults.length,
              query: args!.query
            }, null, 2)
          }]
        };

      case "get_known_issues_summary":
        validateOrThrow(args, DocumentationSearchRules.getKnownIssuesSummary());
        const summary = knownIssuesSearch.getSummary();
        return {
          content: [{
            type: "text",
            text: JSON.stringify(summary, null, 2)
          }]
        };

      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
    }
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to execute tool: ${errorMessage}`
    );
  }
});

/**
 * Start the MCP server
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("bConnect MCP Server running on stdio");
  console.error(`Connected to: ${baseUrl}`);
  console.error("Active modules: Endpoints, Jobs, Assets, Active Directory, Software, Update Management, Defense Control, Variables, Operating Systems, Server Management");
}

main().catch((error) => {
  console.error("Fatal error starting server:", error);
  process.exit(1);
});
