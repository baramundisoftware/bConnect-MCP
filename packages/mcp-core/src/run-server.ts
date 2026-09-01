/**
 * Unified server bootstrap (finding OPT-32)
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * Thirteen servers hand-wrote `main()`. Normalising the server name and
 * collapsing whitespace yields six textual variants; stripping CR and trimming
 * every line collapses those to **four that actually behave differently**:
 *
 *   V1 (8 servers)  throwaway `_startupClient`; `dotenv.config()` twice
 *   V2 (2 servers)  as V1, one `dotenv.config()`
 *   V3 (endpoints, jobs)  long-lived client; `throw` on missing creds; the only
 *                         two that parse BCONNECT_RATE_LIMIT_* / _AUDIT_LEVEL
 *   V4 (groups)     BCONNECT_BASE_URL required; rejectUnauthorizedFromEnv()
 *
 * Six differences, resolved here once. Each is recorded with which servers it
 * changes, because *every* server changes behaviour in at least one respect and
 * an operator runbook that greps stderr needs to know which line moved.
 *
 * ── Difference 1: missing credentials — exit, do not throw ──────────────────
 * endpoints and jobs `throw`, which surfaces as `Fatal error: Error: ...` plus a
 * stack trace. The other eleven print one server-prefixed line and exit 1.
 * **Resolved: exit 1 with the server-prefixed line.** A missing environment
 * variable is an operator error, not a bug; a stack trace is noise. The message
 * text is the eleven-server wording, unchanged, so existing greps keep matching.
 * CHANGES: endpoints, jobs (stderr text and no stack trace).
 *
 * ── Difference 2: BCONNECT_BASE_URL is required. This one is a defect ───────
 * Twelve of thirteen did:
 *
 *     const url = process.env.BCONNECT_BASE_URL || "https://bms.example.com:443/bconnect";
 *
 * With the variable unset those twelve send **real credentials to a hostname the
 * vendor does not control**. It usually dies in DNS and the connectivity check
 * exits 1 — but that is luck, not design. Anyone whose resolver answers for
 * `bms.example.com` (split-horizon DNS, a wildcard internal zone, a typo-squat)
 * receives a Basic-auth header or an API key on the first request.
 *
 * **Resolved: no default. Absent BCONNECT_BASE_URL is a hard exit 1.** This is
 * groups' pre-existing behaviour, promoted to the rule.
 * CHANGES: all twelve except groups — deliberately.
 *
 * ── Difference 3: one client, not two ───────────────────────────────────────
 * V1/V2/V4 build a second `BConnectClient` purely to call `testConnection()` and
 * then discard it; the tools later build their own. A throwaway can verify under
 * different settings than the tools run with — which is precisely the hazard
 * groups had already patched for TLS in one server:
 *
 *     // OPT-33 — same resolver as the runtime provider above, so the startup
 *     // check cannot verify under a different policy than the tools do.
 *
 * **Resolved: the check probes the client the tools will use.** When
 * `createServer()` returns its memoised `getClient` (see `createClientProvider`),
 * `runServer` calls exactly that, so the two cannot diverge — it is structurally
 * impossible rather than patched per server. Servers that do not yet expose
 * `getClient` fall back to `clientFactory` + `resolveClientConfig`, i.e. the same
 * env→config mapping the provider uses.
 * CHANGES: the eleven non-endpoints/jobs servers. Side effect, and a fix in its
 * own right: they begin honouring BCONNECT_RATE_LIMIT_*, BCONNECT_CACHE_*,
 * BCONNECT_BATCH_* and BCONNECT_AUDIT_LEVEL, which `resolveClientConfig` has
 * always read and which the throwaway startup client silently ignored.
 *
 * ── Difference 4: one TLS resolver ──────────────────────────────────────────
 * Twelve inline `NODE_TLS_REJECT_UNAUTHORIZED !== "0"`; groups reads
 * `BCONNECT_REJECT_UNAUTHORIZED !== "false"`. Not the same knob — the same
 * *default*. `rejectUnauthorizedFromEnv()` honours both (see its own note).
 *
 * ── Difference 5: the test-mode guard ───────────────────────────────────────
 * `if (!process.env.VITEST)` (nine) vs `if (process.env.VITEST === undefined)`
 * (four). **Resolved: `=== undefined`** — `VITEST=0` and `VITEST=""` defeat the
 * truthiness form, and a bootstrap that runs during a test suite dials out.
 * `shouldAutoStart()` is exported so the guard is spelt once.
 *
 * ── Difference 6: `err` vs `error`, and dotenv called twice ─────────────────
 * No behavioural impact. `dotenv.config()` is called exactly once here.
 *
 * ── What is deliberately NOT here ───────────────────────────────────────────
 * `express`. mcp-core does not depend on it and will not: the thirteen servers
 * pin `^4.21.0` while the workspace root hoists 5.x, and a shared package is the
 * wrong place to arbitrate that. HTTP mode therefore takes `express` by
 * injection (`http.express`) and mcp-core owns everything around it — the
 * routes, the 405s, the loopback-bind refusal, the Host/Origin guard and the
 * transport lifecycle.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 * ```ts
 * import express from "express";
 * import { runServer, shouldAutoStart } from "@bconnect/mcp-core";
 *
 * if (shouldAutoStart()) {
 *   void runServer({
 *     name: "bconnect-jobs-mcp",
 *     createServer,                 // may return { server, getClient }
 *     clientFactory: (config) => new BConnectClient(config),
 *     http: { express },
 *   });
 * }
 * ```
 */

import * as dotenv from "dotenv";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { BMS_VERSION_PROBE_PATH, type BConnectConfig, type ConnectionProbe } from "./bconnect-client-base.js";
import {
  resolveClientConfig,
  type BConnectCredentialOverrides,
  type MissingCredentialReason,
} from "./client-provider.js";
import {
  createHttpGuardMiddleware,
  httpGuardStartupLine,
  resolveHttpGuardConfig,
  sdkTransportOptions,
} from "./http-host-guard.js";

// ── TLS (Difference 4) ───────────────────────────────────────────────────────

/**
 * Should the HTTPS agent verify the bMS certificate?
 *
 * Two knobs existed and they were not the same knob. groups-mcp read
 * `BCONNECT_REJECT_UNAUTHORIZED !== "false"`; the other twelve read
 * `NODE_TLS_REJECT_UNAUTHORIZED !== "0"`. With neither set both answer `true`,
 * which is why the divergence went unnoticed.
 *
 * This honours **both**, and that is not a loosening: `NODE_TLS_REJECT_UNAUTHORIZED=0`
 * already disables certificate verification process-wide inside Node itself, so
 * a groups process running with it set was never verifying whatever its agent
 * option said. Honouring it makes the agent option tell the truth.
 *
 * Takes `env` so a test does not have to mutate `process.env`.
 */
export function rejectUnauthorizedFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.BCONNECT_REJECT_UNAUTHORIZED === "false") {
    return false;
  }
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    return false;
  }
  return true;
}

// ── The test-mode guard (Difference 5) ───────────────────────────────────────

/**
 * Is this process the entry point rather than a test importing the module?
 *
 * `=== undefined`, never `!process.env.VITEST`: vitest sets `VITEST=true`, but an
 * operator or a wrapper that sets `VITEST=0` or `VITEST=` would defeat the
 * truthiness form and a bootstrap would run — opening a real connection to bMS —
 * in the middle of a test suite.
 */
export function shouldAutoStart(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VITEST === undefined;
}

// ── Failure messages (Difference 1 and 2) ────────────────────────────────────

/**
 * The missing-credentials line, byte-for-byte as eleven servers already print
 * it. endpoints and jobs used to throw instead; they now print this.
 */
export function missingCredentialsMessage(serverName: string): string {
  return (
    `${serverName}: Either BCONNECT_API_KEY or both BCONNECT_USERNAME and ` +
    `BCONNECT_PASSWORD are required`
  );
}

/**
 * The missing-base-URL line. There is no default and there must not be one —
 * see Difference 2 in the header.
 */
export function missingBaseUrlMessage(serverName: string): string {
  return (
    `${serverName}: BCONNECT_BASE_URL is required and has no default.\n` +
    `  BCONNECT_BASE_URL — e.g. https://bms.internal.example:443/bconnect\n` +
    `  Refusing to start rather than fall back to a placeholder host: the ` +
    `previous default sent real credentials to a hostname the vendor does not control.`
  );
}

// ── Options ──────────────────────────────────────────────────────────────────

/** The subset of `Server` this module touches. Structural, so the SDK's real
 *  `Server` satisfies it and a test double can too. */
export interface ConnectableServer {
  connect(transport: never): Promise<void>;
  close(): Promise<void>;
}

/**
 * What a server's `createServer()` hands back.
 *
 * `getClient` is optional only so the thirteen servers can adopt `runServer`
 * before they expose it. Supply it: it is what makes Difference 3 structural.
 */
export interface ServerHandle<TClient = unknown> {
  server: ConnectableServer;
  /** The memoised provider the tool dispatch calls. See `createClientProvider`. */
  getClient?: () => TClient;
}

/** Just enough of a client for the startup probe. */
export interface ProbeableClient {
  testConnection(): Promise<boolean>;
  /**
   * What `testConnection()` learned, including the bMS version when the
   * ManagementServer route was readable (VER-1). Optional so a pre-gate test
   * double still satisfies the interface; every real client inherits it from
   * `BConnectClientBase`. When absent, the 26R1 gate has nothing to read and
   * is skipped.
   */
  getConnectionProbe?(): ConnectionProbe | undefined;
}

// ── The 26R1 version gate (VER-1) ────────────────────────────────────────────

/** The oldest bMS this suite supports: 26R1. Routes several tools call were
 *  added in 26R1; against an older bMS they 404 and the data published would
 *  be missing or wrong. */
export const MINIMUM_BMS_VERSION = { major: 26, release: 1 } as const;

/**
 * Parse the `version` string of `GET /v2.0/ManagementServer` into a
 * (major, release) pair, or null if it matches neither accepted shape.
 *
 * The 26R1 OpenAPI spec types the field as a bare required string — no format,
 * no example — and no real value from a live bMS has been captured in this
 * repo, so the parser is deliberately permissive about where in the string the
 * version sits and accepts BOTH shapes the codebase itself uses:
 *
 *   1. Release form — "26R1", "26 r2", "bMS 2026 R1": digits, an R, digits.
 *      This is how baramundi names releases everywhere in this repo
 *      (openapi-specs/26R1/, the README).
 *   2. Dotted form — "26.1.180.0", "26.2": the first two numeric components as
 *      (major, release). This is how the repo's own code spells the same
 *      release numerically (the servermanagement server calls itself "26.1.7",
 *      and its surface test mocks the ManagementServer version as "26.1").
 *
 * Either way, a 4-digit major >= 2000 is treated as a year and mapped to its
 * two-digit form (2026 -> 26), because baramundi has named the same release
 * both ways ("2022 R1" vs "22R1") and reading "2025 R2" as major 2025 would
 * wave a 25R2 server through.
 *
 * Anything else returns null, and the caller must warn and proceed — a false
 * refusal against a healthy 26R1 bMS is worse than the inaccuracy the gate
 * prevents.
 */
export function parseBmsVersion(raw: string): { major: number; release: number } | null {
  const releaseForm = /(\d{1,4})\s*[Rr]\s*(\d{1,3})\b/.exec(raw);
  const dottedForm = releaseForm === null ? /(\d{1,4})\.(\d{1,4})/.exec(raw) : null;
  const match = releaseForm ?? dottedForm;
  if (match === null) {
    return null;
  }
  let major = Number(match[1]);
  const release = Number(match[2]);
  if (major >= 2000) {
    major -= 2000; // year-form major: 2026 R1 === 26R1
  }
  return { major, release };
}

/** Is (major, release) at or above the 26R1 minimum? */
export function satisfiesMinimumBmsVersion(v: { major: number; release: number }): boolean {
  return (
    v.major > MINIMUM_BMS_VERSION.major ||
    (v.major === MINIMUM_BMS_VERSION.major && v.release >= MINIMUM_BMS_VERSION.release)
  );
}

/** The refusal line. Keep "requires baramundi Management Suite 26R1" verbatim —
 *  the README troubleshooting table tells operators to grep for it. */
export function bmsVersionRefusalMessage(serverName: string, rawVersion: string): string {
  const min = `${MINIMUM_BMS_VERSION.major}R${MINIMUM_BMS_VERSION.release}`;
  return (
    `${serverName}: requires baramundi Management Suite ${min} or later; the connected bMS ` +
    `reports version "${rawVersion}". Refusing to start: several tools call bConnect routes ` +
    `that do not exist before ${min}, so the data published would be missing or inaccurate. ` +
    `Upgrade the bMS. (BCONNECT_SKIP_CONNECTIVITY_CHECK=true skips this check, but does not ` +
    `make the missing routes exist.)`
  );
}

/**
 * Evaluate the gate for one probe outcome. Pure: returns the stderr lines and
 * whether to refuse, so it is testable without a bootstrap. Only a version
 * that PARSES and is BELOW 26R1 refuses; everything undeterminable — a denied
 * or absent version route, a missing field, an unparseable string — warns with
 * the exact evidence and proceeds.
 */
export function evaluateBmsVersionGate(
  serverName: string,
  probe: ConnectionProbe | undefined
): { refuse: boolean; lines: string[] } {
  const min = `${MINIMUM_BMS_VERSION.major}R${MINIMUM_BMS_VERSION.release}`;
  const verifyYourself =
    `Proceeding, but this suite requires baramundi Management Suite ${min} or later — ` +
    `verify the bMS release yourself; against an older bMS several tools would return ` +
    `missing or inaccurate data.`;

  switch (probe?.outcome) {
    case undefined:
    case "skipped":
      // Documented: BCONNECT_SKIP_CONNECTIVITY_CHECK skips the version gate
      // with the connectivity check. `undefined` means the client never ran a
      // probe at all (a stubbed testConnection or a pre-gate client) — there
      // is nothing to evaluate.
      return {
        refuse: false,
        lines: [
          `${serverName}: startup probe skipped — the bMS ${min} version gate is skipped with it.`,
        ],
      };
    case "denied":
      return {
        refuse: false,
        lines: [
          `${serverName}: warning: could not read the bMS version — HTTP ${probe.status} on ` +
            `GET ${BMS_VERSION_PROBE_PATH} (credential not scoped for servermanagement, or ` +
            `route absent). ${verifyYourself}`,
        ],
      };
    case "no-version-field":
      return {
        refuse: false,
        lines: [
          `${serverName}: warning: GET ${BMS_VERSION_PROBE_PATH} answered without a ` +
            `usable "version" string, though the 26R1 spec requires one. ${verifyYourself}`,
        ],
      };
    case "failed":
      // testConnection() returned false and runServer already exited; this arm
      // exists so the switch is exhaustive if someone calls the pure function.
      return { refuse: false, lines: [] };
    case "version": {
      const parsed = parseBmsVersion(probe.version);
      if (parsed === null) {
        return {
          refuse: false,
          lines: [
            `${serverName}: warning: could not parse the bMS version string ` +
              `"${probe.version}" reported by GET ${BMS_VERSION_PROBE_PATH}. ${verifyYourself}`,
          ],
        };
      }
      if (!satisfiesMinimumBmsVersion(parsed)) {
        return { refuse: true, lines: [bmsVersionRefusalMessage(serverName, probe.version)] };
      }
      return {
        refuse: false,
        lines: [
          `${serverName}: bMS version "${probe.version}" satisfies the ${min} minimum.`,
        ],
      };
    }
  }
}

/** Structural `express`, so mcp-core need not depend on express. */
export interface ExpressLike {
  (): ExpressAppLike;
  json(): unknown;
}

export interface ExpressAppLike {
  use(middleware: unknown): unknown;
  post(path: string, handler: (req: ExpressReqLike, res: ExpressResLike) => unknown): unknown;
  get(path: string, handler: (req: ExpressReqLike, res: ExpressResLike) => unknown): unknown;
  delete(path: string, handler: (req: ExpressReqLike, res: ExpressResLike) => unknown): unknown;
  listen(port: number, host: string, callback: () => void): unknown;
}

export interface ExpressReqLike {
  body?: unknown;
}

export interface ExpressResLike {
  on(event: "close", listener: () => void): unknown;
  writeHead(status: number): { end(body?: string): unknown };
}

export interface RunServerOptions<TClient extends ProbeableClient = ProbeableClient> {
  /** e.g. `"bconnect-jobs-mcp"`. Prefixes every stderr line. */
  name: string;

  /** The server's own factory. May return `getClient` — see `ServerHandle`. */
  createServer: (credentials?: BConnectCredentialOverrides) => ServerHandle<TClient>;

  /**
   * Builds a client from a resolved config. Used only when `createServer` does
   * not expose `getClient`; the config comes from `resolveClientConfig`, so even
   * the fallback probes under the tools' configuration.
   */
  clientFactory?: (config: BConnectConfig) => TClient;

  /** `express`, injected. Omit it and `MCP_TRANSPORT=http` is refused. */
  http?: { express: ExpressLike };

  /** Environment. Injected so tests need not mutate `process.env`. */
  env?: NodeJS.ProcessEnv;

  /** stderr sink. Injected for tests. */
  log?: (line: string) => void;

  /** Process exit. Injected for tests; must not return. */
  exit?: (code: number) => never;

  /** Skip `dotenv.config()`. Tests set this; production never does. */
  skipDotenv?: boolean;
}

/** What `runServer` resolved and did, so a test can assert it without spying. */
export interface RunServerResult<TClient> {
  transport: "stdio" | "http";
  baseUrl: string;
  /** The client the startup connectivity check actually probed. */
  probedClient: TClient;
  /** Present in stdio mode: the long-lived handle now serving the transport. */
  handle?: ServerHandle<TClient>;
  /** Present in http mode. */
  port?: number;
  bind?: string;
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

const LOOPBACK_BINDS = new Set(["127.0.0.1", "::1", "localhost"]);

/**
 * Parse `MCP_PORT`.
 *
 * The thirteen hand-written `main()`s did `parseInt(process.env.MCP_PORT ?? "3000", 10)`
 * and passed the result straight to `listen()`. `MCP_PORT=` or `MCP_PORT=http`
 * therefore produced `NaN`, and `listen(NaN)` binds an arbitrary free port — the
 * server comes up, says nothing, and is unreachable at the port the operator
 * configured. Rejected loudly instead.
 */
export function parsePort(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") {
    return 3000;
  }
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const port = Number(raw);
  return port >= 1 && port <= 65535 ? port : null;
}

/**
 * Boot one bConnect MCP server.
 *
 * Resolves configuration, fails loudly if it cannot, probes bMS with the client
 * the tools will use, then serves stdio (default) or HTTP.
 *
 * Never returns normally on a configuration error — it calls `exit`.
 */
export async function runServer<TClient extends ProbeableClient>(
  options: RunServerOptions<TClient>
): Promise<RunServerResult<TClient>> {
  const {
    name,
    env = process.env,
    log = (line: string) => process.stderr.write(`${line}\n`),
    exit = ((code: number) => process.exit(code)) as (code: number) => never,
  } = options;

  // Difference 6 — once, not twice.
  if (!options.skipDotenv) {
    dotenv.config();
  }

  // Differences 1 and 2. `resolveClientConfig` performs the same resolution the
  // tool dispatch performs, so a server that starts is a server whose tools can
  // build a client — the two cannot disagree about what is missing.
  const onMissingCredentials = (reason: MissingCredentialReason): never => {
    log(reason === "baseUrl" ? missingBaseUrlMessage(name) : missingCredentialsMessage(name));
    return exit(1);
  };

  const credentials: BConnectCredentialOverrides = {
    baseUrl: env.BCONNECT_BASE_URL,
    username: env.BCONNECT_USERNAME,
    password: env.BCONNECT_PASSWORD,
    apiKey: env.BCONNECT_API_KEY,
  };

  // Decided against `env` alone, before `resolveClientConfig` gets a chance to
  // fall back to `process.env`. Two reasons: the injected environment is the
  // whole environment as far as the caller is concerned (a test that passes
  // `{}` must see the failure, not the developer's own shell), and the message
  // has to name which of the two things is missing.
  if (!credentials.baseUrl) {
    onMissingCredentials("baseUrl");
  }
  if (!credentials.apiKey && (!credentials.username || !credentials.password)) {
    onMissingCredentials("credentials");
  }

  // Nothing anywhere checked the SCHEME. `http://` sends the bConnect API key,
  // and — because the v1.1 client derives its root by rewriting this same URL —
  // the Basic header for a DOMAIN ACCOUNT, in clear text, with no warning at
  // any point. Refusing outright would break lab deployments that legitimately
  // run plaintext on an isolated segment, so this is loud rather than fatal,
  // with an explicit opt-out that has to be typed on purpose.
  if (credentials.baseUrl && /^http:\/\//i.test(credentials.baseUrl)) {
    if (env.BCONNECT_ALLOW_INSECURE_HTTP === "true") {
      log(
        `${name}: WARNING — BCONNECT_BASE_URL uses http://. Credentials are sent in ` +
          `CLEAR TEXT on every request. Permitted because BCONNECT_ALLOW_INSECURE_HTTP=true.`
      );
    } else {
      log(
        `${name}: BCONNECT_BASE_URL uses http://, which sends your bConnect API key — and, if ` +
          `bConnect v1.1 is enabled, the Basic header for a domain account — in CLEAR TEXT over ` +
          `the network.\n` +
          `  Use https://. If this is a lab on an isolated segment and you accept the exposure, ` +
          `set BCONNECT_ALLOW_INSECURE_HTTP=true to proceed.`
      );
      return exit(1);
    }
  }

  const config = resolveClientConfig<TClient>({
    factory: () => {
      throw new Error("unreachable: resolveClientConfig does not call factory");
    },
    credentials,
    env,
    // No `defaultBaseUrl`. That omission IS Difference 2.
    rejectUnauthorized: () => rejectUnauthorizedFromEnv(env),
    onMissingCredentials,
  });

  // Difference 3 — build the server first, so the probe can use the very client
  // the tools use. `createServer` is lazy about the client by construction
  // (createClientProvider memoises on first call), so this costs one client.
  const handle = options.createServer(credentials);

  let probedClient: TClient;
  if (handle.getClient) {
    probedClient = handle.getClient();
  } else if (options.clientFactory) {
    probedClient = options.clientFactory(config);
  } else {
    log(
      `${name}: runServer needs either createServer().getClient or clientFactory ` +
        `to run the startup connectivity check.`
    );
    return exit(1);
  }

  log(`${name}: verifying bConnect API connectivity...`);
  const connected = await probedClient.testConnection();
  if (!connected) {
    log(
      `${name}: cannot reach bConnect API at ${config.baseUrl}. ` +
        `Check BCONNECT_BASE_URL, credentials, and network.`
    );
    return exit(1);
  }
  // BCONNECT_SKIP_CONNECTIVITY_CHECK makes testConnection() return true
  // WITHOUT any request, and this line used to say "verified" anyway — on the
  // reference deployment every server's log carried the contradiction "API
  // connectivity verified." followed by "startup probe skipped" (all 14
  // servers, every startup; chased 2026-08-22). Say what happened, not what
  // the boolean implies.
  const startupProbe =
    typeof probedClient.getConnectionProbe === "function"
      ? probedClient.getConnectionProbe()
      : undefined;
  if (startupProbe?.outcome === "skipped") {
    log(
      `${name}: connectivity check SKIPPED (BCONNECT_SKIP_CONNECTIVITY_CHECK=true) — ` +
        `nothing was verified.`
    );
  } else {
    log(`${name}: API connectivity verified.`);
  }

  // ── The 26R1 version gate (VER-1) ──────────────────────────────────────────
  // The connectivity probe above already fetched GET /servermanagement/v2.0/
  // ManagementServer (no second round-trip); read what it learned and refuse a
  // bMS below 26R1 through the same log+exit failure path every other startup
  // refusal uses. A client without `getConnectionProbe` (a pre-gate test
  // double) has nothing to evaluate; every real client inherits it from
  // BConnectClientBase, so all thirteen servers gate identically.
  if (typeof probedClient.getConnectionProbe === "function") {
    const gate = evaluateBmsVersionGate(name, probedClient.getConnectionProbe());
    for (const line of gate.lines) {
      log(line);
    }
    if (gate.refuse) {
      return exit(1);
    }
  }

  const transportMode = env.MCP_TRANSPORT ?? "stdio";

  if (transportMode !== "http") {
    const transport = new StdioServerTransport();
    await handle.server.connect(transport as never);
    log(`${name} started on stdio`);
    return { transport: "stdio", baseUrl: config.baseUrl, probedClient, handle };
  }

  // ── HTTP ───────────────────────────────────────────────────────────────────
  if (!options.http) {
    log(
      `${name}: MCP_TRANSPORT=http but no express was supplied to runServer. ` +
        `Pass \`http: { express }\`.`
    );
    return exit(1);
  }

  const port = parsePort(env.MCP_PORT);
  if (port === null) {
    log(
      `${name}: MCP_PORT="${env.MCP_PORT}" is not a valid port (1-65535). ` +
        `Refusing to start: listen() would silently bind an arbitrary free port.`
    );
    return exit(1);
  }

  const bind = env.MCP_BIND ?? "127.0.0.1";
  // Standalone HTTP mode has no client authentication. Binding to a non-loopback
  // address would expose an unauthenticated bConnect proxy, so fail closed unless
  // the operator explicitly opts in (front it with the authenticated gateway instead).
  if (!LOOPBACK_BINDS.has(bind) && env.MCP_ALLOW_NO_AUTH !== "true") {
    log(
      `${name}: refusing to bind ${bind} — standalone HTTP mode is unauthenticated. ` +
        `Bind to loopback (the default) and front it with the authenticated gateway, ` +
        `or set MCP_ALLOW_NO_AUTH=true to override.`
    );
    return exit(1);
  }

  // ── ARCH-4: Host and Origin ────────────────────────────────────────────────
  // Ahead of the body parser, so a request from a forged Host does not get a
  // megabyte of JSON parsed on its behalf before it is refused. Read
  // http-host-guard.ts for why the middleware and not the SDK owns the Host
  // decision, and why the SDK's lists are never handed over empty.
  const guard = resolveHttpGuardConfig(env, bind);
  const express = options.http.express;
  const app = express();
  app.use(createHttpGuardMiddleware(guard));
  app.use(express.json());
  log(httpGuardStartupLine(name, guard));

  app.post("/mcp", async (req, res) => {
    // Stateless: one server instance per request, as the thirteen already did.
    const perRequest = options.createServer(credentials);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      ...sdkTransportOptions(guard, port),
    });
    res.on("close", () => {
      void transport.close();
      void perRequest.server.close();
    });
    await perRequest.server.connect(transport as never);
    await transport.handleRequest(req as never, res as never, req.body);
  });

  app.get("/mcp", async (_req, res) => {
    res
      .writeHead(405)
      .end(JSON.stringify({ error: "Method Not Allowed. Use POST for MCP requests." }));
  });

  app.delete("/mcp", async (_req, res) => {
    res.writeHead(405).end(
      JSON.stringify({
        error: "Method Not Allowed. Session management not supported in stateless mode.",
      })
    );
  });

  app.listen(port, bind, () => {
    log(`${name} listening on http://${bind}:${port}/mcp`);
  });

  return { transport: "http", baseUrl: config.baseUrl, probedClient, port, bind };
}
