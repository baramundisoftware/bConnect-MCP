/**
 * The bconnect-mcp package: one or several bConnect domains as one MCP server (#297).
 *
 *   bconnect-mcp endpoints          one domain: that domain's server, as its own build
 *   bconnect-mcp endpoints,jobs     several domains as one server (createCombinedServer)
 *   bconnect-mcp all                every domain; those without tools in the bMS release list none
 *
 * Everything else comes from the environment, as for a domain server: the
 * startup is core's `startServer` (settings, .env, release detection,
 * connectivity check, stdio or MCP_TRANSPORT=http). The connectivity check
 * reads the ManagementServer route, which every release has and the release
 * detection reads too. Before serving, the chosen domains are listed once: a
 * domain named on its own that has no tools in the release stops the start, as
 * a domain server does, and no two domains may list the same tool name.
 */
import { readFileSync } from "node:fs";
import {
  BConnectClientBase,
  combinedTools,
  createCombinedServer,
  domainList,
  selectedRelease,
  serverClients,
  startServer,
  type ServerEntry,
  type StartupIo,
} from "@bconnect/mcp-core";
import { DOMAINS, domainParts } from "./domains.js";

/** The package's name: the name of a combined server and the start of every log line. */
export const NAME = "bconnect-mcp";

/** The name and version a combined server reports in `initialize`. */
export const INFO = {
  name: NAME,
  version: (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version,
};

/** How to call it, for --help and a missing argument. */
export const USAGE =
  `usage: ${NAME} <domains>\n` +
  `  <domains>: all, or domain names separated by commas: ${DOMAINS.join(", ")}\n` +
  "  Settings come from the environment (BCONNECT_BASE_URL, credentials, …), as for a domain server.";

/** Probes the ManagementServer route, which every release has (the release detection reads it too). */
class ProbeClient extends BConnectClientBase {
  protected override readonly probeRoute = "/servermanagement/v2.0/ManagementServer";
}

/** The chosen domains, and whether they were named (not `all`); throws on anything else. */
export function chosenDomains(args: readonly string[]): { domains: string[]; named: boolean } {
  if (args.length !== 1) {
    throw new Error(`expects one argument, the domains: all, or domain names separated by commas (${DOMAINS.join(", ")})`);
  }
  const domains = domainList(args[0], DOMAINS, "domains");
  if (!domains) {
    throw new Error(`the domains argument is empty: use all, or domain names separated by commas (${DOMAINS.join(", ")})`);
  }
  const all = args[0].split(",").some((name) => name.trim().toLowerCase() === "all");
  return { domains, named: !all };
}

/** Why the chosen domains can't be served in the release, or undefined. */
async function domainRefusal(domains: readonly string[], named: boolean): Promise<string | undefined> {
  let tools: Record<string, string[]>;
  try {
    tools = await combinedTools(domainParts(domains), INFO);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  const empty = domains.filter((domain) => (tools[domain] ?? []).length === 0);
  if (empty.length === domains.length || (named && empty.length > 0)) {
    const which = empty.length === 1 ? `domain ${empty[0]} has` : `domains ${empty.join(", ")} have`;
    const apis = empty.length === 1 ? "its" : "their";
    return `the ${which} no tools in bMS ${selectedRelease()}: none of ${apis} APIs exist in that release. Choose other domains, or all.`;
  }
  return undefined;
}

/** The startup entry for the chosen domains. */
export function domainsEntry(domains: readonly string[], named: boolean): ServerEntry<ProbeClient> {
  return {
    name: NAME,
    createServer: () => (domains.length === 1 ? { server: domainParts(domains)[0].server } : createCombinedServer(domainParts(domains), INFO)),
    clients: serverClients(ProbeClient),
    releases: {},
    beforeServe: () => domainRefusal(domains, named),
  };
}

/**
 * The command: `--help` prints the usage; a wrong argument is one line
 * `bconnect-mcp: <reason>` and the usage on stderr, exit code 1; otherwise the
 * chosen domains start through core's startup routine. Tests pass `io`; the
 * command uses the process's stderr, exit and stdio.
 */
export async function main(args: readonly string[], io?: StartupIo): Promise<void> {
  const error = io?.error ?? ((line: string): void => { console.error(line); });
  const exit = io?.exit ?? ((code: number): never => process.exit(code));
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    error(USAGE);
    exit(0);
    return;
  }
  let chosen: ReturnType<typeof chosenDomains>;
  try {
    chosen = chosenDomains(args);
  } catch (refusal) {
    error(`${NAME}: ${refusal instanceof Error ? refusal.message : String(refusal)}`);
    error(USAGE);
    exit(1);
    return;
  }
  const entry = domainsEntry(chosen.domains, chosen.named);
  await (io ? startServer(entry, io) : startServer(entry));
}
