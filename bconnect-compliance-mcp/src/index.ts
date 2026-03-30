#!/usr/bin/env node

/**
 * bconnect-compliance-mcp
 *
 * A Model Context Protocol server that provides access to the baramundi
 * bConnect REST API for Compliance management — detected rule violations,
 * detected vulnerabilities, mobile device rules, and CVE vulnerability data.
 *
 * Requires bConnect 26R1 or later (compliance API is 26R1-only).
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
      name: "bconnect-compliance-mcp",
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
    return {
      tools: [

        // ── Rule Violations ───────────────────────────────────────────────
        {
          name: "list_detected_rule_violations",
          description: "List all detected compliance rule violations for Android, iOS, and macOS endpoints managed in baramundi Management Suite. Returns a paged list of rule violations with endpoint names, rule names, violation states, and detection timestamps.",
          inputSchema: {
            type: "object",
            properties: {
              OrderBy: { type: "string", description: "Sort results by property name and direction (e.g. 'RuleName asc'). Possible values: EndpointName, RuleName." },
              SearchQuery: { type: "string", description: "Filter results by matching against EndpointName or RuleName." },
              Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
              PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
            },
            required: []
          }
        },
        {
          name: "list_detected_rule_violations_for_endpoint",
          description: "List all detected compliance rule violations for a specific Android, iOS, or macOS endpoint identified by its GUID. Returns a paged list of violations including rule names, violation states, and detection timestamps for the specified endpoint.",
          inputSchema: {
            type: "object",
            properties: {
              endpointId: { type: "string", description: "GUID of the Android, iOS, or macOS endpoint to retrieve rule violations for." },
              OrderBy: { type: "string", description: "Sort results by property name and direction. Possible values: EndpointName, RuleName." },
              SearchQuery: { type: "string", description: "Filter results by matching against EndpointName or RuleName." },
              Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
              PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
            },
            required: ["endpointId"]
          }
        },

        // ── Detected Vulnerabilities ──────────────────────────────────────
        {
          name: "list_detected_vulnerabilities",
          description: "List all detected CVE vulnerabilities across all Windows endpoints managed in baramundi Management Suite. Returns a paged list of detected vulnerabilities including CVE identifiers, endpoint names, detection timestamps, and whether vulnerabilities are ignored.",
          inputSchema: {
            type: "object",
            properties: {
              OrderBy: { type: "string", description: "Sort results by property name and direction. Possible values: EndpointName, CveId." },
              SearchQuery: { type: "string", description: "Filter results by matching against EndpointName or CveId." },
              Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
              PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
            },
            required: []
          }
        },
        {
          name: "list_detected_vulnerabilities_for_endpoint",
          description: "List all detected CVE vulnerabilities for a specific Windows endpoint identified by its GUID. Returns a paged list of vulnerabilities including CVE identifiers, detection timestamps, and ignored status for that specific managed Windows endpoint.",
          inputSchema: {
            type: "object",
            properties: {
              endpointId: { type: "string", description: "GUID of the Windows endpoint to retrieve detected vulnerabilities for." },
              OrderBy: { type: "string", description: "Sort results by property name and direction. Possible value: CveId." },
              SearchQuery: { type: "string", description: "Filter results by matching against CveId." },
              Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
              PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
            },
            required: ["endpointId"]
          }
        },

        // ── Mobile Device Rules ───────────────────────────────────────────
        {
          name: "list_mobile_device_rules",
          description: "List all mobile device compliance rules configured in baramundi Management Suite for Android, iOS, and macOS endpoints. Returns a paged list of rules with names, types, severity levels, and descriptions used to evaluate endpoint compliance status.",
          inputSchema: {
            type: "object",
            properties: {
              OrderBy: { type: "string", description: "Sort results by property name and direction. Possible values: RuleName, Description." },
              SearchQuery: { type: "string", description: "Filter results by matching against RuleName or Description." },
              Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
              PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
            },
            required: []
          }
        },
        {
          name: "get_mobile_device_rule",
          description: "Get the details of a specific mobile device compliance rule by its GUID. Returns the rule name, type, severity level, and description for the specified compliance rule configured in baramundi Management Suite for mobile endpoint compliance evaluation.",
          inputSchema: {
            type: "object",
            properties: {
              ruleId: { type: "string", description: "GUID of the mobile device compliance rule to retrieve." }
            },
            required: ["ruleId"]
          }
        },

        // ── Vulnerabilities (CVE Library) ─────────────────────────────────
        {
          name: "list_vulnerabilities",
          description: "List all CVE vulnerabilities in the baramundi vulnerability library for Windows endpoints. Returns a paged list of vulnerabilities with CVE identifiers, CVSS scores, severity ratings, descriptions, and affected products and operating systems.",
          inputSchema: {
            type: "object",
            properties: {
              OrderBy: { type: "string", description: "Sort results by property name and direction. Possible values: CveId, Severity." },
              SearchQuery: { type: "string", description: "Filter results by matching against searchable vulnerability properties." },
              Page: { type: "number", description: "Zero-indexed page number to return (default: 0)." },
              PageSize: { type: "number", description: "Number of items per page (default: 20, max: 1000)." },
            },
            required: []
          }
        },
        {
          name: "get_vulnerability",
          description: "Get the details of a specific CVE vulnerability from the baramundi vulnerability library by its GUID. Returns the CVE identifier, CVSS score, severity rating, description, and lists of affected products and operating systems.",
          inputSchema: {
            type: "object",
            properties: {
              vulnerabilityId: { type: "string", description: "GUID of the CVE vulnerability to retrieve from the baramundi library." }
            },
            required: ["vulnerabilityId"]
          }
        },

      ]
    };
  });

  // ── CallToolRequestSchema handler ─────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Lazily create BConnect client — allows server instantiation in tests without real credentials.
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
        auditLog: {
          level: auditLevel,
        },
      });
    };

    try {
      const bconnect = getBconnect();
      const compliance = bconnect.compliance;

      switch (name) {

        // ── Rule Violations ─────────────────────────────────────────────
        case "list_detected_rule_violations": {
          const result = await compliance.getDetectedRuleViolations((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_detected_rule_violations_for_endpoint": {
          if (!args?.endpointId || typeof args.endpointId !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "list_detected_rule_violations_for_endpoint requires an endpointId (GUID) string parameter");
          }
          const { endpointId, ...params } = args as Record<string, unknown>;
          const result = await compliance.getDetectedRuleViolationsForEndpoint(endpointId as string, params as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        // ── Detected Vulnerabilities ────────────────────────────────────
        case "list_detected_vulnerabilities": {
          const result = await compliance.getAllDetectedVulnerabilities((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_detected_vulnerabilities_for_endpoint": {
          if (!args?.endpointId || typeof args.endpointId !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "list_detected_vulnerabilities_for_endpoint requires an endpointId (GUID) string parameter");
          }
          const { endpointId, ...params } = args as Record<string, unknown>;
          const result = await compliance.getDetectedVulnerabilitiesByEndpoint(endpointId as string, params as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        // ── Mobile Device Rules ─────────────────────────────────────────
        case "list_mobile_device_rules": {
          const result = await compliance.getAllMobileDeviceRules((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_mobile_device_rule": {
          if (!args?.ruleId || typeof args.ruleId !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "get_mobile_device_rule requires a ruleId (GUID) string parameter");
          }
          const result = await compliance.getMobileDeviceRule(args.ruleId);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        // ── Vulnerabilities (CVE Library) ───────────────────────────────
        case "list_vulnerabilities": {
          const result = await compliance.getAllVulnerabilities((args ?? {}) as never);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_vulnerability": {
          if (!args?.vulnerabilityId || typeof args.vulnerabilityId !== "string") {
            throw new McpError(ErrorCode.InvalidParams, "get_vulnerability requires a vulnerabilityId (GUID) string parameter");
          }
          const result = await compliance.getVulnerability(args.vulnerabilityId);
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

  const { server } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("bconnect-compliance-mcp started");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
