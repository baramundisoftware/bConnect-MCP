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

/** Where the combined endpoint answers. */
export const COMBINED_PATH = "/mcp";

/** The name and version the combined server reports in `initialize`: the gateway's own. */
export const COMBINED_INFO = {
  name: "bconnect-mcp-gateway",
  version: (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version,
};

/**
 * The domains the combined endpoint offers, in the gateway's domain order, or
 * undefined when the setting is unset or empty (the endpoint is off). `all` gives
 * every domain; otherwise a comma-separated list of domain names (any case;
 * spaces and empty entries ignored, a name given twice counts once). `all` with
 * other names, a list that names no domain, or a name that isn't a domain throws,
 * with the variable and what it accepts.
 */
export function combinedDomains(
  setting: string | undefined,
  known: readonly string[],
): string[] | undefined {
  const raw = (setting ?? "").trim();
  if (raw === "") {return undefined;}
  const refuse = (reason: string): never => {
    throw new Error(
      `MCP_GATEWAY_COMBINED=${JSON.stringify(setting)} isn't valid: ${reason}. ` +
        `Use all, or domain names separated by commas: ${known.join(", ")}.`,
    );
  };
  const names = raw.split(",").map((name) => name.trim().toLowerCase()).filter((name) => name !== "");
  if (names.length === 0) {return refuse("it names no domain");}
  if (names.includes("all")) {
    return names.every((name) => name === "all") ? [...known] : refuse("all stands alone");
  }
  const unknown = names.filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    return refuse(`${unknown.map((name) => JSON.stringify(name)).join(", ")} ${unknown.length === 1 ? "is" : "are"} not a domain`);
  }
  return known.filter((domain) => names.includes(domain));
}
