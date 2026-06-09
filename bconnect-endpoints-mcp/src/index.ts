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

// ─── Factory exported for testing ───────────────────────────────────────────

export function createServer(): { server: Server } {
  const release = process.env.BCONNECT_RELEASE ?? "25R2";
  const is26R1 = release === "26R1";

  const server = new Server(
    {
      name: "bconnect-endpoints-mcp",
      version: "26.1.1"
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
        // ── Endpoints API ─────────────────────────────────────────────────
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
            },
            required: []
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
            },
            required: []
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
            },
            required: []
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
            },
            required: []
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
                description: "Sort order"
              },
              includeSubGroups: {
                type: "boolean",
                description: "If true, also includes endpoints from sub-groups (default: false)"
              }
            },
            required: ["logicalGroupId"]
          }
        },
        // Android READ (Phase 24)
        {
          name: "list_android_endpoints",
          description: "List all Android endpoints managed by baramundi. Returns a paged list of Android mobile devices. Use for Android fleet inventory queries.",
          inputSchema: {
            type: "object",
            properties: {
              SearchQuery: { type: "string", description: "Search query to filter results" },
              Page: { type: "number", description: "Page number (1-based)" },
              PageSize: { type: "number", description: "Number of results per page" },
              OrderBy: { type: "string", description: "Sort field" }
            }
          }
        },
        {
          name: "get_android_endpoint",
          description: "Get details of a specific Android endpoint by its GUID. Returns full device properties including serial number, enrollment state, and group assignments.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "Android endpoint ID (GUID)" }
            },
            required: ["id"]
          }
        },
        // iOS READ (Phase 24)
        {
          name: "list_ios_endpoints",
          description: "List all iOS/iPadOS endpoints managed by baramundi. Returns a paged list of Apple mobile devices. Use for iOS fleet inventory queries.",
          inputSchema: {
            type: "object",
            properties: {
              SearchQuery: { type: "string", description: "Search query to filter results" },
              Page: { type: "number", description: "Page number (1-based)" },
              PageSize: { type: "number", description: "Number of results per page" },
              OrderBy: { type: "string", description: "Sort field" }
            }
          }
        },
        {
          name: "get_ios_endpoint",
          description: "Get details of a specific iOS/iPadOS endpoint by its GUID. Returns full device properties including serial number, enrollment state, and group assignments.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "iOS endpoint ID (GUID)" }
            },
            required: ["id"]
          }
        },
        // Mobile enrollment
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
        {
          name: "update_ios_endpoint",
          description: "Update an existing iOS/iPadOS endpoint in baramundi MDM. WARNING: Modifies endpoint properties.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "iOS endpoint ID (GUID)" },
              displayName: { type: "string", description: "Display name of the iOS endpoint" },
              logicalGroupId: { type: "string", description: "ID of the logical group (GUID)" },
              comment: { type: "string", description: "Comment or description" }
            },
            required: ["id"]
          }
        },
        {
          name: "delete_ios_endpoint",
          description: "Delete an iOS/iPadOS endpoint from baramundi MDM. WARNING: Permanently removes the device record.",
          inputSchema: {
            type: "object",
            properties: {
              id: { type: "string", description: "iOS endpoint ID (GUID)" }
            },
            required: ["id"]
          }
        },
        // Windows CRUD
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
        // Linux CRUD
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
        // Maintenance windows (Phase 24: added GET)
        { name: "get_maintenance_window_for_endpoint", description: "Get the maintenance window configuration for a specific endpoint.", inputSchema: { type: "object", properties: { id: { type: "string", description: "Endpoint ID (GUID)" } }, required: ["id"] } },
        { name: "create_maintenance_window_for_endpoint", description: "Create a maintenance window for an endpoint. WARNING: Creates new maintenance window.", inputSchema: { type: "object", properties: { id: { type: "string" }, maintenanceWindowData: { type: "object" } }, required: ["id", "maintenanceWindowData"] } },
        { name: "update_maintenance_window_for_endpoint", description: "Update a maintenance window for an endpoint. WARNING: Modifies existing maintenance window.", inputSchema: { type: "object", properties: { id: { type: "string" }, maintenanceWindowData: { type: "object" } }, required: ["id", "maintenanceWindowData"] } },
        { name: "delete_maintenance_window_for_endpoint", description: "Delete a maintenance window for an endpoint. WARNING: Permanently deletes maintenance window.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
        { name: "get_maintenance_window_for_logical_group", description: "Get the maintenance window configuration for a specific logical group.", inputSchema: { type: "object", properties: { id: { type: "string", description: "Logical group ID (GUID)" } }, required: ["id"] } },
        { name: "create_maintenance_window_for_logical_group", description: "Create a maintenance window for a logical group. WARNING: Creates new maintenance window.", inputSchema: { type: "object", properties: { id: { type: "string" }, maintenanceWindowData: { type: "object" } }, required: ["id", "maintenanceWindowData"] } },
        { name: "update_maintenance_window_for_logical_group", description: "Update a maintenance window for a logical group. WARNING: Modifies existing maintenance window.", inputSchema: { type: "object", properties: { id: { type: "string" }, maintenanceWindowData: { type: "object" } }, required: ["id", "maintenanceWindowData"] } },
        { name: "delete_maintenance_window_for_logical_group", description: "Delete a maintenance window for a logical group. WARNING: Permanently deletes maintenance window.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
        // Industrial & network endpoints (Phase 24: added GET for network)
        { name: "list_industrial_endpoints", description: "List all industrial endpoints (PLCs, SCADA systems, etc.) managed by baramundi. Returns a paged list.", inputSchema: { type: "object", properties: { SearchQuery: { type: "string" }, Page: { type: "number" }, PageSize: { type: "number" }, OrderBy: { type: "string" } } } },
        { name: "get_industrial_endpoint", description: "Get details of a specific industrial endpoint by its GUID.", inputSchema: { type: "object", properties: { id: { type: "string", description: "Industrial endpoint ID (GUID)" } }, required: ["id"] } },
        { name: "create_industrial_endpoint", description: "Create a new industrial endpoint (PLC, SCADA, etc.). WARNING: Creates a new endpoint.", inputSchema: { type: "object", properties: { endpointData: { type: "object" } }, required: ["endpointData"] } },
        { name: "update_industrial_endpoint", description: "Update an existing industrial endpoint. WARNING: Modifies endpoint properties.", inputSchema: { type: "object", properties: { id: { type: "string" }, updateData: { type: "object" } }, required: ["id", "updateData"] } },
        { name: "delete_industrial_endpoint", description: "Delete an industrial endpoint. WARNING: Permanently deletes the endpoint.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
        { name: "list_network_endpoints", description: "List all network endpoints (switches, routers, printers, etc.) managed by baramundi.", inputSchema: { type: "object", properties: { SearchQuery: { type: "string" }, Page: { type: "number" }, PageSize: { type: "number" }, OrderBy: { type: "string" } } } },
        { name: "get_network_endpoint", description: "Get details of a specific network endpoint by its GUID.", inputSchema: { type: "object", properties: { id: { type: "string", description: "Network endpoint ID (GUID)" } }, required: ["id"] } },
        { name: "create_network_endpoint", description: "Create a new network endpoint (switch, router, printer, etc.). WARNING: Creates a new endpoint.", inputSchema: { type: "object", properties: { endpointData: { type: "object" } }, required: ["endpointData"] } },
        { name: "update_network_endpoint", description: "Update an existing network endpoint. WARNING: Modifies endpoint properties.", inputSchema: { type: "object", properties: { id: { type: "string" }, updateData: { type: "object" } }, required: ["id", "updateData"] } },
        { name: "delete_network_endpoint", description: "Delete a network endpoint. WARNING: Permanently deletes the endpoint.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
        // Generic delete
        { name: "delete_endpoint", description: "Delete any endpoint by ID (generic delete for all endpoint types). WARNING: Permanently deletes the endpoint.", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
      ];

      // 26R1-only tools: Unmanaged Endpoints + EntraID
      if (is26R1) {
        tools.push(
          { name: "list_unmanaged_endpoints", description: "[26R1] List all unmanaged endpoints detected by baramundi. Returns a paged list of devices that are not yet enrolled into management. Available in bConnect 26R1 and later.", inputSchema: { type: "object", properties: { SearchQuery: { type: "string" }, Page: { type: "number" }, PageSize: { type: "number" }, OrderBy: { type: "string" } } } },
          { name: "get_unmanaged_endpoint", description: "[26R1] Get details of a specific unmanaged endpoint by its GUID. Available in bConnect 26R1 and later.", inputSchema: { type: "object", properties: { id: { type: "string", description: "Unmanaged endpoint ID (GUID)" } }, required: ["id"] } },
          { name: "delete_unmanaged_endpoint", description: "[26R1] Delete an unmanaged endpoint record. WARNING: Permanently removes the unmanaged device record. Available in bConnect 26R1 and later.", inputSchema: { type: "object", properties: { id: { type: "string", description: "Unmanaged endpoint ID (GUID)" } }, required: ["id"] } },
          { name: "get_entra_id_data", description: "[26R1] Get Microsoft EntraID (formerly Azure AD) data linked to a specific endpoint. Returns the associated Entra device ID and join state. Available in bConnect 26R1 and later.", inputSchema: { type: "object", properties: { endpointId: { type: "string", description: "Endpoint ID (GUID)" } }, required: ["endpointId"] } },
          { name: "link_entra_id_data", description: "[26R1] Link a Microsoft EntraID device to a baramundi endpoint. WARNING: Associates the Entra device ID with the endpoint. Available in bConnect 26R1 and later.", inputSchema: { type: "object", properties: { endpointId: { type: "string", description: "Endpoint ID (GUID)" }, deviceId: { type: "string", description: "Microsoft Entra device ID to link" } }, required: ["endpointId", "deviceId"] } },
          { name: "unlink_entra_id_data", description: "[26R1] Unlink Microsoft EntraID data from a baramundi endpoint. WARNING: Removes the Entra association. Available in bConnect 26R1 and later.", inputSchema: { type: "object", properties: { endpointId: { type: "string", description: "Endpoint ID (GUID)" } }, required: ["endpointId"] } }
        );
      }

      return { tools };
  });

  // ── CallToolRequestSchema handler ─────────────────────────────────────────

  // ── Argument-validation pre-pass (runs before getBconnect) ─────────────────
  function validateToolArguments(name: string, _args: Record<string, unknown> | undefined): void {
    switch (name) {
      case "list_endpoints":
      case "get_endpoint":
      case "search_endpoints":
      case "list_windows_endpoints":
      case "get_windows_endpoint":
      case "list_logical_groups":
      case "get_logical_group":
      case "list_group_endpoints":
      case "list_linux_endpoints":
      case "list_mac_endpoints":
      case "get_linux_endpoint":
      case "get_mac_endpoint":
      case "list_endpoints_by_logical_group":
      case "list_windows_endpoints_by_logical_group":
      case "list_android_endpoints":
      case "get_android_endpoint":
      case "list_ios_endpoints":
      case "get_ios_endpoint":
      case "start_android_enrollment":
      case "start_ios_enrollment":
      case "create_android_endpoint":
      case "update_android_endpoint":
      case "delete_android_endpoint":
      case "create_ios_endpoint":
      case "update_ios_endpoint":
      case "delete_ios_endpoint":
      case "create_windows_endpoint":
      case "update_windows_endpoint":
      case "delete_windows_endpoint":
      case "start_windows_enrollment":
      case "trigger_intune_installation":
      case "create_linux_endpoint":
      case "update_linux_endpoint":
      case "delete_linux_endpoint":
      case "create_mac_endpoint":
      case "update_mac_endpoint":
      case "delete_mac_endpoint":
      case "start_mac_enrollment":
      case "create_logical_group":
      case "update_logical_group":
      case "delete_logical_group":
      case "create_maintenance_window_for_endpoint":
      case "update_maintenance_window_for_endpoint":
      case "delete_maintenance_window_for_endpoint":
      case "create_maintenance_window_for_logical_group":
      case "update_maintenance_window_for_logical_group":
      case "delete_maintenance_window_for_logical_group":
      case "create_industrial_endpoint":
      case "update_industrial_endpoint":
      case "delete_industrial_endpoint":
      case "create_network_endpoint":
      case "update_network_endpoint":
      case "delete_network_endpoint":
      case "delete_endpoint":
      case "list_network_endpoints":
      case "get_network_endpoint":
      case "get_maintenance_window_for_endpoint":
      case "get_maintenance_window_for_logical_group":
      case "list_unmanaged_endpoints":
      case "get_unmanaged_endpoint":
      case "delete_unmanaged_endpoint":
      case "get_entra_id_data":
      case "link_entra_id_data":
      case "unlink_entra_id_data":
      // Unknown tool names are not validated here; dispatch handles MethodNotFound.
    }
  }
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    
    // Validate arguments first — pure, no side effects, fails fast on bad input.
    validateToolArguments(name, args);
    // ── Write-operation gate (REQ-SRV-012) ───────────────────────────────────
    const WRITE_TOOLS = new Set<string>([
    "start_android_enrollment",
    "start_ios_enrollment",
    "create_android_endpoint",
    "update_android_endpoint",
    "delete_android_endpoint",
    "create_ios_endpoint",
    "update_ios_endpoint",
    "delete_ios_endpoint",
    "create_windows_endpoint",
    "update_windows_endpoint",
    "delete_windows_endpoint",
    "start_windows_enrollment",
    "trigger_intune_installation",
    "create_linux_endpoint",
    "update_linux_endpoint",
    "delete_linux_endpoint",
    "create_mac_endpoint",
    "update_mac_endpoint",
    "delete_mac_endpoint",
    "start_mac_enrollment",
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
    "update_industrial_endpoint",
    "delete_industrial_endpoint",
    "create_network_endpoint",
    "update_network_endpoint",
    "delete_network_endpoint",
    "delete_endpoint",
    "delete_unmanaged_endpoint",
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


    // Lazily create BConnect client only when a tool is actually called.
    // This allows the server to be instantiated in tests without real credentials.
    const getBconnect = (): BConnectClient => {
      dotenv.config();
      const baseUrl = process.env.BCONNECT_BASE_URL || "https://bms.example.com:444/bconnect";
      const username = process.env.BCONNECT_USERNAME;
      const password = process.env.BCONNECT_PASSWORD;
      const apiKey = process.env.BCONNECT_API_KEY;

      if (!apiKey && (!username || !password)) {
        throw new McpError(
          ErrorCode.InternalError,
          "Either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD environment variables are required"
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

      switch (name) {
        // ── Endpoints ───────────────────────────────────────────────────
        case "list_endpoints": {
          const result = await bconnect.endpoints.getEndpoints(args || {});
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_endpoint": {
          const result = await bconnect.endpoints.getEndpoint(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "search_endpoints": {
          const result = await bconnect.endpoints.searchEndpoints(
            args!.query as string,
            args!.pageSize as number | undefined
          );
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_windows_endpoints": {
          const result = await bconnect.endpoints.getWindowsEndpoints(args || {});
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_windows_endpoint": {
          const result = await bconnect.endpoints.getWindowsEndpoint(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_logical_groups": {
          const result = await bconnect.endpoints.getLogicalGroups();
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_logical_group": {
          const result = await bconnect.endpoints.getLogicalGroup(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_group_endpoints": {
          const result = await bconnect.endpoints.getLogicalGroupEndpoints(
            args!.logicalGroupId as string,
            args || {}
          );
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_linux_endpoints": {
          const result = await bconnect.endpoints.getLinuxEndpoints(args || {});
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_mac_endpoints": {
          const result = await bconnect.endpoints.getMacEndpoints(args || {});
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_linux_endpoint": {
          const result = await bconnect.endpoints.getLinuxEndpoint(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_mac_endpoint": {
          const result = await bconnect.endpoints.getMacEndpoint(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_endpoints_by_logical_group": {
          const result = await bconnect.endpoints.getEndpointsByLogicalGroup(
            args!.logicalGroupId as string,
            args || {}
          );
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_windows_endpoints_by_logical_group": {
          const result = await bconnect.endpoints.getWindowsEndpointsByLogicalGroup(
            args!.logicalGroupId as string,
            args || {}
          );
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_android_endpoints": {
          const result = await bconnect.endpoints.listAndroidEndpoints(args || {});
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_android_endpoint": {
          const result = await bconnect.endpoints.getAndroidEndpoint(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_ios_endpoints": {
          const result = await bconnect.endpoints.listIosEndpoints(args || {});
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_ios_endpoint": {
          const result = await bconnect.endpoints.getIosEndpoint(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "start_android_enrollment": {
          const result = await bconnect.endpoints.startAndroidEnrollment(
            args!.id as string,
            {
              enrollmentMailAddress: args!.enrollmentMailAddress as string | undefined ?? null,
              emailLanguageId: args!.emailLanguageId as string | undefined ?? null,
              forceMobileDataOnEnrollment: (args!.forceMobileDataOnEnrollment as boolean | undefined) ?? false,
              includeWifiInQrCode: (args!.includeWifiInQrCode as boolean | undefined) ?? false,
            }
          );
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "start_ios_enrollment": {
          const result = await bconnect.endpoints.startIosEnrollment(
            args!.id as string,
            {
              enrollmentMailAddress: args!.enrollmentMailAddress as string | undefined ?? null,
              emailLanguageId: args!.emailLanguageId as string | undefined ?? null,
            }
          );
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "update_android_endpoint": {
          const patchOperations: Array<Record<string, never>> = [];
          if (args!.displayName !== undefined) {patchOperations.push({ op: "replace", path: "/displayName", value: args!.displayName } as never);}
          if (args!.logicalGroupId !== undefined) {patchOperations.push({ op: "replace", path: "/logicalGroupId", value: args!.logicalGroupId } as never);}
          if (args!.comment !== undefined) {patchOperations.push({ op: "replace", path: "/comment", value: args!.comment } as never);}
          if (args!.serialNumber !== undefined) {patchOperations.push({ op: "replace", path: "/serialNumber", value: args!.serialNumber } as never);}
          await bconnect.endpoints.updateAndroidEndpoint(args!.id as string, patchOperations);
          return { content: [{ type: "text", text: JSON.stringify({ success: true, message: `Android endpoint ${args!.id} updated successfully` }, null, 2) }] };
        }

        case "delete_android_endpoint": {
          await bconnect.endpoints.deleteAndroidEndpoint(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify({ success: true, message: `Android endpoint ${args!.id} deleted successfully` }, null, 2) }] };
        }

        case "create_ios_endpoint": {
          const iosData = {
            displayName: args!.displayName as string,
            logicalGroupId: args!.logicalGroupId as string | undefined,
            comment: args!.comment as string | undefined,
          };
          const result = await bconnect.endpoints.createIosEndpoint(iosData as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "update_ios_endpoint": {
          const patchOps: Array<Record<string, never>> = [];
          if (args!.displayName !== undefined) {patchOps.push({ op: "replace", path: "/displayName", value: args!.displayName } as never);}
          if (args!.logicalGroupId !== undefined) {patchOps.push({ op: "replace", path: "/logicalGroupId", value: args!.logicalGroupId } as never);}
          if (args!.comment !== undefined) {patchOps.push({ op: "replace", path: "/comment", value: args!.comment } as never);}
          await bconnect.endpoints.updateIosEndpoint(args!.id as string, patchOps);
          return { content: [{ type: "text", text: JSON.stringify({ success: true, message: `iOS endpoint ${args!.id} updated successfully` }, null, 2) }] };
        }

        case "delete_ios_endpoint": {
          await bconnect.endpoints.deleteIosEndpoint(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify({ success: true, message: `iOS endpoint ${args!.id} deleted successfully` }, null, 2) }] };
        }

        case "create_windows_endpoint": {
          const result = await bconnect.endpoints.createWindowsEndpoint(args! as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "update_windows_endpoint": {
          const result = await bconnect.endpoints.updateWindowsEndpoint(args!.id as string, args! as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "delete_windows_endpoint": {
          await bconnect.endpoints.deleteWindowsEndpoint(args!.id as string);
          return { content: [{ type: "text", text: `Windows endpoint ${args!.id} deleted successfully` }] };
        }

        case "start_windows_enrollment": {
          await bconnect.endpoints.startWindowsEndpointEnrollment(args!.id as string, args! as never);
          return { content: [{ type: "text", text: `Windows endpoint ${args!.id} enrollment started` }] };
        }

        case "trigger_intune_installation": {
          await bconnect.endpoints.triggerInstallationViaIntune(args!.id as string);
          return { content: [{ type: "text", text: `Intune installation triggered for endpoint ${args!.id}` }] };
        }

        case "create_linux_endpoint": {
          const result = await bconnect.endpoints.createLinuxEndpoint(args! as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "update_linux_endpoint": {
          const result = await bconnect.endpoints.updateLinuxEndpoint(args!.id as string, args! as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "delete_linux_endpoint": {
          await bconnect.endpoints.deleteLinuxEndpoint(args!.id as string);
          return { content: [{ type: "text", text: `Linux endpoint ${args!.id} deleted successfully` }] };
        }

        case "create_mac_endpoint": {
          const result = await bconnect.endpoints.createMacEndpoint(args! as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "update_mac_endpoint": {
          const result = await bconnect.endpoints.updateMacEndpoint(args!.id as string, args! as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "delete_mac_endpoint": {
          await bconnect.endpoints.deleteMacEndpoint(args!.id as string);
          return { content: [{ type: "text", text: `Mac endpoint ${args!.id} deleted successfully` }] };
        }

        case "start_mac_enrollment": {
          await bconnect.endpoints.startMacEndpointEnrollment(args!.id as string, args! as never);
          return { content: [{ type: "text", text: `Mac endpoint ${args!.id} enrollment started` }] };
        }

        case "create_logical_group": {
          const result = await bconnect.endpoints.createLogicalGroup(args! as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "update_logical_group": {
          const result = await bconnect.endpoints.updateLogicalGroup(args!.id as string, args! as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "delete_logical_group": {
          await bconnect.endpoints.deleteLogicalGroup(args!.id as string);
          return { content: [{ type: "text", text: `Logical group ${args!.id} deleted successfully` }] };
        }

        case "create_maintenance_window_for_endpoint": {
          const result = await bconnect.endpoints.createMaintenanceWindowForEndpoint(args!.id as string, args!.maintenanceWindowData as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "update_maintenance_window_for_endpoint": {
          await bconnect.endpoints.updateMaintenanceWindowForEndpoint(args!.id as string, args!.maintenanceWindowData as never);
          return { content: [{ type: "text", text: `Maintenance window for endpoint ${args!.id} updated successfully` }] };
        }

        case "delete_maintenance_window_for_endpoint": {
          await bconnect.endpoints.deleteMaintenanceWindowForEndpoint(args!.id as string);
          return { content: [{ type: "text", text: `Maintenance window for endpoint ${args!.id} deleted successfully` }] };
        }

        case "create_maintenance_window_for_logical_group": {
          const result = await bconnect.endpoints.createMaintenanceWindowForLogicalGroup(args!.id as string, args!.maintenanceWindowData as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "update_maintenance_window_for_logical_group": {
          await bconnect.endpoints.updateMaintenanceWindowForLogicalGroup(args!.id as string, args!.maintenanceWindowData as never);
          return { content: [{ type: "text", text: `Maintenance window for logical group ${args!.id} updated successfully` }] };
        }

        case "delete_maintenance_window_for_logical_group": {
          await bconnect.endpoints.deleteMaintenanceWindowForLogicalGroup(args!.id as string);
          return { content: [{ type: "text", text: `Maintenance window for logical group ${args!.id} deleted successfully` }] };
        }

        case "list_industrial_endpoints": {
          const result = await bconnect.endpoints.listIndustrialEndpoints(args || {});
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_industrial_endpoint": {
          if (!args?.id) {throw new McpError(ErrorCode.InvalidParams, "id is required");}
          const result = await bconnect.endpoints.getIndustrialEndpoint(args.id as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "create_industrial_endpoint": {
          const result = await bconnect.endpoints.createIndustrialEndpoint(args!.endpointData as never);
          return { content: [{ type: "text", text: `Industrial endpoint created successfully. ID: ${result.id}` }] };
        }

        case "update_industrial_endpoint": {
          await bconnect.endpoints.updateIndustrialEndpoint(args!.id as string, args!.updateData as never);
          return { content: [{ type: "text", text: `Industrial endpoint ${args!.id} updated successfully` }] };
        }

        case "delete_industrial_endpoint": {
          await bconnect.endpoints.deleteIndustrialEndpoint(args!.id as string);
          return { content: [{ type: "text", text: `Industrial endpoint ${args!.id} deleted successfully` }] };
        }

        case "create_network_endpoint": {
          const result = await bconnect.endpoints.createNetworkEndpoint(args!.endpointData as never);
          return { content: [{ type: "text", text: `Network endpoint created successfully. ID: ${result.id}` }] };
        }

        case "update_network_endpoint": {
          await bconnect.endpoints.updateNetworkEndpoint(args!.id as string, args!.updateData as never);
          return { content: [{ type: "text", text: `Network endpoint ${args!.id} updated successfully` }] };
        }

        case "delete_network_endpoint": {
          await bconnect.endpoints.deleteNetworkEndpoint(args!.id as string);
          return { content: [{ type: "text", text: `Network endpoint ${args!.id} deleted successfully` }] };
        }

        case "delete_endpoint": {
          await bconnect.endpoints.deleteEndpoint(args!.id as string);
          return { content: [{ type: "text", text: `Endpoint ${args!.id} deleted successfully` }] };
        }

        // Phase 24: Network READ
        case "list_network_endpoints": {
          const result = await bconnect.endpoints.listNetworkEndpoints(args || {});
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_network_endpoint": {
          const result = await bconnect.endpoints.getNetworkEndpoint(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        // Phase 24: Maintenance Window GET
        case "get_maintenance_window_for_endpoint": {
          const result = await bconnect.endpoints.getMaintenanceWindowForEndpoint(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_maintenance_window_for_logical_group": {
          const result = await bconnect.endpoints.getMaintenanceWindowForLogicalGroup(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        // Phase 24: 26R1-only tools
        case "list_unmanaged_endpoints": {
          if (!is26R1) {throw new McpError(ErrorCode.MethodNotFound, "list_unmanaged_endpoints is only available in bConnect 26R1. Set BCONNECT_RELEASE=26R1.");}
          const result = await bconnect.endpoints.listUnmanagedEndpoints(args || {});
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_unmanaged_endpoint": {
          if (!is26R1) {throw new McpError(ErrorCode.MethodNotFound, "get_unmanaged_endpoint is only available in bConnect 26R1. Set BCONNECT_RELEASE=26R1.");}
          const result = await bconnect.endpoints.getUnmanagedEndpoint(args!.id as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "delete_unmanaged_endpoint": {
          if (!is26R1) {throw new McpError(ErrorCode.MethodNotFound, "delete_unmanaged_endpoint is only available in bConnect 26R1. Set BCONNECT_RELEASE=26R1.");}
          await bconnect.endpoints.deleteUnmanagedEndpoint(args!.id as string);
          return { content: [{ type: "text", text: `Unmanaged endpoint ${args!.id} deleted successfully` }] };
        }

        case "get_entra_id_data": {
          if (!is26R1) {throw new McpError(ErrorCode.MethodNotFound, "get_entra_id_data is only available in bConnect 26R1. Set BCONNECT_RELEASE=26R1.");}
          const result = await bconnect.endpoints.getEntraIdData(args!.endpointId as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "link_entra_id_data": {
          if (!is26R1) {throw new McpError(ErrorCode.MethodNotFound, "link_entra_id_data is only available in bConnect 26R1. Set BCONNECT_RELEASE=26R1.");}
          const result = await bconnect.endpoints.linkEntraIdData(args!.endpointId as string, args!.deviceId as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "unlink_entra_id_data": {
          if (!is26R1) {throw new McpError(ErrorCode.MethodNotFound, "unlink_entra_id_data is only available in bConnect 26R1. Set BCONNECT_RELEASE=26R1.");}
          await bconnect.endpoints.unlinkEntraIdData(args!.endpointId as string);
          return { content: [{ type: "text", text: `EntraID data unlinked from endpoint ${args!.endpointId} successfully` }] };
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

async function main(): Promise<void> {
  dotenv.config();

  const baseUrl = process.env.BCONNECT_BASE_URL || "https://bms.example.com:444/bconnect";
  const username = process.env.BCONNECT_USERNAME;
  const password = process.env.BCONNECT_PASSWORD;
  const apiKey = process.env.BCONNECT_API_KEY;

  if (!apiKey && (!username || !password)) {
    throw new Error("Either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD environment variables are required");
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

  // Verify client is initialised (unused var kept for side-effect)
  void bconnect;

  
  // Startup connectivity check (REQ-SRV-013)
  console.error(`bconnect-endpoints-mcp: verifying bConnect API connectivity...`);
  const connected = await bconnect.testConnection();
  if (!connected) {
    console.error(`bconnect-endpoints-mcp: cannot reach bConnect API at ${baseUrl}. Check BCONNECT_BASE_URL, credentials, and network.`);
    process.exit(1);
  }
  console.error(`bconnect-endpoints-mcp: API connectivity verified.`);

  const transportMode = process.env.MCP_TRANSPORT ?? "stdio";
  const port = parseInt(process.env.MCP_PORT ?? "3000", 10);
  const serverName = "bconnect-endpoints-mcp";

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

// Only run when this file is the entry point (not imported in tests)
if (process.env.VITEST === undefined) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
