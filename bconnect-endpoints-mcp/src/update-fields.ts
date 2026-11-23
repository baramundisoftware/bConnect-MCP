/**
 * Fields the endpoint update tools offer, per tool (#171).
 *
 * Each entry comes from the PATCH request example of the tool's route in the
 * bundled specs, with the type from the route's GET schema. `path` is the patch
 * path exactly as the example spells it: Mac, Android and iOS use PascalCase, the
 * maintenance window type is lower case. A nested path (clientAgentLink/…,
 * customState/…, sshConfiguration/Port, snmpConfiguration/…) is one flat argument
 * (#328). A field only some releases' examples have names them in `releases`
 * (network SNMP: 25R2 patches the community, 26R1 and 26R2 the whole object).
 * __tests__/update-fields-spec.test.ts checks every route of every release
 * against its example.
 *
 * One table drives the input schema, the validation rules and the JSON Patch,
 * so they can't drift apart.
 */
import { CommonRules, patchFromArguments, selectedRelease, type JsonPatchOperation, type Release, type ValidationRule } from "@bconnect/mcp-core";
import { WINDOW_TYPES } from "./maintenance-window.js";

export interface Field {
  path: string;
  description: string;
  type?: "string" | "boolean" | "integer" | "array" | "object";
  guid?: boolean;
  enum?: readonly string[];
  items?: Record<string, unknown>;
  properties?: Record<string, unknown>;
  /** The releases whose PATCH example has this field; absent: every release that has the route. */
  releases?: readonly Release[];
}

export const text = (path: string, description: string): Field => ({ path, description });
export const guid = (path: string, description: string): Field => ({ path, description, guid: true });
export const flag = (path: string, description: string): Field => ({ path, description, type: "boolean" });
export const choice = (path: string, description: string, values: readonly string[]): Field => ({ path, description, enum: values });

export const MAINTENANCE_INTERVAL = {
  type: "object",
  properties: {
    maintenancePeriod: { type: "string", enum: ["Everyday", "Workdays", "Weekends", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] },
    start: { type: "object", properties: { hour: { type: "integer", minimum: 0, maximum: 24 }, minute: { type: "integer", minimum: 0, maximum: 59 } }, required: ["hour", "minute"] },
    end: { type: "object", properties: { hour: { type: "integer", minimum: 0, maximum: 24 }, minute: { type: "integer", minimum: 0, maximum: 59 } }, required: ["hour", "minute"] },
  },
  required: ["start", "end"],
};

/** The maintenance-window fields of 26R1 (create and update; the update tools need 26R1). */
export const maintenanceWindowFields: Record<string, Field> = {
  maintenanceWindowDefinitionType: choice("/maintenancewindowdefinitiontype",
    "Window type: Anytime (no restriction, the default), Everyday (same slot every day), WorkdayWeekend, IndividualWeekday, or Never. Anytime and Never take no intervals; the others need at least one.",
    WINDOW_TYPES["26R1"]), // Anytime first: the default (spec)
  intervals: { path: "/intervals", type: "array", items: MAINTENANCE_INTERVAL,
    description: "The periods in which jobs may run, e.g. [{\"maintenancePeriod\":\"Everyday\",\"start\":{\"hour\":22,\"minute\":0},\"end\":{\"hour\":6,\"minute\":0}}]. Required, at least one, for Everyday, WorkdayWeekend and IndividualWeekday; leave out for Anytime and Never." },
};

/** The same fields with 25R2's window types and rule (REQ-SRV-031): create on 25R2 sends a body its schema accepts. */
const maintenanceWindowFields25R2: Record<string, Field> = {
  maintenanceWindowDefinitionType: choice("/maintenancewindowdefinitiontype",
    "Window type: Unrestricted (no restriction, the default), Everyday (same slot every day), WorkdayWeekend or IndividualWeekday. Unrestricted takes no intervals; the others need at least one.",
    WINDOW_TYPES["25R2"]), // Unrestricted first: the default (spec)
  intervals: { ...maintenanceWindowFields.intervals,
    description: "The periods in which jobs may run, e.g. [{\"maintenancePeriod\":\"Everyday\",\"start\":{\"hour\":22,\"minute\":0},\"end\":{\"hour\":6,\"minute\":0}}]. Required, at least one, for Everyday, WorkdayWeekend and IndividualWeekday; leave out for Unrestricted." },
};

/** The maintenance-window fields of a release. */
export const maintenanceWindowFieldsOf = (release: Release): Record<string, Field> =>
  (release === "25R2" ? maintenanceWindowFields25R2 : maintenanceWindowFields);

const SSH_PORT: Field = { path: "/sshConfiguration/Port", type: "integer", description: "SSH port" };
const SNMP_VERSIONS = ["V1", "V2c", "V3"] as const;
const SNMP_AUTHENTICATIONS = ["None", "MD5", "SHA", "SHA256", "SHA384", "SHA512"] as const;
const SNMP_ENCRYPTIONS = ["None", "DES", "AES", "TDES", "AES192", "AES256"] as const;
const SNMP_COMMUNITY = "SNMP community (v1, v2c)";
/** The SnmpConfiguration of the 26R1/26R2 network PATCH example (its GET schema, plus the two passwords the example sends). */
const SNMP_CONFIGURATION: Record<string, unknown> = {
  version: { type: "string", enum: [...SNMP_VERSIONS] },
  community: { type: "string" },
  username: { type: "string" },
  authentication: { type: "string", enum: [...SNMP_AUTHENTICATIONS] },
  authenticationPassword: { type: "string" },
  encryption: { type: "string", enum: [...SNMP_ENCRYPTIONS] },
  encryptionPassword: { type: "string" },
  contextName: { type: "string" },
  contextEngineId: { type: "string" },
};
/** Android and iOS: the fields of their PATCH examples (every release), spelt as they are (PascalCase, like Mac). */
const MOBILE: Record<string, Field> = {
  displayName: text("/DisplayName", "Display name"),
  logicalGroupId: guid("/LogicalGroupId", "Logical group to move the endpoint to (GUID)"),
  comment: text("/Comment", "Comment"),
  category: text("/Category", "Category"),
  owner: choice("/Owner", "Owner", ["Company", "Private"]),
  registeredUser: text("/RegisteredUser", "Registered user"),
};

/**
 * Per update tool, and per endpoint type of update_endpoint (its variant key,
 * REQ-SRV-029): the fields it offers, in the order of the PATCH example.
 */
export const UPDATE_FIELDS: Record<string, Record<string, Field>> = {
  "update_endpoint[type=WindowsEndpoint]": {
    displayName: text("/displayName", "Display name"),
    logicalGroupId: guid("/logicalGroupId", "Logical group to move the endpoint to (GUID)"),
    comment: text("/comment", "Comment"),
    hostName: text("/hostName", "Host name"),
    domain: text("/domain", "Domain"),
    primaryIP: text("/primaryIP", "Primary IP address"),
    primarySubnetMask: text("/primarySubnetMask", "Primary subnet mask"),
    primaryMAC: text("/primaryMAC", "Primary MAC address"),
    uuid: text("/UUID", "Hardware UUID"),
    registeredUser: text("/registeredUser", "Registered user"),
    registeredUserUpdateMode: choice("/registeredUserUpdateMode", "How the registered user is kept up to date",
      ["UseNextLogonUser", "DoNotUseRegisteredUser", "UpdateContinously", "EnterManually"]),
    userRelatedJobExecution: choice("/userRelatedJobExecution", "When user-related job steps run", ["Always", "Never", "ForRegisteredUser"]),
    isEnergyManagementActive: flag("/isEnergyManagementActive", "Energy management on or off"),
    isDeactivated: flag("/isDeactivated", "Deactivate (true) or reactivate (false) the endpoint"),
    entraIdDeviceId: text("/EntraIdDeviceId", "Entra ID device ID"),
    coManagement: choice("/CoManagement", "Co-management with Intune", ["None", "Intune"]),
    clientAgentExtendedInternetMode: flag("/clientAgentLink/ExtendedInternetMode", "Agent connection: extended internet mode on or off"),
    clientAgentNetworkMode: choice("/clientAgentLink/NetworkMode", "Agent connection: network mode", ["LAN", "Internet", "Dynamic"]),
    customStateType: { path: "/customState/Type", type: "integer", description: "Custom state: its type (a number)" },
    customStateText: text("/customState/Text", "Custom state: its text"),
  },
  "update_endpoint[type=LinuxEndpoint]": {
    displayName: text("/displayName", "Display name"),
    logicalGroupId: guid("/logicalGroupId", "Logical group to move the endpoint to (GUID)"),
    comment: text("/comment", "Comment"),
    hostName: text("/hostName", "Host name"),
    primaryIP: text("/primaryIP", "Primary IP address"),
    primaryMAC: text("/primaryMAC", "Primary MAC address"),
    sshPort: SSH_PORT,
    managementMode: choice("/managementMode", "How the endpoint is managed", ["SSH", "ManagementAgent"]),
  },
  "update_endpoint[type=MacEndpoint]": {
    displayName: text("/DisplayName", "Display name"),
    logicalGroupId: guid("/LogicalGroupId", "Logical group to move the endpoint to (GUID)"),
    comment: text("/Comment", "Comment"),
    category: text("/Category", "Category"),
    owner: choice("/Owner", "Owner", ["Company", "Private"]),
    registeredUser: text("/RegisteredUser", "Registered user"),
  },
  update_logical_group: {
    name: text("/name", "Group name"),
    parentId: guid("/parentId", "Parent group to move the group under (GUID)"),
    comment: text("/comment", "Comment"),
    dip: text("/dip", "Distribution point (DIP)"),
    defaultDomain: text("/defaultDomain", "Default domain"),
  },
  "update_endpoint[type=AndroidEndpoint]": MOBILE,
  "update_endpoint[type=IOSEndpoint]": MOBILE,
  "update_endpoint[type=NetworkEndpoint]": {
    displayName: text("/displayName", "Display name"),
    comment: text("/comment", "Comment"),
    hostName: text("/hostName", "Host name"),
    primaryIP: text("/primaryIP", "Primary IP address"),
    primaryMAC: text("/primaryMAC", "Primary MAC address"),
    registeredUser: text("/registeredUser", "Registered user"),
    webInterfaceUrl: text("/webInterfaceUrl", "URL of the device's web interface"),
    sshPort: SSH_PORT,
    snmpConfiguration: { path: "/snmpConfiguration", type: "object", properties: SNMP_CONFIGURATION, releases: ["26R1", "26R2"],
      description: "SNMP settings, replaced as a whole: give every value the device needs (e.g. {\"version\":\"V2c\",\"community\":\"public\"}; for V3 username, authentication, authenticationPassword, encryption, encryptionPassword)." },
    snmpCommunity: { ...text("/snmpConfiguration/community", SNMP_COMMUNITY), releases: ["25R2"] },
  },
  "update_endpoint[type=IndustrialEndpoint]": {
    displayName: text("/displayName", "Display name"),
    logicalGroupId: guid("/logicalGroupId", "Logical group to move the endpoint to (GUID)"),
    comment: text("/comment", "Comment"),
    hostName: text("/hostName", "Host name"),
    port: { path: "/port", type: "integer", description: "Port" },
    primaryIP: text("/primaryIP", "Primary IP address"),
    primaryMAC: text("/primaryMAC", "Primary MAC address"),
    webInterfaceUrl: text("/webInterfaceUrl", "URL of the device's web interface"),
    snmpVersion: choice("/snmpConfiguration/Version", "SNMP version", SNMP_VERSIONS),
    snmpUsername: text("/snmpConfiguration/Username", "SNMP v3 user name"),
    snmpAuthentication: choice("/snmpConfiguration/Authentication", "SNMP v3 authentication protocol", SNMP_AUTHENTICATIONS),
    snmpAuthenticationPassword: text("/snmpConfiguration/AuthenticationPassword", "SNMP v3 authentication password"),
    snmpEncryption: choice("/snmpConfiguration/Encryption", "SNMP v3 encryption protocol", SNMP_ENCRYPTIONS),
    snmpEncryptionPassword: text("/snmpConfiguration/EncryptionPassword", "SNMP v3 encryption password"),
    snmpCommunity: { ...text("/snmpConfiguration/Community", SNMP_COMMUNITY), releases: ["25R2"] },
    snmpContextName: text("/snmpConfiguration/ContextName", "SNMP v3 context name"),
    snmpContextEngineId: text("/snmpConfiguration/ContextEngineId", "SNMP v3 context engine ID"),
  },
  update_maintenance_window_for_endpoint: maintenanceWindowFields,
  update_maintenance_window_for_logical_group: maintenanceWindowFields,
};

/** The fields `tool` offers in `release` (default: the selected release, read per call). */
export const updateFieldsFor = (tool: string, release: Release = selectedRelease()): Record<string, Field> => {
  const fields = UPDATE_FIELDS[tool];
  if (!fields) {
    throw new Error(`No update fields for ${tool}`);
  }
  return Object.fromEntries(Object.entries(fields).filter(([, f]) => !f.releases || f.releases.includes(release)));
};
const fieldsOf = (tool: string): Record<string, Field> => updateFieldsFor(tool);

export interface UpdateInputSchema {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  minProperties: number;
}

const fieldProperty = (field: Field): Record<string, unknown> => ({
  type: field.type ?? "string",
  description: field.description,
  ...(field.enum && { enum: [...field.enum] }),
  ...(field.items && { items: field.items }),
  ...(field.properties && { properties: field.properties }),
});

/** The input schema: `id` plus every field, at least one of them given. */
export function updateInputSchema(tool: string, idDescription: string): UpdateInputSchema {
  const properties: Record<string, Record<string, unknown>> = { id: { type: "string", description: idDescription } };
  for (const [name, field] of Object.entries(fieldsOf(tool))) {
    properties[name] = fieldProperty(field);
  }
  return { type: "object", properties, required: ["id"], minProperties: 2 };
}

/**
 * The input schema of a merged update tool (REQ-SRV-029): `type`, `id` and every
 * field of its variants (the first variant's definition), at least one field
 * given. Which types take a field is added when the tool is listed.
 */
export function mergedUpdateInputSchema(keys: readonly string[], type: Record<string, unknown>, idDescription: string): UpdateInputSchema {
  const properties: Record<string, Record<string, unknown>> = { type, id: { type: "string", description: idDescription } };
  for (const key of keys) {
    for (const [name, field] of Object.entries(fieldsOf(key))) {
      properties[name] ??= fieldProperty(field);
    }
  }
  return { type: "object", properties, required: ["type", "id"], minProperties: 3 };
}

/** Validation: `id` and every GUID field must be GUIDs. */
export function updateRules(tool: string): ValidationRule[] {
  return [
    CommonRules.guid("id"),
    ...Object.entries(fieldsOf(tool)).filter(([, f]) => f.guid).map(([name]) => CommonRules.guidOptional(name)),
  ];
}

/** The JSON Patch for the fields the caller gave; empty when nothing changes. */
export function updatePatch(tool: string, args: Record<string, unknown>): JsonPatchOperation[] {
  return patchFromArguments(args, Object.fromEntries(Object.entries(fieldsOf(tool)).map(([name, f]) => [name, f.path])));
}

/** The changeable fields, for the "nothing to change" message. */
export const updateFieldNames = (tool: string): string[] => Object.keys(fieldsOf(tool));
