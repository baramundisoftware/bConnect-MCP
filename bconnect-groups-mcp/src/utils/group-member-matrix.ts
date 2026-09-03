/**
 * The {container kind} x {member type} matrix, as data (finding TOK-3 / TOK-22)
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * This server advertised ONE operation — "list the members of type T held by
 * container C" — as 33 separate MCP tools:
 *
 *   {logical, static, dynamic, universalDynamic, adUser}
 *     x {endpoints, android, ios, linux, mac, network, windows, industrial,
 *        childGroups}
 *
 * Measured on the built `createServer`: 33 tools / 29,764 bytes of tools/list
 * for 3,189 bytes of actual description text. The remaining ~26.5 KB was 33
 * repetitions of the same pagination and filter schema — paid by every client
 * at session start, before a single question is asked. The old index.ts even
 * proved the point: it composed all 33 schemas from four shared spread
 * fragments, so the schemas were already known to be structurally identical.
 *
 * ── Why the matrix has to be data, not a naming convention ──────────────────
 * The matrix is SPARSE, and two of its holes are load-bearing:
 *
 *   - `dynamic` serves only `endpoints` and `windows`. The other seven routes
 *     do not exist upstream.
 *   - `childGroups` exists only under `logical`. There is no
 *     StaticGroups/{id}/LogicalGroups route.
 *   - `adUser` serves neither `network` nor `childGroups`.
 *
 * 5 x 8 = 40 name-able combinations; exactly 30 are real. (It was 33 of 45
 * until 26R1 removed the IndustrialEndpoints API — see REMOVED_MEMBER_TYPES
 * below, which keeps the reason answerable.) A collapsed tool that inferred the
 * route from its two enums would answer the other ten with a 404 from the API —
 * or worse, with a plausible-looking URL that happens to resolve. `GROUP_MEMBER_ROUTES` and `AD_USER_ROUTES` below are the whole truth
 * about which combinations exist, and `supportedMemberTypes()` is what turns a
 * bad pair into a precise, self-correcting error message.
 *
 * ── Why the filter sets have to be data too (D6) ────────────────────────────
 * The 33 tools did not declare the same filters, and that difference is not
 * cosmetic. bConnect answers HTTP 200 and SILENTLY IGNORES a query parameter it
 * does not declare (finding D6) — so a collapsed tool that advertised the union
 * of all filters and forwarded whatever it was given would let
 * `list_group_members{memberType:"android", Domain:"CORP"}` return every
 * Android device in the group while looking like a filtered answer. That is the
 * exact failure shape of D14a, which made a 20-endpoint group report zero.
 *
 * So the union is advertised once (that is the token saving) and
 * `filtersFor()` is enforced at call time (that is what keeps the saving
 * honest). A filter the chosen route does not declare is refused with -32602
 * naming the ones it does declare, instead of being dropped by the API.
 *
 * Filter names, types and applicability are taken from the generated operations
 * in `../generated/endpoints-types.ts`, not invented here — the same rule the
 * pre-collapse code followed.
 */

import type { GroupsModule } from "../modules/groups.js";

// ── Vocabulary ───────────────────────────────────────────────────────────────

/** Kinds of container that hold endpoints. `adUser` is its own tool. */
export const GROUP_KINDS = ["logical", "static", "dynamic", "universalDynamic"] as const;
export type GroupKind = (typeof GROUP_KINDS)[number];

/** Member types a group can be asked for. */
export const MEMBER_TYPES = [
  "endpoints",
  "android",
  "ios",
  "linux",
  "mac",
  "network",
  "windows",
  "childGroups",
] as const;
export type MemberType = (typeof MEMBER_TYPES)[number];

/**
 * Member types this server used to serve and no longer can, with the reason.
 *
 * 26R1 removed IndustrialEndpoints from bConnect entirely — 8 operations and 3
 * schemas, including the three group-scoped list routes this matrix held. The
 * product is 26R1-only, so those routes 404 on every supported bMS.
 *
 * Kept as data rather than deleted outright for the same reason the vendor kept
 * `Deprecated_IndustrialEndpoint` in the endpoint-type enum: callers written
 * against v26.1.7 on an older bMS exist, and `memberType: "industrial"` from one
 * of them should be answered with what happened, not with a bare "supported
 * values are ..." list that reads as a typo. `explainRemovedMemberType()` is
 * consulted before the generic unsupported-combination message.
 */
export const REMOVED_MEMBER_TYPES: Readonly<Record<string, string>> = {
  industrial:
    "memberType 'industrial' was removed because bConnect 26R1 removed the " +
    "IndustrialEndpoints API (GET /v2.0/{LogicalGroups,StaticGroups," +
    "UniversalDynamicGroups}/{id}/IndustrialEndpoints no longer exists). It was " +
    "not renamed or moved, and this server requires 26R1 or later, so there is " +
    "no replacement to call.",
} as const;

/** The removal reason for a member type 26R1 deleted, or undefined. */
export function explainRemovedMemberType(value: unknown): string | undefined {
  return typeof value === "string" ? REMOVED_MEMBER_TYPES[value] : undefined;
}

/** Endpoint types an AD user can be asked for. No network, no industrial. */
export const AD_USER_ENDPOINT_TYPES = [
  "endpoints",
  "android",
  "ios",
  "linux",
  "mac",
  "windows",
] as const;
export type AdUserEndpointType = (typeof AD_USER_ENDPOINT_TYPES)[number];

/**
 * What both tools query when the caller names no member type.
 *
 * "Every endpoint in this group, whatever it runs" is the question these tools
 * are asked most, and it is the only member type every container kind serves —
 * so it is the one default that can never produce an unsupported combination.
 */
export const DEFAULT_MEMBER_TYPE = "endpoints";

/** Every filter either tool can advertise. The union, declared once. */
export const FILTER_NAMES = [
  "DisplayName",
  "HostName",
  "Domain",
  "EntraIdDeviceId",
  "Name",
  "Dip",
] as const;
export type FilterName = (typeof FILTER_NAMES)[number];

/** Methods of `GroupsModule` — checked by the compiler, not by spelling. */
type GroupsMethod = {
  [K in keyof GroupsModule]: GroupsModule[K] extends (id: string, params?: never) => unknown
    ? K
    : never;
}[keyof GroupsModule];

// ── The matrix ───────────────────────────────────────────────────────────────

/**
 * (groupKind, memberType) -> the `GroupsModule` method that serves it.
 *
 * Sparse on purpose: a missing key means the route does not exist upstream, and
 * that is the same statement the pre-collapse code made by simply not
 * registering a tool for it.
 */
export const GROUP_MEMBER_ROUTES: {
  readonly [K in GroupKind]: Partial<Record<MemberType, GroupsMethod>>;
} = {
  logical: {
    endpoints: "getEndpointsByLogicalGroup",
    android: "getAndroidEndpointsByLogicalGroup",
    ios: "getIosEndpointsByLogicalGroup",
    linux: "getLinuxEndpointsByLogicalGroup",
    mac: "getMacEndpointsByLogicalGroup",
    network: "getNetworkEndpointsByLogicalGroup",
    windows: "getWindowsEndpointsByLogicalGroup",
    childGroups: "getLogicalGroupsByLogicalGroup",
  },
  static: {
    endpoints: "getEndpointsByStaticGroup",
    android: "getAndroidEndpointsByStaticGroup",
    ios: "getIosEndpointsByStaticGroup",
    linux: "getLinuxEndpointsByStaticGroup",
    mac: "getMacEndpointsByStaticGroup",
    network: "getNetworkEndpointsByStaticGroup",
    windows: "getWindowsEndpointsByStaticGroup",
  },
  dynamic: {
    endpoints: "getEndpointsByDynamicGroup",
    windows: "getWindowsEndpointsByDynamicGroup",
  },
  universalDynamic: {
    endpoints: "getEndpointsByUDG",
    android: "getAndroidEndpointsByUDG",
    ios: "getIosEndpointsByUDG",
    linux: "getLinuxEndpointsByUDG",
    mac: "getMacEndpointsByUDG",
    network: "getNetworkEndpointsByUDG",
    windows: "getWindowsEndpointsByUDG",
  },
} as const;

/** endpointType -> the `GroupsModule` method that serves it, for AD users. */
export const AD_USER_ROUTES: Partial<Record<AdUserEndpointType, GroupsMethod>> = {
  endpoints: "getEndpointsByADUser",
  android: "getAndroidEndpointsByADUser",
  ios: "getIosEndpointsByADUser",
  linux: "getLinuxEndpointsByADUser",
  mac: "getMacEndpointsByADUser",
  windows: "getWindowsEndpointsByADUser",
} as const;

/**
 * Which value filters each member type's route actually declares.
 *
 * Read as: what `filtersFor()` will let through. Anything else is refused
 * before the request is built — see the header on D6.
 */
export const MEMBER_TYPE_FILTERS: Readonly<Record<MemberType, readonly FilterName[]>> = {
  endpoints: ["DisplayName", "HostName"],
  android: ["DisplayName"],
  ios: ["DisplayName"],
  linux: ["DisplayName", "HostName"],
  mac: ["DisplayName", "HostName"],
  network: ["DisplayName", "HostName"],
  windows: ["DisplayName", "HostName", "Domain", "EntraIdDeviceId"],
  childGroups: ["Name", "Dip", "Domain"],
} as const;

/**
 * `includeSubfolders` is declared by the LogicalGroups routes only.
 *
 * The other three group kinds have no hierarchy to traverse, and per D6 sending
 * the flag anyway would be accepted with a 200 and ignored — which reads as
 * "this group really has no sub-groups" rather than "this parameter does not
 * apply here".
 */
export const SUBFOLDER_GROUP_KINDS: readonly GroupKind[] = ["logical"];

// ── Lookups ──────────────────────────────────────────────────────────────────

export function isGroupKind(value: unknown): value is GroupKind {
  return typeof value === "string" && (GROUP_KINDS as readonly string[]).includes(value);
}

export function isMemberType(value: unknown): value is MemberType {
  return typeof value === "string" && (MEMBER_TYPES as readonly string[]).includes(value);
}

export function isAdUserEndpointType(value: unknown): value is AdUserEndpointType {
  return (
    typeof value === "string" && (AD_USER_ENDPOINT_TYPES as readonly string[]).includes(value)
  );
}

/** Member types this group kind serves, in declaration order. */
export function supportedMemberTypes(kind: GroupKind): MemberType[] {
  return MEMBER_TYPES.filter((type) => GROUP_MEMBER_ROUTES[kind][type] !== undefined);
}

/** The module method for a pair, or `undefined` when the route does not exist. */
export function groupMemberMethod(
  kind: GroupKind,
  memberType: MemberType
): GroupsMethod | undefined {
  return GROUP_MEMBER_ROUTES[kind][memberType];
}

/** The module method for an AD-user endpoint type. */
export function adUserMethod(endpointType: AdUserEndpointType): GroupsMethod | undefined {
  return AD_USER_ROUTES[endpointType];
}

/** Filters the chosen member type's route declares. */
export function filtersFor(memberType: MemberType): readonly FilterName[] {
  return MEMBER_TYPE_FILTERS[memberType];
}

/** Does this group kind's route declare `includeSubfolders`? */
export function supportsSubfolders(kind: GroupKind): boolean {
  return SUBFOLDER_GROUP_KINDS.includes(kind);
}

/**
 * How many concrete operations the collapse covers.
 *
 * Asserted by the tests against the 33 tools that used to be advertised MINUS
 * the three IndustrialEndpoints routes 26R1 deleted, so a route silently
 * dropped during the collapse fails loudly rather than becoming an unreachable
 * capability nobody notices.
 */
export function routeCount(): number {
  const group = GROUP_KINDS.reduce((n, kind) => n + supportedMemberTypes(kind).length, 0);
  const adUser = AD_USER_ENDPOINT_TYPES.filter((t) => AD_USER_ROUTES[t] !== undefined).length;
  return group + adUser;
}
