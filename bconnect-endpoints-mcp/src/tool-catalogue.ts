/**
 * The tool surface, declared once.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 * Until this release a tool here was written out four times: the `tools/list`
 * entry, the CallTool case arm, the module method and the validation rule. This
 * file holds the first and the fourth in one declaration — `defineTools()` in
 * packages/mcp-core derives both from the same OpenAPI operation — and index.ts
 * holds the second.
 *
 * Two kinds of entry:
 *
 *   `op: "GetLogicalGroup"`  a 1:1 wrapper. Parameters, types, required set,
 *                            enums and GUID formats come from the 26R1 spec via
 *                            src/generated/endpoints-operation-index.ts. If the
 *                            spec and the declaration disagree, construction
 *                            throws — in a test, not in a catalogue an operator
 *                            pays for on every session.
 *
 *   `composite({...})`       hand-authored, passed through by identity. Three
 *                            populations need it: the two aggregate tools
 *                            (get_fleet_summary, get_stale_endpoints, which
 *                            answer no single route), the five COLLAPSED
 *                            families (which answer one route per `type` value
 *                            — see endpoint-types.ts), and the JSON-Patch
 *                            writes (whose body schema is an array, so there
 *                            are no fields to derive).
 *
 * Descriptions are never derived, here or anywhere: the vendor's summary for
 * `CreateLogicalGroup` is "Creates a folder according to the specified
 * properties", and a tool description has to say what the tool is FOR.
 */

import {
  composite,
  defineTools,
  objectSchema,
  detailProperty,
  fieldsProperty,
  countOnlyProperty,
  includeSubfoldersProperty,
  guidProperty,
  exactMatchFilter,
  PAGE_DESCRIPTION,
  PAGE_SIZE_DESCRIPTION,
  SEARCH_QUERY_DESCRIPTION,
  ORDER_BY_DESCRIPTION,
  CommonRules,
  type DeclaredTools,
  type SchemaProperties,
  type SchemaProperty,
  type ValidationRule,
} from "@bconnect/mcp-core";

import { ENDPOINTS_OPERATIONS } from "./generated/endpoints-operation-index.js";
import {
  ENDPOINT_TYPES,
  allEnrollmentFields,
  allListFilters,
  allUpdatableFields,
  deletableTypes,
  enrollableTypes,
  groupListableTypes,
  updatableTypes,
  type ListFamily,
} from "./endpoint-types.js";

// ── Shared vocabulary ────────────────────────────────────────────────────────

/** `detail` + `fields` + `countOnly` — the endpoint-shaped list vocabulary. */
const SHAPING: SchemaProperties = { ...detailProperty, ...fieldsProperty, ...countOnlyProperty };

/** Client-side keys the route never sees; `queryParams()` projects them away. */
export const SHAPING_KEYS = ["detail", "fields", "countOnly"] as const;

const SHAPING_RULES: ValidationRule[] = [
  { name: "detail", required: false, type: "boolean" },
  { name: "fields", required: false, type: "array" },
  { name: "countOnly", required: false, type: "boolean" },
];

/** Wording for a filter the collapsed list tools advertise as a union. */
const FILTER_PROPERTY: Record<string, SchemaProperties> = {
  OrderBy: { OrderBy: { type: "string", description: ORDER_BY_DESCRIPTION } },
  SearchQuery: { SearchQuery: { type: "string", description: SEARCH_QUERY_DESCRIPTION } },
  Page: { Page: { type: "number", description: PAGE_DESCRIPTION } },
  PageSize: { PageSize: { type: "number", description: PAGE_SIZE_DESCRIPTION } },
  DisplayName: exactMatchFilter("DisplayName"),
  HostName: exactMatchFilter("HostName"),
  Domain: exactMatchFilter("Domain"),
  EntraIdDeviceId: exactMatchFilter("EntraIdDeviceId"),
  Name: exactMatchFilter("Name"),
  Dip: exactMatchFilter("Dip"),
  includeSubfolders: includeSubfoldersProperty,
};

const FILTER_RULE: Record<string, () => ValidationRule> = {
  OrderBy: CommonRules.orderBy,
  SearchQuery: CommonRules.searchQuery,
  Page: CommonRules.page,
  PageSize: CommonRules.pageSize,
  DisplayName: () => ({ name: "DisplayName", required: false, type: "string", maxLength: 255 }),
  HostName: () => ({ name: "HostName", required: false, type: "string", maxLength: 255 }),
  Domain: () => ({ name: "Domain", required: false, type: "string", maxLength: 255 }),
  EntraIdDeviceId: () => ({ name: "EntraIdDeviceId", required: false, type: "string", maxLength: 255 }),
  includeSubfolders: () => ({ name: "includeSubfolders", required: false, type: "boolean" }),
};

function filterProperties(family: ListFamily): SchemaProperties {
  const properties: SchemaProperties = {};
  for (const name of allListFilters(family)) {
    if (name === "logicalGroupId") {
      continue; // a path parameter, declared separately
    }
    const fragment = FILTER_PROPERTY[name];
    if (fragment === undefined) {
      throw new Error(
        `tool-catalogue: no wording for list filter "${name}". The 26R1 spec ` +
          "grew a parameter this file has never described; add it to " +
          "FILTER_PROPERTY and FILTER_RULE rather than advertising it unnamed."
      );
    }
    Object.assign(properties, fragment);
  }
  return properties;
}

function filterRules(family: ListFamily): ValidationRule[] {
  return allListFilters(family)
    .filter((name) => name !== "logicalGroupId")
    .map((name) => FILTER_RULE[name]!());
}

/** The `type` selector. Values are the API's own `EndpointType` spelling. */
function typeProperty(values: readonly string[], note: string): SchemaProperties {
  return {
    type: {
      type: "string",
      description: note,
      enum: [...values],
    } as SchemaProperty,
  };
}

function typeRule(values: readonly string[], required: boolean): ValidationRule {
  return { name: "type", required, type: "string", enum: [...values] };
}

const TYPE_NOTE_OPTIONAL =
  "Platform, as each row reports it in `type`. Omit for all platforms.";
const TYPE_NOTE_REQUIRED = "Platform, as each row reports it in `type`.";

// ── The catalogue ────────────────────────────────────────────────────────────

export const DECLARED: DeclaredTools = defineTools(ENDPOINTS_OPERATIONS, {
  // ── Composite analysis (LOCAL ADDITION) ────────────────────────────────────
  get_fleet_summary: composite({
    description:
      "Aggregate health of the whole estate in one compact response: totals, check-in distribution, " +
      "breakdown by OS / type / agent version / logical group, endpoints needing attention, agent-version " +
      "outliers, and reported errors. Prefer this over list_endpoints for questions like 'how is the fleet " +
      "doing', 'what needs attention', 'how many machines are stale' or 'what OS mix do we have' — it " +
      "returns a digest instead of every record. Read-only.",
    inputSchema: objectSchema({
      staleAfterDays: {
        type: "number",
        description: "Days without a check-in before an endpoint counts as stale (default: 30).",
      },
      maxOutliers: {
        type: "number",
        description: "How many entries to list under needsAttention, agent outliers and errors (default: 10).",
      },
      includeGroups: {
        type: "boolean",
        description: "Include the per-logical-group breakdown (default: true).",
      },
    }),
    rules: [
      { name: "staleAfterDays", required: false, type: "number", min: 0 },
      { name: "maxOutliers", required: false, type: "number", min: 0 },
      { name: "includeGroups", required: false, type: "boolean" },
    ],
  }),

  get_stale_endpoints: composite({
    description:
      "Find 'ghost machine' endpoints: decommissioned or broken devices still in the database. " +
      "Detects two independent signals — (1) not seen for longer than a threshold, and (2) currently " +
      "checking in but has never once succeeded a job, even after repeated failed attempts. The second " +
      "signal is the one that matters most and is easy to miss: a machine can look alive by check-in " +
      "alone while every job run against it fails, and it still counts toward license and compliance " +
      "numbers. Prefer this over list_endpoints + manual date math, and over digging through " +
      "explain_job_failure's neverSucceeded/flapping arrays by hand. Returns an aggregate and a capped, " +
      "worst-first list, not the full estate. Read-only.",
    inputSchema: objectSchema({
      notSeenForDays: {
        type: "number",
        description:
          "Days without a check-in before an endpoint counts as 'not seen since' (default: 30, matches get_fleet_summary's staleAfterDays).",
      },
      minFailedAttempts: {
        type: "number",
        description:
          "Minimum total failed job executions (summed across that endpoint's job instances) before 'never succeeded a job' is reported, to filter out one-off blips (default: 3). Ignored if includeJobHistory is false.",
      },
      includeJobHistory: {
        type: "boolean",
        description:
          "Join job-instance history to detect the never-succeeded-a-job signal (default: true). Set false for a cheaper, check-in-only answer that needs no jobs-domain access.",
      },
      maxListed: {
        type: "number",
        description:
          "How many ghost entries to return, worst first (default: 25). Totals always reflect the full estate even when the list is truncated.",
      },
    }),
    rules: [
      { name: "notSeenForDays", required: false, type: "number", min: 0 },
      { name: "minFailedAttempts", required: false, type: "number", min: 0 },
      { name: "includeJobHistory", required: false, type: "boolean" },
      { name: "maxListed", required: false, type: "number", min: 1 },
    ],
  }),

  // ── The collapsed read families ────────────────────────────────────────────
  list_endpoints: composite({
    description:
      "List endpoints. Omit type for every platform, or set it to reach one platform's own route. " +
      "Filters are per-type and are refused rather than silently ignored: UnmanagedEndpoint accepts " +
      "none, Domain and EntraIdDeviceId are WindowsEndpoint-only, and Android/iOS have no HostName. " +
      // "see detail/fields" was too oblique to route on, and countOnly was not
      // mentioned at all: measured over nine sessions this is the second
      // most-called tool in the suite (10 calls, 51,248 B) and not one call used
      // countOnly. "How many endpoints?" costs ~122 B instead of a page.
      "Compact rows by default: detail:true for the raw record, fields:[..] to pick columns. " +
      "countOnly:true answers 'how many' without fetching a page.",
    inputSchema: objectSchema({
      ...typeProperty(ENDPOINT_TYPES, TYPE_NOTE_OPTIONAL),
      ...filterProperties("list"),
      ...SHAPING,
    }),
    rules: [typeRule(ENDPOINT_TYPES, false), ...filterRules("list"), ...SHAPING_RULES],
  }),

  get_endpoint: composite({
    description:
      "Get one endpoint by id. Omit type for the platform-agnostic record, or set it to read the " +
      "platform's own route, which carries the fields only that platform has.",
    inputSchema: objectSchema(
      {
        ...guidProperty("id", "endpoint"),
        ...typeProperty(ENDPOINT_TYPES, TYPE_NOTE_OPTIONAL),
      },
      ["id"]
    ),
    rules: [CommonRules.guid("id"), typeRule(ENDPOINT_TYPES, false)],
  }),

  list_endpoints_by_logical_group: composite({
    description:
      "List a logical group's endpoints. Omit type for every platform, or set it to reach that " +
      "platform's group route. Set includeSubfolders=true to reach sub-groups — without it a parent " +
      "group commonly reports zero members. Compact rows by default; see detail/fields.",
    inputSchema: objectSchema(
      {
        ...guidProperty("logicalGroupId", "logical group"),
        ...typeProperty(groupListableTypes(), TYPE_NOTE_OPTIONAL),
        ...filterProperties("listByGroup"),
        ...SHAPING,
      },
      ["logicalGroupId"]
    ),
    rules: [
      CommonRules.guid("logicalGroupId"),
      typeRule(groupListableTypes(), false),
      ...filterRules("listByGroup"),
      ...SHAPING_RULES,
    ],
  }),

  // ── Logical groups (1:1) ───────────────────────────────────────────────────
  list_logical_groups: {
    op: "GetLogicalGroups",
    description: "List logical groups.",
    shaping: ["countOnly"],
    describe: {
      Name: "Exact-match filter on Name.",
      Dip: "Exact-match filter on Dip.",
      Domain: "Exact-match filter on Domain.",
    },
  },

  get_logical_group: {
    op: "GetLogicalGroup",
    description: "Get one logical group by id.",
  },

  // ── Maintenance windows (1:1; note the resource is NOT an endpoint family) ─
  get_maintenance_window_for_endpoint: {
    op: "GetMaintenanceWindowForEndpointById",
    description: "Get an endpoint's maintenance window.",
  },
  get_maintenance_window_for_logical_group: {
    op: "GetMaintenanceWindowForLogicalGroupById",
    description: "Get a logical group's maintenance window.",
  },

  // ── EntraID (1:1) ──────────────────────────────────────────────────────────
  get_entra_id_data: {
    op: "GetEntraIdEndpointDataByDeviceId",
    description:
      "Get the baramundi endpoint linked to a Microsoft Entra device id. NOTE: keyed on the ENTRA " +
      "device id, not a baramundi endpoint id — that is the only GET bConnect 26R1 declares.",
  },

  // ── Writes: the collapsed families ─────────────────────────────────────────
  update_endpoint: composite({
    write: true,
    description:
      "Update an endpoint's properties. WARNING: modifies a device record. Fields are per-type and " +
      "are refused rather than silently ignored: hostName is Windows/Linux/Network, category, owner " +
      "and registeredUser are Android, logicalGroupId is everything but Network. Sends a JSON Patch " +
      "built from what you pass. serialNumber is set at creation and cannot be patched.",
    inputSchema: objectSchema(
      {
        ...guidProperty("id", "endpoint"),
        ...typeProperty(updatableTypes(), TYPE_NOTE_REQUIRED),
        displayName: { type: "string", description: "Display name." },
        logicalGroupId: { type: "string", description: "GUID of the logical group to move it to." },
        comment: { type: "string", description: "Comment." },
        hostName: { type: "string", description: "Host name." },
        // Android only. Listed in the 26R1 PATCH /v2.0/AndroidEndpoints/{id}
        // example; the suite exposed none of them, so they were unreachable
        // capability rather than drift. See UPDATABLE_FIELDS in endpoint-types.ts
        // for why that example is not a complete list of writable fields.
        category: { type: "string", description: "User-defined category. Android only." },
        owner: { type: "string", description: "Owner, e.g. 'Company'. Android only." },
        registeredUser: {
          type: "string",
          description: "Registered user. Android and Network endpoints.",
        },
        // Network only. Restored: the family collapse dropped the untyped
        // `updateData` blob and took these with it, leaving a network endpoint
        // editable only in the three fields it shares with every other type.
        // Each appears in the 26R1 PATCH /v2.0/NetworkEndpoints/{id} example.
        primaryIP: {
          type: "string",
          description: "Primary IP address, e.g. '10.10.5.101'. Network endpoints only.",
        },
        primaryMAC: {
          type: "string",
          description: "Primary MAC address, e.g. 'AA:BB:CC:DD:EE:FF'. Network endpoints only.",
        },
        webInterfaceUrl: {
          type: "string",
          description:
            "URL of the device's own web interface, e.g. 'https://printer.corp.local'. " +
            "Network endpoints only.",
        },
        sshConfigurationPort: {
          type: "integer",
          description:
            "SSH port, 1-65535. Network endpoints only. Patches /sshConfiguration/Port — the " +
            "only part of the SSH configuration the 26R1 patch example writes.",
        },
        snmpConfiguration: {
          type: "object",
          description:
            "SNMP configuration, replaced whole. Network endpoints only. Fields: version " +
            "(e.g. 'V3'), community, username, authentication, encryption, contextName, " +
            "contextEngineId, authenticationPassword, encryptionPassword. WARNING: this " +
            "carries CREDENTIALS — the community string on v1/v2c, and both passwords on v3. " +
            "Do not pass values a user has not explicitly supplied for this purpose.",
        },
      },
      ["id", "type"]
    ),
    rules: [
      CommonRules.guid("id"),
      typeRule(updatableTypes(), true),
      { name: "displayName", required: false, type: "string", minLength: 1, maxLength: 255 },
      CommonRules.guidOptional("logicalGroupId"),
      { name: "comment", required: false, type: "string", maxLength: 4000 },
      { name: "hostName", required: false, type: "string", minLength: 1, maxLength: 255 },
      { name: "category", required: false, type: "string", minLength: 1, maxLength: 255 },
      { name: "owner", required: false, type: "string", minLength: 1, maxLength: 255 },
      { name: "registeredUser", required: false, type: "string", minLength: 1, maxLength: 255 },
      { name: "primaryIP", required: false, type: "string", minLength: 1, maxLength: 255 },
      { name: "primaryMAC", required: false, type: "string", minLength: 1, maxLength: 255 },
      { name: "webInterfaceUrl", required: false, type: "string", minLength: 1, maxLength: 2048 },
      // 1-65535 from the SshConfiguration schema's own minimum/maximum, rather
      // than a number picked here.
      { name: "sshConfigurationPort", required: false, type: "number", min: 1, max: 65535 },
      { name: "snmpConfiguration", required: false, type: "object" },
    ],
  }),

  delete_endpoint: composite({
    write: true,
    description:
      "Delete an endpoint. WARNING: permanent. Omit type to delete via the platform-agnostic route, " +
      "or set it to use that platform's own route.",
    inputSchema: objectSchema(
      {
        ...guidProperty("id", "endpoint"),
        ...typeProperty(deletableTypes(), TYPE_NOTE_OPTIONAL),
      },
      ["id"]
    ),
    rules: [CommonRules.guid("id"), typeRule(deletableTypes(), false)],
  }),

  start_enrollment: composite({
    write: true,
    description:
      "Start MDM enrollment for an existing endpoint: sets it to Internet mode where applicable and " +
      "generates enrollment data, optionally mailing the instructions. WARNING: changes device state. " +
      "forceMobileDataOnEnrollment and includeWifiInQrCode are AndroidEndpoint-only and are refused " +
      "for other types.",
    inputSchema: objectSchema(
      {
        ...guidProperty("id", "endpoint"),
        ...typeProperty(enrollableTypes(), TYPE_NOTE_REQUIRED),
        enrollmentMailAddress: {
          type: "string",
          description: "Mail the enrollment instructions here. Omit to send none.",
        },
        emailLanguageId: {
          type: "string",
          description: "Mail template language, e.g. 'en-US'.",
        },
        forceMobileDataOnEnrollment: {
          type: "boolean",
          description: "Android: force mobile data during enrollment (default false).",
        },
        includeWifiInQrCode: {
          type: "boolean",
          description: "Android: put Wi-Fi credentials in the QR code (default false).",
        },
      },
      ["id", "type"]
    ),
    rules: [
      CommonRules.guid("id"),
      typeRule(enrollableTypes(), true),
      { name: "enrollmentMailAddress", required: false, type: "string", minLength: 1, maxLength: 320 },
      { name: "emailLanguageId", required: false, type: "string", minLength: 1, maxLength: 32 },
      { name: "forceMobileDataOnEnrollment", required: false, type: "boolean" },
      { name: "includeWifiInQrCode", required: false, type: "boolean" },
    ],
  }),

  // ── Writes: creates, kept per platform on purpose ──────────────────────────
  //
  // The survey measured `create_*_endpoint` as the one family that must NOT
  // collapse: SHARED-BY-ALL PARAMETERS = 0 across the seven tools, and the
  // required sets diverge (displayName+hostName for Windows and Linux,
  // displayName+primaryIP for Network, displayName alone for Mac/Android/iOS).
  // A collapsed create would advertise a union where the valid subset is implied
  // only by the enum value, on the tools that create real objects in a real bMS.
  // Left as separate tools, with their required sets now DERIVED from the spec
  // rather than hand-written — which is what closes the tracked
  // `OPEN_BODY_REQUIRED` defect (create_linux_endpoint did not advertise the
  // required `hostName` at all, so every call 400ed).
  create_windows_endpoint: {
    op: "CreateWindowsEndpoint",
    description: "Create a Windows endpoint. WARNING: creates a device record.",
    write: true,
    body: ["displayName", "hostName", "logicalGroupId", "comment", "domain", "primaryMAC", "primaryIP"],
    describe: {
      displayName: "Display name.",
      hostName: "Host name.",
      logicalGroupId: "GUID of the logical group to file it under.",
      comment: "Comment.",
      domain: "Windows domain.",
      primaryMAC: "Primary MAC address.",
      primaryIP: "Primary IP address.",
    },
  },
  create_linux_endpoint: {
    op: "CreateLinuxEndpoint",
    description: "Create a Linux endpoint. WARNING: creates a device record.",
    write: true,
    body: ["displayName", "hostName", "logicalGroupId", "comment", "primaryIP", "primaryMAC"],
    describe: {
      displayName: "Display name.",
      hostName: "Host name.",
      logicalGroupId: "GUID of the logical group to file it under.",
      comment: "Comment.",
      primaryIP: "Primary IP address.",
      primaryMAC: "Primary MAC address.",
    },
  },
  create_mac_endpoint: {
    op: "CreateMacEndpoint",
    description: "Create a Mac endpoint. WARNING: creates a device record.",
    write: true,
    body: ["displayName", "logicalGroupId", "comment", "serialNumber", "hostName"],
    describe: {
      displayName: "Display name.",
      logicalGroupId: "GUID of the logical group to file it under.",
      comment: "Comment.",
      serialNumber: "Serial number.",
      hostName: "Host name.",
    },
  },
  create_android_endpoint: {
    op: "CreateAndroidEndpoint",
    description: "Create an Android endpoint. WARNING: creates a device record.",
    write: true,
    body: ["displayName", "logicalGroupId", "comment", "serialNumber", "androidEnterpriseProfileType", "registeredUser"],
    describe: {
      displayName: "Display name.",
      logicalGroupId: "GUID of the logical group to file it under.",
      comment: "Comment.",
      serialNumber: "Serial number.",
      androidEnterpriseProfileType: "Android Enterprise profile type.",
      registeredUser: "Registered user.",
    },
  },
  create_ios_endpoint: {
    op: "CreateIOSEndpoint",
    description: "Create an iOS/iPadOS endpoint. WARNING: creates a device record.",
    write: true,
    body: ["displayName", "logicalGroupId", "comment", "serialNumber", "registeredUser"],
    describe: {
      displayName: "Display name.",
      logicalGroupId: "GUID of the logical group to file it under.",
      comment: "Comment.",
      serialNumber: "Serial number.",
      registeredUser: "Registered user.",
    },
  },
  create_network_endpoint: {
    op: "CreateNetworkEndpoint",
    description:
      "Create a network endpoint (switch, router, printer). WARNING: creates a device record.",
    write: true,
    body: ["displayName", "primaryIP", "logicalGroupId", "comment", "hostName", "primaryMAC"],
    describe: {
      displayName: "Display name.",
      primaryIP: "Primary IP address.",
      logicalGroupId: "GUID of the logical group to file it under.",
      comment: "Comment.",
      hostName: "Host name.",
      primaryMAC: "Primary MAC address.",
    },
  },

  trigger_intune_installation: {
    op: "TriggerInstallationViaIntune",
    description:
      "Trigger baramundi Agent installation on a Windows endpoint via Intune. Requires co-management. " +
      "WARNING: starts an installation. The 200 body is a bare boolean — read the result: false " +
      "means the installation was NOT confirmed, and bConnect does not document why.",
    write: true,
  },

  // ── Logical group writes ───────────────────────────────────────────────────
  create_logical_group: {
    op: "CreateLogicalGroup",
    description: "Create a logical group. WARNING: creates a group in the hierarchy.",
    write: true,
    body: ["name", "parentId", "comment"],
    describe: {
      name: "Group name.",
      parentId: "GUID of the parent group. Omit for a root group.",
      comment: "Comment.",
    },
  },
  update_logical_group: composite({
    write: true,
    description: "Update a logical group. WARNING: modifies group properties.",
    inputSchema: objectSchema(
      {
        ...guidProperty("id", "logical group"),
        name: { type: "string", description: "Group name." },
        comment: { type: "string", description: "Comment." },
      },
      ["id"]
    ),
    rules: [
      CommonRules.guid("id"),
      { name: "name", required: false, type: "string", minLength: 1, maxLength: 255 },
      { name: "comment", required: false, type: "string", maxLength: 4000 },
    ],
  }),
  delete_logical_group: {
    op: "DeleteLogicalGroup",
    description: "Delete a logical group. WARNING: permanent, and the group must be empty.",
    write: true,
  },

  // ── Maintenance window writes ──────────────────────────────────────────────
  create_maintenance_window_for_endpoint: {
    op: "CreateMaintenanceWindowForEndpointById",
    description: "Create an endpoint's maintenance window. WARNING: changes when jobs may run.",
    write: true,
    describe: {
      maintenanceWindowDefinitionType: "Window type.",
      intervals: "Intervals. Required for every type except Anytime and Never.",
    },
  },
  update_maintenance_window_for_endpoint: composite({
    write: true,
    description: "Update an endpoint's maintenance window. WARNING: changes when jobs may run.",
    inputSchema: objectSchema(
      {
        ...guidProperty("id", "endpoint"),
        maintenanceWindowDefinitionType: { type: "string", description: "Window type." },
        intervals: {
          type: "array",
          description: "Intervals. Required for every type except Anytime and Never.",
        },
      },
      ["id"]
    ),
    rules: [
      CommonRules.guid("id"),
      { name: "maintenanceWindowDefinitionType", required: false, type: "string" },
      { name: "intervals", required: false, type: "array" },
    ],
  }),
  delete_maintenance_window_for_endpoint: {
    op: "DeleteMaintenanceWindowForEndpointById",
    description: "Delete an endpoint's maintenance window. WARNING: permanent.",
    write: true,
  },
  create_maintenance_window_for_logical_group: {
    op: "CreateMaintenanceWindowForLogicalGroupById",
    description: "Create a logical group's maintenance window. WARNING: changes when jobs may run.",
    write: true,
    describe: {
      maintenanceWindowDefinitionType: "Window type.",
      intervals: "Intervals. Required for every type except Anytime and Never.",
    },
  },
  update_maintenance_window_for_logical_group: composite({
    write: true,
    description: "Update a logical group's maintenance window. WARNING: changes when jobs may run.",
    inputSchema: objectSchema(
      {
        ...guidProperty("id", "logical group"),
        maintenanceWindowDefinitionType: { type: "string", description: "Window type." },
        intervals: {
          type: "array",
          description: "Intervals. Required for every type except Anytime and Never.",
        },
      },
      ["id"]
    ),
    rules: [
      CommonRules.guid("id"),
      { name: "maintenanceWindowDefinitionType", required: false, type: "string" },
      { name: "intervals", required: false, type: "array" },
    ],
  }),
  delete_maintenance_window_for_logical_group: {
    op: "DeleteMaintenanceWindowForLogicalGroupById",
    description: "Delete a logical group's maintenance window. WARNING: permanent.",
    write: true,
  },

  // ── EntraID writes ─────────────────────────────────────────────────────────
  link_entra_id_data: {
    op: "SetEntraIdEndpointData",
    // The mobile-only constraint is load-bearing: the route's own 404 means
    // "no endpoint with the specified ID" for any non-mobile id (the spec
    // reserves 403 for rights), and the API's generic 404 title reads as a
    // rights problem. Measured live 2026-08-11: a Windows endpoint id earned
    // that 404 with every profile permission open, and the first diagnosis
    // blamed credentials. Say it here so a model never has to re-derive it.
    description:
      "Link a Microsoft Entra device to an endpoint. ONLY MOBILE endpoints (iOS, Android, macOS) are supported — " +
      "a Windows endpoint id answers 404 'no endpoint with the specified ID', which is a platform refusal, not a " +
      "missing object or a rights problem. WARNING: changes device identity.",
    write: true,
    // A `describe: { deviceId: … }` entry sat here until 2026-08-11 — the
    // operation's parameters are entraIdDeviceId/entraIdTenantId/entraIdUserId,
    // so the key matched nothing and was a no-op. It also corroborated the
    // dispatch arm reading the same phantom parameter (TOOL-REVIEW-MATRIX.md
    // H4). The spec-derived descriptions are already right; nothing to
    // override.
  },
  unlink_entra_id_data: {
    op: "DeleteEntraIdEndpointData",
    description:
      "Unlink Microsoft Entra data from an endpoint. ONLY MOBILE endpoints (iOS, Android, macOS) are supported — " +
      "a Windows endpoint id answers 404. WARNING: removes the association.",
    write: true,
  },
});

/** Field names `update_endpoint` may carry, for the dispatch guard. */
export const UPDATE_FIELDS = allUpdatableFields();
/** Field names `start_enrollment` may carry, for the dispatch guard. */
export const ENROLLMENT_FIELDS = allEnrollmentFields();
