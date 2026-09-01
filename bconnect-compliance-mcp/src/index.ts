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
import { createClientProvider, BareMcpError } from "@bconnect/mcp-core";
// TOK-20 / TOK-25 / TOK-10 / INT-53 — the shared composition layer. See
// packages/mcp-core/src/{tool-catalogue,count-only,schema-fragments,tool-error}.ts.
import {
  defineToolCatalogue,
  handleToolError,
  toolTextResult,
  apiParams,
  isCountOnlyRequest,
  fetchCount,
  createListShaper,
} from "@bconnect/mcp-core";
// LOCAL ADDITION — composite exposure analysis (see modules/exposure.ts).
import { getVulnerabilityExposure } from "./modules/exposure.js";
// LOCAL ADDITION — patch-queue join (see modules/unpatched.ts).
import { getUnpatchedEndpoints } from "./modules/unpatched.js";
import { shapeDetectionsGrouped } from "./modules/detection-grouping.js";
import { serializeToolResult } from "@bconnect/mcp-core";
// OPT-31 — the catalogue and its validation rules, declared once. This import
// replaces both the hand-written TOOLS array and ComplianceRules: the rules are
// now derived from the same operation the schema is, so they cannot disagree.
import { DECLARED } from "./declared-tools.js";

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
      name: "bconnect-compliance-mcp",
      version: "26.1.8"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // ── Tool catalogue (OPT-31) ───────────────────────────────────────────────
  //
  // Declared in src/declared-tools.ts and derived from the 26R1 spec, so the
  // advertised schema and the validation rules come from ONE statement instead
  // of two that had to be kept in step by hand. The two composites pass through
  // composite() by identity. Read that file before changing anything here.
  //
  // This server is read-only: every route it reaches is a GET. The catalogue is
  // still used, for the duplicate-name check and so that a write tool added here
  // later is gated by construction rather than by remembering to add it to a
  // hand-maintained set (the F21 drift class).

  const catalogue = defineToolCatalogue(DECLARED);

  // ── Response shaping for list_vulnerabilities (AUD-optimization-1) ────────
  //
  // This is the whole CVE library — totalItems 37,571 measured live, the
  // largest resource in the API. On a 20-row page, affectedOperatingSystems
  // alone ran 6,751 of 16,039 B (42.1%). Dropped from the compact projection
  // and named in meta.dropped: -41.6% measured. detail:true is exact — same
  // "drop it, name it, detail:true restores it" pattern as the WMI __PATH
  // fold and OPT-3/OPT-4.
  const shapeVulnerabilities = createListShaper({
    alwaysDrop: ["affectedOperatingSystems"],
    fullModeHint: "Pass detail:true for the full record including affectedOperatingSystems, or fields:[...] to choose columns.",
  });


  // ── ListToolsRequestSchema handler ────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: catalogue.listTools() };
  });

  // ── CallToolRequestSchema handler ─────────────────────────────────────────

  // ── Argument validation (OPT-31) ──────────────────────────────────────────
  //
  // This used to be an eight-case switch mapping each tool name to a
  // hand-written ComplianceRules.* rule set. Both sides restated one OpenAPI
  // operation and nothing made them agree. DECLARED.validate() looks the rules
  // up by name from the same declaration the schema came from, so a tool cannot
  // be advertised with one shape and validated against another, and a tool
  // added without rules is impossible rather than merely unlikely.
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
    // (BCONNECT_API_KEY__COMPLIANCE); with no such variable set this
    // changes nothing. See mcp-core/server-scoped-credentials.ts.
    serverName: "bconnect-compliance-mcp",
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

    // Validate arguments first — pure, no side effects, fails fast on bad input.
    DECLARED.validate(name, args);

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

    // Write gate. This server declares no writes, so this never refuses today —
    // it is here so that adding one cannot skip the gate.
    const denied = catalogue.gateWriteTool(name);
    if (denied) {
      return denied;
    }

    try {
      const bconnect = getBconnect();
      const compliance = bconnect.compliance;

      // Dispatch — arguments already validated by validateToolArguments above.
      switch (name) {

        // ── Rule Violations ─────────────────────────────────────────────
        case "list_detected_rule_violations": {
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => compliance.getDetectedRuleViolations(p as never), args);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await compliance.getDetectedRuleViolations(apiParams(args) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_detected_rule_violations_by_endpoint": {
          const { endpointId, ...params } = args as Record<string, unknown>;
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount(
              (p) => compliance.getDetectedRuleViolationsForEndpoint(endpointId as string, p as never),
              params
            );
            return toolTextResult(serializeToolResult(count));
          }
          const result = await compliance.getDetectedRuleViolationsForEndpoint(endpointId as string, apiParams(params) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        // ── Detected Vulnerabilities ────────────────────────────────────
        case "list_detected_vulnerabilities": {
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => compliance.getAllDetectedVulnerabilities(p as never), args);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await compliance.getAllDetectedVulnerabilities(apiParams(args) as never);
          // Grouped by endpoint unless the caller asked for the raw record.
          // See modules/detection-grouping.ts for what was measured and why
          // grouping was chosen over interning the repeated identifiers.
          const grouped = shapeDetectionsGrouped(result as never, args?.detail === true);
          return { content: [{ type: "text", text: serializeToolResult(grouped) }] };
        }

        case "list_detected_vulnerabilities_by_endpoint": {
          const { endpointId, ...params } = args as Record<string, unknown>;
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount(
              (p) => compliance.getDetectedVulnerabilitiesByEndpoint(endpointId as string, p as never),
              params
            );
            return toolTextResult(serializeToolResult(count));
          }
          const result = await compliance.getDetectedVulnerabilitiesByEndpoint(endpointId as string, apiParams(params) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        // ── Mobile Device Rules ─────────────────────────────────────────
        case "list_mobile_device_rules": {
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => compliance.getAllMobileDeviceRules(p as never), args);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await compliance.getAllMobileDeviceRules(apiParams(args) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "get_mobile_device_rule": {
          // `id`, not `ruleId` — the route is /v2.0/Rules/{id}. See declared-tools.ts.
          const result = await compliance.getMobileDeviceRule(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        // ── Vulnerabilities (CVE Library) ───────────────────────────────
        // LOCAL ADDITION — composite exposure analysis.
        case "get_vulnerability_exposure": {
          // The raw axios client is handed through for the scan-age lookup, which
          // has to read /jobs/v2.0 — the compliance module wraps /compliance/v2.0
          // only, and that split is exactly what makes D17 expensive by hand.
          const result = await getVulnerabilityExposure(
            compliance,
            (args ?? {}) as never,
            bconnect.getHttpClient()
          );
          return { content: [{ type: "text" as const, text: serializeToolResult(result) }] };
        }

        // LOCAL ADDITION — patch-queue join.
        case "get_unpatched_endpoints": {
          const result = await getUnpatchedEndpoints(
            compliance,
            bconnect.getHttpClient(),
            (args ?? {}) as never
          );
          return { content: [{ type: "text" as const, text: serializeToolResult(result) }] };
        }

        case "list_vulnerabilities": {
          // The CVE library measured 37,571 items live. `countOnly` is the
          // difference between 122 bytes and a 700 B-per-row page here.
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => compliance.getAllVulnerabilities(p as never), args);
            return toolTextResult(serializeToolResult(count));
          }
          const all = (args ?? {}) as Record<string, unknown>;
          const result = await compliance.getAllVulnerabilities(apiParams(all) as never);
          const shaped = shapeVulnerabilities(result as never, {
            full: all.detail === true,
            fields: all.fields as string[] | undefined,
            args: all,
          });
          return toolTextResult(serializeToolResult(shaped));
        }

        case "get_vulnerability": {
          // `id`, not `vulnerabilityId` — the route is /v2.0/Vulnerabilities/{id}.
          const result = await compliance.getVulnerability(args!.id as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        default:
          throw new BareMcpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error) {
      // INT-53 — one error channel: 400/403/404/429 come back as a readable
      // isError tool result, validation/gate errors stay protocol errors, and
      // 401/5xx/TLS/bugs become protocol InternalError.
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
    name: "bconnect-compliance-mcp",
    createServer,
    http: { express },
  }).catch((error) => {
    console.error(`Fatal error: ${describeConnectionFailure(error)}`);
    process.exit(1);
  });
}
