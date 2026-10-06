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
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import { BConnectClient } from "./bconnect-client.js";
import { validateOrThrow, toolErrorResult, lazyClient, declaredArgumentsOnly, pickArguments, queryParameters, withQueryProperties, serverClients, runServer } from "@bconnect/mcp-core";
import { QUERY_PARAMETERS } from "./query-params.js";

/** The query parameters a list tool sends: exactly what its route declares in the selected release (#179). */
const sends = (tool: string): string[] => queryParameters(QUERY_PARAMETERS, process.env.BCONNECT_RELEASE, tool);
import type { BConnectCredentials } from "@bconnect/mcp-core";
import { ComplianceRules } from "./utils/mcp-tool-validation-rules.js";

// ─── Factory exported for testing ───────────────────────────────────────────

export type { BConnectCredentials } from "@bconnect/mcp-core";

/** The server's bConnect clients: one shared by every tool call (REQ-SRV-023). */
const clients = serverClients(BConnectClient);

export function createServer(credentials?: BConnectCredentials): { server: Server } {
  const server = new Server(
    {
      name: "bconnect-compliance-mcp",
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

        // ── Rule Violations ───────────────────────────────────────────────
        {
          name: "list_detected_rule_violations",
          description: "List all detected compliance rule violations for Android, iOS, and macOS endpoints managed in baramundi Management Suite. Returns a paged list of rule violations with endpoint names, rule names, violation states, and detection timestamps.",
          inputSchema: {
            type: "object",
            properties: {},
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
            properties: {},
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
            properties: {},
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
            properties: {},
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
  }));
  server.setRequestHandler(ListToolsRequestSchema, toolCatalog.list);

  // ── CallToolRequestSchema handler ─────────────────────────────────────────

  // ── Argument-validation pre-pass (runs before getBconnect) ─────────────────
  function validateToolArguments(name: string, args: Record<string, unknown> | undefined): void {
    switch (name) {
      case "list_detected_rule_violations":
        validateOrThrow(args, ComplianceRules.listDetectedRuleViolations());
        return;
      case "list_detected_rule_violations_for_endpoint":
        validateOrThrow(args, ComplianceRules.listDetectedRuleViolationsForEndpoint());
        return;
      case "list_detected_vulnerabilities":
        validateOrThrow(args, ComplianceRules.listDetectedVulnerabilities());
        return;
      case "list_detected_vulnerabilities_for_endpoint":
        validateOrThrow(args, ComplianceRules.listDetectedVulnerabilitiesForEndpoint());
        return;
      case "list_mobile_device_rules":
        validateOrThrow(args, ComplianceRules.listMobileDeviceRules());
        return;
      case "get_mobile_device_rule":
        validateOrThrow(args, ComplianceRules.getMobileDeviceRule());
        return;
      case "list_vulnerabilities":
        validateOrThrow(args, ComplianceRules.listVulnerabilities());
        return;
      case "get_vulnerability":
        validateOrThrow(args, ComplianceRules.getVulnerability());
        return;
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
      // The server's shared client (REQ-SRV-023). A ClientConfigError (e.g. missing
      // credentials) reaches the catch below and becomes a tool result (REQ-XC-001).
      return clients.get(credentials);
    };

    try {
      const bconnect = lazyClient(getBconnect);
      const compliance = lazyClient(() => bconnect.compliance);

      // Dispatch — arguments already validated by validateToolArguments above.
      switch (name) {

        // ── Rule Violations ─────────────────────────────────────────────
        case "list_detected_rule_violations": {
          const result = await compliance.getDetectedRuleViolations(pickArguments(args ?? {}, sends("list_detected_rule_violations")));
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_detected_rule_violations_for_endpoint": {
          const { endpointId, ...params } = args as Record<string, unknown>;
          const result = await compliance.getDetectedRuleViolationsForEndpoint(endpointId as string, pickArguments(params, sends("list_detected_rule_violations_for_endpoint")));
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        // ── Detected Vulnerabilities ────────────────────────────────────
        case "list_detected_vulnerabilities": {
          const result = await compliance.getAllDetectedVulnerabilities(pickArguments(args ?? {}, sends("list_detected_vulnerabilities")));
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "list_detected_vulnerabilities_for_endpoint": {
          const { endpointId, ...params } = args as Record<string, unknown>;
          const result = await compliance.getDetectedVulnerabilitiesByEndpoint(endpointId as string, pickArguments(params, sends("list_detected_vulnerabilities_for_endpoint")));
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        // ── Mobile Device Rules ─────────────────────────────────────────
        case "list_mobile_device_rules": {
          const result = await compliance.getAllMobileDeviceRules(pickArguments(args ?? {}, sends("list_mobile_device_rules")));
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_mobile_device_rule": {
          const result = await compliance.getMobileDeviceRule(args!.ruleId as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        // ── Vulnerabilities (CVE Library) ───────────────────────────────
        case "list_vulnerabilities": {
          const result = await compliance.getAllVulnerabilities(pickArguments(args ?? {}, sends("list_vulnerabilities")));
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        case "get_vulnerability": {
          const result = await compliance.getVulnerability(args!.vulnerabilityId as string);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error) {
      // API errors, gate refusals and configuration errors are tool results the
      // model can read; only McpErrors stay protocol errors (REQ-XC-001).
      return toolErrorResult(error, process.env.BCONNECT_RELEASE ?? "26R1");
    }
  });

  return { server };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

runServer({ name: "bconnect-compliance-mcp", createServer, clients });
