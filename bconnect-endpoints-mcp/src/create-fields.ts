/**
 * Body fields of the endpoint create and enrollment tools, per tool (#189).
 *
 * Each table lists the properties of the operation's request schema in the
 * 26R1 spec (WindowsEndpointForCreation, LinuxEndpointForCreation,
 * NetworkEndpointForCreation, MaintenanceWindowForCreation,
 * Windows/MacEnrollmentRequest) that the tool offers; `required` follows the
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
  start_windows_enrollment: {
    pathId: "Endpoint ID (GUID)",
    fields: {
      enrollmentMailAddress: text("", "E-mail address that receives the enrollment instructions"),
      emailLanguageId: text("", "Language of the e-mail, e.g. de or en"),
      sync: flag("", "Wait for the enrollment data to be generated"),
    },
    required: [],
  },
  start_mac_enrollment: {
    pathId: "Endpoint ID (GUID)",
    fields: {
      enrollmentMailAddress: text("", "E-mail address that receives the enrollment instructions"),
      emailLanguageId: text("", "Language of the e-mail, e.g. de or en"),
      enrollmentType: choice("", "How the Mac is enrolled", ["Unenrolled", "SSH", "SSHAndNative", "Native"]),
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

/** The input schema: the path id (if any) plus every body field. */
export function createInputSchema(name: string): CreateInputSchema {
  const tool = toolOf(name);
  const properties: Record<string, Record<string, unknown>> = tool.pathId ? { id: { type: "string", description: tool.pathId } } : {};
  for (const [field, f] of Object.entries(tool.fields)) {
    properties[field] = {
      type: f.type ?? "string",
      description: f.description,
      ...(f.enum && { enum: [...f.enum] }),
      ...(f.items && { items: f.items }),
      ...(f.properties && { properties: f.properties }),
    };
  }
  return { type: "object", properties, required: [...(tool.pathId ? ["id"] : []), ...tool.required] };
}

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
