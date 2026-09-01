/**
 * Client lifetime and configuration resolution (upstream findings R3, B8, B11)
 *
 * ── The defect this exists to fix (R3) ───────────────────────────────────────
 * Every server used to declare `getBconnect()` *inside* its
 * `CallToolRequestSchema` handler:
 *
 *     server.setRequestHandler(CallToolRequestSchema, async (request) => {
 *       const getBconnect = () => new BConnectClient({ ... });   // per call
 *       const bconnect = getBconnect();
 *
 * The comment above it said "lazy-initialize client on first tool call", which
 * is the right intent — the closure was simply one scope too deep. The client,
 * and with it every piece of state the client owns, was rebuilt on every single
 * tool call. Verified in 13 of 13 servers.
 *
 * That is why the rate limiter never limited (B8): its sliding window was
 * discarded and recreated before it could ever fill. It is also why the
 * response cache could not have worked even if it had been wired up (B7).
 *
 * The fix is to hold the client in `createServer()` scope instead — one scope
 * out — so it outlives a single tool call but is still created lazily on first
 * use, so a server can still be constructed in tests without credentials.
 *
 * ── Credential isolation ─────────────────────────────────────────────────────
 * A longer-lived client must never be handed to a differently-credentialed
 * caller. Two independent guards:
 *
 *   1. Structural: the provider is created per `createServer(credentials?)`
 *      call, so its closure is per session. Two sessions never share one.
 *   2. Defensive: the memo is keyed on a SHA-256 fingerprint of the *resolved*
 *      configuration, including credentials. If anything the config derives
 *      from changes between calls — injected credentials, environment
 *      variables, the CA file — the fingerprint changes and the client is
 *      rebuilt. The fingerprint is a hash, so no secret is retained in
 *      cleartext beyond the client that needs it.
 *
 * ── Subsystem wiring (B11) ───────────────────────────────────────────────────
 * `BConnectClientBase` supports a response cache, a rate limiter and batch
 * operations, each gated on a config key. Before this change `config.cache` was
 * passed by 0 of 13 servers, `config.rateLimit` by 4 of 13, and `config.batch`
 * by 0 of 13 — so `BCONNECT_RATE_LIMIT_ENABLED` was silently unread on nine
 * servers and the other two subsystems were unreachable by any deployment.
 * Resolving all of them here, once, means a server cannot forget one.
 *
 * ── What this deliberately does NOT do ───────────────────────────────────────
 * The cache held here is in-process only. It dies when an MCP host recycles the
 * server process, which for a stdio server is often. The composite tools in
 * `bconnect-compliance-mcp/src/modules/` keep a disk tier on top of module
 * scope for exactly that reason — measured on this estate, the disk tier served
 * 93.4% of warm reads. Anything that must survive a process restart needs that
 * pattern, not this one.
 */

import * as fs from "node:fs";
import { createHash } from "node:crypto";
import * as dotenv from "dotenv";
import type { BConnectConfig } from "./bconnect-client-base.js";
import type { AuditLevel } from "./audit-logger.js";
import { resolveServerScopedCredentials } from "./server-scoped-credentials.js";

/** Per-session credentials, as accepted by each server's `createServer()`. */
export interface BConnectCredentialOverrides {
  baseUrl?: string;
  username?: string;
  password?: string;
  apiKey?: string;
}

/** Why credential resolution failed, so a server can throw its own error. */
export type MissingCredentialReason = "baseUrl" | "credentials";

export interface ClientProviderOptions<TClient> {
  /** Builds this server's concrete client from a fully-resolved config. */
  factory: (config: BConnectConfig) => TClient;

  /** Credentials injected into `createServer()`; win over the environment. */
  credentials?: BConnectCredentialOverrides;

  /** Base URL used when neither the session nor the environment supplies one. */
  defaultBaseUrl?: string;

  /**
   * Env var consulted for TLS verification. Servers historically disagree:
   * most read `NODE_TLS_REJECT_UNAUTHORIZED !== "0"`, groups-mcp reads
   * `BCONNECT_REJECT_UNAUTHORIZED !== "false"`. Preserved rather than
   * unified — changing a TLS default is not this change's business.
   */
  rejectUnauthorized?: () => boolean;

  /** Must throw. Called when no usable base URL or credentials were found. */
  onMissingCredentials: (reason: MissingCredentialReason) => never;

  /**
   * The environment to resolve from. Defaults to `process.env`, read at call
   * time rather than captured, so `createClientProvider`'s per-call
   * `dotenv.config()` still picks up a value that appears after startup.
   *
   * Injected because half of this function's inputs used to be unreachable from
   * a test without mutating the process: a caller who passed `env` got its
   * credentials honoured and its timeouts, rate limits, cache, batch and audit
   * settings silently taken from the developer's own shell instead. Every read
   * below now goes through this one object.
   */
  env?: NodeJS.ProcessEnv;

  /**
   * This server's own name (`bconnect-jobs-mcp`, or the bare domain `jobs`).
   *
   * Supplying it enables the OPTIONAL per-server credential convention —
   * `BCONNECT_API_KEY__JOBS` and friends — so a local deployment can give the
   * one server that writes a narrower bMS key than the twelve that only read.
   * See server-scoped-credentials.ts for why this lives in the environment
   * rather than in a client config file.
   *
   * Omitting it, or setting no `__<SERVER>` variable, resolves exactly as
   * before: one shared credential, no behaviour change, nothing new to learn.
   */
  serverName?: string;
}

function intFromEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const parsed = parseInt(env[name] ?? "", 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function boolFromEnv(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw === "") { return fallback; }
  return raw === "true";
}

/** Values already warned about, so a per-tool-call resolve does not spam stderr. */
const warnedAuditLevels = new Set<string>();

function auditLevelFromEnv(env: NodeJS.ProcessEnv): AuditLevel {
  const raw = env.BCONNECT_AUDIT_LEVEL ?? "none";
  if ((["none", "security", "write", "all"] as const).includes(raw as never)) {
    return raw as AuditLevel;
  }

  // INT-44: an unrecognised level used to be coerced to 'none' in silence. The
  // root README documented level names that do not exist, so an operator who
  // followed it — `BCONNECT_AUDIT_LEVEL=info`, say — believed auditing was on
  // while it was off. Failing loudly is not an option here (it would take the
  // server down over a log setting), so it warns once per distinct value.
  if (!warnedAuditLevels.has(raw)) {
    warnedAuditLevels.add(raw);
    process.stderr.write(
      `[bconnect-mcp] BCONNECT_AUDIT_LEVEL="${raw}" is not a valid audit level ` +
      `(expected one of: none, security, write, all). Audit logging is DISABLED.\n`
    );
  }
  return "none";
}

/**
 * CA PEM content, keyed on (path, mtime, size) — PER-19.
 *
 * `resolveClientConfig` runs on every tool call by design (the provider re-reads
 * `.env` so a late-appearing value is still picked up), which meant a configured
 * CA bundle was `readFileSync`'d on every call. Measured at ~0.01 ms today, so
 * this is scaling hygiene rather than a win: an enterprise PEM bundle is
 * hundreds of KB, and this is the one hot-path cost that grows with operator
 * configuration rather than estate size.
 *
 * Deliberately NOT extended to the config fingerprint: fingerprinting the
 * *resolved* config is the credential-isolation change-detection guard, and a
 * CA file edited in place must still change it. mtime+size does that.
 */
const caCertCache = new Map<string, { mtimeMs: number; size: number; content: string }>();

function readCaCert(caCertPath: string): string {
  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(caCertPath);
  } catch {
    // Fall through to readFileSync so the caller sees the original error from
    // the original call, unchanged.
    stat = null;
  }

  if (stat) {
    const hit = caCertCache.get(caCertPath);
    if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
      return hit.content;
    }
    const content = fs.readFileSync(caCertPath, "utf8");
    caCertCache.set(caCertPath, { mtimeMs: stat.mtimeMs, size: stat.size, content });
    return content;
  }

  return fs.readFileSync(caCertPath, "utf8");
}

/**
 * Resolve a complete `BConnectConfig` from injected credentials + environment.
 *
 * Exported separately from the provider so the env→config mapping can be tested
 * without constructing a client or a server.
 */
export function resolveClientConfig<TClient>(
  options: ClientProviderOptions<TClient>
): BConnectConfig {
  const { credentials, defaultBaseUrl } = options;
  const env = options.env ?? process.env;

  // Explicitly annotated so TypeScript treats the call as never-returning and
  // narrows `baseUrl` below; a bare property call does not get that treatment.
  const fail: (reason: MissingCredentialReason) => never = options.onMissingCredentials;

  // Optional per-server credentials, between the injected ones and the shared
  // environment. Undefined unless this server was given a name AND a
  // `BCONNECT_*__<SERVER>` variable exists, so the common single-key
  // deployment resolves exactly as it did before this existed.
  //
  // Read as a UNIT, never field-by-field — see the fallback lines below for
  // the concrete failure a per-field chain produces.
  const scoped = options.serverName
    ? resolveServerScopedCredentials(options.serverName, env)
    : undefined;

  // The unit rule in practice: when `scoped` exists it supplies the credential
  // fields OUTRIGHT, with no per-field fallback to the shared environment.
  //
  // A field-by-field chain looks equivalent and is not. Set only
  // BCONNECT_USERNAME__JOBS + BCONNECT_PASSWORD__JOBS and the apiKey slot would
  // fall through to the SHARED BCONNECT_API_KEY — and since a key beats basic
  // auth downstream, that server would quietly run on the shared credential it
  // was just configured away from. Silent over-privilege, produced by the very
  // setting meant to prevent it.
  const baseUrl = credentials?.baseUrl ?? scoped?.baseUrl ?? env.BCONNECT_BASE_URL ?? defaultBaseUrl;
  const username = credentials?.username ?? (scoped ? scoped.username : env.BCONNECT_USERNAME);
  const password = credentials?.password ?? (scoped ? scoped.password : env.BCONNECT_PASSWORD);
  const apiKey = credentials?.apiKey ?? (scoped ? scoped.apiKey : env.BCONNECT_API_KEY);

  if (!baseUrl) { fail("baseUrl"); }
  if (!apiKey && (!username || !password)) { fail("credentials"); }

  const caCertPath = env.BCONNECT_CA_CERT_PATH;
  const caCert = caCertPath ? readCaCert(caCertPath) : undefined;

  const rejectUnauthorized = options.rejectUnauthorized
    ? options.rejectUnauthorized()
    : env.NODE_TLS_REJECT_UNAUTHORIZED !== "0";

  // B8/B11 — rate limiting. Previously read by only 4 of 13 servers.
  const rateLimitEnabled = env.BCONNECT_RATE_LIMIT_ENABLED === "true";

  // B7/B11 — response cache. Previously reachable by no deployment at all,
  // because no server passed `config.cache` and no env var existed for it.
  const cacheEnabled = env.BCONNECT_CACHE_ENABLED === "true";

  // B11 — batch operations. ~295 lines that no deployment could reach.
  const batchEnabled = env.BCONNECT_BATCH_ENABLED === "true";

  return {
    baseUrl,
    username,
    password,
    apiKey,
    rejectUnauthorized,
    // PER-13 — `timeout`, `maxRetries` and `retryDelay` have always been part of
    // BConnectConfig and axios-retry has always been wired to them, but no
    // server and no env var ever set them, so every deployment ran on the
    // fallbacks in bconnect-client-base.ts. The defaults below are exactly those
    // fallbacks (30000 / 0 / 100), so an existing deployment is bit-identical.
    //
    // This matters operationally on this estate: the software read probe
    // intermittently times out at exactly 30 s, which was the non-configurable
    // boundary. Note that raising BCONNECT_MAX_RETRIES will NOT help the
    // documented compliance-Vulnerabilities failure — that one returns HTTP 200
    // with an empty envelope after ~30 s, which axios-retry never retries.
    timeout: intFromEnv(env, "BCONNECT_TIMEOUT_MS", 30000),
    maxRetries: intFromEnv(env, "BCONNECT_MAX_RETRIES", 0),
    retryDelay: intFromEnv(env, "BCONNECT_RETRY_DELAY_MS", 100),
    ...(caCert && { ca: caCert }),
    ...(rateLimitEnabled && {
      rateLimit: {
        enabled: true,
        maxRequests: intFromEnv(env, "BCONNECT_RATE_LIMIT_MAX_REQUESTS", 100),
        windowMs: intFromEnv(env, "BCONNECT_RATE_LIMIT_WINDOW_MS", 60000),
      },
    }),
    ...(cacheEnabled && {
      cache: {
        enabled: true,
        maxSize: intFromEnv(env, "BCONNECT_CACHE_MAX_SIZE", 100),
        ttl: intFromEnv(env, "BCONNECT_CACHE_TTL_MS", 300000),
        getOnly: boolFromEnv(env, "BCONNECT_CACHE_GET_ONLY", true),
      },
    }),
    ...(batchEnabled && {
      batch: {
        concurrency: intFromEnv(env, "BCONNECT_BATCH_CONCURRENCY", 5),
        stopOnError: boolFromEnv(env, "BCONNECT_BATCH_STOP_ON_ERROR", false),
        retries: intFromEnv(env, "BCONNECT_BATCH_RETRIES", 0),
        retryDelay: intFromEnv(env, "BCONNECT_BATCH_RETRY_DELAY_MS", 1000),
      },
    }),
    auditLog: {
      level: auditLevelFromEnv(env),
      // SEC-4 — `includeParameters` was read by the logger and plumbed through
      // the client, but no env var ever set it, so it was permanently false and
      // a write record could only ever say method+path, never what changed.
      // Default false = today's behaviour; secret-looking fields are redacted
      // before they reach the log (see redactSensitiveParameters).
      includeParameters: boolFromEnv(env, "BCONNECT_AUDIT_INCLUDE_PARAMS", false),
      // B5 — a file destination, so a stdio deployment can have an audit trail
      // at all. Unset by default; see audit-logger.ts.
      ...(env.BCONNECT_AUDIT_FILE && { logFile: env.BCONNECT_AUDIT_FILE }),
    },
  };
}

/**
 * Fingerprint a resolved config so a cached client is never reused across a
 * different one. Hashed, not stored: the digest is kept, the secrets are not.
 */
export function configFingerprint(config: BConnectConfig): string {
  const material = JSON.stringify(config, (key, value) =>
    typeof value === "function" ? `[fn:${key}]` : value
  );
  return createHash("sha256").update(material).digest("hex");
}

/**
 * Build the memoised client accessor for one server session.
 *
 * Call this in `createServer()` scope — NOT inside the tool-call handler, which
 * is the bug (R3) this function exists to make hard to reintroduce.
 */
export function createClientProvider<TClient>(
  options: ClientProviderOptions<TClient>
): () => TClient {
  let client: TClient | null = null;
  let fingerprint: string | null = null;

  return (): TClient => {
    // Preserved from the original per-call implementation: .env is re-read on
    // each access, so a value that appears after startup is still picked up.
    dotenv.config();

    const config = resolveClientConfig(options);
    const next = configFingerprint(config);

    if (client !== null && fingerprint === next) {
      return client;
    }

    client = options.factory(config);
    fingerprint = next;
    return client;
  };
}
