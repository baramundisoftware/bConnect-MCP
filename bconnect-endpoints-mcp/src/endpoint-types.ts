/**
 * The endpoint-type table — the whole of the family collapse, in one place.
 *
 * ── What collapsed, and why it is lossless ──────────────────────────────────
 * This server used to advertise six near-identical tools per operation, one per
 * platform:
 *
 *   list_windows_endpoints  GET /v2.0/WindowsEndpoints
 *   list_linux_endpoints    GET /v2.0/LinuxEndpoints
 *   …                       …
 *
 * Measured over the route table (not the tool names — see the maintenance-window
 * trap below), every family was a 1:1 mapping from tool to route with an
 * IDENTICAL parameter shape apart from the route segment. The platform is
 * therefore not information the tool NAME has to carry: it is a value, and the
 * bConnect API already has a name for that value — `EndpointType`, the field
 * every endpoint row returns as `type`. Encoding it as an enum argument is a
 * lossless re-spelling of the same information, and a validated one: a bad type
 * is a -32602 naming the seven legal values, where a bad tool NAME was a
 * MethodNotFound naming nothing.
 *
 * The enum values are the API's own spelling — `WindowsEndpoint`, not `Windows`
 * — deliberately. `list_endpoints` returns `type: "WindowsEndpoint"` on every
 * row (it is one of the ten fields the compact projection keeps, because
 * modules/bmc-console-link.ts needs it), so a model that has just read a row can
 * feed that value straight back into `get_endpoint`. A prettier `Windows` would
 * have made the round trip fail.
 *
 * ── The trap this table exists to avoid ─────────────────────────────────────
 * `get_maintenance_window_for_endpoint` matches `*_endpoint` and takes `{id}` —
 * and hits `/v2.0/Endpoints/{id}/MaintenanceWindow`, a different resource. Any
 * collapse driven by tool NAMES would have swallowed it. This table is driven by
 * operation ids, and the maintenance-window tools are not in it.
 *
 * ── D6: the per-type filter sets are read off the spec, not retyped ─────────
 * bConnect answers HTTP 200 and silently DROPS a query parameter it does not
 * know (finding D6). So a collapsed `list_endpoints` that advertised the union
 * of every platform's filters would tell a model that `Domain` filters Linux
 * endpoints — and bConnect would answer 200 with the full unfiltered set. That
 * is a confident wrong answer, which is worse than eight tools.
 *
 * Two things prevent it, and neither is prose:
 *   1. `filtersFor(type)` reads the parameter names off the OPERATION INDEX, so
 *      the allowed set for `AndroidEndpoint` is exactly what
 *      `GET /v2.0/AndroidEndpoints` declares in the 26R1 spec. It cannot drift.
 *   2. dispatch calls `assertFiltersDeclared()` BEFORE the request, so a filter
 *      the chosen type's route does not declare is a loud -32602 rather than a
 *      silently-ignored parameter.
 *
 * `GET /v2.0/UnmanagedEndpoints` is the sharpest case: 26R1 declares it with NO
 * query parameters at all, and the pre-collapse `list_unmanaged_endpoints`
 * advertised SearchQuery, OrderBy, Page and PageSize — four parameters that
 * route has never had. That tool was returning page 0 of everything whatever the
 * caller asked for. The guard now says so.
 */

import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BareMcpError, requireOperation } from "@bconnect/mcp-core";
import { ENDPOINTS_OPERATIONS } from "./generated/endpoints-operation-index.js";

/**
 * The values `type` may take. `EndpointType` in the bConnect schema, minus
 * `Deprecated_IndustrialEndpoint` — 26R1 removed the eight IndustrialEndpoints
 * operations, so there is no route to select. The enum VALUE survives in
 * src/generated/endpoints-types.ts on the vendor's own instruction ("Removed in
 * 26.1. Keep to avoid gaps in enum values."), because historical records still
 * deserialise with it; what is gone here is the ability to ASK for one.
 *
 * `UnmanagedEndpoint` is not an `EndpointType` value — unmanaged devices are a
 * separate 26R1 resource — but it is a route selector of exactly the same shape,
 * and keeping it out would have left `list_unmanaged_endpoints` as the one
 * surviving member of a collapsed family.
 */
export const ENDPOINT_TYPES = [
  "WindowsEndpoint",
  "LinuxEndpoint",
  "MacEndpoint",
  "AndroidEndpoint",
  "IOSEndpoint",
  "NetworkEndpoint",
  "UnmanagedEndpoint",
] as const;

export type EndpointType = (typeof ENDPOINT_TYPES)[number];

/** `undefined` selects the type-agnostic `/v2.0/Endpoints` routes. */
export type EndpointTypeSelector = EndpointType | undefined;

/** The operation each `type` selects, per family. `""` is the untyped route. */
interface TypeRoutes {
  /** `GET /v2.0/<X>` — absent for no type is impossible; every entry has one. */
  list: string;
  /**
   * `GET /v2.0/LogicalGroups/{logicalGroupId}/<X>`.
   *
   * Absent for `UnmanagedEndpoint` — 26R1 declares no group-scoped route for
   * unmanaged devices, which is a fact about the API and not an omission here.
   * The five typed group routes other than Windows had no tool at all before
   * this collapse: `list_windows_endpoints_by_logical_group` existed and its
   * Linux/Mac/Android/iOS/Network siblings did not.
   */
  listByGroup?: string;
  /** `GET /v2.0/<X>/{id}`. */
  get: string;
  /** `DELETE /v2.0/<X>/{id}`; absent where the API declares no delete. */
  delete?: string;
  /** `PATCH /v2.0/<X>/{id}`; absent for the untyped and unmanaged routes. */
  update?: string;
  /** `POST /v2.0/<X>/{id}/StartEnrollment`. */
  enroll?: string;
}

const UNTYPED = "" as const;

const ROUTES: Record<EndpointType | typeof UNTYPED, TypeRoutes> = {
  [UNTYPED]: {
    list: "GetEndpoints",
    listByGroup: "GetEndpointsByLogicalGroupId",
    get: "GetEndpoint",
    delete: "DeleteEndpoint",
  },
  WindowsEndpoint: {
    list: "GetWindowsEndpoints",
    listByGroup: "GetWindowsEndpointsByLogicalGroupId",
    get: "GetWindowsEndpoint",
    delete: "DeleteWindowsEndpoint",
    update: "UpdateWindowsEndpoint",
    enroll: "StartWindowsEndpointEnrollment",
  },
  LinuxEndpoint: {
    list: "GetLinuxEndpoints",
    listByGroup: "GetLinuxEndpointsByLogicalGroupId",
    get: "GetLinuxEndpoint",
    delete: "DeleteLinuxEndpoint",
    update: "UpdateLinuxEndpoint",
  },
  MacEndpoint: {
    list: "GetMacEndpoints",
    listByGroup: "GetMacEndpointsByLogicalGroupId",
    get: "GetMacEndpoint",
    delete: "DeleteMacEndpoint",
    update: "UpdateMacEndpoint",
    enroll: "StartMacEndpointEnrollment",
  },
  AndroidEndpoint: {
    list: "GetAndroidEndpoints",
    listByGroup: "GetAndroidEndpointsByLogicalGroupId",
    get: "GetAndroidEndpoint",
    delete: "DeleteAndroidEndpoint",
    update: "UpdateAndroidEndpoint",
    enroll: "StartAndroidEndpointEnrollment",
  },
  IOSEndpoint: {
    list: "GetIOSEndpoints",
    listByGroup: "GetIOSEndpointsByLogicalGroupId",
    get: "GetIOSEndpoint",
    delete: "DeleteIOSEndpoint",
    update: "UpdateIOSEndpoint",
    enroll: "StartIosEndpointEnrollment",
  },
  NetworkEndpoint: {
    list: "GetNetworkEndpoints",
    listByGroup: "GetNetworkEndpointsByLogicalGroupId",
    get: "GetNetworkEndpoint",
    delete: "DeleteNetworkEndpoint",
    update: "UpdateNetworkEndpoint",
  },
  UnmanagedEndpoint: {
    list: "GetAllUnmanagedEndpoints",
    get: "GetUnmanagedEndpoint",
    delete: "DeleteUnmanagedEndpoint",
  },
};

function routesFor(type: EndpointTypeSelector): TypeRoutes {
  return ROUTES[type ?? UNTYPED];
}

/** The two collapsed read families that select a route by `type`. */
export type ListFamily = "list" | "listByGroup";

/** The route a collapsed tool will call, for the test that proves reachability. */
export function routeFor(
  family: "list" | "listByGroup" | "get" | "delete" | "update" | "enroll",
  type: EndpointTypeSelector
): { method: string; path: string } | undefined {
  const operationId = routesFor(type)[family];
  if (operationId === undefined) {
    return undefined;
  }
  const operation = requireOperation(ENDPOINTS_OPERATIONS, operationId);
  return { method: operation.method, path: operation.path };
}

/** Types the group-scoped list reaches — everything with a group route. */
export function groupListableTypes(): EndpointType[] {
  return ENDPOINT_TYPES.filter((type) => ROUTES[type].listByGroup !== undefined);
}

// ── List filters, read off the spec ──────────────────────────────────────────

/**
 * The query parameters `GET /v2.0/<X>` declares for this type — nothing more.
 *
 * Read from the operation index rather than retyped, so this cannot say
 * `HostName` about a route that has no `HostName`. That precise mistake is what
 * D6 turns into a wrong answer that looks right.
 */
export function filtersFor(
  type: EndpointTypeSelector,
  family: ListFamily = "list"
): readonly string[] {
  const operationId = routesFor(type)[family];
  if (operationId === undefined) {
    return [];
  }
  return requireOperation(ENDPOINTS_OPERATIONS, operationId).parameters.map(
    (parameter) => parameter.name
  );
}

/**
 * Every filter any type declares, in a stable order.
 *
 * This is what the collapsed list tool advertises. Advertising the union is only
 * safe because `assertFiltersDeclared()` refuses the ones that do not apply to
 * the chosen type; without that guard this would be the survey's rejected design.
 */
export function allListFilters(family: ListFamily = "list"): readonly string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const type of [undefined, ...ENDPOINT_TYPES] as EndpointTypeSelector[]) {
    for (const name of filtersFor(type, family)) {
      if (!seen.has(name)) {
        seen.add(name);
        ordered.push(name);
      }
    }
  }
  return ordered;
}

/** Types whose list route declares `name` — for the "why not" half of an error. */
function typesDeclaring(name: string, family: ListFamily): string[] {
  return ([undefined, ...ENDPOINT_TYPES] as EndpointTypeSelector[])
    .filter((type) => filtersFor(type, family).includes(name))
    .map((type) => type ?? "(no type)");
}

/**
 * Refuse a filter the chosen type's route does not declare.
 *
 * The alternative is bConnect's own behaviour: HTTP 200, the parameter dropped,
 * the full unfiltered set returned as though it had been filtered. An error a
 * model can read and correct is strictly better than a page of rows that answers
 * a different question than the one asked.
 */
export function assertFiltersDeclared(
  toolName: string,
  type: EndpointTypeSelector,
  args: Record<string, unknown> | undefined,
  clientSideKeys: readonly string[],
  family: ListFamily = "list"
): void {
  const route = routeFor(family, type);
  if (route === undefined) {
    throw new BareMcpError(
      ErrorCode.InvalidParams,
      `${toolName}: bConnect 26R1 declares no group-scoped list route for ` +
        `type=${type}. Supported: ${groupListableTypes().join(", ")}, or omit type.`
    );
  }

  const declared = new Set(filtersFor(type, family));
  const clientSide = new Set(clientSideKeys);
  const offending = Object.keys(args ?? {}).filter(
    (key) => !declared.has(key) && !clientSide.has(key)
  );
  if (offending.length === 0) {
    return;
  }

  const label = type ?? "(no type)";
  const accepted = [...declared].join(", ") || "no filters at all";
  const alternatives = offending
    .map((key) => {
      const types = typesDeclaring(key, family);
      return types.length > 0 ? `${key} (declared by ${types.join(", ")})` : key;
    })
    .join("; ");

  throw new BareMcpError(
    ErrorCode.InvalidParams,
    `${toolName}: type=${label} does not accept ${alternatives}. ` +
      `GET ${route.path} declares ${accepted}. ` +
      "bConnect answers HTTP 200 and silently drops a query parameter it does not " +
      "know, so sending it would have returned the full unfiltered set as though " +
      "it had been filtered."
  );
}

// ── Write families ───────────────────────────────────────────────────────────

/**
 * Fields `update_endpoint` may patch, per type.
 *
 * Derived from the vendor's own JSON-Patch example on each PATCH route, which is
 * the only statement the spec makes about which paths a patch document may carry
 * (the body schema is `JsonPatchDocument` — an array, so `defineTools()` cannot
 * derive it and says so via `OperationBody.isArray`).
 *
 * This is where the two `updateData: object` blob tools went. The survey made
 * that the precondition for collapsing this family: with five of seven types
 * taking named fields and two taking an opaque JSON-Patch document, a model
 * could not tell which shape the enum value wanted. Now they all take fields.
 */
const UPDATABLE_FIELDS: Record<EndpointType, readonly string[]> = {
  WindowsEndpoint: ["displayName", "logicalGroupId", "comment", "hostName"],
  LinuxEndpoint: ["displayName", "logicalGroupId", "comment", "hostName"],
  MacEndpoint: ["displayName", "logicalGroupId", "comment"],
  // The 26R1 PATCH /v2.0/AndroidEndpoints/{id} request body describes its example
  // as containing "all modifiable Android endpoint properties" and lists exactly:
  // DisplayName, LogicalGroupId, Comment, Category, Owner, RegisteredUser. The
  // first three were already here; the last three were never exposed, so the suite
  // could not set them at all.
  //
  // `serialNumber` is deliberately NOT here, and the reason is a trap worth
  // recording. It is absent from every PATCH definition in all 12 live 26R1 specs
  // (checked, not assumed), but it DOES appear in the Swagger UI on this
  // operation's page — inside the 200 response example, because a successful patch
  // returns the whole endpoint record. Swagger renders that response block
  // immediately below the request-body block and the two look alike, so reading it
  // as a writable field is an easy mistake; it cost us a round trip here.
  //
  // Beware more generally: the OpenAPI schema marks nothing `readOnly`, so the
  // response model is no guide at all to what may be written. The request-body
  // example is the only statement of writability the spec makes.
  AndroidEndpoint: ["displayName", "logicalGroupId", "comment", "category", "owner", "registeredUser"],
  IOSEndpoint: ["displayName", "logicalGroupId", "comment"],
  // No logicalGroupId: the vendor's patch example for NetworkEndpoints does not
  // carry one, and inventing a path the spec does not document is how the
  // `emailRecipient` defect below happened.
  //
  // The rest of this list is RESTORED. The 2026-08-02 family collapse dropped
  // `updateData`, an untyped blob that was itself a defect, and took the
  // legitimate half with it — leaving a network endpoint editable only in the
  // three fields it shares with every other type, which is not what the API
  // offers. Every field below appears in the 26R1 PATCH
  // /v2.0/NetworkEndpoints/{id} request-body example, which (per the note
  // above) is the only statement of writability the spec makes.
  //
  // `sshConfigurationPort` is deliberately NOT `sshConfiguration`. The vendor
  // example patches the SUB-PATH `/sshConfiguration/Port` and never replaces
  // the object whole, so exposing a whole-object replace would be inventing
  // exactly the kind of path that produced `emailRecipient`. See
  // NESTED_PATCH_PATHS below.
  NetworkEndpoint: [
    "displayName",
    "comment",
    "hostName",
    "primaryIP",
    "primaryMAC",
    "registeredUser",
    "webInterfaceUrl",
    "sshConfigurationPort",
    "snmpConfiguration",
  ],
  // 26R1 declares no PATCH for unmanaged devices; `assertTypeSupports` refuses
  // the type before this is read, and the empty list keeps the two in step.
  UnmanagedEndpoint: [],
};

/** Every field `update_endpoint` advertises, in a stable order. */
export function allUpdatableFields(): readonly string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const type of ENDPOINT_TYPES) {
    for (const field of UPDATABLE_FIELDS[type] ?? []) {
      if (!seen.has(field)) {
        seen.add(field);
        ordered.push(field);
      }
    }
  }
  return ordered;
}

export function updatableFieldsFor(type: EndpointType): readonly string[] {
  return UPDATABLE_FIELDS[type] ?? [];
}

/** Types whose PATCH route this server can drive. */
export function updatableTypes(): EndpointType[] {
  return ENDPOINT_TYPES.filter((type) => ROUTES[type].update !== undefined);
}

/** Types whose `StartEnrollment` route exists. */
export function enrollableTypes(): EndpointType[] {
  return ENDPOINT_TYPES.filter((type) => ROUTES[type].enroll !== undefined);
}

/** Types with a DELETE route. */
export function deletableTypes(): EndpointType[] {
  return ENDPOINT_TYPES.filter((type) => ROUTES[type].delete !== undefined);
}

/**
 * Enrollment body fields, per type.
 *
 * ── A defect the collapse uncovered ────────────────────────────────────────
 * `start_windows_enrollment` and `start_mac_enrollment` advertised
 * `emailRecipient`. No schema in bConnect_Endpoints.json has a field of that
 * name: `WindowsEnrollmentRequest`, `MacEnrollmentRequest`,
 * `AndroidEnrollmentRequest` and `IosEnrollmentRequest` all declare
 * `enrollmentMailAddress` and `emailLanguageId`. Both tools also posted their
 * whole argument object as the body, so bConnect received `{ id, emailRecipient }`
 * and ignored both — an operator who asked for enrollment instructions by email
 * got a success and no email.
 *
 * The four tools are one tool now and the field is spelled the way the API
 * spells it, once.
 */
const ENROLLMENT_FIELDS: Record<EndpointType, readonly string[]> = {
  WindowsEndpoint: ["enrollmentMailAddress", "emailLanguageId"],
  MacEndpoint: ["enrollmentMailAddress", "emailLanguageId"],
  AndroidEndpoint: [
    "enrollmentMailAddress",
    "emailLanguageId",
    "forceMobileDataOnEnrollment",
    "includeWifiInQrCode",
  ],
  IOSEndpoint: ["enrollmentMailAddress", "emailLanguageId"],
  LinuxEndpoint: [],
  NetworkEndpoint: [],
  UnmanagedEndpoint: [],
};

export function enrollmentFieldsFor(type: EndpointType): readonly string[] {
  return ENROLLMENT_FIELDS[type] ?? [];
}

/** Every enrollment field the collapsed tool advertises. */
export function allEnrollmentFields(): readonly string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const type of enrollableTypes()) {
    for (const field of ENROLLMENT_FIELDS[type]) {
      if (!seen.has(field)) {
        seen.add(field);
        ordered.push(field);
      }
    }
  }
  return ordered;
}

/**
 * Refuse a `type` the family does not support, and a field that type does not
 * take. Same argument as `assertFiltersDeclared`: a body field bConnect does not
 * know is dropped without complaint.
 */
export function assertTypeSupports(
  toolName: string,
  family: "get" | "delete" | "update" | "enroll",
  type: EndpointType
): void {
  if (routesFor(type)[family] !== undefined) {
    return;
  }
  const supported =
    family === "update"
      ? updatableTypes()
      : family === "enroll"
        ? enrollableTypes()
        : deletableTypes();
  throw new BareMcpError(
    ErrorCode.InvalidParams,
    `${toolName}: bConnect 26R1 declares no ${family} route for type=${type}. ` +
      `Supported: ${supported.join(", ")}.`
  );
}

export function assertFieldsSupported(
  toolName: string,
  type: EndpointType,
  args: Record<string, unknown> | undefined,
  allowed: readonly string[],
  alwaysAllowed: readonly string[]
): void {
  const permitted = new Set([...allowed, ...alwaysAllowed]);
  const offending = Object.keys(args ?? {}).filter((key) => !permitted.has(key));
  if (offending.length === 0) {
    return;
  }
  throw new BareMcpError(
    ErrorCode.InvalidParams,
    `${toolName}: type=${type} does not accept ${offending.join(", ")}. ` +
      `It accepts: ${[...allowed].join(", ") || "no fields"}. ` +
      "bConnect ignores a body field it does not declare, so the call would have " +
      "reported success while changing nothing."
  );
}

/**
 * Build a JSON-Patch document from the named fields a caller supplied.
 *
 * Every PATCH route in this module takes `application/json-patch+json`. Three of
 * the seven per-type update tools this replaces posted their raw argument object
 * instead — `updateWindowsEndpoint(id, args)` sent `{ id, displayName, comment }`
 * where the route expects `[{ op, path, value }]` — so Windows, Linux and Mac
 * updates could not have succeeded. Built once, correctly, here.
 */
/**
 * Argument name -> the JSON Patch path it writes, where the two differ.
 *
 * One entry, and it exists because the vendor's PATCH example for a network
 * endpoint patches `/sshConfiguration/Port` — a sub-path — and never replaces
 * `sshConfiguration` as a whole object. Exposing a whole-object replace would
 * be documenting a path the spec does not, which is precisely how the
 * `emailRecipient` defect happened. A flat argument name that maps to the
 * nested path the spec DOES show keeps the tool surface simple and the wire
 * format exactly what the vendor demonstrated.
 */
const NESTED_PATCH_PATHS: Readonly<Record<string, string>> = Object.freeze({
  sshConfigurationPort: "/sshConfiguration/Port",
});

export function buildPatchDocument(
  args: Record<string, unknown> | undefined,
  fields: readonly string[]
): Array<{ op: "replace"; path: string; value: unknown }> {
  const operations: Array<{ op: "replace"; path: string; value: unknown }> = [];
  for (const field of fields) {
    const value = args?.[field];
    if (value !== undefined) {
      operations.push({
        op: "replace",
        path: NESTED_PATCH_PATHS[field] ?? `/${field}`,
        value,
      });
    }
  }
  return operations;
}
