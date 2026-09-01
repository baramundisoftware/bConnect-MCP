#!/usr/bin/env node

/**
 * bconnect-defensecontrol-mcp
 *
 * A Model Context Protocol server that provides access to the baramundi
 * bConnect REST API for Defense Control — BitLocker encryption management,
 * Local Admin account credentials, and Microsoft Defender threat monitoring.
 *
 * Requires bConnect 26R1 or later. 25R2 is no longer supported and the
 * BCONNECT_RELEASE switch that used to select between them is gone:
 * `get_bitlocker_secrets` and `update_bitlocker_pin` are now registered
 * unconditionally, as is every other tool here.
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
// LOCAL ADDITION — composite security posture (see modules/security-posture.ts).
import { getSecurityPosture } from "./modules/security-posture.js";
import { validateOrThrow, serializeToolResult } from "@bconnect/mcp-core";
// A2/INT-53: `McpError` bakes "MCP error <code>: " into `.message`, and the SDK
// client adds it again when it rebuilds the error from the wire — so anything
// thrown out of a request handler reaches the model doubled. `BareMcpError` is
// an `McpError` subclass carrying the bare message, so the prefix appears once.
// It is still `instanceof McpError`, which the catch-all below relies on.
import { BareMcpError } from "@bconnect/mcp-core";
// TOK-20 / TOK-25 / TOK-10 / INT-53 — the shared composition layer. See
// packages/mcp-core/src/{tool-catalogue,count-only,schema-fragments,tool-error}.ts.
// `handleToolError` applies `stripMcpErrorPrefix` itself, which is why this file
// no longer imports it directly.
import {
  defineToolCatalogue,
  handleToolError,
  toolTextResult,
  apiParams,
  isCountOnlyRequest,
  fetchCount,
  countOnlyProperty,
  pageProperties,
  includeSubfoldersProperty,
  // Response shaping (TOK-24 gap closed here — this was one of 8 servers with
  // zero response shaping; see the shaper declarations below for why).
  createListShaper,
  projectionProperties,
  type ListEnvelope,
  type Row,
} from "@bconnect/mcp-core";
import { DefenseControlRules } from "./utils/mcp-tool-validation-rules.js";
// INT4-14 — a removed/renamed tool explains itself rather than falling
// through to a bare "Unknown tool". Modelled on
// bconnect-endpoints-mcp/src/removed-tools.ts, the one server that already
// had this.
import { removalReason } from "./removed-tools.js";

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
      name: "bconnect-defensecontrol-mcp",
      version: "26.1.8"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // ── Response shaping (Phase 4 token-consumption §3) ─────────────────────
  //
  // Measured live against labcorp.local (PageSize:20, 20 of 23 endpoints):
  //   list_bitlocker_windows_endpoints  24,621 B -> compact ~5,100 B  (-79%)
  //   list_defender_windows_endpoints   18,519 B -> compact ~6,800 B  (-63%)
  // Both rows are deeply nested (per-disk/per-volume BitLocker data, four
  // Defender engine sub-blocks that repeat the same definitionVersion), and
  // `shapeRows`'s flat `compactFields` cannot reach into a nested path — so
  // each row is flattened to the handful of top-level facts a fleet question
  // actually asks for BEFORE the shaper runs, and only on the non-`detail`
  // path: `detail:true` is passed the untouched raw envelope, so the escape
  // hatch stays exact byte-for-byte, per this module's own contract.
  // `meta.projectedAway` (shape-response.ts) then names every field the
  // flattening/projection removed from what the API actually returned —
  // nothing is dropped without saying so.

  /**
   * One Windows endpoint's system volume, out of `storageMedia[].storageVolumes[]`
   * (EFI/Recovery volumes carry no BitLocker data and are not a BitLocker fact).
   */
  function systemVolumeOf(row: Row): Record<string, unknown> | null {
    const disks = Array.isArray(row.storageMedia) ? (row.storageMedia as Row[]) : [];
    for (const disk of disks) {
      const volumes = Array.isArray(disk.storageVolumes) ? (disk.storageVolumes as Row[]) : [];
      const system = volumes.find((v) => v.isSystemVolume === true);
      if (system) {
        const bl = (system.bitLockerVolumeData as Row | null) ?? null;
        return {
          driveLetter: system.driveLetter ?? null,
          protectionStatus: bl?.protectionStatus ?? null,
          conversionStatus: bl?.conversionStatus ?? null,
          lockStatus: bl?.lockStatus ?? null,
        };
      }
    }
    return null;
  }

  function flattenBitlockerRow(row: Row): Row {
    const tpmData = (row.tpmData as Row | undefined) ?? undefined;
    return {
      ...row,
      tpmStatus: tpmData?.tpmStatus ?? null,
      systemVolume: systemVolumeOf(row),
    };
  }

  const shapeBitlockerEndpoints = createListShaper({
    compactFields: ["endpointId", "endpointName", "isSecureBootEnabled", "tpmStatus", "systemVolume"],
    fullModeHint: "Pass detail:true for the full record, including every disk/volume.",
  });

  function flattenDefenderRow(row: Row): Row {
    const state = (row.microsoftDefenderState as Row | undefined) ?? {};
    const antivirus = (state.antivirus as Row | undefined) ?? {};
    return {
      ...row,
      isRealTimeProtectionActive: state.isRealTimeProtectionActive ?? null,
      isTamperProtectionActive: state.isTamperProtectionActive ?? null,
      highestSeverity: state.highestSeverity ?? null,
      activeThreats: state.activeThreats ?? null,
      resolvedThreats: state.resolvedThreats ?? null,
      definitionVersion: antivirus.definitionVersion ?? null,
      lastQuickScan: state.lastQuickScan ?? null,
      lastFullScan: state.lastFullScan ?? null,
    };
  }

  const shapeDefenderEndpoints = createListShaper({
    compactFields: [
      "endpointId", "endpointName", "isMicrosoftDefenderActive",
      "isRealTimeProtectionActive", "isTamperProtectionActive", "highestSeverity",
      "activeThreats", "resolvedThreats", "definitionVersion", "lastQuickScan", "lastFullScan",
    ],
    fullModeHint: "Pass detail:true for the full record, including every engine sub-block.",
  });

  /** Flatten every row unless the caller asked for the untouched record. */
  function forShaping<T extends ListEnvelope>(
    payload: T, full: boolean, flatten: (row: Row) => Row
  ): T {
    if (full || !Array.isArray(payload.data)) {return payload;}
    return { ...payload, data: payload.data.map((r) => flatten(r as Row)) };
  }

  // ── Tool catalogue ────────────────────────────────────────────────────────

  const TOOLS = [

      // ── Composite analysis (LOCAL ADDITION) ─────────────────────────────
      {
        name: "get_security_posture",
        description:
          "Security posture of the whole estate in one compact response: BitLocker encryption, TPM and " +
          "Secure Boot state, Microsoft Defender activity, antivirus definition age, and detected threats. " +
          "Prefer this over the individual list_* tools for questions like 'how secure are we', 'what is our " +
          "encryption coverage', 'are our AV signatures current' or 'what security gaps do we have' — the raw " +
          "listings are deeply nested and run to tens of kilobytes to answer what is really a handful of " +
          "counts. Read-only.",
        inputSchema: {
          type: "object",
          properties: {
            staleDefinitionsAfterDays: {
              type: "number",
              description: "Antivirus definitions older than this many days count as stale (default: 7)."
            },
            maxNamed: {
              type: "number",
              description: "How many endpoints to name in each problem list (default: 10)."
            },
          },
          required: []
        }
      },

      // ── BitLocker ──────────────────────────────────────────────────────
      {
        name: "list_bitlocker_windows_endpoints",
        description: "List all Windows endpoints with BitLocker encryption status managed in baramundi Management Suite. Compact rows by default: endpoint id/name, Secure Boot state, TPM status, and the system volume's protection/conversion/lock status. Per-disk and per-volume detail (EFI/Recovery partitions, capacity, free space) is dropped and named in meta.projectedAway. Pass detail:true for the full record, fields:[...] to pick columns, countOnly:true for the count alone.",
        inputSchema: {
          type: "object",
          properties: {
            OrderBy: { type: "string", description: "Sort results by property name and direction (e.g. 'EndpointName asc')." },
            SearchQuery: { type: "string", description: "Filter results by matching against searchable properties." },
            ...pageProperties,
            ...projectionProperties,
          },
          required: []
        }
      },
      {
        name: "get_bitlocker_windows_endpoint",
        description: "Get the BitLocker encryption status and volume details for a specific Windows endpoint identified by its GUID. Returns volume data, conversion status, encryption percentage, BitLocker version, and protection state for the endpoint.",
        inputSchema: {
          type: "object",
          properties: {
            endpointId: { type: "string", description: "GUID of the Windows endpoint to retrieve BitLocker status for." }
          },
          required: ["endpointId"]
        }
      },

      // ── Local Admin ────────────────────────────────────────────────────
      {
        name: "get_local_admin_accounts",
        description: "Get the Local Administrator account credentials for a specific Windows endpoint managed in baramundi Management Suite. Returns the current local admin account details including username and password managed by baramundi LAPS. This is a READ that can still fail: answers HTTP 409 'This action can not be executed on a disabled device' for a disabled endpoint.",
        inputSchema: {
          type: "object",
          properties: {
            endpointId: { type: "string", description: "GUID of the Windows endpoint to retrieve local admin account credentials for." }
          },
          required: ["endpointId"]
        }
      },
      {
        name: "patch_local_admin_user_credentials",
        description: "baramundi LAPS only. The ONLY patchable path is /LocalAdminAccount/RequestedExpirationDate (ISO 8601), nested and case-sensitive exactly as the 26R1 example writes it — username and password cannot be set directly, baramundi LAPS generates them. Setting the date in the PAST forces the endpoint to generate NEW credentials, which is how a rotation is requested; any currently distributed password stops working. The request stays pending until the client acknowledges it — refresh_local_admin_account_expiry asks the client to acknowledge immediately. WARNING: this can rotate live credentials on a production endpoint.",
        inputSchema: {
          type: "object",
          properties: {
            endpointId: { type: "string", description: "GUID of the Windows endpoint to patch local admin credentials for." },
            patchOperations: {
              type: "array",
              description: "JSON Patch operations array. The only legal path is /LocalAdminAccount/RequestedExpirationDate (op=replace, value=ISO 8601 date-time) — a nested path, exactly as the 26R1 patch example writes it, and case-sensitive. Any other path returns HTTP 400."
            }
          },
          required: ["endpointId", "patchOperations"]
        }
      },
      {
        name: "refresh_local_admin_account_expiry",
        description: "baramundi LAPS only. Ask ONE Windows endpoint to immediately update the expiration date of its baramundi-managed local administrator account. The endpoint must be ONLINE: the call waits up to 'timeout' seconds (0-60, default 30) and answers HTTP 409 'This action can not be executed on a disabled device' for a disabled endpoint. The 200 body is a bare boolean: true means the client changed its expiration date, false means the client could NOT be reached within the timeout — a false result is not an error and must be reported as 'not confirmed', not as success. This does NOT install software or Windows updates, does NOT re-run inventory, and does NOT refresh any other managed data — for those use start_job_instance in bconnect-jobs, or list_update_management_endpoints in bconnect-updatemanagement to see what an endpoint is missing. WARNING: this changes credential state on a production endpoint.",
        inputSchema: {
          type: "object",
          properties: {
            endpointId: { type: "string", description: "GUID of the Windows endpoint to trigger the update on." },
            timeout: { type: "number", description: "Timeout in seconds, 0-60 (default 30). Must be between 0 and 60 per the bConnect API." }
          },
          required: ["endpointId"]
        }
      },

      // ── Microsoft Defender Threats ─────────────────────────────────────
      {
        name: "list_defender_threats",
        description: "List all Microsoft Defender threat detections across all Windows endpoints managed in baramundi Management Suite. Returns a paged list of threats with threat identifiers, names, severity, categories, and detection status information.",
        inputSchema: {
          type: "object",
          properties: {
            OrderBy: { type: "string", description: "Sort results by property name and direction (e.g. 'ThreatName asc')." },
            SearchQuery: { type: "string", description: "Filter results by matching against searchable threat properties." },
            ...pageProperties,
            ...countOnlyProperty,
          },
          required: []
        }
      },
      {
        name: "get_defender_threat",
        description: "Get the details of a specific Microsoft Defender threat detection by its GUID. Returns threat name, severity, category, detection status, and affected endpoint information for the specified threat recorded in baramundi Management Suite.",
        inputSchema: {
          type: "object",
          properties: {
            threatId: { type: "string", description: "GUID of the Microsoft Defender threat to retrieve details for." }
          },
          required: ["threatId"]
        }
      },
      {
        name: "list_defender_threats_by_endpoint",
        description: "List all Microsoft Defender threat detections for a specific Windows endpoint identified by its GUID. Returns a paged list of threats detected on that endpoint including threat names, severity levels, and detection timestamps.",
        inputSchema: {
          type: "object",
          properties: {
            endpointId: { type: "string", description: "GUID of the Windows endpoint to retrieve Defender threats for." },
            OrderBy: { type: "string", description: "Sort results by property name and direction." },
            SearchQuery: { type: "string", description: "Filter results by matching against threat properties." },
            ...pageProperties,
            ...countOnlyProperty,
          },
          required: ["endpointId"]
        }
      },
      {
        name: "list_defender_threats_by_logical_group",
        description: "List all Microsoft Defender threat detections for endpoints within a specific logical group identified by its GUID. Returns a paged list of threats across all endpoints in that group with threat details and endpoint names.",
        inputSchema: {
          type: "object",
          properties: {
            logicalGroupId: { type: "string", description: "GUID of the logical group to retrieve Defender threats for." },
            OrderBy: { type: "string", description: "Sort results by property name and direction." },
            SearchQuery: { type: "string", description: "Filter results by matching against threat properties." },
            ...pageProperties,
            ...includeSubfoldersProperty,
            ...countOnlyProperty,
          },
          required: ["logicalGroupId"]
        }
      },

      // ── Microsoft Defender States ──────────────────────────────────────
      {
        name: "list_defender_windows_endpoints",
        description: "List all Windows endpoints with Microsoft Defender status managed in baramundi Management Suite. Compact rows by default: endpoint id/name, whether Defender is active, real-time/tamper protection, highest threat severity, active/resolved threat counts, antivirus definition version, and last quick/full scan. The per-engine (antimalware/antispyware/antivirus/network-inspection) sub-blocks are dropped and named in meta.projectedAway. Pass detail:true for the full record, fields:[...] to pick columns, countOnly:true for the count alone.",
        inputSchema: {
          type: "object",
          properties: {
            OrderBy: { type: "string", description: "Sort results by property name and direction." },
            SearchQuery: { type: "string", description: "Filter results by matching against searchable properties." },
            ...pageProperties,
            ...projectionProperties,
          },
          required: []
        }
      },
      {
        name: "get_defender_windows_endpoint",
        description: "Get the Microsoft Defender status for a specific Windows endpoint identified by its GUID. Returns the Defender protection state, real-time protection enabled status, signature version, engine version, and last full scan timestamp.",
        inputSchema: {
          type: "object",
          properties: {
            endpointId: { type: "string", description: "GUID of the Windows endpoint to retrieve Microsoft Defender status for." }
          },
          required: ["endpointId"]
        }
      },
  ];

  // Spliced in at index 2 rather than appended, to keep the BitLocker tools
  // adjacent in tools/list. This used to be `if (is26R1)`; the product is 26R1
  // -only, so it is unconditional and the "[26R1]" description prefix and the
  // "Available in bConnect 26R1 and later." sentence have gone with the switch —
  // both said something that is now true of every tool in the suite.
  TOOLS.splice(2, 0,
    {
      name: "get_bitlocker_secrets",
      description: "Returns LIVE recovery keys and startup PIN — for encryption STATUS (is it encrypted, protection state) use get_bitlocker_windows_endpoint instead; this call exposes credentials and is gated by ALLOW_SECRET_READ. Get the BitLocker secrets for a specific Windows endpoint. Returns the initial startup PIN and BitLocker recovery keys stored for the specified managed Windows endpoint.",
      inputSchema: {
        type: "object",
        properties: {
          endpointId: { type: "string", description: "GUID of the Windows endpoint to retrieve BitLocker secrets for." }
        },
        required: ["endpointId"]
      }
    },
    {
      name: "update_bitlocker_pin",
      description: "Update the BitLocker startup PIN for a specific Windows endpoint using a JSON Patch document. Modifies the InitialStartupPin field for the specified managed Windows endpoint and returns the updated BitLocker secrets.",
      inputSchema: {
        type: "object",
        properties: {
          endpointId: { type: "string", description: "GUID of the Windows endpoint to update the BitLocker PIN for." },
          patchOperations: {
            type: "array",
            description: "JSON Patch operations array. Use op=replace, path=/InitialStartupPin, value=<new-pin>."
          }
        },
        required: ["endpointId", "patchOperations"]
      }
    }
  );

  const catalogue = defineToolCatalogue({
    tools: TOOLS,
    write: [
      // `update_bitlocker_pin` used to be spread in conditionally, because naming
      // a write that is absent from `tools` is a hard error in
      // defineToolCatalogue (the F21 drift class). It is always present now.
      "update_bitlocker_pin",
      "patch_local_admin_user_credentials",
      "refresh_local_admin_account_expiry",
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
      case "list_bitlocker_windows_endpoints":
        validateOrThrow(args, DefenseControlRules.listBitlockerWindowsEndpoints());
        return;
      case "get_bitlocker_windows_endpoint":
        validateOrThrow(args, DefenseControlRules.getBitlockerWindowsEndpoint());
        return;
      case "get_bitlocker_secrets":
        validateOrThrow(args, DefenseControlRules.getBitlockerSecrets());
        return;
      case "update_bitlocker_pin":
        validateOrThrow(args, DefenseControlRules.updateBitlockerPin());
        return;
      case "get_local_admin_accounts":
        validateOrThrow(args, DefenseControlRules.getLocalAdminAccounts());
        return;
      case "patch_local_admin_user_credentials":
        validateOrThrow(args, DefenseControlRules.patchLocalAdminUserCredentials());
        return;
      case "refresh_local_admin_account_expiry":
        validateOrThrow(args, DefenseControlRules.triggerUpdateOnClient());
        return;
      case "list_defender_threats":
        validateOrThrow(args, DefenseControlRules.listDefenderThreats());
        return;
      case "get_defender_threat":
        validateOrThrow(args, DefenseControlRules.getDefenderThreat());
        return;
      case "list_defender_threats_by_endpoint":
        validateOrThrow(args, DefenseControlRules.listDefenderThreatsByEndpoint());
        return;
      case "list_defender_threats_by_logical_group":
        validateOrThrow(args, DefenseControlRules.listDefenderThreatsByLogicalGroup());
        return;
      case "list_defender_windows_endpoints":
        validateOrThrow(args, DefenseControlRules.listDefenderWindowsEndpoints());
        return;
      case "get_defender_windows_endpoint":
        validateOrThrow(args, DefenseControlRules.getDefenderWindowsEndpoint());
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
    // (BCONNECT_API_KEY__DEFENSECONTROL); with no such variable set this
    // changes nothing. See mcp-core/server-scoped-credentials.ts.
    serverName: "bconnect-defensecontrol-mcp",
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
    //    tools/list is a token optimisation; this is the security control, and
    //    it still answers a client that calls a hidden tool by name.
    const denied = catalogue.gateWriteTool(name);
    if (denied) {
      return denied;
    }

    // 3. Secret-read gate (security audit C3, extended by SEC-3). These calls
    // return live secrets (BitLocker recovery keys/PIN, cleartext LAPS admin
    // passwords) that would otherwise land in the model context/transcript
    // unredacted. Off by default; an operator must opt in explicitly.
    //
    // The two write tools are here as well as in WRITE_TOOLS above, so BOTH
    // gates must be open for them. They are not read tools, but their
    // *responses* are secret-bearing: updateBitLockerPin() resolves to
    // BitLockerSecrets (the recovery key set) and patchLocalAdminUserCredentials()
    // resolves to LocalAdminAccountWindowsEndpoint (the LAPS username/password),
    // and both are serialised into the tool result unmodified. Without this,
    // the documented remediation posture (ALLOW_WRITE_OPERATIONS=true,
    // ALLOW_SECRET_READ unset) let an effectively no-op JSON Patch return
    // exactly the secrets this gate exists to withhold.
    const SECRET_READ_TOOLS = new Set<string>([
      "get_bitlocker_secrets",
      "get_local_admin_accounts",
      "update_bitlocker_pin",
      "patch_local_admin_user_credentials",
    ]);
    if (SECRET_READ_TOOLS.has(name) && process.env.ALLOW_SECRET_READ !== "true") {
      // INT4-15 — name the actor, the location, and the restart, not just the
      // variable. A model relaying "set ALLOW_SECRET_READ=true" cannot tell an
      // administrator WHERE to set it or that a running server will not pick
      // it up — this MCP server's own failure mode, per DEMO-RUN-OF-SHOW.md.
      return {
        content: [{
          type: "text" as const,
          text: `Secret-returning operation '${name}' is disabled because it exposes live credentials (BitLocker keys / LAPS passwords). This MCP server was started without ALLOW_SECRET_READ. An operator must set ALLOW_SECRET_READ=true in the server's environment — the MCP host's 'env' block for this server, or the container/service environment — and RESTART the server; the change is not picked up by a running process, and the model cannot set it. This gate is independent of ALLOW_WRITE_OPERATIONS: opening writes alone does not enable this.`
        }],
        isError: true
      };
    }


    try {
      const bconnect = getBconnect();
      const dc = bconnect.defenseControl;

      // Dispatch — arguments already validated by validateToolArguments above.
      switch (name) {

        // LOCAL ADDITION — composite posture aggregate; read-only.
        case "get_security_posture": {
          const result = await getSecurityPosture(dc, (args ?? {}) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_bitlocker_windows_endpoints": {
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => dc.getBitLockerWindowsEndpoints(p as never), args);
            return toolTextResult(serializeToolResult(count));
          }
          const raw = await dc.getBitLockerWindowsEndpoints(apiParams(args) as never);
          const full = args?.detail === true;
          const shaped = shapeBitlockerEndpoints(
            forShaping(raw as unknown as ListEnvelope, full, flattenBitlockerRow),
            { full, fields: args?.fields as string[] | undefined, args }
          );
          return toolTextResult(serializeToolResult(shaped));
        }

        case "get_bitlocker_windows_endpoint": {
          const result = await dc.getBitLockerWindowsEndpoint(args!.endpointId as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "get_bitlocker_secrets": {
          const result = await dc.getBitLockerSecrets(args!.endpointId as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "update_bitlocker_pin": {
          const result = await dc.updateBitLockerPin(args!.endpointId as string, args!.patchOperations as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "get_local_admin_accounts": {
          const result = await dc.getLocalAdministrativeAccounts(args!.endpointId as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "patch_local_admin_user_credentials": {
          const result = await dc.patchLocalAdminUserCredentials(args!.endpointId as string, args!.patchOperations as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "refresh_local_admin_account_expiry": {
          const timeout = typeof args?.timeout === "number" ? args.timeout : undefined;
          const result = await dc.triggerUpdateOnClient(args!.endpointId as string, timeout);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_defender_threats": {
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => dc.getMicrosoftDefenderThreats(p as never), args);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await dc.getMicrosoftDefenderThreats(apiParams(args) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "get_defender_threat": {
          const result = await dc.getMicrosoftDefenderThreat(args!.threatId as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_defender_threats_by_endpoint": {
          const { endpointId, ...params } = args as Record<string, unknown>;
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => dc.getMicrosoftDefenderThreatsByEndpoint(endpointId as string, p as never), params);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await dc.getMicrosoftDefenderThreatsByEndpoint(endpointId as string, apiParams(params) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_defender_threats_by_logical_group": {
          const { logicalGroupId, ...params } = args as Record<string, unknown>;
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => dc.getMicrosoftDefenderThreatsByLogicalGroup(logicalGroupId as string, p as never), params);
            return toolTextResult(serializeToolResult(count));
          }
          const result = await dc.getMicrosoftDefenderThreatsByLogicalGroup(logicalGroupId as string, apiParams(params) as never);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        case "list_defender_windows_endpoints": {
          if (isCountOnlyRequest(args)) {
            const count = await fetchCount((p) => dc.getMicrosoftDefenderWindowsEndpoints(p as never), args);
            return toolTextResult(serializeToolResult(count));
          }
          const raw = await dc.getMicrosoftDefenderWindowsEndpoints(apiParams(args) as never);
          const full = args?.detail === true;
          const shaped = shapeDefenderEndpoints(
            forShaping(raw as unknown as ListEnvelope, full, flattenDefenderRow),
            { full, fields: args?.fields as string[] | undefined, args }
          );
          return toolTextResult(serializeToolResult(shaped));
        }

        case "get_defender_windows_endpoint": {
          const result = await dc.getMicrosoftDefenderWindowsEndpoint(args!.endpointId as string);
          return { content: [{ type: "text", text: serializeToolResult(result) }] };
        }

        default: {
          // INT4-14 — a renamed/removed tool explains itself.
          const reason = removalReason(name);
          throw new BareMcpError(ErrorCode.MethodNotFound, reason ?? `Unknown tool: ${name}`);
        }
      }
    } catch (error) {
      // INT-53 — one error channel. `handleToolError` applies stripMcpErrorPrefix
      // (A2) on every branch. See packages/mcp-core/src/tool-error.ts.
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
    name: "bconnect-defensecontrol-mcp",
    createServer,
    http: { express },
  }).catch((error) => {
    console.error(`Fatal error: ${describeConnectionFailure(error)}`);
    process.exit(1);
  });
}
