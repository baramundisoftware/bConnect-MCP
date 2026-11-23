/**
 * bconnect-mcp-gateway — the combined endpoint, MCP_GATEWAY_COMBINED (#131).
 *
 * `POST /mcp` offers the tools of several domains as one MCP server, for clients
 * and proxies (LiteLLM and the like) that want one server entry instead of one
 * per domain. Off by default. The setting turns it on and chooses the domains:
 * `all`, or domain names separated by commas. Tool names stay as the domains
 * define them; the gateway checks at startup that no two chosen domains share one.
 */

import { readFileSync } from "node:fs";
import { domainList } from "@bconnect/mcp-core";

/** Where the combined endpoint answers. */
export const COMBINED_PATH = "/mcp";

/** The name and version the combined server reports in `initialize`: the gateway's own. */
export const COMBINED_INFO = {
  name: "bconnect-mcp-gateway",
  version: (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version,
};

/**
 * The domains the combined endpoint offers, in the gateway's domain order, or
 * undefined when the setting is unset or empty (the endpoint is off). The form
 * and the refusals are core's `domainList`, shared with the bconnect-mcp package.
 */
export function combinedDomains(
  setting: string | undefined,
  known: readonly string[],
): string[] | undefined {
  return domainList(setting, known, "MCP_GATEWAY_COMBINED");
}
