/**
 * The bMS release the servers work with, chosen in one place (REQ-SRV-028, #159, ADR-0014).
 *
 * At startup `detectRelease` reads `version` from the connected bMS
 * (GET /servermanagement/v2.0/ManagementServer) once per process. Every
 * release-dependent decision — query tables, countOnly, tool lists, refusals,
 * error texts, the software probe — asks `selectedRelease()`: the detected
 * release, else BCONNECT_RELEASE, else 26R1. Detection never stops a server;
 * what it can't use falls back with a warning that says why. Nothing else
 * reads BCONNECT_RELEASE (release-source.guard.test.ts).
 */
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { BConnectApiError } from "./api-errors.js";
import type { BConnectClientBase } from "./bconnect-client-base.js";
import { checkRelease, ClientConfigError, RELEASES } from "./client-config.js";

export type Release = (typeof RELEASES)[number];

/** Where detection writes its lines: stderr for a stdio server, the gateway's logger. */
export interface ReleaseLog {
  info: (line: string) => void;
  warn: (line: string) => void;
}

/** Major.minor of the bMS version → release. 26R2 joins here with #280. */
const VERSION_RELEASES: Readonly<Record<string, Release>> = { "26.1": "26R1", "25.2": "25R2" };

let detected: { release: Release; version: string } | undefined;

const isDigits = (part: string): boolean => {
  if (part === "") {
    return false;
  }
  for (const ch of part) {
    if (ch < "0" || ch > "9") {
      return false;
    }
  }
  return true;
};

/** The release of a bMS version such as `26.1.161.0`; undefined for anything else. */
export function releaseFromVersion(version: unknown): Release | undefined {
  if (typeof version !== "string") {
    return undefined;
  }
  const parts = version.split(".");
  if (parts.length < 2 || !parts.every(isDigits)) {
    return undefined;
  }
  const key = `${parts[0]}.${parts[1]}`;
  return Object.hasOwn(VERSION_RELEASES, key) ? VERSION_RELEASES[key] : undefined;
}

/** A value from bMS as one short quoted string, so it can't forge or flood a log line. */
const quoted = (value: string): string => JSON.stringify(value.length > 32 ? `${value.slice(0, 32)}…` : value);

/**
 * BCONNECT_RELEASE as the servers have always read it: unset or 26R1 is 26R1,
 * anything else 25R2. Only 26R1 and 25R2 get past the settings check.
 */
const settingRelease = (env: NodeJS.ProcessEnv): Release => (env.BCONNECT_RELEASE === undefined || env.BCONNECT_RELEASE === "26R1" ? "26R1" : "25R2");

/** The release every release-dependent decision uses; read on every call. */
export function selectedRelease(env: NodeJS.ProcessEnv = process.env): Release {
  return detected?.release ?? settingRelease(env);
}

/** The selected release and where it came from, e.g. `25R2 (detected: bMS 25.2.0.0)`. */
export function releaseDescription(env: NodeJS.ProcessEnv = process.env): string {
  if (detected) {
    return `${detected.release} (detected: bMS ${detected.version})`;
  }
  return `${settingRelease(env)} (${env.BCONNECT_RELEASE === undefined ? "default" : "from BCONNECT_RELEASE"})`;
}

/** The refusal for a tool the selected release doesn't offer; `needed` names the release(s) that do. */
export function releaseRefusal(tool: string, needed: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${tool} is only available in bMS ${needed}; this server uses ${releaseDescription(env)}.`;
}

/** Stops on an invalid BCONNECT_RELEASE (ClientConfigError), as the settings check does. */
export function checkReleaseSetting(env: NodeJS.ProcessEnv = process.env): void {
  checkRelease(env.BCONNECT_RELEASE);
}

/** Forgets a detected release (tests; a process detects once). */
export function forgetDetectedRelease(): void {
  detected = undefined;
}

/**
 * Why detection failed, as one line: the status for an API error; the whole
 * message for a settings error (our own text, and the operator needs all of
 * it); the first sentence of anything else, without the tool-call advice.
 */
const reasonOf = (error: unknown): string => {
  if (error instanceof BConnectApiError) {
    return `ManagementServer answered ${error.status}`;
  }
  const message = (error instanceof Error ? error.message : String(error)).split(/[\r\n]+/).join(" ").trim();
  if (error instanceof ClientConfigError) {
    return message;
  }
  const first = message.split(". ")[0].replace(" (BCONNECT_TIMEOUT_MS)", "");
  return first.length > 120 ? `${first.slice(0, 120)}…` : first;
};

/**
 * Detects the release of the connected bMS once and logs it. A different
 * BCONNECT_RELEASE is overridden, with a warning. Unreadable, missing or
 * unknown versions keep the setting (or 26R1), with a warning. With
 * BCONNECT_SKIP_CONNECTIVITY_CHECK=true nothing is sent. `client` may be a
 * factory (the gateway builds one from its service settings); if it throws,
 * that is a reason to fall back too.
 */
export async function detectRelease(
  client: BConnectClientBase | (() => BConnectClientBase),
  log: ReleaseLog,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Release> {
  detected = undefined;
  if (env.BCONNECT_SKIP_CONNECTIVITY_CHECK === "true") {
    log.info(`release detection skipped (BCONNECT_SKIP_CONNECTIVITY_CHECK=true); using ${releaseDescription(env)}`);
    return selectedRelease(env);
  }
  const fallBack = (reason: string): Release => {
    log.warn(`could not detect the bMS release (${reason}); using ${releaseDescription(env)}`);
    return selectedRelease(env);
  };
  let version: unknown;
  try {
    version = await (typeof client === "function" ? client() : client).managementServerVersion();
  } catch (error) {
    return fallBack(reasonOf(error));
  }
  if (typeof version !== "string" || version === "") {
    return fallBack("the ManagementServer answer has no version");
  }
  const release = releaseFromVersion(version);
  if (!release) {
    return fallBack(`bMS version ${quoted(version)} is not a supported release: ${RELEASES.join(", ")}`);
  }
  // A known version is digits and dots only, safe to log as it is.
  detected = { release, version };
  const setting = env.BCONNECT_RELEASE;
  if (setting !== undefined && setting !== release) {
    log.warn(`bMS ${version} → release ${release}; BCONNECT_RELEASE=${setting} is ignored`);
  } else {
    log.info(`bMS ${version} → release ${release}`);
  }
  return release;
}

/** Per tool: the releases whose spec has every route the tool calls; generated into each server's src/tool-releases.ts. */
export type ToolReleaseTable = Readonly<Record<string, readonly Release[]>>;

const isNamed = (tool: object): tool is { name: string } => "name" in tool && typeof tool.name === "string";

/** The releases of a listed tool; a tool missing from the table means it wasn't regenerated. */
function releasesOf(table: ToolReleaseTable, tool: string): readonly Release[] {
  if (!Object.hasOwn(table, tool)) {
    throw new Error(`No releases for ${tool}; run node scripts/generate-query-parameters.mjs`);
  }
  return table[tool];
}

/**
 * The tool list of the selected release (REQ-SRV-028 AC 5): a tool is listed
 * only when the release's spec has every route it calls. Read per request,
 * like the release itself.
 */
export function withReleaseTools<Result extends { tools: object[] }>(
  table: ToolReleaseTable,
  handler: () => Result | Promise<Result>,
): () => Promise<Result> {
  return async () => {
    const result = await handler();
    const release = selectedRelease();
    return { ...result, tools: result.tools.filter((tool) => !isNamed(tool) || releasesOf(table, tool.name).includes(release)) };
  };
}

/**
 * Refuses a call to a tool the selected release doesn't offer, before anything
 * is sent (MethodNotFound, naming the release(s) that offer it and the one in
 * use). A name the table doesn't know is left to the server.
 */
export function refuseUnavailableTool(table: ToolReleaseTable, tool: string): void {
  if (!Object.hasOwn(table, tool) || table[tool].includes(selectedRelease())) {
    return;
  }
  throw new McpError(ErrorCode.MethodNotFound, releaseRefusal(tool, table[tool].join(" or ")));
}
