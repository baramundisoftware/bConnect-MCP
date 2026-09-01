#!/usr/bin/env node

/**
 * bconnect-endpoints-mcp
 *
 * A Model Context Protocol server over the baramundi bConnect REST API for
 * endpoint management. **bConnect 26R1 or newer only** — see README.
 *
 * ── What this file is, after the 2026-08-02 surface revision ────────────────
 * Three layers, and only one of them lives here:
 *
 *   src/tool-catalogue.ts   WHAT is advertised, and what each argument must be.
 *                           `defineTools()` derives both from the 26R1 spec for
 *                           the 1:1 wrappers; the composites are hand-authored.
 *   src/endpoint-types.ts   WHICH route a `type` value selects, and which
 *                           filters that route actually declares.
 *   this file               dispatch: argument checks, the write gate, and the
 *                           call.
 *
 * The catalogue used to be a 840-line array literal here and the rules a
 * separate 370-line table that restated it. Both are gone.
 *
 * ── The release gate is gone with 25R2 ──────────────────────────────────────
 * `BCONNECT_RELEASE`, `is26R1` and the conditional tool registration have been
 * removed (product decision 2). 25R2 is not supported, six tools stopped being
 * conditional, and six `if (!is26R1) throw` arms stopped existing. A bMS older
 * than 26R1 is refused at startup rather than half-served.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import express from "express";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import { BConnectClient } from "./bconnect-client.js";
import {
  createClientProvider,
  serializeToolResult,
  defineToolCatalogue,
  createListShaper,
  ENDPOINT_COMPACT_FIELDS,
  fetchCount,
  isCountOnlyRequest,
  handleToolError,
  toolTextResult,
  BareMcpError,
  assertSafePathSegment,
  runServer,
  shouldAutoStart,
  validateOrThrow,
  assertNoUnknownParameters,
  describeConnectionFailure,
  v11Enabled,
  gateV11Tool,
  type ToolTextResult,
  type CountResult,
} from "@bconnect/mcp-core";
import type { EndpointsModule } from "./modules/endpoints.js";
import { DECLARED, SHAPING_KEYS } from "./tool-catalogue.js";
import {
  assertFieldsSupported,
  assertFiltersDeclared,
  assertTypeSupports,
  buildPatchDocument,
  enrollmentFieldsFor,
  filtersFor,
  updatableFieldsFor,
  type EndpointType,
  type EndpointTypeSelector,
} from "./endpoint-types.js";
import { removalReason } from "./removed-tools.js";
// LOCAL ADDITION — composite fleet aggregate (see modules/fleet-summary.ts).
import { getFleetSummary } from "./modules/fleet-summary.js";
// LOCAL ADDITION — ghost-machine / stale-endpoint detection.
import { getStaleEndpoints } from "./modules/stale-endpoints.js";
// LOCAL ADDITION — bMC console link builder (see modules/bmc-console-link.ts).
import { withConsoleLinkMeta, isConsoleLinksEnabled, isRemoteDeskLinksEnabled } from "./modules/bmc-console-link.js";
// LOCAL ADDITION — bConnect v1.1 custom inventory scans (registry / WMI / file).
// A second, separately gated catalogue: v1.1 has no OpenAPI document, so it
// cannot go through the spec-derived declaration in tool-catalogue.ts. See
// v11-tool-catalogue.ts for why, and modules/inventory-scans-v11.ts for the
// measured payload sizes that shape these tools.
import { v11Catalogue, V11_TOOL_NAMES, V11_RULES } from "./v11-tool-catalogue.js";
import {
  InventoryScansV11Client,
  REGISTRY_CONTROLLER,
  WMI_CONTROLLER,
  FILE_CONTROLLER,
  shapeRegistryScan,
  shapeFileScan,
  shapeWmiIndex,
  shapeWmiClass,
} from "./modules/inventory-scans-v11.js";

const SERVER_NAME = "bconnect-endpoints-mcp";
const SERVER_VERSION = "26.1.8";

// ─── Per-type route dispatch ────────────────────────────────────────────────
//
// The collapse's other half. `endpoint-types.ts` decides WHICH route a `type`
// selects and whether the caller's filters exist on it; these tables say which
// typed module method issues it.
//
// Deliberately NOT a `/${type}Endpoints` template. Interpolating a caller-
// supplied value into a path is the defect SEC-0 recorded on `id`, and a table
// of typed methods also keeps every call bound to its generated request and
// response types — the collapse is a change to the TOOL surface, not a
// loosening of the client.

type Args = Record<string, unknown> | undefined;
type Params = Record<string, unknown>;

/** `""` is the type-agnostic `/v2.0/Endpoints` route. */
const UNTYPED = "";

const LIST_ROUTE: Record<string, (m: EndpointsModule, p: Params) => Promise<unknown>> = {
  [UNTYPED]: (m, p) => m.getEndpoints(p as never),
  WindowsEndpoint: (m, p) => m.getWindowsEndpoints(p as never),
  LinuxEndpoint: (m, p) => m.getLinuxEndpoints(p as never),
  MacEndpoint: (m, p) => m.getMacEndpoints(p as never),
  AndroidEndpoint: (m, p) => m.listAndroidEndpoints(p as never),
  IOSEndpoint: (m, p) => m.listIosEndpoints(p as never),
  NetworkEndpoint: (m, p) => m.listNetworkEndpoints(p as never),
  UnmanagedEndpoint: (m, p) => m.listUnmanagedEndpoints(p as never),
};

const GROUP_LIST_ROUTE: Record<
  string,
  (m: EndpointsModule, groupId: string, p: Params) => Promise<unknown>
> = {
  [UNTYPED]: (m, g, p) => m.getEndpointsByLogicalGroup(g, p as never),
  WindowsEndpoint: (m, g, p) => m.getWindowsEndpointsByLogicalGroup(g, p as never),
  LinuxEndpoint: (m, g, p) => m.getLinuxEndpointsByLogicalGroup(g, p as never),
  MacEndpoint: (m, g, p) => m.getMacEndpointsByLogicalGroup(g, p as never),
  AndroidEndpoint: (m, g, p) => m.getAndroidEndpointsByLogicalGroup(g, p as never),
  IOSEndpoint: (m, g, p) => m.getIosEndpointsByLogicalGroup(g, p as never),
  NetworkEndpoint: (m, g, p) => m.getNetworkEndpointsByLogicalGroup(g, p as never),
};

const GET_ROUTE: Record<string, (m: EndpointsModule, id: string) => Promise<unknown>> = {
  [UNTYPED]: (m, id) => m.getEndpoint(id),
  WindowsEndpoint: (m, id) => m.getWindowsEndpoint(id),
  LinuxEndpoint: (m, id) => m.getLinuxEndpoint(id),
  MacEndpoint: (m, id) => m.getMacEndpoint(id),
  AndroidEndpoint: (m, id) => m.getAndroidEndpoint(id),
  IOSEndpoint: (m, id) => m.getIosEndpoint(id),
  NetworkEndpoint: (m, id) => m.getNetworkEndpoint(id),
  UnmanagedEndpoint: (m, id) => m.getUnmanagedEndpoint(id),
};

const DELETE_ROUTE: Record<string, (m: EndpointsModule, id: string) => Promise<void>> = {
  [UNTYPED]: (m, id) => m.deleteEndpoint(id),
  WindowsEndpoint: (m, id) => m.deleteWindowsEndpoint(id),
  LinuxEndpoint: (m, id) => m.deleteLinuxEndpoint(id),
  MacEndpoint: (m, id) => m.deleteMacEndpoint(id),
  AndroidEndpoint: (m, id) => m.deleteAndroidEndpoint(id),
  IOSEndpoint: (m, id) => m.deleteIosEndpoint(id),
  NetworkEndpoint: (m, id) => m.deleteNetworkEndpoint(id),
  UnmanagedEndpoint: (m, id) => m.deleteUnmanagedEndpoint(id),
};

const PATCH_ROUTE: Record<
  string,
  (m: EndpointsModule, id: string, patch: unknown) => Promise<unknown>
> = {
  WindowsEndpoint: (m, id, patch) => m.updateWindowsEndpoint(id, patch as never),
  LinuxEndpoint: (m, id, patch) => m.updateLinuxEndpoint(id, patch as never),
  MacEndpoint: (m, id, patch) => m.updateMacEndpoint(id, patch as never),
  AndroidEndpoint: (m, id, patch) => m.updateAndroidEndpoint(id, patch as never),
  IOSEndpoint: (m, id, patch) => m.updateIosEndpoint(id, patch as never),
  NetworkEndpoint: (m, id, patch) => m.updateNetworkEndpoint(id, patch as never),
};

const ENROLL_ROUTE: Record<
  string,
  (m: EndpointsModule, id: string, body: Params) => Promise<unknown>
> = {
  WindowsEndpoint: (m, id, body) => m.startWindowsEndpointEnrollment(id, body as never),
  MacEndpoint: (m, id, body) => m.startMacEndpointEnrollment(id, body as never),
  AndroidEndpoint: (m, id, body) => m.startAndroidEnrollment(id, body as never),
  IOSEndpoint: (m, id, body) => m.startIosEnrollment(id, body as never),
};

/** The `type` a caller chose, validated against the enum before it gets here. */
function selectedType(args: Args): EndpointTypeSelector {
  const type = args?.type;
  return typeof type === "string" && type !== "" ? (type as EndpointType) : undefined;
}

// ─── Response shaping (TOK-21 / TOK-23 / TOK-25) ────────────────────────────

// The field list moved to @bconnect/mcp-core when bconnect-groups-mcp's
// list_group_members needed the same projection for the same row: two copies of
// this list would drift, and the copy would lose the reasoning attached to
// `logicalGroupId`. Read ENDPOINT_COMPACT_FIELDS's header there before changing
// what is in it.
const shapeEndpointList = createListShaper({ compactFields: ENDPOINT_COMPACT_FIELDS });

/** Project tool arguments onto the query keys a bConnect route declares. */
function queryParams(args: Args, declaredQueryKeys: readonly string[]): Params {
  const params: Params = {};
  for (const key of declaredQueryKeys) {
    const value = args?.[key];
    if (value !== undefined) {
      params[key] = value;
    }
  }
  return params;
}

function endpointListResult(payload: Record<string, unknown>, args: Args): ToolTextResult {
  const shaped = shapeEndpointList(payload, {
    full: args?.detail === true,
    fields: Array.isArray(args?.fields) && args.fields.length > 0 ? (args.fields as string[]) : undefined,
    args,
  });
  return toolTextResult(
    serializeToolResult(
      withConsoleLinkMeta(shaped as Record<string, unknown>, {
        // Both forced from the server's own env vars, never from caller-supplied
        // args: a model must not be able to self-grant console or RemoteDesk
        // links by naming the field.
        includeConsoleLinks: isConsoleLinksEnabled(),
        includeRemoteDesk: isRemoteDeskLinksEnabled(),
      })
    )
  );
}

/** Fetch just the count, echoing the filters — including any path scope. */
async function countOnlyResult(
  fetchPage: (params: Params) => Promise<unknown>,
  args: Args,
  declaredQueryKeys: readonly string[],
  pathScope: Params = {}
): Promise<ToolTextResult> {
  const counted: CountResult = await fetchCount(fetchPage, queryParams(args, declaredQueryKeys));
  const echoed = { ...pathScope, ...(counted.filters ?? {}) };
  return toolTextResult(
    serializeToolResult(Object.keys(echoed).length > 0 ? { ...counted, filters: echoed } : counted)
  );
}

/**
 * Arguments this server interpolates into a URL path.
 *
 * Checked on every call whatever the tool: an argument named `id` never
 * legitimately contains a path separator. `deviceId` is here now — it reaches
 * the path on `get_entra_id_data` (GET /v2.0/EntraIdData/{deviceId}), which it
 * did not before that route was corrected.
 */
const PATH_SEGMENT_PARAMETERS = ["id", "logicalGroupId", "endpointId", "deviceId"] as const;

export interface BConnectCredentials {
  baseUrl?: string;
  username?: string;
  password?: string;
  apiKey?: string;
}

export interface EndpointsServerHandle {
  server: Server;
  /** The memoised client the tools use; `runServer` probes exactly this one. */
  getClient: () => BConnectClient;
}

export function createServer(credentials?: BConnectCredentials): EndpointsServerHandle {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } }
  );

  const catalogue = defineToolCatalogue({ tools: DECLARED.tools, write: DECLARED.write });

  // v1.1 tools are advertised only when BCONNECT_ENABLE_V11=true AND both v1.1
  // credentials are present — the ALLOW_WRITE_OPERATIONS precedent (TOK-20): a
  // deployment that cannot authenticate to v1.1 pays no schema-token cost for
  // tools it could never call. Hiding them is the token optimisation; the gate
  // in the call handler is the control.
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...catalogue.listTools(), ...(v11Enabled() ? v11Catalogue.listTools() : [])],
  }));

  /** Tool name → the parameter names its advertised inputSchema declares. */
  const declaredParameters = catalogue.declaredParameters();
  const v11DeclaredParameters = v11Catalogue.declaredParameters();

  function validateToolArguments(name: string, args: Args): void {
    // v1.1 tools carry their own rules: they are not in the spec-derived
    // DECLARED set, so `DECLARED.validate` knows nothing about them and the
    // early return below would let anything through unchecked.
    const v11Declared = v11DeclaredParameters.get(name);
    if (v11Declared) {
      assertArgumentsAreAnObject(name, args);
      assertNoUnknownParameters(name, args, v11Declared);
      validateOrThrow(args, V11_RULES[name] ?? []);
      return;
    }

    const declared = declaredParameters.get(name);
    if (!declared) {
      return; // unknown or removed name — dispatch answers it, not this function
    }

    assertArgumentsAreAnObject(name, args);

    // 1. An unrecognised key is not harmless: per finding D6 bConnect answers
    //    HTTP 200 and ignores it, returning the FULL unfiltered set, so a
    //    misspelled filter silently produces a confident wrong answer.
    assertNoUnknownParameters(name, args, declared);

    // 2. Types, ranges, enums and GUID formats — derived from the 26R1 spec for
    //    every 1:1 tool, hand-authored for the composites.
    DECLARED.validate(name, args);

    // 3. Defence in depth: every argument that reaches a URL path must be a
    //    single segment. See SEC-0 — `get_endpoint {id: "../../../defensecontrol/
    //    v2.0/BitLocker/WindowsEndpoints"}` returned 23 records from another
    //    bConnect module.
    for (const parameterName of PATH_SEGMENT_PARAMETERS) {
      const value = args?.[parameterName];
      if (value !== undefined && value !== null) {
        assertSafePathSegment(value, parameterName);
      }
    }

    // 4. The collapse's own check: a parameter can be valid for the TOOL and
    //    wrong for the `type` chosen. Runs here, with the other argument
    //    checks and before any client is built, so it costs no request and
    //    arrives as -32602 like every other bad argument.
    validateTypeScopedArguments(name, args);
  }

  /**
   * Refuse a filter or field the chosen `type` does not have.
   *
   * This is the whole safety argument for advertising a union. Steps 1-2 above
   * check a name against the TOOL's schema; a collapsed tool's schema is the
   * union across seven routes, so `type: "AndroidEndpoint", HostName: "..."`
   * passes both and would still be dropped in flight by bConnect, which answers
   * 200 with the unfiltered set (finding D6). The allowed set comes from the
   * same operation index the schema was built from — see endpoint-types.ts.
   */
  function validateTypeScopedArguments(name: string, args: Args): void {
    switch (name) {
      case "list_endpoints":
        assertFiltersDeclared(name, selectedType(args), args, [...SHAPING_KEYS, "type"]);
        return;
      case "list_endpoints_by_logical_group":
        assertFiltersDeclared(
          name,
          selectedType(args),
          args,
          [...SHAPING_KEYS, "type", "logicalGroupId"],
          "listByGroup"
        );
        return;
      case "update_endpoint": {
        const type = args?.type as EndpointType;
        assertTypeSupports(name, "update", type);
        assertFieldsSupported(name, type, args, updatableFieldsFor(type), ["id", "type"]);
        if (buildPatchDocument(args, updatableFieldsFor(type)).length === 0) {
          throw new BareMcpError(
            ErrorCode.InvalidParams,
            `${name}: nothing to update. Supply at least one of: ` +
              `${updatableFieldsFor(type).join(", ")}.`
          );
        }
        return;
      }
      case "delete_endpoint": {
        const type = selectedType(args);
        if (type !== undefined) {
          assertTypeSupports(name, "delete", type);
        }
        return;
      }
      case "start_enrollment": {
        const type = args?.type as EndpointType;
        assertTypeSupports(name, "enroll", type);
        assertFieldsSupported(name, type, args, enrollmentFieldsFor(type), ["id", "type"]);
        return;
      }
      default:
        return;
    }
  }

  // ── Client lifetime (upstream finding R3) ─────────────────────────────────
  // Built lazily on first tool call, held in createServer() scope. A client
  // constructed per call rebuilt everything stateful it owned, which is why
  // rate limiting never limited (B8) and the response cache could not work (B7).
  const getBconnect = createClientProvider<BConnectClient>({
    // Enables the optional per-server credential convention
    // (BCONNECT_API_KEY__ENDPOINTS); with no such variable set this
    // changes nothing. See mcp-core/server-scoped-credentials.ts.
    serverName: "bconnect-endpoints-mcp",
    factory: (config) => new BConnectClient(config),
    credentials,
    onMissingCredentials: () => {
      throw new BareMcpError(
        ErrorCode.InternalError,
        "Either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD are required"
      );
    },
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    validateToolArguments(name, args);

    // The write gate is still the security control; the catalogue only decides
    // what was ADVERTISED. A client holding a name from an older session gets
    // the refusal, not a silent success.
    const denied = catalogue.gateWriteTool(name);
    if (denied) {
      return denied;
    }

    // Same reasoning for v1.1: omitting the tools from tools/list saves tokens,
    // this answers a client that knows a name from another deployment and calls
    // it anyway. It says what to set, not "unknown tool".
    const deniedV11 = gateV11Tool(name, V11_TOOL_NAMES);
    if (deniedV11) {
      return deniedV11;
    }

    try {
      const bconnect = getBconnect();
      const endpoints = bconnect.endpoints;

      switch (name) {
        // ── Composites (LOCAL ADDITION) ─────────────────────────────────────
        case "get_fleet_summary": {
          // includeRemoteDesk is forced from the server's own env var, not from
          // caller-supplied args — a model must not self-grant RemoteDesk links.
          const result = await getFleetSummary(endpoints, {
            ...(args ?? {}),
            includeRemoteDesk: isRemoteDeskLinksEnabled(),
          } as never);
          return toolTextResult(serializeToolResult(result));
        }

        case "get_stale_endpoints": {
          const result = await getStaleEndpoints(endpoints, bconnect.getHttpClient(), {
            ...(args ?? {}),
            includeRemoteDesk: isRemoteDeskLinksEnabled(),
          } as never);
          return toolTextResult(serializeToolResult(result));
        }

        // ── The collapsed read families ─────────────────────────────────────
        // Every `type`-scoped argument check already ran in
        // validateTypeScopedArguments() above, before any client existed.
        case "list_endpoints": {
          const type = selectedType(args);
          const declaredKeys = filtersFor(type);
          const route = LIST_ROUTE[type ?? UNTYPED]!;
          if (isCountOnlyRequest(args)) {
            // UnmanagedEndpoint declares no Page/PageSize, so the probe idiom
            // (PageSize=1 on a page past the end) has nothing to send. Counting
            // it would mean fetching every row, which is what countOnly exists
            // to avoid, so it is refused rather than silently expensive.
            if (!declaredKeys.includes("PageSize")) {
              throw new BareMcpError(
                ErrorCode.InvalidParams,
                `${name}: countOnly needs Page/PageSize and GET ` +
                  `/v2.0/UnmanagedEndpoints declares neither. Call it without countOnly.`
              );
            }
            return await countOnlyResult((p) => route(endpoints, p), args, declaredKeys);
          }
          const result = await route(endpoints, queryParams(args, declaredKeys));
          return endpointListResult(result as Record<string, unknown>, args);
        }

        case "get_endpoint": {
          const type = selectedType(args);
          const result = await GET_ROUTE[type ?? UNTYPED]!(endpoints, args!.id as string);
          return toolTextResult(serializeToolResult(result));
        }

        case "list_endpoints_by_logical_group": {
          const type = selectedType(args);
          const groupId = args!.logicalGroupId as string;
          const declaredKeys = filtersFor(type, "listByGroup");
          const route = GROUP_LIST_ROUTE[type ?? UNTYPED]!;
          if (isCountOnlyRequest(args)) {
            return await countOnlyResult(
              (p) => route(endpoints, groupId, p),
              args,
              declaredKeys,
              { logicalGroupId: groupId }
            );
          }
          const result = await route(endpoints, groupId, queryParams(args, declaredKeys));
          return endpointListResult(result as Record<string, unknown>, args);
        }

        // ── Logical groups ──────────────────────────────────────────────────
        case "list_logical_groups": {
          const keys = ["SearchQuery", "OrderBy", "Name", "Dip", "Domain", "Page", "PageSize"];
          if (isCountOnlyRequest(args)) {
            return await countOnlyResult(
              (p) => endpoints.getLogicalGroups(p as never),
              args,
              keys
            );
          }
          const result = await endpoints.getLogicalGroups(queryParams(args, keys) as never);
          return toolTextResult(serializeToolResult(result));
        }

        case "get_logical_group": {
          const result = await endpoints.getLogicalGroup(args!.id as string);
          return toolTextResult(serializeToolResult(result));
        }

        case "create_logical_group": {
          const result = await endpoints.createLogicalGroup(args! as never);
          return toolTextResult(serializeToolResult(result));
        }

        case "update_logical_group": {
          const patch = buildPatchDocument(args, ["name", "comment"]);
          const result = await endpoints.updateLogicalGroup(args!.id as string, patch as never);
          return toolTextResult(serializeToolResult(result));
        }

        case "delete_logical_group": {
          await endpoints.deleteLogicalGroup(args!.id as string);
          return toolTextResult(`Logical group ${args!.id} deleted successfully`);
        }

        // ── The collapsed write families ────────────────────────────────────
        case "update_endpoint": {
          const type = args!.type as EndpointType;
          const patch = buildPatchDocument(args, updatableFieldsFor(type));
          // ARCH-2: Android and iOS return the UPDATED record ("Returns the updated
          // android endpoint according to the specified properties"). A JSON-Patch
          // that silently no-ops answers 200 with the record unchanged, and that is
          // the only way to tell. Types that genuinely declare no body still return
          // undefined here and keep the sentence below.
          const updatedEndpoint = await PATCH_ROUTE[type]!(endpoints, args!.id as string, patch);
          if (updatedEndpoint !== undefined && updatedEndpoint !== null && updatedEndpoint !== "") {
            return toolTextResult(serializeToolResult(updatedEndpoint));
          }
          return toolTextResult(
            serializeToolResult({
              success: true,
              message: `${type} ${args!.id} updated successfully`,
              patched: patch.map((operation) => operation.path.slice(1)),
            })
          );
        }

        case "delete_endpoint": {
          const type = selectedType(args);
          await DELETE_ROUTE[type ?? UNTYPED]!(endpoints, args!.id as string);
          return toolTextResult(`${type ?? "Endpoint"} ${args!.id} deleted successfully`);
        }

        case "start_enrollment": {
          const type = args!.type as EndpointType;
          const body = queryParams(args, enrollmentFieldsFor(type));
          const result = await ENROLL_ROUTE[type]!(endpoints, args!.id as string, body);
          // ── ARCH-2: this fallback used to be `?? { success: true, … }` ────
          // All four routes declare a 200 body, and until 2026-08-14 two of
          // them (Windows, Mac) were typed `Promise<void>` and so ALWAYS
          // returned undefined — the fallback fired every time and replaced
          // the enrollment artefacts with a sentence asserting success. The
          // Mac body is the QR code and token a technician needs at the
          // machine, so the fabricated line was worse than nothing: it read as
          // confirmation of the thing it had discarded.
          //
          // Both now return their body. An empty body is still possible, and
          // is reported as what it is — accepted, no artefact — rather than as
          // a success the response never asserted.
          if (result === undefined || result === null || result === "") {
            return toolTextResult(
              serializeToolResult({
                accepted: true,
                enrollmentArtifacts: null,
                note:
                  `The API accepted the enrollment request for ${type} ${args!.id} and answered 200 ` +
                  `with NO body, although this route declares one. Do not read this as an enrolled ` +
                  `endpoint — the install command or QR code the operator needs was not supplied. ` +
                  `Re-read the endpoint to confirm its state.`,
              })
            );
          }
          return toolTextResult(serializeToolResult(result));
        }

        // ── Creates, deliberately per platform ──────────────────────────────
        case "create_windows_endpoint": {
          const result = await endpoints.createWindowsEndpoint(args! as never);
          return toolTextResult(serializeToolResult(result));
        }
        case "create_linux_endpoint": {
          const result = await endpoints.createLinuxEndpoint(args! as never);
          return toolTextResult(serializeToolResult(result));
        }
        case "create_mac_endpoint": {
          const result = await endpoints.createMacEndpoint(args! as never);
          return toolTextResult(serializeToolResult(result));
        }
        case "create_android_endpoint": {
          const result = await endpoints.createAndroidEndpoint(args! as never);
          return toolTextResult(serializeToolResult(result));
        }
        case "create_ios_endpoint": {
          const result = await endpoints.createIosEndpoint(args! as never);
          return toolTextResult(serializeToolResult(result));
        }
        case "create_network_endpoint": {
          const result = await endpoints.createNetworkEndpoint(args! as never);
          return toolTextResult(serializeToolResult(result));
        }

        case "trigger_intune_installation": {
          // ── The 200 body is a boolean, and it used to be discarded ────────
          // The route returns `"application/json": boolean`; the module was
          // Promise<void> and the handler answered a constant, so a 200
          // carrying FALSE — accepted, then refused — read as "triggered".
          // That is msw_cleanup's discarded `wasSuccessful` in a different
          // server. The tool's own description opens "WARNING: starts an
          // installation": told it was triggered, an operator stops watching,
          // and a silent false means the agent never arrives while nothing
          // later flags an error, because nothing was ever queued.
          //
          // Three answers, kept apart. Absent is not success.
          const triggered = await endpoints.triggerInstallationViaIntune(args!.id as string);
          if (triggered === true) {
            return toolTextResult(`Intune installation triggered for endpoint ${args!.id}.`);
          }
          if (triggered === false) {
            // States WHAT was returned, not WHY. The spec puts no description
            // on this boolean, and every documented refusal has its own status
            // code (403/404/409/412) — so "the install was refused" would be a
            // mechanism nobody verified. The vendor's only other documented
            // bare-boolean 200, defensecontrol's TriggerUpdateOnClient, means
            // "the client could not be reached", which is a different cause
            // entirely. The operational advice holds under every candidate
            // meaning; the explanation would not.
            return toolTextResult(
              `Intune installation NOT confirmed for endpoint ${args!.id}: the route returned ` +
                `false. bConnect does not document what false means here, so the reason is ` +
                `unknown — it is NOT evidence an installation started. Do not report this ` +
                `endpoint as enrolling; check its state before relying on it.`
            );
          }
          return toolTextResult(
            `Intune installation requested for endpoint ${args!.id}, but this call cannot ` +
              `confirm it: the route declares a boolean result and the response carried no ` +
              `boolean. Treat the outcome as unknown rather than as started, and check the ` +
              `endpoint's state before relying on it.\n${serializeToolResult(triggered)}`
          );
        }

        // ── Maintenance windows ─────────────────────────────────────────────
        case "get_maintenance_window_for_endpoint": {
          const result = await endpoints.getMaintenanceWindowForEndpoint(args!.id as string);
          return toolTextResult(serializeToolResult(result));
        }
        case "create_maintenance_window_for_endpoint": {
          const result = await endpoints.createMaintenanceWindowForEndpoint(
            args!.id as string,
            maintenanceWindowBody(args) as never
          );
          return toolTextResult(serializeToolResult(result));
        }
        case "update_maintenance_window_for_endpoint": {
          // ARCH-2: this returned a sentence beside a 200 whose own description
          // is "The maintenance window was updated as requested and can be seen in
          // the body of the response". The body is the only thing that can show a
          // patch applied something other than what was asked.
          const updatedWindow = await endpoints.updateMaintenanceWindowForEndpoint(
            args!.id as string,
            buildPatchDocument(args, MAINTENANCE_WINDOW_FIELDS) as never
          );
          return toolTextResult(serializeToolResult(updatedWindow));
        }
        case "delete_maintenance_window_for_endpoint": {
          await endpoints.deleteMaintenanceWindowForEndpoint(args!.id as string);
          return toolTextResult(`Maintenance window for endpoint ${args!.id} deleted successfully`);
        }
        case "get_maintenance_window_for_logical_group": {
          const result = await endpoints.getMaintenanceWindowForLogicalGroup(args!.id as string);
          return toolTextResult(serializeToolResult(result));
        }
        case "create_maintenance_window_for_logical_group": {
          const result = await endpoints.createMaintenanceWindowForLogicalGroup(
            args!.id as string,
            maintenanceWindowBody(args) as never
          );
          return toolTextResult(serializeToolResult(result));
        }
        case "update_maintenance_window_for_logical_group": {
          // ARCH-2: this returned a sentence beside a 200 whose own description
          // is "The maintenance window was updated as requested and can be seen in
          // the body of the response". The body is the only thing that can show a
          // patch applied something other than what was asked.
          const updatedWindow = await endpoints.updateMaintenanceWindowForLogicalGroup(
            args!.id as string,
            buildPatchDocument(args, MAINTENANCE_WINDOW_FIELDS) as never
          );
          return toolTextResult(serializeToolResult(updatedWindow));
        }
        case "delete_maintenance_window_for_logical_group": {
          await endpoints.deleteMaintenanceWindowForLogicalGroup(args!.id as string);
          return toolTextResult(
            `Maintenance window for logical group ${args!.id} deleted successfully`
          );
        }

        // ── EntraID ─────────────────────────────────────────────────────────
        case "get_entra_id_data": {
          const result = await endpoints.getEntraIdData(args!.deviceId as string);
          return toolTextResult(serializeToolResult(result));
        }
        case "link_entra_id_data": {
          // Until 2026-08-11 this arm read the undeclared `deviceId` argument
          // (undefined on every call, since the unknown-parameter validator
          // refuses it), so the three advertised entraId* fields were read by
          // nothing; the module then posted a body key
          // EntraIdEndpointDataForCreation rejects. Rule I pins the reads —
          // and matches source TEXT, which is why this comment does not spell
          // the old expression — entra-link-body.test.ts pins the wire.
          const result = await endpoints.linkEntraIdData(args!.endpointId as string, {
            entraIdDeviceId: args!.entraIdDeviceId as string | undefined,
            entraIdTenantId: args!.entraIdTenantId as string | undefined,
            entraIdUserId: args!.entraIdUserId as string | undefined,
          });
          return toolTextResult(serializeToolResult(result));
        }
        case "unlink_entra_id_data": {
          await endpoints.unlinkEntraIdData(args!.endpointId as string);
          return toolTextResult(`EntraID data unlinked from endpoint ${args!.endpointId} successfully`);
        }

        // ── bConnect v1.1 custom inventory scans (gated above) ──────────────
        //
        // The client is rebuilt per call on purpose: it holds no state, and
        // reading the environment at request time means a credential change is
        // honoured the same way the memoised v2.0 provider honours one. It
        // borrows ONLY baseURL + httpsAgent from the v2.0 client — never the
        // API key, which v1.1 rejects anyway.
        //
        // Every call passes EndpointId. That is not a convenience: v1.1 serves
        // no paging parameters on these controllers (PageSize/Page/Skip/Top/
        // OrderBy/SearchQuery all answer 400), so unfiltered means 325 KB for
        // registry and 11.9 MB for WMI. The filter is the only bound there is.

        case "get_endpoint_registry_inventory": {
          const v11 = new InventoryScansV11Client({ httpClient: bconnect.getHttpClient() });
          const endpointId = args!.endpointId as string;
          const raw = await v11.request(REGISTRY_CONTROLLER, { EndpointId: endpointId });
          return toolTextResult(
            serializeToolResult(shapeRegistryScan(raw, { endpointId, detail: args?.detail === true }))
          );
        }

        case "get_endpoint_file_inventory": {
          const v11 = new InventoryScansV11Client({ httpClient: bconnect.getHttpClient() });
          const endpointId = args!.endpointId as string;
          const raw = await v11.request(FILE_CONTROLLER, { EndpointId: endpointId });
          return toolTextResult(
            serializeToolResult(shapeFileScan(raw, { endpointId, detail: args?.detail === true }))
          );
        }

        case "get_endpoint_wmi_inventory": {
          const v11 = new InventoryScansV11Client({ httpClient: bconnect.getHttpClient() });
          const endpointId = args!.endpointId as string;
          const className = args?.className as string | undefined;
          const detail = args?.detail === true;

          // `detail` without a class would mean the whole 585 KB scan. Refused
          // here rather than served: the two-step shape is the bound, and a
          // bound a caller can switch off is not one. -32602 like any other
          // bad argument combination, and it names the fix.
          if (detail && !className) {
            throw new BareMcpError(
              ErrorCode.InvalidParams,
              "get_endpoint_wmi_inventory: detail:true requires className. Without a class " +
                "this would return the endpoint's entire WMI scan, which measured 585 KB on a " +
                "single machine. Call without arguments to get the class index, then pass the " +
                "className you want."
            );
          }

          const raw = await v11.request(WMI_CONTROLLER, { EndpointId: endpointId });
          const shaped = className
            ? shapeWmiClass(raw, { endpointId, className, detail })
            : shapeWmiIndex(raw, { endpointId });
          return toolTextResult(serializeToolResult(shaped));
        }

        default: {
          // Product decision 4 — a removed tool explains itself rather than
          // falling through to a bare "Unknown tool".
          const reason = removalReason(name);
          throw new BareMcpError(
            ErrorCode.MethodNotFound,
            reason ?? `Unknown tool: ${name}`
          );
        }
      }
    } catch (error: unknown) {
      // INT-53 — one error channel: 400/403/404/429 come back as readable
      // isError results, faults stay protocol errors.
      return handleToolError(error);
    }
  });

  return { server, getClient: getBconnect };
}

/**
 * Argument checks shared by the v2.0 and v1.1 validation paths.
 *
 * Extracted rather than restated: the two paths differ in where their declared
 * parameter set comes from (the 26R1 spec vs a hand-authored v1.1 catalogue)
 * and in nothing else. A second copy of the D6 wording would be one more
 * hand-maintained parallel thing to drift.
 */
function assertArgumentsAreAnObject(name: string, args: Args): void {
  if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args))) {
    throw new BareMcpError(ErrorCode.InvalidParams, `${name}: arguments must be an object.`);
  }
}

// The unknown-key check itself now lives in mcp-core as
// `assertNoUnknownParameters`. This server grew it first, locally; the Phase 4
// data-reliability audit then measured that eleven of thirteen servers had
// never grown it and were forwarding misspelt filters to a bConnect that
// answers 200 and ignores them. Promoting the local copy was the fix, and
// leaving a second copy here would have recreated the drift that caused it.

/** The two fields `MaintenanceWindowForCreation` declares. */
const MAINTENANCE_WINDOW_FIELDS = ["maintenanceWindowDefinitionType", "intervals"] as const;

function maintenanceWindowBody(args: Args): Params {
  return queryParams(args, MAINTENANCE_WINDOW_FIELDS);
}

// ─── Bootstrap ──────────────────────────────────────────────────────────────
//
// OPT-32 — `main()` is gone. Every behavioural decision it used to make
// (BCONNECT_BASE_URL required with no placeholder default, exit 1 rather than a
// stack trace on missing credentials, one client for both the startup probe and
// dispatch, one TLS resolver, MCP_PORT parsed rather than coerced, the
// loopback-bind refusal) now lives once in mcp-core's `runServer`. `express` is
// injected because mcp-core does not depend on it.

if (shouldAutoStart()) {
  void runServer({
    name: SERVER_NAME,
    createServer,
    clientFactory: (config) => new BConnectClient(config),
    http: { express: express as never },
  }).catch((error: unknown) => {
    // This server had NO catch at all, so a rejection here became an unhandled
    // rejection and Node printed the raw error — the same util.inspect walk
    // over `error.config.headers` that SEC-2 closed in the client, landing on
    // a stdio host's stderr and from there into its log files.
    // `describeConnectionFailure` emits a preformatted string and never
    // inspects the object.
    console.error(`Fatal error: ${describeConnectionFailure(error)}`);
    process.exit(1);
  });
}
