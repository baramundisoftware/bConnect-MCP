/**
 * A removed tool explains itself (product decision 4).
 *
 * This release removes 34 tool names from this server: five because 26R1 deleted
 * the bConnect API behind them, twenty-eight because they collapsed into a tool
 * that takes the platform as an argument, and one because it was a second name
 * for a route that already had one.
 *
 * Falling through to `Unknown tool: get_windows_endpoint` would be true and
 * useless. Someone upgrading a pinned v26.1.7 client, or a model working from a
 * cached catalogue, gets a sentence naming the reason and the replacement
 * instead. That is a `Record<string, string>` consulted immediately before the
 * unknown-tool arm — deliberately not a framework, and deliberately not a
 * silent alias: the call still fails, because answering it would hide the
 * change rather than explain it.
 *
 * The code is still MethodNotFound. Nothing here makes a removed name callable.
 */

/** Tool name → why it is gone and what to call instead. */
export const REMOVED_TOOLS: Readonly<Record<string, string>> = Object.freeze({
  // ── 26R1 deleted the API (product decision 1) ────────────────────────────
  //
  // bConnect_Endpoints.json 26R1 declares no /v2.0/IndustrialEndpoints path at
  // all; 25R2 declared eight operations there. These five tools would have
  // 404ed on every call against a 26R1 bMS. The `Deprecated_IndustrialEndpoint`
  // value survives in the generated types on the vendor's own instruction —
  // historical records still carry it — but there is no route left to call.
  list_industrial_endpoints: INDUSTRIAL(),
  get_industrial_endpoint: INDUSTRIAL(),
  create_industrial_endpoint: INDUSTRIAL(),
  update_industrial_endpoint: INDUSTRIAL(),
  delete_industrial_endpoint: INDUSTRIAL(),

  // ── Collapsed into list_endpoints ────────────────────────────────────────
  list_windows_endpoints: COLLAPSED("list_endpoints", "WindowsEndpoint"),
  list_linux_endpoints: COLLAPSED("list_endpoints", "LinuxEndpoint"),
  list_mac_endpoints: COLLAPSED("list_endpoints", "MacEndpoint"),
  list_android_endpoints: COLLAPSED("list_endpoints", "AndroidEndpoint"),
  list_ios_endpoints: COLLAPSED("list_endpoints", "IOSEndpoint"),
  list_network_endpoints: COLLAPSED("list_endpoints", "NetworkEndpoint"),
  list_unmanaged_endpoints: COLLAPSED("list_endpoints", "UnmanagedEndpoint"),

  // ── Collapsed into get_endpoint ──────────────────────────────────────────
  get_windows_endpoint: COLLAPSED("get_endpoint", "WindowsEndpoint"),
  get_linux_endpoint: COLLAPSED("get_endpoint", "LinuxEndpoint"),
  get_mac_endpoint: COLLAPSED("get_endpoint", "MacEndpoint"),
  get_android_endpoint: COLLAPSED("get_endpoint", "AndroidEndpoint"),
  get_ios_endpoint: COLLAPSED("get_endpoint", "IOSEndpoint"),
  get_network_endpoint: COLLAPSED("get_endpoint", "NetworkEndpoint"),
  get_unmanaged_endpoint: COLLAPSED("get_endpoint", "UnmanagedEndpoint"),

  // ── Collapsed into delete_endpoint ───────────────────────────────────────
  delete_windows_endpoint: COLLAPSED("delete_endpoint", "WindowsEndpoint"),
  delete_linux_endpoint: COLLAPSED("delete_endpoint", "LinuxEndpoint"),
  delete_mac_endpoint: COLLAPSED("delete_endpoint", "MacEndpoint"),
  delete_android_endpoint: COLLAPSED("delete_endpoint", "AndroidEndpoint"),
  delete_ios_endpoint: COLLAPSED("delete_endpoint", "IOSEndpoint"),
  delete_network_endpoint: COLLAPSED("delete_endpoint", "NetworkEndpoint"),
  delete_unmanaged_endpoint: COLLAPSED("delete_endpoint", "UnmanagedEndpoint"),

  // ── Collapsed into update_endpoint ───────────────────────────────────────
  update_windows_endpoint: COLLAPSED("update_endpoint", "WindowsEndpoint"),
  update_linux_endpoint: COLLAPSED("update_endpoint", "LinuxEndpoint"),
  update_mac_endpoint: COLLAPSED("update_endpoint", "MacEndpoint"),
  update_android_endpoint: COLLAPSED("update_endpoint", "AndroidEndpoint"),
  update_ios_endpoint: COLLAPSED("update_endpoint", "IOSEndpoint"),
  update_network_endpoint:
    "update_network_endpoint was collapsed into update_endpoint with " +
    "type='NetworkEndpoint'. Its `updateData` JSON-Patch blob is gone: the " +
    "collapsed tool takes named fields (displayName, comment, hostName) and " +
    "builds the patch document itself.",

  // ── Collapsed into start_enrollment ──────────────────────────────────────
  start_windows_enrollment: ENROLLMENT("start_windows_enrollment", "WindowsEndpoint"),
  start_mac_enrollment: ENROLLMENT("start_mac_enrollment", "MacEndpoint"),
  start_android_enrollment: COLLAPSED("start_enrollment", "AndroidEndpoint"),
  start_ios_enrollment: COLLAPSED("start_enrollment", "IOSEndpoint"),

  // ── One route, one tool ──────────────────────────────────────────────────
  search_endpoints:
    "search_endpoints was removed: it issued the same GET /v2.0/Endpoints as " +
    "list_endpoints, with a lower-cased spelling of the same paging " +
    "(query/pageSize/page) and no countOnly. Call " +
    "list_endpoints({ SearchQuery: '...' }) instead — same route, same search, " +
    "and the compact projection and countOnly come with it.",

  // TOK-26, kept from the previous revision so the explanation does not
  // regress to a bare MethodNotFound now that this map exists.
  list_group_endpoints:
    "list_group_endpoints was removed: it issued the byte-identical request as " +
    "list_endpoints_by_logical_group while advertising fewer parameters. Call " +
    "list_endpoints_by_logical_group instead.",

  list_windows_endpoints_by_logical_group:
    "list_windows_endpoints_by_logical_group was collapsed into " +
    "list_endpoints_by_logical_group with type='WindowsEndpoint'. The " +
    "collapsed tool also reaches the Linux, Mac, Android, iOS and Network " +
    "group routes, which had no tool at all before.",
});

function INDUSTRIAL(): string {
  return (
    "Industrial endpoint tools were removed in this release because bConnect " +
    "26R1 removed the underlying API: /v2.0/IndustrialEndpoints and its eight " +
    "operations are not in the 26R1 specification, so the tool was removed " +
    "rather than renamed or moved. There is no replacement. If you are running " +
    "a bMS older than 26R1, this MCP server refuses to start against it — see " +
    "the 26R1 requirement in the README."
  );
}

function COLLAPSED(replacement: string, type: string): string {
  return (
    `This tool was collapsed into ${replacement}. Call ` +
    `${replacement}({ type: '${type}', ... }) — same route, same parameters. ` +
    "The platform moved from the tool name to a validated enum argument."
  );
}

function ENROLLMENT(name: string, type: string): string {
  return (
    `${name} was collapsed into start_enrollment. Call ` +
    `start_enrollment({ type: '${type}', ... }). Note the field rename: it ` +
    "advertised `emailRecipient`, which no bConnect enrollment schema declares " +
    "— the API field is `enrollmentMailAddress`, so the email was never sent."
  );
}

/** The explanation for a removed name, or `undefined` if it was never a tool. */
export function removalReason(toolName: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(REMOVED_TOOLS, toolName)
    ? REMOVED_TOOLS[toolName]
    : undefined;
}
