/**
 * Fields the endpoint update tools offer, per tool (#171).
 *
 * Each entry comes from the PATCH request example of the tool's route in the
 * bundled specs (26R1; industrial from 25R2, the only release with that route),
 * with the type from the route's GET schema. `path` is the patch path exactly as
 * the example spells it: Mac uses PascalCase, the maintenance window type is
 * lower case. Nested paths (clientAgentLink/…, customState/…, sshConfiguration/…,
 * snmpConfiguration) aren't offered yet.
 *
 * One table drives the input schema, the validation rules and the JSON Patch,
 * so they can't drift apart.
 */
import { CommonRules, patchFromArguments, type JsonPatchOperation, type ValidationRule } from "@bconnect/mcp-core";

export interface Field {
  path: string;
  description: string;
  type?: "string" | "boolean" | "integer" | "array" | "object";
  guid?: boolean;
  enum?: readonly string[];
  items?: Record<string, unknown>;
  properties?: Record<string, unknown>;
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

export const maintenanceWindowFields: Record<string, Field> = {
  maintenanceWindowDefinitionType: choice("/maintenancewindowdefinitiontype",
    "Window type: Anytime (no restriction, the default), Everyday (same slot every day), WorkdayWeekend, IndividualWeekday, or Never. Anytime and Never take no intervals; the others need at least one.",
    ["Anytime", "Never", "Everyday", "WorkdayWeekend", "IndividualWeekday"]), // Anytime first: the default (spec)
  intervals: { path: "/intervals", type: "array", items: MAINTENANCE_INTERVAL,
    description: "The periods in which jobs may run, e.g. [{\"maintenancePeriod\":\"Everyday\",\"start\":{\"hour\":22,\"minute\":0},\"end\":{\"hour\":6,\"minute\":0}}]. Required, at least one, for Everyday, WorkdayWeekend and IndividualWeekday; leave out for Anytime and Never." },
};

export const UPDATE_FIELDS: Record<string, Record<string, Field>> = {
  update_windows_endpoint: {
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
  },
  update_linux_endpoint: {
    displayName: text("/displayName", "Display name"),
    logicalGroupId: guid("/logicalGroupId", "Logical group to move the endpoint to (GUID)"),
    comment: text("/comment", "Comment"),
    hostName: text("/hostName", "Host name"),
    primaryIP: text("/primaryIP", "Primary IP address"),
    primaryMAC: text("/primaryMAC", "Primary MAC address"),
    managementMode: choice("/managementMode", "How the endpoint is managed", ["SSH", "ManagementAgent"]),
  },
  update_mac_endpoint: {
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
  update_network_endpoint: {
    displayName: text("/displayName", "Display name"),
    comment: text("/comment", "Comment"),
    hostName: text("/hostName", "Host name"),
    primaryIP: text("/primaryIP", "Primary IP address"),
    primaryMAC: text("/primaryMAC", "Primary MAC address"),
    registeredUser: text("/registeredUser", "Registered user"),
    webInterfaceUrl: text("/webInterfaceUrl", "URL of the device's web interface"),
  },
  update_industrial_endpoint: {
    displayName: text("/displayName", "Display name"),
    logicalGroupId: guid("/logicalGroupId", "Logical group to move the endpoint to (GUID)"),
    comment: text("/comment", "Comment"),
    hostName: text("/hostName", "Host name"),
    port: { path: "/port", type: "integer", description: "Port" },
    primaryIP: text("/primaryIP", "Primary IP address"),
    primaryMAC: text("/primaryMAC", "Primary MAC address"),
    webInterfaceUrl: text("/webInterfaceUrl", "URL of the device's web interface"),
  },
  update_maintenance_window_for_endpoint: maintenanceWindowFields,
  update_maintenance_window_for_logical_group: maintenanceWindowFields,
};

const fieldsOf = (tool: string): Record<string, Field> => {
  const fields = UPDATE_FIELDS[tool];
  if (!fields) {
    throw new Error(`No update fields for ${tool}`);
  }
  return fields;
};

export interface UpdateInputSchema {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  minProperties: number;
}

/** The input schema: `id` plus every field, at least one of them given. */
export function updateInputSchema(tool: string, idDescription: string): UpdateInputSchema {
  const properties: Record<string, Record<string, unknown>> = { id: { type: "string", description: idDescription } };
  for (const [name, field] of Object.entries(fieldsOf(tool))) {
    properties[name] = {
      type: field.type ?? "string",
      description: field.description,
      ...(field.enum && { enum: [...field.enum] }),
      ...(field.items && { items: field.items }),
    };
  }
  return { type: "object", properties, required: ["id"], minProperties: 2 };
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
