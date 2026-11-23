/**
 * The 13 domain servers the package offers, by domain name (#297).
 *
 * Importing a server module runs its entry point unless VITEST is set (as for the
 * gateway's preload): cli.ts sets it before it imports this module, so only the
 * package's own startup runs. The names and their order are the gateway's
 * (`__tests__/bconnect-mcp-package.test.ts` checks both against the servers on disk).
 */
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { CombinedPart } from "@bconnect/mcp-core";

import { createServer as activedirectory } from "bconnect-activedirectory-mcp";
import { createServer as assets } from "bconnect-assets-mcp";
import { createServer as compliance } from "bconnect-compliance-mcp";
import { createServer as defensecontrol } from "bconnect-defensecontrol-mcp";
import { createServer as endpoints } from "bconnect-endpoints-mcp";
import { createServer as groups } from "bconnect-groups-mcp";
import { createServer as jobs } from "bconnect-jobs-mcp";
import { createServer as operatingsystems } from "bconnect-operatingsystems-mcp";
import { createServer as servermanagement } from "bconnect-servermanagement-mcp";
import { createServer as software } from "bconnect-software-mcp";
import { createServer as universaldynamicgroups } from "bconnect-universaldynamicgroups-mcp";
import { createServer as updatemanagement } from "bconnect-updatemanagement-mcp";
import { createServer as variables } from "bconnect-variables-mcp";

/** A domain server's factory: a fresh, unconnected server with the shared client. */
type DomainFactory = () => { server: Server };

const FACTORIES: ReadonlyMap<string, DomainFactory> = new Map<string, DomainFactory>([
  ["activedirectory", activedirectory],
  ["assets", assets],
  ["compliance", compliance],
  ["defensecontrol", defensecontrol],
  ["endpoints", endpoints],
  ["groups", groups],
  ["jobs", jobs],
  ["operatingsystems", operatingsystems],
  ["servermanagement", servermanagement],
  ["software", software],
  ["universaldynamicgroups", universaldynamicgroups],
  ["updatemanagement", updatemanagement],
  ["variables", variables],
]);

/** Every domain name, in the gateway's order. */
export const DOMAINS: readonly string[] = [...FACTORIES.keys()];

/** Fresh, unconnected servers of the chosen domains (names from `DOMAINS`). */
export function domainParts(chosen: readonly string[]): CombinedPart[] {
  return chosen.map((domain) => {
    const factory = FACTORIES.get(domain);
    if (!factory) {
      throw new Error(`Unknown MCP domain '${domain}'`);
    }
    return { domain, server: factory().server };
  });
}
