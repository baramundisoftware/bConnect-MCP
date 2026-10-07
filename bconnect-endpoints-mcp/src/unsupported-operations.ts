/**
 * Operations of the bundled specs this server deliberately doesn't offer in a release
 * (REQ-SRV-031, #307): operationId → release → why, in one public sentence.
 *
 * The spec-conformance guard (__tests__/spec-conformance.guard.test.ts) doesn't count a
 * declared operation as a coverage gap in that release, and fails when a declaration no
 * longer holds: the operation isn't in that release's spec, no tool of this server calls it,
 * or that tool is listed in that release. Remove an entry once the operation is offered.
 */
import type { Release } from "@bconnect/mcp-core";

export const UNSUPPORTED_OPERATIONS: Readonly<Record<string, Readonly<Partial<Record<Release, string>>>>> = {
  UpdateMaintenanceWindowForEndpointById: {
    "25R2": "bMS 25R2 updates a maintenance window with PUT, and its specification describes that request in two contradicting ways; updating needs 26R1 until a 25R2 bMS confirms it.",
  },
  UpdateMaintenanceWindowForLogicalGroupById: {
    "25R2": "bMS 25R2 updates a maintenance window with PUT, and its specification describes that request in two contradicting ways; updating needs 26R1 until a 25R2 bMS confirms it.",
  },
};
