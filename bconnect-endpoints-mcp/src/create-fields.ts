/**
 * Body fields of the endpoint create and enrollment tools, per tool (#189).
 *
 * Each table lists the properties of the operation's request schema in the
 * 26R1 spec (WindowsEndpointForCreation, LinuxEndpointForCreation,
 * NetworkEndpointForCreation, MaintenanceWindowForCreation,
 * Windows/Mac/Android/IOSEnrollmentRequest) that the tool offers; `required` follows the
 * schema. The table drives the input schema, the validation rules and the body,
 * so a tool can't send a field its schema doesn't declare. Path parameters
 * (`id`) are added to the input schema and stay out of the body.
 */
import { CommonRules, pickArguments, type ValidationRule } from "@bconnect/mcp-core";
import { choice, flag, guid, maintenanceWindowFields, text, type Field } from "./update-fields.js";

interface CreateTool {
  /** Path parameter, if the route has one. */
  pathId?: string;
  fields: Record<string, Field>;
  required: string[];
}

export const CREATE_FIELDS: Record<string, CreateTool> = {
  create_windows_endpoint: {
    fields: {
      displayName: text("", "Display name"),
      hostName: text("", "Host name"),
      logicalGroupId: guid("", "Logical group to create the endpoint in (GUID)"),
      comment: text("", "Comment"),
      domain: text("", "Domain"),
      primaryIP: text("", "Primary IP address"),
      primarySubnetMask: text("", "Primary subnet mask"),
      primaryMAC: text("", "Primary MAC address"),
      registeredUser: text("", "Registered user"),
    },
    required: ["displayName", "hostName"],
  },
  create_linux_endpoint: {
    fields: {
      displayName: text("", "Display name"),
      hostName: text("", "Host name"),
      logicalGroupId: guid("", "Logical group to create the endpoint in (GUID)"),
      comment: text("", "Comment"),
      primaryIP: text("", "Primary IP address"),
      primaryMAC: text("", "Primary MAC address"),
      registeredUser: text("", "Registered user"),
      managementMode: choice("", "How the endpoint is managed", ["SSH", "ManagementAgent"]),
    },
    required: ["displayName", "hostName"],
  },
  create_network_endpoint: {
    fields: {
      displayName: text("", "Display name"),
      primaryIP: text("", "Primary IP address"),
      logicalGroupId: guid("", "Logical group to create the endpoint in (GUID)"),
      comment: text("", "Comment"),
      hostName: text("", "Host name"),
      primaryMAC: text("", "Primary MAC address"),
      webInterfaceUrl: text("", "URL of the device's web interface"),
      serialNumber: text("", "Serial number"),
      registeredUser: text("", "Registered user"),
    },
    required: ["displayName", "primaryIP"],
  },
  // 25R2 only: 26R1 has no IndustrialEndpoints route (known drift).
  create_industrial_endpoint: {
    fields: {
      displayName: text("", "Display name"),
      port: { path: "", type: "integer", description: "SNMP port, usually 161" },
      primaryIP: text("", "Primary IP address"),
      snmpConfiguration: {
        path: "", type: "object", description: "How bMS reads the device over SNMP",
        properties: {
          version: { type: "string", enum: ["V1", "V2c", "V3"] },
          community: { type: "string", description: "Community string (V1, V2c)" },
          username: { type: "string", description: "User name (V3)" },
          authentication: { type: "string", enum: ["None", "MD5", "SHA", "SHA256", "SHA384", "SHA512"] },
          authenticationPassword: { type: "string" },
          encryption: { type: "string", enum: ["None", "DES", "AES", "TDES", "AES192", "AES256"] },
          encryptionPassword: { type: "string" },
          contextName: { type: "string" },
          contextEngineId: { type: "string" },
        },
      },
      logicalGroupId: guid("", "Logical group to create the endpoint in (GUID)"),
      comment: text("", "Comment"),
      hostName: text("", "Host name"),
      primaryMAC: text("", "Primary MAC address"),
      webInterfaceUrl: text("", "URL of the device's web interface"),
    },
    required: ["displayName", "port", "primaryIP", "snmpConfiguration"],
  },
  create_maintenance_window_for_endpoint: {
    pathId: "Endpoint ID (GUID)",
    fields: maintenanceWindowFields,
    required: ["maintenanceWindowDefinitionType"],
  },
  create_maintenance_window_for_logical_group: {
    pathId: "Logical group ID (GUID)",
    fields: maintenanceWindowFields,
    required: ["maintenanceWindowDefinitionType"],
  },
  // start_enrollment per endpoint type (its variant key, REQ-SRV-029).
  "start_enrollment[type=WindowsEndpoint]": {
    pathId: "Endpoint ID (GUID)",
    fields: {
      enrollmentMailAddress: text("", "E-mail address that receives the enrollment instructions"),
      emailLanguageId: text("", "E-mail template ID, e.g. en-US or de-DE"),
      sync: flag("", "Wait for the enrollment data to be generated"),
    },
    required: [],
  },
  "start_enrollment[type=MacEndpoint]": {
    pathId: "Endpoint ID (GUID)",
    fields: {
      enrollmentMailAddress: text("", "E-mail address that receives the enrollment instructions"),
      emailLanguageId: text("", "E-mail template ID, e.g. en-US or de-DE"),
      enrollmentType: choice("", "How the Mac is enrolled", ["Unenrolled", "SSH", "SSHAndNative", "Native"]),
    },
    required: [],
  },
  // Android and iOS: fields only (schema, validation); the server builds their bodies, which
  // always carry every field (null or false when not given), as before.
  "start_enrollment[type=AndroidEndpoint]": {
    pathId: "Endpoint ID (GUID)",
    fields: {
      enrollmentMailAddress: text("", "E-mail address that receives the enrollment instructions"),
      emailLanguageId: text("", "E-mail template ID, e.g. en-US or de-DE"),
      forceMobileDataOnEnrollment: flag("", "Force mobile data during enrollment (default: false)"),
      includeWifiInQrCode: flag("", "Include Wi-Fi credentials in the QR code (default: false)"),
    },
    required: [],
  },
  "start_enrollment[type=IOSEndpoint]": {
    pathId: "Endpoint ID (GUID)",
    fields: {
      enrollmentMailAddress: text("", "E-mail address that receives the enrollment instructions"),
      emailLanguageId: text("", "E-mail template ID, e.g. en-US or de-DE"),
    },
    required: [],
  },
};

const toolOf = (name: string): CreateTool => {
  const tool = CREATE_FIELDS[name];
  if (!tool) {
    throw new Error(`No create fields for ${name}`);
  }
  return tool;
};

export interface CreateInputSchema {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required: string[];
}

const fieldProperty = (f: Field): Record<string, unknown> => ({
  type: f.type ?? "string",
  description: f.description,
  ...(f.enum && { enum: [...f.enum] }),
  ...(f.items && { items: f.items }),
  ...(f.properties && { properties: f.properties }),
});

/** The input schema: the path id (if any) plus every body field. */
export function createInputSchema(name: string): CreateInputSchema {
  const tool = toolOf(name);
  const properties: Record<string, Record<string, unknown>> = tool.pathId ? { id: { type: "string", description: tool.pathId } } : {};
  for (const [field, f] of Object.entries(tool.fields)) {
    properties[field] = fieldProperty(f);
  }
  return { type: "object", properties, required: [...(tool.pathId ? ["id"] : []), ...tool.required] };
}

/**
 * The input schema of a merged tool with a body (start_enrollment, REQ-SRV-029):
 * `type`, the path id and every field of its variants (the first variant's
 * definition). Which types take a field is added when the tool is listed.
 */
export function mergedCreateInputSchema(keys: readonly string[], type: Record<string, unknown>): CreateInputSchema {
  const first = toolOf(keys[0]);
  const properties: Record<string, Record<string, unknown>> = { type, ...(first.pathId && { id: { type: "string", description: first.pathId } }) };
  for (const key of keys) {
    for (const [field, f] of Object.entries(toolOf(key).fields)) {
      properties[field] ??= fieldProperty(f);
    }
  }
  return { type: "object", properties, required: ["type", ...(first.pathId ? ["id"] : [])] };
}

/** The body fields a create or enrollment tool (or variant) takes. */
export const createFieldNames = (name: string): string[] => Object.keys(toolOf(name).fields);

/** Validation: the path id and every GUID field. */
export function createRules(name: string): ValidationRule[] {
  const tool = toolOf(name);
  return [
    ...(tool.pathId ? [CommonRules.guid("id")] : []),
    ...Object.entries(tool.fields).filter(([, f]) => f.guid)
      .map(([field]) => (tool.required.includes(field) ? CommonRules.guid(field) : CommonRules.guidOptional(field))),
  ];
}

/** The request body: only the declared fields the caller gave. */
export function createBody(name: string, args: Record<string, unknown>): Record<string, unknown> {
  return pickArguments(args, Object.keys(toolOf(name).fields));
}
