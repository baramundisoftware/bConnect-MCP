/**
 * bconnect-mcp-gateway — bConnect configuration validation at startup (SEC-1).
 *
 * WHY THIS EXISTS
 * ---------------
 * The thirteen stdio servers validate their bConnect configuration in
 * `runServer` (packages/mcp-core): BCONNECT_BASE_URL must be present, a
 * credential must be present, an `http://` base URL is refused unless the
 * operator opts in on purpose, and the connected bMS must be 26R1 or later.
 * The gateway ran none of it, and could not: `runServer` bootstraps only when
 * `shouldAutoStart()` is true, and preload.ts sets VITEST so that importing
 * thirteen server modules does not start thirteen stdio servers on the
 * gateway's stdout.
 *
 * That suppression is correct and stays. What was wrong is that "do not
 * auto-start a stdio transport" had been conflated with "do not check the
 * configuration": the one component that listens on a socket was the one
 * component that would send the bConnect API key — and, with v1.1 enabled, a
 * domain account's Basic header — over clear-text http:// without a word.
 *
 * So the checks are performed here, explicitly, before anything binds. The
 * refusal MESSAGES are imported from mcp-core rather than restated, so the two
 * paths cannot drift apart about what is wrong or how to fix it.
 *
 * The decisions are pure and the I/O is injected, for the reason auth.ts gives
 * for `evaluateBindPosture`: gateway.ts is a top-level script that calls
 * process.exit(), which cannot be exercised from a test without taking the
 * runner with it.
 */

import {
  evaluateBmsVersionGate,
  missingBaseUrlMessage,
  missingCredentialsMessage,
  type ConnectionProbe,
} from "@bconnect/mcp-core";

/** The name the refusal lines are printed under, matching the stdio servers. */
export const GATEWAY_NAME = "bconnect-mcp-gateway";

export interface StartupConfigVerdict {
  /** May the gateway start? */
  ok: boolean;
  /** Why not, ready to print. Present only when ok === false. */
  reason?: string;
  /** Lines to print alongside a refusal. */
  detail: string[];
  /** Lines to print on a configuration that starts but is not safe. */
  warnings: string[];
  /** The base URL, once it is known to be present. */
  baseUrl?: string;
}

/**
 * Validate the bConnect service credential the gateway will use.
 *
 * Deliberately mirrors runServer's order — base URL, credential, scheme — so an
 * operator moving between the stdio and gateway deployments meets the same
 * refusal in the same order for the same misconfiguration.
 */
export function evaluateStartupConfig(
  env: NodeJS.ProcessEnv = process.env,
): StartupConfigVerdict {
  const baseUrl = env.BCONNECT_BASE_URL;
  const apiKey = env.BCONNECT_API_KEY;
  const username = env.BCONNECT_USERNAME;
  const password = env.BCONNECT_PASSWORD;

  if (!baseUrl) {
    return { ok: false, reason: missingBaseUrlMessage(GATEWAY_NAME), detail: [], warnings: [] };
  }
  if (!apiKey && (!username || !password)) {
    return { ok: false, reason: missingCredentialsMessage(GATEWAY_NAME), detail: [], warnings: [] };
  }

  // The scheme check is the reason this file exists. It runs BEFORE the
  // connectivity probe below, so a refused configuration never puts the
  // credential on the wire even once.
  if (/^http:\/\//i.test(baseUrl)) {
    if (env.BCONNECT_ALLOW_INSECURE_HTTP === "true") {
      return {
        ok: true,
        detail: [],
        warnings: [
          `${GATEWAY_NAME}: WARNING — BCONNECT_BASE_URL uses http://. Credentials are sent in ` +
            `CLEAR TEXT on every request. Permitted because BCONNECT_ALLOW_INSECURE_HTTP=true.`,
        ],
        baseUrl,
      };
    }
    return {
      ok: false,
      reason:
        `${GATEWAY_NAME}: BCONNECT_BASE_URL uses http://, which sends your bConnect API key — ` +
        `and, if bConnect v1.1 is enabled, the Basic header for a domain account — in CLEAR ` +
        `TEXT over the network.`,
      detail: [
        "Use https://. If this is a lab on an isolated segment and you accept the exposure, " +
          "set BCONNECT_ALLOW_INSECURE_HTTP=true to proceed.",
      ],
      warnings: [],
      baseUrl,
    };
  }

  return { ok: true, detail: [], warnings: [], baseUrl };
}

// ─── Connectivity and the 26R1 version gate (VER-1) ──────────────────────────

/**
 * The part of a bConnect client the startup probe touches. Structural, so a
 * real client satisfies it and a test double can too.
 */
export interface StartupProbeClient {
  testConnection(): Promise<boolean>;
  getConnectionProbe?(): ConnectionProbe | undefined;
}

/** A line to report, carrying the level it should be reported at. */
export interface StartupLine {
  level: "info" | "warn" | "error";
  text: string;
}

export interface ConnectivityVerdict {
  ok: boolean;
  /** Everything the probe and the version gate had to say, in order. */
  lines: StartupLine[];
}

/**
 * Probe bConnect once and evaluate the 26R1 gate on what the probe learned.
 *
 * One request, not two: `testConnection()` fetches the ManagementServer
 * document and records what it saw, and `evaluateBmsVersionGate` reads that
 * back — the same arrangement runServer uses, so the gateway and the stdio
 * servers gate on identical evidence. docker-compose.gateway.yml's header
 * describes this check; until SEC-1 it described something that never ran.
 *
 * BCONNECT_SKIP_CONNECTIVITY_CHECK=true is honoured inside the client, which
 * reports the probe as "skipped"; the gate then says so rather than refusing.
 */
export async function evaluateConnectivity(
  client: StartupProbeClient,
  baseUrl: string,
): Promise<ConnectivityVerdict> {
  const lines: StartupLine[] = [
    { level: "info", text: `${GATEWAY_NAME}: verifying bConnect API connectivity...` },
  ];

  if (!(await client.testConnection())) {
    lines.push({
      level: "error",
      text:
        `${GATEWAY_NAME}: cannot reach bConnect API at ${baseUrl}. ` +
        `Check BCONNECT_BASE_URL, credentials, and network.`,
    });
    return { ok: false, lines };
  }
  // Same truthfulness rule as runServer (mcp-core): the skip path returns true
  // WITHOUT any request, and this used to push "verified" anyway — the log
  // then read "API connectivity verified." followed by "startup probe
  // skipped", a contradiction chased on the reference deployment 2026-08-22.
  const startupProbe =
    typeof client.getConnectionProbe === "function" ? client.getConnectionProbe() : undefined;
  if (startupProbe?.outcome === "skipped") {
    lines.push({
      level: "warn",
      text:
        `${GATEWAY_NAME}: connectivity check SKIPPED (BCONNECT_SKIP_CONNECTIVITY_CHECK=true) — ` +
        `nothing was verified.`,
    });
  } else {
    lines.push({ level: "info", text: `${GATEWAY_NAME}: API connectivity verified.` });
  }

  // A double without `getConnectionProbe` has nothing to evaluate; every real
  // client inherits it from BConnectClientBase.
  if (typeof client.getConnectionProbe !== "function") {
    return { ok: true, lines };
  }

  // Everything the gate says short of a refusal is advisory — an unreadable or
  // unparseable version proceeds with the evidence, it does not stop the
  // gateway. Reported at warn so it survives LOG_LEVEL=warn, which is what an
  // operator running this as a service will have set.
  const gate = evaluateBmsVersionGate(GATEWAY_NAME, client.getConnectionProbe());
  for (const text of gate.lines) {
    lines.push({ level: gate.refuse ? "error" : "warn", text });
  }
  return { ok: !gate.refuse, lines };
}

// ─── The whole startup sequence, as one testable unit ────────────────────────

export interface StartupChecksOptions {
  env?: NodeJS.ProcessEnv;
  /** Reporting sink for a refusal. */
  error: (line: string) => void;
  /** Reporting sink for a configuration that starts but is not safe. */
  warn: (line: string) => void;
  /** Reporting sink for progress. */
  info: (line: string) => void;
  /**
   * The client the connectivity probe uses. Called only once the configuration
   * has been accepted — building it resolves the credential, which a refused
   * configuration must not get as far as doing. Return undefined to skip the
   * probe (there is then no version gate to evaluate, exactly as for a stdio
   * server whose client predates `getConnectionProbe`).
   */
  probeClient: () => StartupProbeClient | undefined;
}

/**
 * Run every check the stdio path runs, in the stdio path's order.
 *
 * Returns rather than exits: gateway.ts owns the process, this owns the
 * decision. `ok: false` means "do not bind".
 */
export async function runStartupChecks(options: StartupChecksOptions): Promise<{ ok: boolean }> {
  const config = evaluateStartupConfig(options.env ?? process.env);
  for (const line of config.warnings) {
    options.warn(line);
  }
  if (!config.ok) {
    options.error(config.reason ?? "Refusing to start.");
    for (const line of config.detail) {
      options.error(line);
    }
    return { ok: false };
  }

  const client = options.probeClient();
  if (!client) {
    return { ok: true };
  }

  const connectivity = await evaluateConnectivity(client, config.baseUrl ?? "");
  for (const line of connectivity.lines) {
    ({ info: options.info, warn: options.warn, error: options.error })[line.level](line.text);
  }
  return { ok: connectivity.ok };
}
