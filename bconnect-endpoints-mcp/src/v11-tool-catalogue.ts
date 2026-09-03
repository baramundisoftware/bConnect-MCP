/**
 * The bConnect v1.1 tool surface for this server, declared once.
 *
 * Kept OUT of `tool-catalogue.ts` on purpose. That file derives tools from the
 * 26R1 OpenAPI document via `defineTools(ENDPOINTS_OPERATIONS, …)`, and if the
 * spec and a declaration disagree, construction throws. **v1.1 has no
 * machine-readable contract at all** — there is no spec to derive from and
 * nothing for that check to check. Feeding hand-authored v1.1 entries through
 * the spec-driven path would mean either weakening that check or lying to it.
 *
 * So this is a second, separate catalogue, gated separately, exactly as
 * `bconnect-updatemanagement-mcp` does for the Microsoft Update slice. The
 * duplicate-name guard still runs (`defineToolCatalogue`), and `suite-tool-names`
 * still sees both.
 *
 * Every fact in these descriptions was measured against a live 26R1 bMS on
 * 2026-08-03 — see modules/inventory-scans-v11.ts for the numbers and the
 * probe that produced them.
 */

import { defineToolCatalogue, CommonRules, type ValidationRule } from "@bconnect/mcp-core";

const ENDPOINT_ID_DESCRIPTION =
  "GUID of the Windows endpoint. Required — bConnect v1.1 offers no paging on this " +
  "controller, so an endpoint id is the only bound on the response. Get one from " +
  "list_endpoints with type: WindowsEndpoint. Windows endpoints only: any other endpoint " +
  "type answers 404.";

const DETAIL_DESCRIPTION = "Return the raw v1.1 API record instead of the compact projection. Default false.";

export const V11_TOOLS = [
  {
    name: "get_endpoint_registry_inventory",
    description:
      "Get the RAW REGISTRY inventory scan for one Windows endpoint (bConnect v1.1) — each " +
      "product's registry DisplayName, version and vendor as the registry itself holds them, " +
      "with the scan time and the template that collected them. " +
      "For \"what is installed on this machine\", prefer list_installed_software_by_endpoint " +
      "(bconnect-software): it reads the same scan run, and on the 26R1 estate this was " +
      "measured against it returned every product this tool did and several more. " +
      "Use THIS tool only when the literal registry strings matter, because baramundi's " +
      "software recognition rewrites the name and version of every product it matches — " +
      "'Zoom Workplace (64-bit)' 7.1.43453 is reported there as 'Zoom' 7.1.5.43453 — and " +
      "this is the only tool that shows the registry's own values. " +
      "Roughly 19 KB raw per endpoint; the compact projection is smaller. " +
      "Requires BCONNECT_ENABLE_V11 and v1.1 credentials; LAN-only.",
    inputSchema: {
      type: "object",
      properties: {
        endpointId: { type: "string", description: ENDPOINT_ID_DESCRIPTION },
        detail: { type: "boolean", description: DETAIL_DESCRIPTION },
      },
      required: ["endpointId"],
    },
  },
  {
    name: "get_endpoint_file_inventory",
    description:
      "Get the custom FILE inventory scan for one Windows endpoint (bConnect v1.1) — the files " +
      "matched by the file-scan templates assigned to it, with path, size, version, vendor and " +
      "last-write time. Use it to answer whether a specific executable or DLL is present on a " +
      "machine and at what version, which the software inventory cannot answer. An endpoint may " +
      "carry several file scans from different templates; all are returned, since they are " +
      "different searches rather than versions of one. Requires BCONNECT_ENABLE_V11 and v1.1 " +
      "credentials; LAN-only.",
    inputSchema: {
      type: "object",
      properties: {
        endpointId: { type: "string", description: ENDPOINT_ID_DESCRIPTION },
        detail: { type: "boolean", description: DETAIL_DESCRIPTION },
      },
      required: ["endpointId"],
    },
  },
  {
    name: "get_endpoint_wmi_inventory",
    description:
      "Get the WMI inventory scan for one Windows endpoint (bConnect v1.1) — hardware and system " +
      "detail collected from WMI classes such as Win32_BIOS, Win32_Processor, " +
      "Win32_ComputerSystem, Win32_LogicalDisk and Win32_NetworkAdapterConfiguration. " +
      "TWO STEPS, because one endpoint's full WMI scan measured 585 KB: call it WITHOUT " +
      "className to get the index — every class collected, its instance count and its size — " +
      "then call it again WITH className to get that one class's instances. There is no " +
      "argument that returns every class at once. Requires BCONNECT_ENABLE_V11 and v1.1 " +
      "credentials; LAN-only.",
    inputSchema: {
      type: "object",
      properties: {
        endpointId: { type: "string", description: ENDPOINT_ID_DESCRIPTION },
        className: {
          type: "string",
          description:
            "WMI class to return instances for, e.g. 'Win32_BIOS'. Matched case-insensitively. " +
            "Omit to get the index of classes available on this endpoint; naming a class that " +
            "was not collected returns the list of ones that were.",
        },
        detail: { type: "boolean", description: DETAIL_DESCRIPTION + " Requires className." },
      },
      required: ["endpointId"],
    },
  },
] as const;

/**
 * Rules run BEFORE the v1.1 gate and before any client exists, so a bad
 * argument never costs a network round trip. `endpointId` is required and
 * GUID-checked here rather than left to the server: v1.1 does answer 400 for a
 * non-GUID, but the unfiltered controllers are 325 KB and 11.9 MB, so a
 * missing filter must not be able to reach the wire at all.
 */
const detailRule: ValidationRule = {
  name: "detail",
  required: false,
  type: "boolean",
  message: "detail must be a boolean",
};

export const V11_RULES: Record<string, ValidationRule[]> = {
  get_endpoint_registry_inventory: [CommonRules.guid("endpointId"), detailRule],
  get_endpoint_file_inventory: [CommonRules.guid("endpointId"), detailRule],
  get_endpoint_wmi_inventory: [
    CommonRules.guid("endpointId"),
    {
      name: "className",
      required: false,
      type: "string",
      message: "className must be a string, e.g. 'Win32_BIOS'",
    },
    detailRule,
  ],
};

/** Read-only, all three: `write` is empty and there is no v1.1 write path. */
export const v11Catalogue = defineToolCatalogue({ tools: [...V11_TOOLS], write: [] });

export const V11_TOOL_NAMES = v11Catalogue.readToolNames;
