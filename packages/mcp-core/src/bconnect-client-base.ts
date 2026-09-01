/**
 * bConnect API Client
 *
 * Modular client for baramundi bConnect REST API
 * Supports multiple API modules: Endpoints, Assets, Software, etc.
 */

import axios, { AxiosInstance, AxiosError, CreateAxiosDefaults, InternalAxiosRequestConfig } from "axios";
import axiosRetry from "axios-retry";
import https from "https";
import tls, { PeerCertificate } from "node:tls";

/**
 * Build the default CA trust list when no explicit CA is configured.
 *
 * Node validates TLS against its *bundled* CA list only — it never consults the
 * operating-system certificate store. On Windows/macOS that means an internal or
 * corporate CA that already signs the bMS certificate is invisible to Node unless
 * the admin manually exports it and points `BCONNECT_CA_CERT_PATH` at the PEM
 * (see issue #59). When available (Node >= 22.15 / 23.5) `tls.getCACertificates`
 * lets us read the OS trust store ("system") and merge it with Node's bundled
 * list ("default", which also includes any `NODE_EXTRA_CA_CERTS`), so both public
 * and enterprise CAs validate out of the box.
 *
 * Returns `undefined` on older Node (or if the store can't be read) so the agent
 * keeps Node's existing bundled-only behavior — no regression.
 */
function buildDefaultTrustStore(): string[] | undefined {
  const getCACertificates = (tls as unknown as {
    getCACertificates?: (type: "default" | "system" | "bundled" | "extra") => string[];
  }).getCACertificates;

  if (typeof getCACertificates !== "function") {
    return undefined; // Node < 22.15 — leave Node's default trust behavior untouched.
  }

  try {
    const merged = [...getCACertificates("default"), ...getCACertificates("system")];
    return merged.length > 0 ? merged : undefined;
  } catch {
    return undefined;
  }
}

/**
 * OpenSSL error codes that mean "the peer certificate chain was not trusted".
 * These surface as `error.code` (or `error.cause.code`) on a failed request and
 * are worth translating into an actionable message instead of a generic
 * "cannot connect" (see issue #59).
 */
const TLS_UNTRUSTED_CERT_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_UNTRUSTED",
]);

/**
 * If `error` is a TLS "certificate not trusted" failure, return a remediation
 * message; otherwise `undefined`. Deliberately does not echo the target hostname.
 */
function tlsUntrustedCertHint(error: AxiosError): string | undefined {
  const code =
    (error.code as string | undefined) ??
    (error.cause as { code?: string } | undefined)?.code;

  if (!code || !TLS_UNTRUSTED_CERT_CODES.has(code)) {
    return undefined;
  }

  return (
    `TLS certificate verification failed (${code}): the bConnect server's ` +
    "certificate is not trusted by this process. Resolve it one of these ways:\n" +
    "  1. Run on Node.js >= 22.15 so the OS/Windows trust store is honored automatically.\n" +
    "  2. Set BCONNECT_CA_CERT_PATH to a PEM file containing the signing CA.\n" +
    "  3. Set NODE_EXTRA_CA_CERTS to a PEM file with the signing CA (appended to Node's bundle).\n" +
    "Never set NODE_TLS_REJECT_UNAUTHORIZED=0 in production — it disables all certificate checks."
  );
}

/** Longest slice of an API error body carried into a thrown message. */
const API_ERROR_DETAIL_MAX = 400;

/**
 * "GET /endpoints/v2.0/Endpoints/{id}" for the failed request, or "".
 *
 * Deliberately the *relative* path only: `error.config.url` is what the module
 * built from the caller's own arguments, whereas `baseURL` carries the internal
 * hostname the no-response branch is careful never to echo.
 */
function requestSummary(error: AxiosError): string {
  const method = error.config?.method?.toUpperCase();
  const url = error.config?.url;
  if (!method && !url) {
    return "";
  }
  return ` [${[method, url].filter(Boolean).join(" ")}]`;
}

/**
 * The API's own error payload, truncated (INT-43).
 *
 * bConnect returns a JSON problem body on 400s naming the offending field. That
 * body was being discarded, so a model that sent a malformed patch had nothing
 * to correct against.
 */
function apiErrorDetail(error: AxiosError): string {
  const data: unknown = error.response?.data;
  if (data === undefined || data === null || data === "") {
    return "";
  }

  let text: string;
  if (typeof data === "string") {
    text = data;
  } else {
    try {
      text = JSON.stringify(data);
    } catch {
      return "";
    }
  }

  text = text.replace(/\s+/g, " ").trim();
  if (!text || text === "{}" || text === '""') {
    return "";
  }
  if (text.length > API_ERROR_DETAIL_MAX) {
    text = `${text.slice(0, API_ERROR_DETAIL_MAX)}...`;
  }
  return ` API said: ${text}`;
}

/**
 * The recovery hint the root README's troubleshooting table already documents:
 * on this API a 404 (and sometimes a 400) can mean the route exists only in a
 * newer release than the one the server is configured for.
 */
function releaseHint(): string {
  // BCONNECT_RELEASE no longer exists — the suite is 26R1-only and the release is
  // verified once at startup by the version gate rather than configured. So a 404
  // here can no longer mean "wrong release configured"; the remaining ambiguity is
  // between a wrong id and a route this bMS genuinely does not serve, and that is
  // what the hint should say. Pointing at a removed setting sent operators to a
  // knob that is not there.
  return (
    ` A wrong id and a route this bMS does not serve look identical here. ` +
    `The suite requires baramundi Management Suite 26R1 or newer and verifies it at ` +
    `startup, so if the id is correct this route may not exist on this server.`
  );
}

/**
 * Render a connection failure without ever inspecting the error object (SEC-2).
 *
 * `console.error("...", axiosError)` hands the whole error to `util.inspect`,
 * which walks `error.config.headers` — where `setupAuth()` installs
 * `Authorization: Basic <base64>` or `X-Api-Key`. On a stdio MCP server stderr
 * is captured verbatim into the host's log files, so that wrote a
 * plaintext-recoverable bMS service credential to disk on exactly the ordinary
 * misconfigurations (wrong base URL, untrusted TLS chain, network down). Only
 * the code, the message and the existing TLS hint are emitted.
 *
 * EXPORTED because the fix was applied here and nowhere else: fourteen server
 * bootstraps still did `console.error("Fatal error:", error)`, which is the
 * same util.inspect walk on the same error object. A safe formatter that only
 * one call site can reach is half a fix.
 */
export function describeConnectionFailure(error: unknown): string {
  if (error instanceof AxiosError) {
    const hint = tlsUntrustedCertHint(error);
    const code = error.code ? ` (${error.code})` : "";
    return `${error.message}${code}${hint ? `\n${hint}` : ""}`;
  }
  if (error instanceof Error) {
    const code = (error as { code?: string }).code;
    return `${error.message}${code ? ` (${code})` : ""}`;
  }
  return "unknown error";
}

/**
 * Extended Axios request config to carry internal metadata through interceptors.
 */
interface BConnectRequestConfig extends InternalAxiosRequestConfig {
  __rateLimitInfo?: { allowed: boolean; remaining: number; limit: number; resetInMs: number };
  __auditStartTime?: number;
  __cachedResponse?: unknown;
  /** Set on the request LEADING a single-flight GET; settles the flight. */
  __flightHandle?: FlightHandle;
  /** Set on a request served by JOINING another request's flight. */
  __sharedFlight?: boolean;
}
import { RateLimiter, RateLimitError } from "./rate-limiter.js";
import { AuditLogger, AuditLevel, AuditLogEntry } from "./audit-logger.js";
import { ResponseCache, FlightHandle, SharedFlightResult, CacheStats } from "./response-cache.js";
import { BatchOperations, BatchOperation, BatchExecutionResult } from "./batch-operations.js";
import { RequestBlockedError, assertRequestPathContained } from "./path-guard.js";
import { assertSecurityRouteAllowed } from "./security-routes.js";
import { BConnectApiError } from "./tool-error.js";

export interface BConnectConfig {
  baseUrl: string;
  username?: string;
  password?: string;
  apiKey?: string;
  timeout?: number;

  // Path probed by testConnection(). bConnect exposes no global health route, so
  // this must be a lightweight list endpoint the configured credentials can read.
  healthCheckPath?: string;

  // SSL/TLS Configuration
  rejectUnauthorized?: boolean;  // Reject unauthorized certificates (default: true)
  ca?: string | Buffer | Array<string | Buffer>;  // Custom CA certificate(s)
  cert?: string | Buffer;  // Client certificate
  key?: string | Buffer;   // Client private key
  passphrase?: string;     // Passphrase for client key
  checkServerIdentity?: (hostname: string, cert: PeerCertificate) => Error | undefined;  // Custom hostname validation

  // Retry Configuration
  maxRetries?: number;
  retryDelay?: number;

  // Rate Limiting Configuration
  rateLimit?: {
    enabled?: boolean;        // Enable rate limiting (default: false)
    maxRequests?: number;     // Max requests per window (default: 100)
    windowMs?: number;        // Time window in ms (default: 60000 = 1 minute)
    message?: string;         // Custom error message
  };

  // Audit Logging Configuration
  auditLog?: {
    level?: AuditLevel;       // Audit level: 'all', 'write', 'security', 'none' (default: 'none')
    includeParameters?: boolean; // Include request parameters in audit log (default: false)
    logHandler?: (entry: AuditLogEntry) => void; // Custom log handler (default: stderr)
    logFile?: string;         // Append JSONL audit records here as well (default: none) — B5
  };

  // Response Caching Configuration
  cache?: {
    enabled?: boolean;        // Enable response caching (default: false)
    maxSize?: number;         // Maximum cache entries (default: 100)
    ttl?: number;             // Time-to-live in ms (default: 300000 = 5 minutes, 0 = no expiration)
    getOnly?: boolean;        // Cache only GET requests (default: true)
  };

  // Batch Operations Configuration
  batch?: {
    concurrency?: number;     // Maximum concurrent operations (default: 5)
    stopOnError?: boolean;    // Stop on first error (default: false)
    retries?: number;         // Retry failed operations (default: 0)
    retryDelay?: number;      // Delay between retries in ms (default: 1000)
  };


  // Testing Configuration
  disableHttpsAgent?: boolean;  // Disable HTTPS agent (for MSW testing)
}

/**
 * The route the startup connectivity check probes first (VER-1, the 26R1 gate).
 *
 * `GET /v2.0/ManagementServer` in the servermanagement module returns `version`
 * as a REQUIRED string field (openapi-specs/26R1/bConnect_Servermanagement.json,
 * schema `ManagementServer`) — the version of the bMS actually being talked to,
 * which a Windows-registry read can never establish for a remote bMS or from
 * inside a Linux container. One request both proves connectivity and yields the
 * version, so the gate costs no extra round-trip on the happy path.
 */
export const BMS_VERSION_PROBE_PATH = "/servermanagement/v2.0/ManagementServer";

/**
 * What the startup probe learned, for `runServer` to gate on (VER-1).
 *
 *   skipped           BCONNECT_SKIP_CONNECTIVITY_CHECK=true — nothing probed,
 *                     and the documented contract is that the version gate is
 *                     skipped with the connectivity check.
 *   version           The ManagementServer route answered 2xx with a string
 *                     `version`. Connectivity and credentials are proven by the
 *                     same response.
 *   no-version-field  2xx, but no non-empty string `version` in the body. The
 *                     spec marks the field required, so this is unexpected —
 *                     the caller warns and proceeds rather than refusing a
 *                     healthy server over a shape surprise.
 *   denied            401/403/404 on the version route: the credential is
 *                     scoped away from servermanagement, or the route does not
 *                     exist on this bMS. Connectivity was then verified against
 *                     `healthCheckPath` instead (the pre-gate probe), so a
 *                     scoped credential is not bricked — the version is simply
 *                     unknowable, and the caller warns and proceeds.
 *   failed            No route answered; `testConnection()` returned false.
 */
export type ConnectionProbe =
  | { outcome: "skipped" }
  | { outcome: "version"; version: string }
  | { outcome: "no-version-field" }
  | { outcome: "denied"; status: number }
  | { outcome: "failed" };

export class BConnectClientBase {
  protected client: AxiosInstance;
  // Probed by testConnection(). WindowsEndpoints exists on every bMS; a domain
  // whose credentials cannot read it should override via config.healthCheckPath.
  protected healthCheckPath: string;
  // What the last testConnection() run learned. See ConnectionProbe.
  private lastConnectionProbe: ConnectionProbe | undefined;
  private config: BConnectConfig;
  private rateLimiter: RateLimiter | null = null;
  private auditLogger: AuditLogger | null = null;
  private responseCache: ResponseCache | null = null;
  private batchOperations: BatchOperations | null = null;


  constructor(config: BConnectConfig) {
    this.config = config;
    // B1: the default used to be "/v2.0/WindowsEndpoints", which omits the API
    // module segment. `baseURL` is the bare bConnect root, and every module
    // client prefixes its own module (`/endpoints/v2.0`, `/defensecontrol/v2.0`
    // …), so the probe resolved to `<root>/v2.0/WindowsEndpoints` — a route no
    // bMS serves — and the startup connectivity check 401'd on every server. No
    // server overrides `healthCheckPath`, so there was no working configuration
    // to preserve. PER-18: `/Endpoints` is also the lean projection, ~10x
    // smaller per row than `/WindowsEndpoints`.
    this.healthCheckPath = config.healthCheckPath ?? "/endpoints/v2.0/Endpoints";

    // Resolve the CA trust list. An explicit CA (e.g. BCONNECT_CA_CERT_PATH) always
    // wins. Otherwise, when verification is on, fall back to the OS trust store
    // merged with Node's bundle so an already-trusted enterprise CA works without a
    // manual export (issue #59); this is a no-op on Node < 22.15.
    const caList: BConnectConfig["ca"] | undefined =
      config.ca ??
      (config.rejectUnauthorized !== false ? buildDefaultTrustStore() : undefined);

    // Create HTTPS agent with SSL/TLS configuration
    const httpsAgentOptions: https.AgentOptions = {
      // Default to secure (reject unauthorized certificates)
      rejectUnauthorized: config.rejectUnauthorized !== false,

      // PER-12: an explicitly constructed https.Agent defaults keepAlive to
      // false — only `https.globalAgent` has had it on since Node 19 (verified
      // on the deployment host, Node 22.23.1). Without this every bConnect call
      // opened a TCP connection, ran a full TLS handshake against the merged
      // ~500 KB CA list, and discarded the socket. The composite tools page
      // dozens of times per call, so they paid it dozens of times.
      keepAlive: true,
      keepAliveMsecs: 15000,
      // Modest caps: the fan-out helper (`paginateAll`) runs a handful of pages
      // at a time, and an unbounded pool against one bMS is not a kindness.
      maxSockets: 32,
      maxFreeSockets: 8,

      // Custom CA certificate(s) for self-signed or corporate certificates
      ...(caList && { ca: caList }),

      // Client certificate authentication
      ...(config.cert && { cert: config.cert }),
      ...(config.key && { key: config.key }),
      ...(config.passphrase && { passphrase: config.passphrase }),

      // Custom hostname validation
      ...(config.checkServerIdentity && { checkServerIdentity: config.checkServerIdentity }),
    };

    // Create V2.0 axios instance with base configuration
    // Note: In test environments, skip custom httpsAgent to allow MSW request interception
    const axiosConfig: CreateAxiosDefaults = {
      baseURL: config.baseUrl,
      timeout: config.timeout || 30000,
      // SECURITY: never follow a redirect. The API key travels in a custom
      // header, and `follow-redirects` strips only Authorization,
      // Proxy-Authorization and Cookie when a 30x crosses to another host —
      // `X-Api-Key` is not in that list. With axios's default of 21 redirects,
      // a bMS that answers 30x (or anyone able to inject one) would receive
      // the bConnect API key on the redirect target. Basic-auth deployments
      // are protected by the stripping; the documented default is not.
      //
      // 0 rather than a smaller number: bConnect serves no route that
      // legitimately redirects, so a redirect is either a misconfiguration or
      // an attack, and both are better surfaced than followed.
      maxRedirects: 0,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      }
    };

    // Only add httpsAgent if not explicitly disabled (needed for MSW testing)
    if (!config.disableHttpsAgent) {
      axiosConfig.httpsAgent = new https.Agent(httpsAgentOptions);
    }

    this.client = axios.create(axiosConfig);

    // ── Transport-layer safety guards (SEC-0, SEC-1) ─────────────────────────
    //
    // Registered FIRST deliberately. axios `unshift`s request interceptors, so
    // the first one registered is the LAST one to run — i.e. this sees the
    // final URL, immediately before dispatch, after the audit interceptor below
    // has already recorded the attempt. A refused LAPS read therefore still
    // produces an audit record, which is the point of auditing it.
    //
    // Two independent checks, both of which every one of the 13 servers gets
    // whether or not it remembered to wire its own parameter validator:
    //
    //   1. Containment — no `..` segment may pop the request out of the module
    //      whose basePath the URL was written against. This is the transport
    //      half of the path-traversal fix; the per-server validators are the
    //      other half.
    //   2. Credential routes — BitLocker secrets/PIN and LAPS passwords are
    //      refused unless ALLOW_SECRET_READ=true, regardless of which server or
    //      tool name originated the request.
    //
    // Both throw `RequestBlockedError`, which `handleError` passes through
    // unchanged and `retryCondition` refuses to retry.
    this.client.interceptors.request.use(
      (requestConfig: InternalAxiosRequestConfig) => {
        const url = requestConfig.url ?? "";
        try {
          assertRequestPathContained(url);
          assertSecurityRouteAllowed(requestConfig.method ?? "GET", url);
        } catch (refusal) {
          // Refusals thrown between flight registration and dispatch must be
          // findable by handleError's flight settling, and only the config
          // links them. Axios attaches config to every error IT produces;
          // our own refusals follow the same convention.
          (refusal as { config?: InternalAxiosRequestConfig }).config = requestConfig;
          throw refusal;
        }
        return requestConfig;
      },
      (error) => Promise.reject(error)
    );

    // LOCAL PATCH (F25): bConnect's PATCH endpoints declare a request body of
    // `application/json-patch+json`, but the client sets a global
    // `Content-Type: application/json` for every request. Every JSON Patch call
    // therefore failed with HTTP 415 Unsupported Media Type — that is all 15
    // patch call sites across 7 servers, i.e. every update_* tool that takes
    // patchOperations. Set the correct media type on PATCH only.
    this.client.interceptors.request.use((cfg) => {
      if (String(cfg.method).toLowerCase() === "patch") {
        cfg.headers = cfg.headers ?? {};
        (cfg.headers as Record<string, string>)["Content-Type"] =
          "application/json-patch+json";
      }
      return cfg;
    });

    // Setup Basic Authentication
    this.setupAuth();

    // Setup retry logic with exponential backoff for V2.0 client
    axiosRetry(this.client, {
      retries: config.maxRetries || 0, // Default: no retries (backward compatible)
      retryDelay: (retryCount) => {
        // Exponential backoff: baseDelay * (2 ^ retryCount)
        const baseDelay = config.retryDelay || 100;
        return baseDelay * Math.pow(2, retryCount - 1);
      },
      retryCondition: (error: AxiosError) => {
        // A request the client itself refused (traversal, credential route) is
        // not a transient failure — retrying it just repeats the refusal.
        if (error instanceof RequestBlockedError) {
          return false;
        }

        // Retry on network errors (no response)
        if (!error.response) {
          return true;
        }

        const status = error.response.status;

        // Retry on 5xx server errors
        if (status >= 500 && status < 600) {
          return true;
        }

        // Retry on 429 rate limit
        if (status === 429) {
          return true;
        }

        // Don't retry on 4xx client errors (except 429)
        return false;
      },
    });

    // Initialize rate limiter if enabled
    if (config.rateLimit?.enabled) {
      this.rateLimiter = new RateLimiter({
        maxRequests: config.rateLimit.maxRequests || 100,
        windowMs: config.rateLimit.windowMs || 60000,
        enabled: true,
        message: config.rateLimit.message,
      });

      // Add rate limiting request interceptor for V2.0 client
      this.client.interceptors.request.use(
        (requestConfig: InternalAxiosRequestConfig) => {
          if (this.rateLimiter) {
            const rateLimitInfo = this.rateLimiter.tryConsume();
            if (!rateLimitInfo.allowed) {
              const refusal = new RateLimitError(
                this.rateLimiter.getConfig().message,
                rateLimitInfo
              );
              // Same convention as the path-guard refusal above: carry the
              // config so handleError can settle a registered flight. Without
              // it, a rate-limited leader would leave its waiters hanging to
              // their own timeouts.
              (refusal as unknown as { config?: InternalAxiosRequestConfig }).config = requestConfig;
              throw refusal;
            }
            // Attach rate limit info to request for response headers
            (requestConfig as BConnectRequestConfig).__rateLimitInfo = rateLimitInfo;
          }
          return requestConfig;
        },
        (error) => Promise.reject(error)
      );
    }

    // Initialize audit logger if enabled
    if (config.auditLog?.level && config.auditLog.level !== 'none') {
      this.auditLogger = new AuditLogger({
        level: config.auditLog.level,
        username: config.username ?? 'api-key-user',
        includeParameters: config.auditLog.includeParameters,
        logHandler: config.auditLog.logHandler,
        logFile: config.auditLog.logFile,
      });

      // Add audit logging request interceptor for V2.0 client
      this.client.interceptors.request.use(
        (requestConfig: InternalAxiosRequestConfig) => {
          if (this.auditLogger) {
            const method = requestConfig.method?.toUpperCase() || 'GET';
            const path = requestConfig.url || '';
            const params = requestConfig.params || requestConfig.data;
            const startTime = this.auditLogger.logRequest(method, path, params);
            // Attach start time to request for duration calculation
            (requestConfig as BConnectRequestConfig).__auditStartTime = startTime;
          }
          return requestConfig;
        },
        (error) => Promise.reject(error)
      );
    }

    // Initialize response cache if enabled
    //
    // B7: this used to tag the request config on a cache hit and return it
    // unchanged, so the request still went out over the network and the
    // response interceptor then overwrote the *fresh* body with the *stale*
    // cached one — the worst of both, plus an `X-Cache: HIT` header claiming a
    // saving that never happened:
    //
    //     network calls made : 3     (a working cache would make 1)
    //     response 2  serial=1  X-Cache=HIT   <- serial=2 fetched, then discarded
    //
    // A cache hit now installs a per-request adapter that resolves the cached
    // value without dispatching anything. `adapter` is a documented per-request
    // axios option, so this short-circuits inside axios rather than fighting the
    // interceptor chain (throwing a marker here would have to be caught before
    // axios-retry's error interceptor, which is registered earlier).
    if (config.cache?.enabled) {
      this.responseCache = new ResponseCache({
        enabled: true,
        maxSize: config.cache.maxSize,
        ttl: config.cache.ttl,
        getOnly: config.cache.getOnly,
      });

      // Add cache request interceptor for V2.0 client (check cache before request)
      this.client.interceptors.request.use(
        (requestConfig: InternalAxiosRequestConfig) => {
          if (this.responseCache) {
            const method = requestConfig.method?.toUpperCase() || 'GET';
            const url = requestConfig.url || '';
            const params = requestConfig.params;
            const tagged = requestConfig as BConnectRequestConfig;

            // ── Retry re-entry (axios-retry re-dispatches the SAME config) ──
            // A leader's retry still holds __flightHandle: it must keep
            // leading its own flight, not join it — joining would await a
            // promise only its own success can settle. A waiter's retry holds
            // __sharedFlight and a stale adapter closed over the settled
            // flight: strip both, so the retry is a real, independent attempt
            // (it may then join a NEW flight, or lead one).
            if (tagged.__flightHandle) {
              return requestConfig;
            }
            if (tagged.__sharedFlight) {
              delete tagged.__sharedFlight;
              delete requestConfig.adapter;
            }

            // Only consult the cache for methods this cache would ever store.
            if (!this.responseCache.shouldCache(method)) {
              return requestConfig;
            }

            const cachedResponse = this.responseCache.get(method, url, params);
            if (cachedResponse !== null) {
              tagged.__cachedResponse = cachedResponse;
              // Serve from cache without touching the network.
              requestConfig.adapter = async (cfg) => ({
                data: cachedResponse,
                status: 200,
                statusText: 'OK',
                headers: {},
                config: cfg,
                request: undefined,
              });
              return requestConfig;
            }

            // ── Single flight: miss, but an identical GET is on the wire ────
            const flight = this.responseCache.joinFlight(method, url, params);
            if (flight) {
              tagged.__sharedFlight = true;
              // The waiter races the flight against ITS OWN timeout: replacing
              // the transport also replaced the transport's timeout, and a
              // flight leaked by a failure path nobody foresaw must surface as
              // this caller's ordinary timeout, never as a permanent hang.
              const timeoutMs = requestConfig.timeout;
              requestConfig.adapter = async (cfg) => {
                const outcome = await BConnectClientBase.awaitFlight(flight, timeoutMs, url);
                const response = {
                  data: outcome.data,
                  status: outcome.status,
                  statusText: outcome.statusText,
                  headers: {},
                  config: cfg,
                  request: undefined,
                };
                // The built-in adapters apply validateStatus via settle(); a
                // custom adapter must do it itself or a 500 delivered to a
                // default-contract waiter would arrive as a SUCCESS. Mirrors
                // axios's settle(): 4xx -> ERR_BAD_REQUEST, 5xx -> ERR_BAD_RESPONSE.
                const validate = cfg.validateStatus;
                if (validate && !validate(outcome.status)) {
                  throw new AxiosError(
                    `Request failed with status code ${outcome.status}`,
                    [AxiosError.ERR_BAD_REQUEST, AxiosError.ERR_BAD_RESPONSE][Math.floor(outcome.status / 100) - 4],
                    cfg,
                    undefined,
                    response as never
                  );
                }
                return response;
              };
              return requestConfig;
            }

            const handle = this.responseCache.beginFlight(method, url, params);
            if (handle) {
              tagged.__flightHandle = handle;
            }
          }
          return requestConfig;
        },
        (error) => Promise.reject(error)
      );
    }

    // Initialize batch operations
    if (config.batch) {
      this.batchOperations = new BatchOperations({
        concurrency: config.batch.concurrency,
        stopOnError: config.batch.stopOnError,
        retries: config.batch.retries,
        retryDelay: config.batch.retryDelay,
      });
    }

    // Initialize domain module

    // Setup error handling and rate limit headers interceptor for V2.0 client
    this.client.interceptors.response.use(
      (response) => {
        // Check if response was cached (from request interceptor).
        //
        // B7, second half: the marker header was written as the literal string
        // `'X-Cache'` onto an axios headers object that lowercases every real
        // header, so a conventional caller reading `headers['x-cache']` got
        // `undefined` and could not tell a hit from a miss at all. Written
        // lowercase now, matching how axios exposes every other response header.
        if (this.responseCache && response.config) {
          const cachedResponse = (response.config as BConnectRequestConfig).__cachedResponse;
          if (cachedResponse !== undefined) {
            // Already served from cache by the request adapter — no network
            // call was made, and `response.data` is the cached value.
            response.headers['x-cache'] = 'HIT';
            return response;
          }

          // Served by joining another request's flight: no wire call of its
          // own, nothing to cache (the leader caches), same early return as a
          // HIT.
          if ((response.config as BConnectRequestConfig).__sharedFlight) {
            response.headers['x-cache'] = 'SHARED';
            return response;
          }

          // Cache successful GET responses
          const method = response.config.method?.toUpperCase() || 'GET';
          const url = response.config.url || '';
          const params = response.config.params;

          if (response.status >= 200 && response.status < 300) {
            this.responseCache.set(method, url, response.data, params);
            response.headers['x-cache'] = 'MISS';
          }

          // Settle this request's flight AFTER set(), so a waiter that re-asks
          // later hits the cache. Every response that reaches this handler
          // settles — including a non-2xx arriving under a caller's
          // validateStatus override; the waiters apply their own contracts.
          const flightHandle = (response.config as BConnectRequestConfig).__flightHandle;
          if (flightHandle) {
            flightHandle.resolve({
              status: response.status,
              statusText: response.statusText,
              data: response.data,
            });
          }

          // Invalidate cache on write operations.
          //
          // The parent path is ESCAPED before it becomes a regex. It used to be
          // interpolated raw, which had two consequences, both measured
          // 2026-08-23:
          //
          //   * `.` was a wildcard, so a write under `/jobs/v2.0/Folders` also
          //     invalidated `/jobs/v2X0/Folders`. Harmless over-invalidation —
          //     a cache entry too few is only ever a refetch.
          //   * an unbalanced `(` or `[` in a NON-FINAL path segment made
          //     `new RegExp` THROW, inside the success interceptor, AFTER the
          //     write had already been applied by bMS. The caller would see a
          //     successful write as a failure and might repeat it.
          //
          // Reachability, stated rather than implied: not reached on this
          // estate. It needs response caching switched on (off by default —
          // BCONNECT_CACHE_ENABLED), a 2xx write, and a regex metacharacter in
          // a segment that is not the last one. Real bMS ids are GUIDs, and
          // `assertSafePathSegment` rejects `/`, `\` and `..` but deliberately
          // permits `(`, which `encodeURIComponent` also leaves alone. So this
          // is hardening against a latent shape, not a repair of an observed
          // failure — and it makes the invalidation exact as a side effect.
          if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
            const parentPath = url.replace(/\/[^/]+$/, '');
            const urlPattern = new RegExp(parentPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
            this.responseCache.invalidateByPattern(urlPattern);
          }
        }

        // Add rate limit headers if rate limiting is enabled
        if (this.rateLimiter && response.config) {
          const rateLimitInfo = (response.config as BConnectRequestConfig).__rateLimitInfo;
          if (rateLimitInfo) {
            response.headers['X-RateLimit-Limit'] = rateLimitInfo.limit.toString();
            response.headers['X-RateLimit-Remaining'] = rateLimitInfo.remaining.toString();
            response.headers['X-RateLimit-Reset'] = Math.ceil(rateLimitInfo.resetInMs / 1000).toString();
          }
        }

        // Log response if audit logging is enabled
        if (this.auditLogger && response.config) {
          const method = response.config.method?.toUpperCase() || 'GET';
          const path = response.config.url || '';
          const statusCode = response.status;
          const startTime = (response.config as BConnectRequestConfig).__auditStartTime || Date.now();
          this.auditLogger.logResponse(method, path, statusCode, startTime);
        }

        return response;
      },
      (error: AxiosError) => {
        return this.handleError(error);
      }
    );
    // TODO: Initialize V2.0 module
    // Example: this.domain = new DomainModule(this.client);
  }

  /**
   * Response-cache statistics, or null when response caching is off. Includes
   * the single-flight counters (`sharedFlights`, `inFlight`); `inFlight` in
   * particular is the observable that a flight was never leaked.
   */
  getCacheStats(): CacheStats | null {
    return this.responseCache ? this.responseCache.getStats() : null;
  }

  /**
   * A waiter's view of a shared flight, bounded by the waiter's OWN timeout.
   *
   * The shared-flight adapter replaces the transport, and the transport is
   * where axios enforces `timeout` — so without this, a flight left unsettled
   * by some failure path nobody foresaw (a throw between registration and
   * dispatch in an interceptor this file does not own, say) would hang every
   * waiter FOREVER. With it, the worst any such bug can do is what a hung
   * socket already does: this caller's ordinary timeout. `timeout: 0` is
   * axios's documented "no timeout" and is honoured here the same way.
   */
  private static awaitFlight(
    flight: Promise<SharedFlightResult>,
    timeoutMs: number | undefined,
    url: string
  ): Promise<SharedFlightResult> {
    if (!timeoutMs || timeoutMs <= 0) {
      return flight;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const backstop = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(
          `Shared in-flight GET ${url} did not settle within ${timeoutMs}ms; ` +
            `the leading request may itself have stalled.`
        );
        (err as { code?: string }).code = "ETIMEDOUT";
        reject(err);
      }, timeoutMs);
    });
    return Promise.race([flight, backstop]).finally(() => clearTimeout(timer));
  }

  /**
   * Configure Basic Authentication for the client
   */
  private setupAuth(): void {
    if (this.config.apiKey) {
      this.client.defaults.headers.common["X-Api-Key"] = this.config.apiKey;
    } else {
      const authString = Buffer.from(
        `${this.config.username}:${this.config.password}`
      ).toString("base64");
      this.client.defaults.headers.common["Authorization"] = `Basic ${authString}`;
    }
  }

  /**
   * Handle API errors with meaningful messages
   */
  private handleError(error: AxiosError | RateLimitError | Error): Promise<never> {
    // ── Settle this request's single flight FIRST, whatever the error is ────
    //
    // Reached only on FINAL failure: axios-retry's interceptor runs before
    // this one and swallows retryable errors while it re-dispatches, so a
    // flight stays pending across retries and waiters wait them out.
    //
    // With an HTTP response the flight RESOLVES — the wire answered, and each
    // waiter's own validateStatus decides whether that status is data or an
    // error (production callers genuinely differ; see response-cache.ts).
    // Without one — network failure, client-side refusal, cancellation — it
    // REJECTS, and every waiter shares the error: re-issuing the herd at a
    // failing bMS is exactly what this exists to prevent. A rejected flight is
    // deleted on settle and never cached, so the NEXT caller leads fresh.
    if ('config' in error && error.config) {
      const flightHandle = (error.config as BConnectRequestConfig).__flightHandle;
      if (flightHandle) {
        const resp = (error as AxiosError).response;
        if (resp) {
          flightHandle.resolve({ status: resp.status, statusText: resp.statusText, data: resp.data });
        } else {
          flightHandle.reject(error);
        }
      }
    }

    // Log error if audit logging is enabled
    if (this.auditLogger && 'config' in error && error.config) {
      const config = error.config as BConnectRequestConfig;
      const method = config.method?.toUpperCase() || 'GET';
      const path = error.config.url || '';
      const startTime = (error.config as BConnectRequestConfig).__auditStartTime || Date.now();
      this.auditLogger.logError(method, path, error, startTime);
    }

    // SEC-0/SEC-1: a request this client refused to send. The message is already
    // precise and the McpError code is already right — do not flatten it into
    // "Request error: ..." in the branch below.
    if (error instanceof RequestBlockedError) {
      throw error;
    }

    // Handle rate limit errors from the client-side limiter. Rethrow the
    // original instance rather than flattening it into a plain Error: the
    // structured retry-after data (`error.info.remaining`/`resetInMs`) and the
    // `instanceof RateLimitError` identity are the only way a caller (or a
    // future retry wrapper) can distinguish a self-imposed rate-limit
    // rejection from any other client-side error. `error.message` already
    // starts with "Rate limit exceeded" by default (see RateLimiterConfig),
    // which is also what `classifyToolError`'s message-pattern fallback keys
    // on — that behaviour is unchanged, this only stops discarding the object.
    if (error instanceof RateLimitError) {
      throw error;
    }

    if (error instanceof AxiosError && error.response) {
      // Server responded with error status
      const status = error.response.status;

      // INT-43: the sentences below used to be the whole message. A model that
      // got "Resource not found." had no resource type, no offending id, no
      // route, and no hint that a 404 on this API can also mean the deployment
      // is pointed at the wrong release — the root README's troubleshooting
      // table knows that rule; the runtime error never said it. Everything the
      // caller needs to recover is appended here. The request path is included
      // (it is the caller's own input); the host is not, matching the
      // deliberate sanitisation in the no-response branch below.
      const where = requestSummary(error);
      const detail = apiErrorDetail(error);
      const suffix = `${where}${detail}`;

      // INT-53: the thrown value carries `status` now. The message is unchanged
      // — same sentence, same suffix, same release hint — but a plain `Error`
      // forced every catch-all downstream to pattern-match English to find out
      // whether it was holding a recoverable 404 or a genuine fault, so all of
      // them gave up and coded everything as -32603 InternalError.
      // `BConnectApiError extends Error`, so every existing `instanceof Error`
      // branch and every assertion on the text is unaffected.
      const at = {
        method: error.config?.method?.toUpperCase(),
        path: error.config?.url,
      };

      switch (status) {
        case 401:
          throw new BConnectApiError(
            status,
            "Authentication failed. Check your credentials (username/password or API key)." +
            suffix,
            at
          );
        case 403:
          throw new BConnectApiError(
            status,
            "Access denied. Insufficient permissions for this operation." + suffix,
            at
          );
        case 404:
          throw new BConnectApiError(status, "Resource not found." + suffix + releaseHint(), at);
        case 409:
          // The most-hit error path in the suite, and until now it arrived as
          // "the server is broken". bConnect uses 409 for ordinary, expected
          // states, so the message says that outright and points at the API's
          // own detail, which is already in `suffix` and is the actual answer.
          throw new BConnectApiError(
            status,
            "The request conflicts with the resource's current state. This is usually NOT an " +
              "error in your arguments — bConnect answers 409 for ordinary conditions such as " +
              "\"this endpoint has no maintenance window\", \"a folder with that name already " +
              "exists\" and \"that folder is not empty\". Read the API's own detail below and " +
              "treat it as the answer; retrying the identical call will return the same 409." +
              suffix,
            at
          );
        case 412:
          throw new BConnectApiError(
            status,
            "A precondition for this request was not met. The API's detail below names it; " +
              "satisfy it and retry." + suffix,
            at
          );
        case 423:
          throw new BConnectApiError(
            status,
            "The resource is locked because another operation holds it — typically a cleanup or " +
              "maintenance task already running on the bMS. This is temporary: wait for it to " +
              "finish and retry. Do not start a second one." + suffix,
            at
          );
        case 429:
          throw new BConnectApiError(
            status, "Rate limit exceeded. Please try again later." + suffix, at
          );
        case 500:
          throw new BConnectApiError(
            status, "bConnect API returned an internal server error." + suffix, at
          );
        default:
          throw new BConnectApiError(
            status,
            `bConnect API error (HTTP ${status}).` + suffix +
              (status === 400 ? releaseHint() : ""),
            at
          );
      }
    } else if (error instanceof AxiosError && error.request) {
      // Request made but no response received. A TLS trust failure lands here —
      // give an actionable message before the generic connectivity one (issue #59).
      const certHint = tlsUntrustedCertHint(error);
      if (certHint) {
        throw new Error(certHint);
      }
      // do not expose internal hostname
      throw new Error(
        "Cannot connect to the bConnect API. " +
        "Check network connectivity and BCONNECT_BASE_URL configuration."
      );
    } else {
      // Error in request configuration
      throw new Error(`Request error: ${error.message}`);
    }
  }

  /**
   * Health check / test connection — now also the bMS version probe (VER-1).
   *
   * The primary probe is `GET /servermanagement/v2.0/ManagementServer`, whose
   * 2xx response both proves connectivity/credentials AND carries the required
   * string `version` field the 26R1 gate in `runServer` needs — one round-trip
   * for both, never two on the happy path.
   *
   * A 401/403/404 there means the credential is scoped away from the
   * servermanagement module (or the route is missing); that must not brick the
   * server, so connectivity falls back to the pre-gate probe of
   * `healthCheckPath` — the ONLY case with a second round-trip — and the
   * outcome is recorded as `denied` for the caller to warn about. Any other
   * failure is a genuine connectivity failure, exactly as before.
   *
   * The signature stays `Promise<boolean>` deliberately: thirteen bootstrap
   * tests (and any operator tooling) stub or observe `testConnection()` by
   * name. What the probe learned is read back via `getConnectionProbe()`.
   *
   * PER-18: the fallback still asks for one row via `PageSize: 1`, the paging
   * parameter the API actually reads (`$top` is OData and is ignored).
   *
   * SEC-2: the failure is described, never inspected. See
   * `describeConnectionFailure`.
   */
  async testConnection(): Promise<boolean> {
    if (process.env.BCONNECT_SKIP_CONNECTIVITY_CHECK === 'true') {
      this.lastConnectionProbe = { outcome: "skipped" };
      return true;
    }
    try {
      const response = await this.client.get(BMS_VERSION_PROBE_PATH);
      const version = (response.data as { version?: unknown } | null | undefined)?.version;
      this.lastConnectionProbe =
        typeof version === "string" && version.trim() !== ""
          ? { outcome: "version", version }
          : { outcome: "no-version-field" };
      return true;
    } catch (error) {
      const status = error instanceof BConnectApiError ? error.status : undefined;
      if (status === 401 || status === 403 || status === 404) {
        // Version route unreadable with these credentials (or absent). Verify
        // connectivity the pre-gate way so a servermanagement-scoped-away
        // credential keeps exactly the startup behaviour it had before the gate.
        try {
          await this.client.get(this.healthCheckPath, { params: { PageSize: 1 } });
          this.lastConnectionProbe = { outcome: "denied", status };
          return true;
        } catch (fallbackError) {
          this.lastConnectionProbe = { outcome: "failed" };
          console.error(`Connection test failed: ${describeConnectionFailure(fallbackError)}`);
          return false;
        }
      }
      this.lastConnectionProbe = { outcome: "failed" };
      console.error(`Connection test failed: ${describeConnectionFailure(error)}`);
      return false;
    }
  }

  /**
   * What the most recent `testConnection()` run learned (VER-1), or undefined
   * if it never ran in this process. `runServer` reads this — after calling
   * `testConnection()` — to enforce the 26R1 minimum without a second request.
   */
  getConnectionProbe(): ConnectionProbe | undefined {
    return this.lastConnectionProbe;
  }

  /**
   * Get base axios client for direct API calls if needed
   */
  getHttpClient(): AxiosInstance {
    return this.client;
  }

  /**
   * Execute batch operations with concurrency control
   *
   * @param operations Array of batch operations to execute
   * @returns Batch execution result with summary and individual results
   * @throws Error if batch operations is not enabled
   *
   * @example
   * ```typescript
   * // Create batch operations for multiple endpoint updates
   * const operations = createBatchOperations(
   *   endpointIds,
   *   (id) => client.endpoints.updateEndpoint(id, { comments: 'Updated' }),
   *   'update-endpoint'
   * );
   *
   * // Execute with progress tracking
   * const result = await client.executeBatch(operations);
   * console.log(`Success: ${result.summary.succeeded}/${result.summary.total}`);
   * ```
   */
  async executeBatch<T, R>(
    operations: BatchOperation<T, R>[]
  ): Promise<BatchExecutionResult<T, R>> {
    if (!this.batchOperations) {
      throw new Error(
        'Batch operations is not enabled. Initialize BConnectClient with batch configuration.'
      );
    }
    return this.batchOperations.execute(operations);
  }

  /**
   * Get batch operations configuration
   *
   * @returns Current batch operations configuration
   * @throws Error if batch operations is not enabled
   */
  getBatchConfig(): { concurrency: number; stopOnError: boolean; retries: number; retryDelay: number } {
    if (!this.batchOperations) {
      throw new Error(
        'Batch operations is not enabled. Initialize BConnectClient with batch configuration.'
      );
    }
    return this.batchOperations.getConfig();
  }
}
