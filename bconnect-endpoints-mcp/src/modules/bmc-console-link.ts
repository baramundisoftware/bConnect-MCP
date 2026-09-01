/**
 * bMC console link builder — LOCAL ADDITION (not upstream).
 *
 * Turns an endpoint record into a `bMC:///` URI that opens the baramundi
 * Management Center (bMC) desktop console directly on that client, per the
 * vendor's documented command-line / URI surface.
 *
 * ── OFF BY DEFAULT (BMC_CONSOLE_LINKS) ──────────────────────────────────────
 * Two facts decide this. First, the scheme is derived from the vendor's HTML
 * documentation but has never been round-tripped through bMC's own protocol
 * handler — see the ENCODING note on `buildConsoleLink` for the specific open
 * question. Second, a `bMC:///` URI is only actionable on a machine with the
 * bMC desktop console installed, and an MCP client is as likely to be a browser
 * tab or a workflow runner on a server as it is to be an admin workstation. A
 * link that may not resolve, attached to every row of the most-called tools in
 * the server, is a confident-looking affordance the caller cannot check — so it
 * is emitted only when an operator who CAN check it opts in, exactly the gate
 * RemoteDesk links already sit behind.
 *
 * ── TOK-23: the link is a template now, not a string on every row ───────────
 * This module used to append a 131-165 character `bMC:///` URI to EVERY row of
 * EVERY list response, plus a 340-character explanatory note on every single
 * call. Measured live: ~2.9 KB of links + 0.35 KB of note on an 18 KB
 * `list_endpoints` page (~15-18%), and — worse — ~4.4 KB of a ~9.8 KB
 * `get_fleet_summary`, the tool whose entire purpose is being the compact
 * digest. Roughly half of the "compact" digest was repeated URL boilerplate.
 *
 * The URI is mechanically derivable from two fields the row already carries
 * (`id` and `type`), so to an LLM consumer the per-row string was pure
 * repetition. `consoleLinkMeta()` emits the template, the `type -> objectType`
 * table and ONE fully-expanded example, once per response — everything needed
 * to reconstruct any row's link, at a fixed ~600 bytes instead of a per-row
 * cost that grows with the page.
 *
 * The expanded `example` is not decoration: the first thing anyone does with
 * this block is copy one link out of a tool result and paste it at the console,
 * and a template alone would make that a substitution exercise.
 *
 * WRITTEN TO BE PROMOTABLE to `packages/mcp-core` later so every server can
 * share it (compliance, defensecontrol, jobs and software all return
 * endpoint-shaped rows too) — but NOT promoted yet, deliberately: other
 * agents are building against mcp-core concurrently in this working tree,
 * and a broken shared package would break them mid-flight. This file has no
 * dependency on anything endpoints-mcp-specific beyond the four fields an
 * endpoint-shaped record carries everywhere in this API (`id`, `type`,
 * `displayName`, `hostName`), so the eventual move should be a plain copy.
 *
 * ISSUES NO WRITES. Every function here is pure string-building; nothing in
 * this file makes a network call.
 */

// ── Navigation links (open the record) ──────────────────────────────────────

/** The three ways the vendor docs allow a client to be identified. */
export type NavigationCriteriaType = "Id" | "Name" | "Hostname";

/**
 * DEFAULT. Whether bConnect's endpoint `id` GUID is the same identifier bMC's
 * own `navigationCriteria=.../navigationCriteriaType=Id` resolves against could
 * NOT be confirmed without launching the bMC GUI, which this project was told
 * not to do. `Id` is still the chosen default because (a) it is guaranteed
 * unique across the whole estate, so it never needs `navigationObjectType` to
 * disambiguate, unlike `Name` (display names are operator-editable free text
 * and not guaranteed unique) or `Hostname` (not guaranteed unique either, and
 * null for whole classes of row — a never-checked-in client, a
 * network-discovered device known only by MAC); and (b) bConnect is documented
 * as a REST surface over the same server-side object model the console itself
 * reads, which is circumstantial but real evidence `id` is the console's own
 * primary key, not a REST-only synthetic one. `Hostname` is the fallback if a
 * click-test shows `Id` does not resolve.
 */
export const DEFAULT_CRITERIA_TYPE: NavigationCriteriaType = "Id";

/**
 * Minimal shape needed to build a link. Matches the fields every
 * endpoint-shaped schema in this server's generated types carries —
 * `Endpoint`, `WindowsEndpoint`, `LinuxEndpoint`, `MacEndpoint`,
 * `AndroidEndpoint`, `IosEndpoint`, `NetworkEndpoint`, `IndustrialEndpoint`
 * (see src/generated/endpoints-types.ts) — so any of those can be passed in
 * directly without adapting.
 */
export interface ConsoleLinkableEndpoint {
  id?: string | null;
  displayName?: string | null;
  hostName?: string | null;
  /**
   * The API's `EndpointType` enum value verbatim, e.g. "WindowsEndpoint",
   * "IOSEndpoint" (note the API's all-caps "IOS" — bMC's documented
   * `navigationObjectType` value is "IosEndpoint", different casing; see
   * NAVIGATION_OBJECT_TYPE_MAP below).
   */
  type?: string | null;
}

/**
 * bMC's documented `navigationObjectType` values, keyed by the API's
 * `EndpointType` enum. Only Windows / Mac / iOS / Android (+ WP8, which this
 * API has no equivalent of) are documented by the vendor. This estate also
 * has Linux, Network and Industrial endpoints, which have no documented
 * value — entries are deliberately absent for them, and
 * `mapNavigationObjectType` returns `undefined`, so the parameter is simply
 * omitted (legitimate per the vendor docs, which mark it optional) rather
 * than guessed at. Consequence: a link for one of those types relies on
 * `navigationCriteria` alone being unique, which `Id` always is — one more
 * reason `Id` is the default rather than `Name`/`Hostname`.
 */
export const NAVIGATION_OBJECT_TYPE_MAP: Readonly<Record<string, string>> = Object.freeze({
  WindowsEndpoint: "WindowsEndpoint",
  MacEndpoint: "MacEndpoint",
  AndroidEndpoint: "AndroidEndpoint",
  IOSEndpoint: "IosEndpoint",
});

/** Maps an API `EndpointType` value to bMC's `navigationObjectType`, or
 * `undefined` if the platform has no documented value (Linux, Network,
 * Industrial, or an unrecognised/absent type). */
export function mapNavigationObjectType(apiType?: string | null): string | undefined {
  if (!apiType) {return undefined;}
  return NAVIGATION_OBJECT_TYPE_MAP[apiType];
}

export interface ConsoleLinkOptions {
  /** Defaults to DEFAULT_CRITERIA_TYPE ("Id"). */
  criteriaType?: NavigationCriteriaType;
}

/**
 * Build a `bMC:///navigationCriteria=...` URI for one endpoint, or `null`
 * if the record doesn't carry the field the chosen criteriaType needs
 * (e.g. `Hostname` requested but `hostName` is null — a never-checked-in
 * client or a network-discovered device with only a MAC address).
 *
 * ENCODING — the open question this whole module is gated on.
 * The vendor's own HTML example writes a literal space
 * between parameters:
 *   `bMC:///navigationCriteria=<Client> /navigationCriteriaType=<Type>`
 * A raw space is not valid inside a URI; any href containing one gets
 * percent-encoded to `%20` by the consuming user agent (browser, Markdown
 * renderer, etc.) before the request ever leaves the page. This function
 * does that encoding itself, up front, rather than emitting a URI a
 * renderer would have to fix — but whether bMC's own protocol handler
 * decodes `%20` back to a space before splitting the string into
 * pseudo-arguments has NOT been confirmed end to end. To settle it: expand one
 * link from a real row, paste it into the Run dialog on a machine with bMC
 * installed, and check the console opens on that client rather than on nothing.
 * If it does not, try `criteriaType: "Hostname"` before changing the encoding.
 */
export function buildConsoleLink(
  endpoint: ConsoleLinkableEndpoint,
  opts: ConsoleLinkOptions = {}
): string | null {
  const criteriaType = opts.criteriaType ?? DEFAULT_CRITERIA_TYPE;

  const rawValue =
    criteriaType === "Id"
      ? endpoint.id
      : criteriaType === "Hostname"
        ? endpoint.hostName
        : endpoint.displayName;

  if (!rawValue) {return null;}

  const params = [`navigationCriteria=${encodeURIComponent(rawValue)}`, `navigationCriteriaType=${criteriaType}`];

  const objectType = mapNavigationObjectType(endpoint.type);
  if (objectType) {params.push(`navigationObjectType=${objectType}`);}

  // First param has no leading slash — the "///" already supplies the path's
  // leading "/", matching the vendor's literal HTML example. Every
  // subsequent param is joined with "%20/" (encoded space + slash), the
  // encoded form of the vendor doc's literal " /" separator.
  const [first, ...rest] = params;
  const path = first + rest.map((p) => `%20/${p}`).join("");
  return `bMC:///${path}`;
}

// ── RemoteDesk links (take over the live machine) ───────────────────────────
//
// Gated OFF by default. RemoteDesk is a different risk class from a
// navigation link: a navigationCriteria link opens a record for a human to
// look at; a RemoteDesk link starts a live AnyDesk remote-control session
// against a running endpoint, and per the vendor docs requires the "remote
// control" environment right on the device or its organizational unit — read
// rights alone (what every other tool in this server needs) do not grant it.
// Mirrors this project's existing write-gate convention
// (`ALLOW_WRITE_OPERATIONS` / `ALLOWED_WRITE_TOOLS` in this file's own
// index.ts and in bconnect-jobs-mcp/src/index.ts): off unless a specific env
// var is set to exactly "true", read fresh on every call rather than cached,
// so a test can flip it per-case.

const REMOTEDESK_ENV_VAR = "BMC_REMOTEDESK_LINKS";

/** True only if BMC_REMOTEDESK_LINKS=true is set in this process's environment. */
export function isRemoteDeskLinksEnabled(): boolean {
  return process.env[REMOTEDESK_ENV_VAR] === "true";
}

// ── The outer gate on the whole block (see the OFF BY DEFAULT note above) ────
//
// Read fresh on every call rather than cached at import, same as the RemoteDesk
// flag, so a test can flip it per-case. RemoteDesk sits INSIDE this one: its
// templates live in the `consoleLinks` object, so turning console links off
// turns them off too. That nesting is deliberate — the stricter gate winning is
// the right failure direction for a live remote-control link.

const CONSOLE_LINKS_ENV_VAR = "BMC_CONSOLE_LINKS";

/** True only if BMC_CONSOLE_LINKS=true is set in this process's environment. */
export function isConsoleLinksEnabled(): boolean {
  return process.env[CONSOLE_LINKS_ENV_VAR] === "true";
}

/**
 * Build a `bmc:///remotedesk=...` URI, or `null` if the record has neither a
 * hostname nor a display name.
 *
 * UNVERIFIED, more so than the navigation link: the vendor docs give
 * `/RemoteDesk=<Client>` a single, untyped `<Client>` parameter with no
 * `navigationCriteriaType`-style sibling, so which identifier it accepts is
 * not documented at all. Hostname is used here (falling back to
 * displayName) because it is the identifier the rest of bMC's client-facing
 * surface treats as "the" name for a device, but this is a guess, not a
 * confirmed mapping — flag this prominently if a human tests it.
 *
 * Callers MUST gate calls to this function behind `isRemoteDeskLinksEnabled()`
 * (or an equivalent explicit opt-in) themselves — this function does not
 * check the flag, so it stays usable in tests without env-var juggling.
 */
export function buildRemoteDeskLink(endpoint: ConsoleLinkableEndpoint): string | null {
  const value = endpoint.hostName ?? endpoint.displayName;
  if (!value) {return null;}
  return `bmc:///remotedesk=${encodeURIComponent(value)}`;
}

// ── Response-level link metadata (TOK-23) ───────────────────────────────────

export interface ConsoleLinkMetaOptions extends ConsoleLinkOptions {
  /** Defaults to `isRemoteDeskLinksEnabled()` if omitted. */
  includeRemoteDesk?: boolean;
  /** Defaults to `isConsoleLinksEnabled()` if omitted. Exposed so tests do not
   *  need env-var juggling to exercise both branches. */
  includeConsoleLinks?: boolean;
}

/**
 * The navigation-link template. `{id}` is a row's `id`; the trailing
 * `navigationObjectType` segment is dropped when the row's `type` has no
 * documented bMC value (see NAVIGATION_OBJECT_TYPE_MAP).
 */
export const CONSOLE_LINK_TEMPLATE =
  "bMC:///navigationCriteria={id}%20/navigationCriteriaType=Id%20/navigationObjectType={objectType}";

/** RemoteDesk template. `{hostName}` falls back to the row's displayName. */
export const REMOTEDESK_LINK_TEMPLATE = "bmc:///remotedesk={hostName}";

/**
 * What a response says about console links, emitted ONCE instead of a URI on
 * every row.
 *
 * Lossless by construction: `template` + `objectType` + a row's `id`/`type`
 * reproduce exactly the string `buildConsoleLink()` would have written on that
 * row — which is asserted in `__tests__/bmc-console-link.test.ts` rather than
 * asserted by this comment.
 */
export interface ConsoleLinkMeta {
  template: string;
  /** API `EndpointType` -> bMC `navigationObjectType`. Absent type = omit that segment. */
  objectType: Readonly<Record<string, string>>;
  /** One fully-expanded link, so a human can copy-paste without substituting. */
  example?: string;
  remoteDeskTemplate?: string;
  remoteDeskExample?: string;
  remoteDeskLinksEnabled?: true;
  note: string;
}

/**
 * Build the once-per-response link metadata.
 *
 * @param sample a row to expand `example` from; omit when the page is empty
 */
export function consoleLinkMeta(
  sample?: ConsoleLinkableEndpoint | null,
  includeRemoteDesk: boolean = isRemoteDeskLinksEnabled()
): ConsoleLinkMeta {
  const example = sample ? buildConsoleLink(sample) : null;
  const remoteDeskExample = sample && includeRemoteDesk ? buildRemoteDeskLink(sample) : null;

  return {
    template: CONSOLE_LINK_TEMPLATE,
    objectType: NAVIGATION_OBJECT_TYPE_MAP,
    ...(example ? { example } : {}),
    ...(includeRemoteDesk
      ? {
          remoteDeskTemplate: REMOTEDESK_LINK_TEMPLATE,
          ...(remoteDeskExample ? { remoteDeskExample } : {}),
          remoteDeskLinksEnabled: true as const,
        }
      : {}),
    // No pointer to any document: whatever ships alongside this server, the
    // reader of a tool result cannot be assumed to have it. Everything needed
    // to use — and to distrust — the link is stated here.
    note:
      `Expand {id} from a row's id; drop the navigationObjectType segment when the row type is ` +
      `not in objectType. Opens the endpoint in the baramundi Management Center, and only works ` +
      `where that console is installed. Emitted because ${CONSOLE_LINKS_ENV_VAR}=true; the URI ` +
      `form (navigationCriteriaType=${DEFAULT_CRITERIA_TYPE}) follows baramundi's documentation ` +
      `but has not been confirmed against a live console, so treat a link that opens on nothing ` +
      `as a bad link rather than a missing endpoint.` +
      (includeRemoteDesk
        ? ` ${REMOTEDESK_ENV_VAR}=true is also set, so remoteDeskTemplate is live — it starts an ` +
          `AnyDesk remote-control session, a different risk class from a console view.`
        : ""),
  };
}

/**
 * Add `consoleLinks` to a paginated `{ data: [...], ... }` response — when the
 * feature is enabled. With it off the result is returned unchanged, so nothing
 * in the response hints at a console affordance that may not resolve.
 *
 * Rows are handed back untouched — this is the whole TOK-23 change: the reader
 * gets one template rather than one string per row, and nothing else about the
 * payload moves. Never mutates the input.
 */
export function withConsoleLinkMeta<T extends Record<string, unknown>>(
  result: T,
  opts: ConsoleLinkMetaOptions = {}
): T & { consoleLinks?: ConsoleLinkMeta } {
  const obj = (result ?? {}) as { data?: ConsoleLinkableEndpoint[] | null } & T;
  if (!(opts.includeConsoleLinks ?? isConsoleLinksEnabled())) {return { ...obj };}
  const includeRemoteDesk = opts.includeRemoteDesk ?? isRemoteDeskLinksEnabled();
  const sample = Array.isArray(obj.data) ? obj.data[0] : undefined;
  return { ...obj, consoleLinks: consoleLinkMeta(sample, includeRemoteDesk) };
}
