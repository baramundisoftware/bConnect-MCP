#!/usr/bin/env node

/**
 * bconnect-insights-mcp — the cross-module composites, and the scaffold source.
 *
 * This is a REAL server (five tools, all read-only) that also remains the file
 * new servers are scaffolded from — it mirrors the validation-first dispatch
 * architecture used by the 13 domain servers (see SECURITY.md →
 * "Tool-argument validation"), and the numbered steps below are the recipe.
 *
 * To create a new server from this scaffold:
 *   1. Replace insights with the actual domain name (e.g. assets, jobs).
 *   2. Replace DomainRules with the real per-domain rules name in
 *      `src/utils/mcp-tool-validation-rules.ts`.
 *   3. Add tool definitions to the TOOLS array.
 *   4. Name every mutating tool in `defineToolCatalogue`'s `write` list. It is a
 *      hard error to name one that is not in TOOLS, which is the check that
 *      would have caught finding F21 (a write tool the hand-maintained set
 *      silently failed to cover).
 *   5. Add one validation case per tool to validateToolArguments().
 *   6. Add the matching dispatch case (no inline argument validation —
 *      validateToolArguments has already done it).
 *
 * Three suite-wide behaviours come from @bconnect/mcp-core and should not be
 * reimplemented here:
 *   - TOK-20  write tools are omitted from tools/list unless
 *             ALLOW_WRITE_OPERATIONS=true, and `gateWriteTool` still refuses a
 *             hidden write called by name. Hiding is not disabling.
 *   - TOK-25  `countOnly: true` on a list tool answers "how many?" with the
 *             envelope count instead of a page of rows.
 *   - INT-53  `handleToolError` is the only catch-all: 400/403/404/429 become
 *             readable isError results, everything else stays a protocol error.
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
// `pageProperties` and `countOnlyProperty` are unused until a tool is added, and
// are imported here so the first tool has one obvious way to declare paging.
import {
  defineToolCatalogue,
  handleToolError,
  toolTextResult,
  isCountOnlyRequest,
  fetchCount,
  countOnlyProperty,
  pageProperties,
  assertNoUnknownParameters,
} from "@bconnect/mcp-core";
import { InsightsRules } from "./utils/mcp-tool-validation-rules.js";
import { buildEstateRiskBriefing } from "./modules/estate-risk.js";
import { buildEndpointBriefing } from "./modules/endpoint-briefing.js";
import { buildPatchReadiness } from "./modules/patch-readiness.js";
import { buildDeploymentCoverage } from "./modules/deployment-coverage.js";
import { buildEndpointReach } from "./modules/endpoint-reach.js";

// The imports above are the template's point; reference them so an unmodified
// template still type-checks and lints without an unused-import error.
void isCountOnlyRequest;
void fetchCount;
void countOnlyProperty;
void pageProperties;

// ─── Factory exported for testing ───────────────────────────────────────────

/** Per-session credentials. Injected by the caller; they win over the environment. */
export interface BConnectCredentials {
  baseUrl?: string;
  username?: string;
  password?: string;
  apiKey?: string;
}

/**
 * OPT-32 — the parameter is not optional decoration.
 *
 * The template used to be the one factory of the thirteen that took NO
 * credentials, so a new server copied from it could only ever read the process
 * environment. Two things that costs: its tests cannot construct a server
 * without mutating `process.env` (which is how credential-isolation regressions
 * go unnoticed), and `runServer` — which passes the credentials it resolved into
 * every `createServer()` call, including the per-request one in HTTP mode —
 * would have had them silently ignored here.
 */
export function createServer(credentials?: BConnectCredentials): { server: Server; getClient: () => BConnectClient } {
  const server = new Server(
    {
      name: "bconnect-insights-mcp",
      version: "26.1.8"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // ── Tool catalogue ────────────────────────────────────────────────────────

  const TOOLS: { name: string; [key: string]: unknown }[] = [
    {
      name: "get_estate_risk_briefing",
      description:
        "How exposed is this estate, in one call. Combines encryption and TPM state, Microsoft " +
        "Defender activity and antivirus definition age, detected vulnerabilities, and endpoints " +
        "that have stopped reporting — four dimensions that otherwise live in three different " +
        "servers. Prefer this over assembling get_security_posture, get_vulnerability_exposure " +
        "and get_stale_endpoints yourself for questions like 'how exposed are we', 'what is our " +
        "risk', 'where should we start' or 'give me a security briefing'. Counts are exact; name " +
        "lists are capped at maxNamed and say so. If a dimension cannot be read the briefing " +
        "still returns the others, says which is missing in headline[0], and sets " +
        "meta.resultTrustworthy false — an incomplete briefing is never an all-clear. Read-only.",
      inputSchema: {
        type: "object",
        properties: {
          maxNamed: {
            type: "number",
            description: "How many endpoints to name per list (default 10). Counts are exact regardless.",
          },
          staleDefinitionsAfterDays: {
            type: "number",
            description: "Antivirus definitions older than this many days count as stale (default 7).",
          },
          staleEndpointAfterDays: {
            type: "number",
            description: "An endpoint not seen for this many days counts as not reporting (default 30).",
          },
          pageSize: {
            type: "number",
            description: "Rows read per dimension, 1-1000 (default 200). Estate totals are reported separately.",
          },
        },
        required: [],
      },
    },
    {
      name: "get_endpoint_briefing",
      description:
        "Everything known about ONE endpoint, in one call: whether it is reporting in, encryption and TPM, " +
        "Defender activity and definition age, detected vulnerabilities, job health INCLUDING past failures the " +
        "current state hides, recent software installs, and whether patching is switched on. Spans six servers. " +
        "Prefer this for 'what is going on with WORKSTATION1', 'why is this machine misbehaving', 'tell me about " +
        "this endpoint'. Takes a NAME or a GUID — passing endpointName saves you a list_endpoints lookup, and an " +
        "ambiguous name is refused rather than guessed. Leads with what is WRONG. Variable values are never " +
        "returned. Read-only.",
      inputSchema: {
        type: "object",
        properties: {
          endpointId: { type: "string", description: "GUID of the endpoint. From list_endpoints in bconnect-endpoints. Wins if both are given." },
          endpointName: { type: "string", description: "Display name or host name, e.g. WORKSTATION1. Resolved here, so no lookup call is needed." },
          maxNamed: { type: "number", description: "How many items to name per list (default 5). Counts stay exact." },
          staleDefinitionsAfterDays: { type: "number", description: "Antivirus definitions older than this many days are called stale (default 7)." },
          pageSize: { type: "number", description: "Rows read per dimension, 1-1000 (default 100)." },
        },
        required: [],
      },
    },
    {
      name: "get_patch_readiness",
      description:
        "What needs patching across the estate, and whether anything is being done about it. Joins " +
        "Microsoft-Update counts, CVE detections and patch JOB outcomes — three servers — and names the " +
        "endpoints that are missing updates with no patch job running. Prefer this for 'are we patched', " +
        "'what needs patching', 'is patching working', 'patch compliance'. Two things it deliberately does " +
        "NOT do: it never sums Microsoft update counts with CVE detections (different populations that " +
        "disagree), and it never reports a zero from an endpoint whose inventory is stale as clean. Patch " +
        "jobs are identified by step type, not by job name. Read-only.",
      inputSchema: {
        type: "object",
        properties: {
          inventoryStaleAfterDays: { type: "number", description: "Inventory older than this makes an update count untrustworthy (default 30)." },
          scanStaleAfterDays: { type: "number", description: "Vulnerability scan older than this makes a CVE count historical rather than current (default 30). Separate from inventory age — different measurement, different population." },
          maxNamed: { type: "number", description: "Endpoints to name per list (default 10). Counts stay exact." },
          pageSize: { type: "number", description: "Rows read per source, 1-1000 (default 500)." },
        },
        required: [],
      },
    },

    {
      name: "get_deployment_coverage",
      description:
        "Did a software bundle actually land on the group it was deployed to. Joins the bundle's " +
        "applications, the group's members and what is actually installed — three reads in two " +
        "servers that nothing else joins for you, and by hand it is over 100 KB because the " +
        "installed-software listing returns every product on every member. Use this for 'did my " +
        "deployment work', 'who is missing this software', 'is this bundle installed everywhere'. " +
        "Joins on applicationId, never on name: a bundle's applicationVersion is empty, so a " +
        "name match is unreliable. On an endpoint that HAS a software inventory, an absent row is " +
        "NOT INSTALLED as of that inventory's date — a dated fact, and the date sits beside every " +
        "verdict. Only an endpoint with NO inventory at all is genuinely unknown: it is counted " +
        "as NEVER INVENTORIED and never as missing, because nothing has ever looked. Read-only.",
      inputSchema: {
        type: "object",
        properties: {
          bundleId: { type: "string", description: "GUID of the software bundle. From list_software_bundles in bconnect-software." },
          logicalGroupId: { type: "string", description: "GUID of the logical group the bundle was deployed to. From list_logical_groups in bconnect-endpoints." },
          inventoryStaleAfterDays: { type: "number", description: "Verdicts never change with inventory age — an absence in an old snapshot is still 'not installed as of that date'. This only counts how many answers come from a snapshot older than this many days, per endpoint and in coverage.answersOlderThanThreshold (default 30)." },
          reachableWithinDays: { type: "number", description: "An endpoint not seen within this many days is flagged unreachable, so a redeployment would queue rather than run (default 7)." },
          maxNamed: { type: "number", description: "Endpoints to name per list (default 10). Counts stay exact." },
          pageSize: { type: "number", description: "Rows read per source, 1-1000 (default 1000). The installed-software read is the large one." },
        },
        required: ["bundleId", "logicalGroupId"],
      },
    },

    {
      name: "get_endpoint_reach",
      description:
        "Which groups reach ONE endpoint, and what is assigned through them. bConnect has no " +
        "endpoint-to-groups direction — every reverse route answers 404 — so membership only runs " +
        "group to endpoints, and answering this by hand costs one read PER GROUP: measured, 56 " +
        "calls and 436 KB to learn that one endpoint is in 15 of 55 dynamic groups. Use this for " +
        "'why does this machine get that job', 'which dynamic groups is it in', 'what reaches this " +
        "endpoint'. The logical group is free (it is a field on the endpoint) and is reported " +
        "without a lookup. A group whose membership could not be read is counted as UNCHECKED and " +
        "never as 'not a member', so the reach list is a floor and says so. Static and dynamic " +
        "groups are not covered because bConnect cannot enumerate them at all. Membership is " +
        "server-evaluated from a rule, so this is a snapshot. Read-only.",
      inputSchema: {
        type: "object",
        properties: {
          endpointId: { type: "string", description: "GUID of the endpoint. From list_endpoints in bconnect-endpoints." },
          maxGroupsChecked: { type: "number", description: "Ceiling on membership reads, 1-1000 (default 200). Groups past it are reported unchecked rather than assumed absent." },
          budgetMs: { type: "number", description: "Wall-clock budget in ms (default 20000). Groups not reached in time are reported unchecked." },
          maxNamed: { type: "number", description: "Groups to name per list (default 25). Counts stay exact." },
          // Says "every read", not "membership call": it is also applied to the
          // job-instance and kiosk reads. Lowering it to economise across many
          // membership calls therefore short-serves the job history too, which
          // now correctly reports the failure count as a FLOOR — surprising if
          // you believed the old description, which named only membership.
          pageSize: { type: "number", description: "Rows read per underlying read — membership, job instances and kiosk releases alike, 1-1000 (default 1000). Lowering it can make the job-instance read incomplete, which is reported." },
        },
        required: ["endpointId"],
      },
    }
  ];

  // `write` names every tool that mutates state (REQ-SRV-012). Those tools are
  // omitted from tools/list unless ALLOW_WRITE_OPERATIONS=true — a token
  // optimisation, not the security control; `gateWriteTool` below is the
  // control, and it still answers a client that calls a hidden tool by name.
  const catalogue = defineToolCatalogue({
    tools: TOOLS,
    write: [
      // "create_insights",
      // "update_insights",
      // "delete_insights",
    ],
  });

  /** Tool name -> the parameter names its advertised inputSchema declares. */
  const declaredParameters = catalogue.declaredParameters();

  /**
   * A JSON-RPC caller can send `arguments` as a string or an array. Object.keys
   * on either yields nonsense rather than an error, so the unknown-parameter
   * check below would pass on input it never actually examined. Local, not
   * shared, matching bconnect-endpoints-mcp — the day a third server needs it,
   * it belongs in mcp-core.
   */
  function assertArgumentsAreAnObject(name: string, args: unknown): void {
    if (args === undefined || (typeof args === "object" && args !== null && !Array.isArray(args))) {
      return;
    }
    throw new BareMcpError(
      ErrorCode.InvalidParams,
      `${name}: arguments must be an object.`
    );
  }

  // ── ListToolsRequestSchema handler ────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: catalogue.listTools() };
  });

  // ── Argument-validation pre-pass (runs before write-gate or bConnect setup) ─
  //
  // ARCHITECTURAL CONTRACT: every tool's arguments are validated here BEFORE
  // any side effect. Argument validation is pure; bConnect setup has side
  // effects (TLS, credentials, network); the pure step belongs first.
  //
  // This is the trust boundary against prompt-injection-induced malformed
  // arguments (see SECURITY.md → "Tool-argument validation"). Do not move
  // validation back into individual case bodies — that defers it past the
  // write gate and past credential setup.
  function validateToolArguments(name: string, args: Record<string, unknown> | undefined): void {
    // 1. An unrecognised key is not harmless (finding D6): bConnect answers
    //    HTTP 200 and ignores it, so a misspelled option silently produces a
    //    confident wrong answer. The declared set comes from the catalogue,
    //    never from a hand-kept list, so it cannot drift from what is
    //    advertised. The first test run caught this missing: `{nonsense:true}`
    //    was accepted.
    const declared = declaredParameters.get(name);
    if (!declared) {
      return; // unknown tool name — dispatch answers it, not this function
    }
    assertArgumentsAreAnObject(name, args);
    assertNoUnknownParameters(name, args, declared);

    // 2. Types and ranges.
    switch (name) {
      case "get_estate_risk_briefing":
        validateOrThrow(args, InsightsRules.estateRiskBriefing()); return;
      case "get_endpoint_briefing":
        validateOrThrow(args, InsightsRules.endpointBriefing()); return;
      case "get_patch_readiness":
        validateOrThrow(args, InsightsRules.patchReadiness()); return;
      case "get_deployment_coverage":
        validateOrThrow(args, InsightsRules.deploymentCoverage()); return;
      case "get_endpoint_reach":
        validateOrThrow(args, InsightsRules.endpointReach()); return;
    }
  }

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
    // (BCONNECT_API_KEY__<insights>); with no such variable set this changes
    // nothing. See packages/mcp-core/src/server-scoped-credentials.ts.
    //
    // In the TEMPLATE because a server that omits it keeps the shared
    // credential while its operator believes it was scoped down — silent, and
    // asymmetric: twelve servers scoped and one not reads as least privilege
    // and is not. `__tests__/suite-server-scoped-credentials.ts` enforces it on
    // every real server, and found this omission the first time a server was
    // scaffolded from this file.
    serverName: "bconnect-insights-mcp",
    factory: (config) => new BConnectClient(config),
    credentials,
    defaultBaseUrl: "https://bms-server/bconnect",
    onMissingCredentials: () => {
      throw new BareMcpError(
        ErrorCode.InternalError,
        "Either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD environment variables are required"
      );
    },
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // 1. Validate arguments first — pure, no side effects, fails fast on bad input.
    validateToolArguments(name, args);

    // 2. Write-operation gate (REQ-SRV-012). Names come from the catalogue
    //    above, so a write tool cannot be advertised and left ungated.
    const denied = catalogue.gateWriteTool(name);
    if (denied) {
      return denied;
    }


    // 3. Dispatch — arguments already validated by validateToolArguments above.
    try {
      const bconnect = getBconnect();

      switch (name) {
        case "get_estate_risk_briefing": {
          // The composite reads several MODULES through one client, which is
          // what this server exists to do: bConnect is one API with per-module
          // path prefixes, so `getHttpClient()` reaches /defensecontrol,
          // /compliance and /endpoints without importing another package.
          const briefing = await buildEstateRiskBriefing(bconnect.getHttpClient(), {
            maxNamed: args?.maxNamed as number | undefined,
            staleDefinitionsAfterDays: args?.staleDefinitionsAfterDays as number | undefined,
            staleEndpointAfterDays: args?.staleEndpointAfterDays as number | undefined,
            pageSize: args?.pageSize as number | undefined,
          });
          return toolTextResult(serializeToolResult(briefing));
        }

        case "get_endpoint_briefing": {
          // Neither id nor name is individually required — one of the two is.
          // The rules cannot express "exactly one of", so it is enforced here
          // with a message that says which to pass, rather than a bare throw.
          if (!args?.endpointId && !args?.endpointName) {
            throw new BareMcpError(
              ErrorCode.InvalidParams,
              "get_endpoint_briefing: pass endpointId (a GUID, from list_endpoints) or endpointName (e.g. WORKSTATION1).",
            );
          }
          const briefing = await buildEndpointBriefing(bconnect.getHttpClient(), {
            endpointId: args?.endpointId as string | undefined,
            endpointName: args?.endpointName as string | undefined,
            maxNamed: args?.maxNamed as number | undefined,
            staleDefinitionsAfterDays: args?.staleDefinitionsAfterDays as number | undefined,
            pageSize: args?.pageSize as number | undefined,
          });
          return toolTextResult(serializeToolResult(briefing));
        }

        case "get_patch_readiness": {
          const report = await buildPatchReadiness(bconnect.getHttpClient(), {
            inventoryStaleAfterDays: args?.inventoryStaleAfterDays as number | undefined,
            scanStaleAfterDays: args?.scanStaleAfterDays as number | undefined,
            maxNamed: args?.maxNamed as number | undefined,
            pageSize: args?.pageSize as number | undefined,
          });
          return toolTextResult(serializeToolResult(report));
        }

        case "get_deployment_coverage": {
          const report = await buildDeploymentCoverage(bconnect.getHttpClient(), {
            bundleId: args!.bundleId as string,
            logicalGroupId: args!.logicalGroupId as string,
            inventoryStaleAfterDays: args?.inventoryStaleAfterDays as number | undefined,
            reachableWithinDays: args?.reachableWithinDays as number | undefined,
            maxNamed: args?.maxNamed as number | undefined,
            pageSize: args?.pageSize as number | undefined,
          });
          return toolTextResult(serializeToolResult(report));
        }

        case "get_endpoint_reach": {
          const report = await buildEndpointReach(bconnect.getHttpClient(), {
            endpointId: args!.endpointId as string,
            maxGroupsChecked: args?.maxGroupsChecked as number | undefined,
            budgetMs: args?.budgetMs as number | undefined,
            maxNamed: args?.maxNamed as number | undefined,
            pageSize: args?.pageSize as number | undefined,
          });
          return toolTextResult(serializeToolResult(report));
        }

        default:
          throw new BareMcpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (error) {
      // INT-53 — one error channel. Expected API failures (400/403/404/429)
      // become readable isError results the model can act on; validation and
      // gate errors are rethrown as the protocol errors they already are; and
      // 401/5xx/TLS/bugs become protocol InternalError. Do not add a second
      // catch-all here — a per-server one is what produced two channels.
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
    name: "bconnect-insights-mcp",
    createServer,
    http: { express },
  }).catch((error) => {
    console.error(`Fatal error: ${describeConnectionFailure(error)}`);
    process.exit(1);
  });
}
