/**
 * bConnect API Client
 *
 * Modular client for baramundi bConnect REST API
 * Supports multiple API modules: Endpoints, Assets, Software, etc.
 */

import axios, { AxiosHeaders, AxiosInstance, AxiosError, CreateAxiosDefaults, InternalAxiosRequestConfig } from "axios";
import axiosRetry from "axios-retry";
import http from "http";
import https from "https";
import tls, { PeerCertificate } from "node:tls";
import { BConnectApiError, BConnectConnectionError, BConnectRedirectError } from "./api-errors.js";
import { cleanModelData, cleanModelText } from "./model-text.js";
import { basicAuthHeader } from "./client-config.js";

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
  // eslint-disable-next-line no-restricted-syntax -- feature probe: @types/node may lack tls.getCACertificates (Node >= 22.15); not an API body
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

/**
 * Extended Axios request config to carry internal metadata through interceptors.
 */
interface BConnectRequestConfig extends InternalAxiosRequestConfig {
  __rateLimitInfo?: { allowed: boolean; remaining: number; limit: number; resetInMs: number };
  __auditStartTime?: number;
  __cachedResponse?: unknown;
}
import { RateLimiter, RateLimitError } from "./rate-limiter.js";
import { AuditLogger, AuditLevel, AuditLogEntry } from "./audit-logger.js";
import { ResponseCache } from "./response-cache.js";
import { BatchOperations, BatchOperation, BatchExecutionResult } from "./batch-operations.js";
import { assertSecretRouteAllowed, SecretRouteBlockedError } from "./secret-routes.js";
import { assertCanonicalRequestPath, RequestPathRefusedError } from "./request-path.js";

export interface BConnectConfig {
  baseUrl: string;
  username?: string;
  password?: string;
  apiKey?: string;
  timeout?: number;

  // Path probed by testConnection(), overriding the server's own probeRoute.
  // bConnect exposes no global health route, so this must be a list endpoint
  // the configured credentials can read.
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
    logHandler?: (entry: AuditLogEntry) => void; // Custom log handler (default: one line per entry on stderr)
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

/** What a client gets besides its config (REQ-SRV-023, ADR-0010). */
export interface ClientOptions {
  /** The server's one rate limiter, shared by all its clients; overrides config.rateLimit. */
  rateLimiter?: RateLimiter;
  /** How long an idle kept-alive connection stays open, in ms (default 5000). */
  idleSocketMs?: number;
}

/**
 * Idle connections are closed after this, below common server idle timeouts,
 * so a reused connection is rarely one bMS is just closing (D2 = c). The
 * request's own timeout still governs a slow answer.
 */
const DEFAULT_IDLE_SOCKET_MS = 5000;

/**
 * Origin (scheme + host + port) a redirect points to, resolved against the
 * request URL. Path and query are left out: they could carry data, and the
 * operator only needs the address to put into BCONNECT_BASE_URL.
 */
function redirectOrigin(error: AxiosError): string {
  const location = error.response?.headers?.location;
  if (typeof location !== "string" || location === "") {
    return "an unknown address";
  }
  try {
    const base = new URL(error.config?.url ?? "", error.config?.baseURL ?? undefined);
    return new URL(location, base).origin;
  } catch {
    return "an unknown address";
  }
}

/** A method that changes data: anything but GET, HEAD and OPTIONS (#254). */
export function isWriteMethod(method: string | undefined): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes((method ?? "GET").toUpperCase());
}

/** The error for a write whose outcome the client can't know (REQ-XC-003 AC 6, #254). */
function outcomeUnknown(method: string | undefined, reason: string): BConnectConnectionError {
  return new BConnectConnectionError(
    `bConnect didn't answer the ${(method ?? "").toUpperCase()} request (${reason}), ` +
    "so it's unknown whether bMS made the change; it may still carry it out. " +
    "Check the current state (read the object back) before repeating this call."
  );
}

/** `value` without trailing slashes (a scan, not a regex: linear on any input). */
function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") {end--;}
  return value.slice(0, end);
}

/**
 * Request path relative to the base URL, without query string or fragment. An
 * absolute URL loses the base URL's origin and path prefix; one outside the base
 * URL gives a placeholder instead of naming it.
 */
function relativeRequestPath(url: string | undefined, baseUrl: string): string {
  const raw = url ?? "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {return raw.split("?")[0].split("#")[0];}
  try {
    const target = new URL(raw);
    const base = new URL(baseUrl);
    const prefix = trimTrailingSlashes(base.pathname);
    if (target.origin === base.origin && (target.pathname === prefix || target.pathname.startsWith(prefix + "/"))) {
      return target.pathname.slice(prefix.length);
    }
  } catch {
    // Unparsable: fall through to the placeholder.
  }
  return "(an address outside BCONNECT_BASE_URL)";
}

/** `text` with every occurrence of `needle` (any case) replaced by `replacement`. */
function replaceAllIgnoreCase(text: string, needle: string, replacement: string): string {
  if (needle === "") {return text;}
  const lower = text.toLowerCase();
  const target = needle.toLowerCase();
  let out = "";
  let from = 0;
  for (let at = lower.indexOf(target); at !== -1; at = lower.indexOf(target, from)) {
    out += text.slice(from, at) + replacement;
    from = at + target.length;
  }
  return out + text.slice(from);
}

/**
 * bConnect's problem text (RFC 7807 title, detail and up to five validation
 * errors), cleaned for the model, with the configured host removed (best
 * effort: a bare single-label host name and percent-encoded forms stay). `type` and
 * `instance` are left out: they can carry URLs. Anything that isn't a problem
 * object (an HTML page from a proxy, plain text, an array) gives undefined.
 */
function problemText(data: unknown, baseUrl: string): string | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) {return undefined;}
  const title = Reflect.get(data, "title");
  const detail = Reflect.get(data, "detail");
  const errors: unknown = Reflect.get(data, "errors");
  const parts: string[] = [];
  const cleanTitle = typeof title === "string" ? title.trim() : "";
  const cleanDetail = typeof detail === "string" ? detail.trim() : "";
  if (cleanTitle) {parts.push(cleanTitle);}
  if (cleanDetail && cleanDetail !== cleanTitle) {parts.push(cleanDetail);}
  if (errors && typeof errors === "object" && !Array.isArray(errors)) {
    const fields = Object.entries(errors).slice(0, 5).map(([field, messages]) => {
      const list: unknown[] = Array.isArray(messages) ? messages : [messages];
      return `${field}: ${list.filter((m) => typeof m === "string").join(" ")}`;
    });
    if (fields.length > 0) {parts.push(fields.join("; "));}
  }
  if (parts.length === 0) {return undefined;}
  // Clean first (without shortening), so a host split by an invisible character
  // is whole again when it is removed; shorten last.
  let text = cleanModelText(parts.join(": "), Number.POSITIVE_INFINITY);
  try {
    const url = new URL(baseUrl);
    for (const needle of [trimTrailingSlashes(baseUrl), url.origin, url.host, url.hostname.includes(".") ? url.hostname : ""]) {
      text = replaceAllIgnoreCase(text, needle, "[bConnect host]");
    }
  } catch {
    // No parsable base URL: nothing to remove.
  }
  return cleanModelText(text);
}

/** Responses the success step has handled; see the retry note there. */
const processedResponses = new WeakSet<object>();

export class BConnectClientBase {
  protected client: AxiosInstance;
  // List route of the server's own domain probed by testConnection(), e.g.
  // "/endpoints/v2.0/Endpoints". Each server's client sets it; there is no
  // default, because every bConnect route carries its domain prefix (#111).
  protected readonly probeRoute?: string;
  private config: BConnectConfig;
  private rateLimiter: RateLimiter | null = null;
  private auditLogger: AuditLogger | null = null;
  private responseCache: ResponseCache | null = null;
  private batchOperations: BatchOperations | null = null;


  constructor(config: BConnectConfig, options: ClientOptions = {}) {
    this.config = config;
    const idleSocketMs = options.idleSocketMs ?? DEFAULT_IDLE_SOCKET_MS;

    // Resolve the CA trust list. An explicit CA (e.g. BCONNECT_CA_CERT_PATH) always
    // wins. Otherwise, when verification is on, fall back to the OS trust store
    // merged with Node's bundle so an already-trusted enterprise CA works without a
    // manual export (issue #59); this is a no-op on Node < 22.15.
    const caList: BConnectConfig["ca"] | undefined =
      config.ca ??
      (config.rejectUnauthorized !== false ? buildDefaultTrustStore() : undefined);

    // Create HTTPS agent with SSL/TLS configuration
    const httpsAgentOptions: https.AgentOptions = {
      // One client serves every tool call, so connections are kept and reused;
      // idle ones are closed after idleSocketMs.
      keepAlive: true,
      timeout: idleSocketMs,
      // Default to secure (reject unauthorized certificates)
      rejectUnauthorized: config.rejectUnauthorized !== false,

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
      // bConnect declares no redirects, and a followed redirect would carry the
      // X-Api-Key header to whatever host it names (REQ-SRV-021). A 3xx becomes
      // an error that tells the operator to fix BCONNECT_BASE_URL instead.
      maxRedirects: 0,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      }
    };

    // Only add httpsAgent if not explicitly disabled (needed for MSW testing)
    if (!config.disableHttpsAgent) {
      axiosConfig.httpsAgent = new https.Agent(httpsAgentOptions);
      // Loopback http (the bundled mock, local tests) reuses connections the same way.
      axiosConfig.httpAgent = new http.Agent({ keepAlive: true, timeout: idleSocketMs });
    }

    this.client = axios.create(axiosConfig);

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
      // A retried request gets its own timeout window.
      shouldResetTimeout: true,
      // Only reads are retried, and only when the failure may be transient:
      // no answer (network error, timeout) or 502/503/504. A write is never
      // sent twice (REQ-XC-003 AC 2); 4xx, 429 and 500 aren't retried (#162).
      retryCondition: (error: AxiosError) => {
        if ((error.config?.method ?? "get").toUpperCase() !== "GET") {
          return false;
        }
        if (!error.response) {
          return true;
        }
        return [502, 503, 504].includes(error.response.status);
      },
    });

    // The server's shared rate limiter, or one of the client's own (REQ-SRV-023 AC 1).
    this.rateLimiter = options.rateLimiter ?? (config.rateLimit?.enabled
      ? new RateLimiter({
        maxRequests: config.rateLimit.maxRequests || 100,
        windowMs: config.rateLimit.windowMs || 60000,
        enabled: true,
        message: config.rateLimit.message,
      })
      : null);
    if (this.rateLimiter) {
      // Add rate limiting request interceptor for V2.0 client
      this.client.interceptors.request.use(
        (requestConfig: InternalAxiosRequestConfig) => {
          // A cache hit sends nothing, so it costs no token.
          if (this.rateLimiter && (requestConfig as BConnectRequestConfig).__cachedResponse === undefined) {
            const rateLimitInfo = this.rateLimiter.tryConsume();
            if (!rateLimitInfo.allowed) {
              throw new RateLimitError(
                this.rateLimiter.getConfig().message,
                rateLimitInfo
              );
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

            // Check cache for GET requests
            const cachedResponse = this.responseCache.get(method, url, params);
            if (cachedResponse) {
              // Answer from the cache instead of sending the request (#160).
              (requestConfig as BConnectRequestConfig).__cachedResponse = cachedResponse;
              requestConfig.adapter = async (adapterConfig) => ({
                data: cachedResponse,
                status: 200,
                statusText: "OK",
                headers: new AxiosHeaders(),
                config: adapterConfig,
                request: {},
              });
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
        // A response that succeeded on a retry already went through this step in
        // the retried request's own chain; process it once (audit, cache, cleaning).
        if (processedResponses.has(response)) {
          return response;
        }
        processedResponses.add(response);

        // Hidden characters in bMS data never reach the cache, the audit step or
        // the model (REQ-XC-006 AC 2, ADR-0009). Binary bodies are left alone.
        response.data = cleanModelData(response.data);

        // Check if response was cached (from request interceptor)
        if (this.responseCache && response.config) {
          const cachedResponse = (response.config as BConnectRequestConfig).__cachedResponse;
          if (cachedResponse) {
            // Return cached response
            response.data = cachedResponse;
            response.headers['X-Cache'] = 'HIT';
            return response;
          }

          // Cache successful GET responses
          const method = response.config.method?.toUpperCase() || 'GET';
          const url = response.config.url || '';
          const params = response.config.params;

          if (response.status >= 200 && response.status < 300) {
            this.responseCache.set(method, url, response.data, params);
            response.headers['X-Cache'] = 'MISS';
          }

          // Invalidate cache on write operations
          if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
            // Forget the written resource's collection and everything below it,
            // matched by path segments (the last segment removed).
            this.responseCache.invalidatePath(url.replace(/\/[^/]+$/, ''));
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
    // Every PATCH operation in the bConnect specs declares only
    // application/json-patch+json (#188), so every PATCH is sent with it.
    this.client.interceptors.request.use((requestConfig: InternalAxiosRequestConfig) => {
      if ((requestConfig.method ?? "").toLowerCase() === "patch") {
        requestConfig.headers.set("Content-Type", "application/json-patch+json");
      }
      return requestConfig;
    });

    // Canonical-path check (REQ-SRV-018). Runs right after the secret-route gate
    // below (axios runs request interceptors in reverse order), so a secret route
    // is still refused by that gate, and before cache, rate limiter or audit.
    this.client.interceptors.request.use(
      (requestConfig: InternalAxiosRequestConfig) => {
        try {
          assertCanonicalRequestPath(requestConfig.url ?? "");
        } catch (error) {
          this.auditRefusal(requestConfig, error);
          throw error;
        }
        return requestConfig;
      },
      (error) => Promise.reject(error)
    );
    // Secret-route gate (REQ-SRV-017). Registered last because axios runs request
    // interceptors in reverse order: this one runs first, before the cache or
    // rate limiter can act on a request whose response carries credentials.
    this.client.interceptors.request.use(
      (requestConfig: InternalAxiosRequestConfig) => {
        try {
          assertSecretRouteAllowed(requestConfig.method ?? "GET", requestConfig.url ?? "");
        } catch (error) {
          this.auditRefusal(requestConfig, error);
          throw error;
        }
        return requestConfig;
      },
      (error) => Promise.reject(error)
    );

    // TODO: Initialize V2.0 module
    // Example: this.domain = new DomainModule(this.client);
  }

  /**
   * Record a request refused before sending (secret route, non-canonical path).
   * These refusals happen before the audit step that records sent requests.
   */
  private auditRefusal(requestConfig: InternalAxiosRequestConfig, error: unknown): void {
    try {
      this.auditLogger?.logRefusal(
        requestConfig.method ?? "GET",
        requestConfig.url ?? "",
        error instanceof Error ? error.message : String(error),
      );
    } catch {
      // A failing custom log handler must not replace the refusal itself.
    }
  }

  /**
   * Configure Basic Authentication for the client
   */
  private setupAuth(): void {
    if (this.config.apiKey) {
      this.client.defaults.headers.common["X-Api-Key"] = this.config.apiKey;
    } else {
      // Latin-1, as bConnect decodes Basic credentials (#228); refuses what it can't carry.
      this.client.defaults.headers.common["Authorization"] =
        basicAuthHeader(this.config.username ?? "", this.config.password ?? "");
    }
  }

  /**
   * Handle API errors with meaningful messages
   */
  private handleError(error: AxiosError | RateLimitError | Error): Promise<never> {
    // The secret-route and request-path refusals are already written for the
    // operator; pass them on as is.
    if (error instanceof SecretRouteBlockedError || error instanceof RequestPathRefusedError) {
      throw error;
    }
    // A retry (axios-retry) sends the request through this whole chain again,
    // so its failure arrives here already mapped and audited: pass it on as is.
    if (!(error instanceof AxiosError) && !(error instanceof RateLimitError)) {
      throw error;
    }

    // Log error if audit logging is enabled
    if (this.auditLogger && 'config' in error && error.config) {
      const config = error.config as BConnectRequestConfig;
      const method = config.method?.toUpperCase() || 'GET';
      const path = error.config.url || '';
      const startTime = (error.config as BConnectRequestConfig).__auditStartTime || Date.now();
      this.auditLogger.logError(method, path, error, startTime);
    }

    // Handle rate limit errors from client-side limiter
    if (error instanceof RateLimitError) {
      throw new Error(
        `${error.message} (Remaining: ${error.info.remaining}, ` +
        `Reset in: ${Math.ceil(error.info.resetInMs / 1000)}s)`
      );
    }

    if (error instanceof AxiosError && error.response) {
      // A write whose success answer was cut off mid-body (axios: ERR_BAD_RESPONSE
      // with a 2xx status, "stream has been aborted") probably succeeded; its
      // outcome is unknown (#254). axios also uses ERR_BAD_RESPONSE for every 5xx,
      // so the status decides.
      if (error.code === "ERR_BAD_RESPONSE" && error.response.status < 300 && isWriteMethod(error.config?.method)) {
        throw outcomeUnknown(error.config?.method, "the answer was cut off");
      }
      // Server responded with error status
      const status = error.response.status;

      if (status >= 300 && status < 400) {
        throw new BConnectRedirectError(
          `bConnect answered with a redirect to ${redirectOrigin(error)}. ` +
          "Set BCONNECT_BASE_URL to the final address; redirects are not followed, " +
          "so credentials are only ever sent to the configured host."
        );
      }

      const details = {
        status,
        method: (error.config?.method ?? "GET").toUpperCase(),
        path: relativeRequestPath(error.config?.url, this.config.baseUrl),
        problemText: problemText(error.response.data, this.config.baseUrl),
      };
      // The message is the short operator text (audit log, startup probe);
      // toolErrorResult() builds the model's text from the details.
      switch (status) {
        case 401:
          throw new BConnectApiError(
            "Authentication failed. Check your credentials (username/password or API key).", details
          );
        case 403:
          throw new BConnectApiError(
            "Access denied. Insufficient permissions for this operation.", details
          );
        case 404:
          throw new BConnectApiError("Resource not found.", details);
        case 429:
          throw new BConnectApiError("Rate limit exceeded. Please try again later.", details);
        case 500:
          throw new BConnectApiError("bConnect API returned an internal server error.", details);
        default:
          throw new BConnectApiError(`bConnect API error (HTTP ${status}).`, details);
      }
    } else if (error instanceof AxiosError && error.request) {
      // Request made but no response received. A TLS trust failure lands here —
      // give an actionable message before the generic connectivity one (issue #59).
      const certHint = tlsUntrustedCertHint(error);
      if (certHint) {
        throw new BConnectConnectionError(certHint);
      }
      // axios's own timeout ("timeout of N ms exceeded") isn't a connection failure:
      // the request went out but no answer came in time (#203). A TCP connect
      // timeout from the operating system (also ETIMEDOUT) stays "Cannot connect".
      const timedOut = (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") && /^timeout of \d+ms exceeded/.test(error.message);
      // The request went out, then the connection closed or the answer couldn't be
      // read (#254). A reset while connecting or during the TLS handshake happened
      // before anything was sent and stays "Cannot connect".
      const cause: unknown = error.cause;
      const beforeSending = (cause instanceof Error && Reflect.get(cause, "syscall") === "connect") ||
        /^connect /.test(error.message) || /before secure TLS connection/i.test(error.message);
      const closedAfterSending = !beforeSending && (error.code === "ECONNRESET" || error.code === "EPIPE" ||
        /^HPE_/.test(error.code ?? "") || /socket hang up/i.test(error.message));
      const seconds = (error.config?.timeout ?? this.config.timeout ?? 30000) / 1000;
      // A write that was sent but got no answer may still be carried out by bMS:
      // say so instead of suggesting a retry (REQ-XC-003 AC 6, #254).
      if (isWriteMethod(error.config?.method) && (timedOut || closedAfterSending)) {
        throw outcomeUnknown(error.config?.method,
          timedOut ? `no answer within ${seconds} s, BCONNECT_TIMEOUT_MS` : "the connection was closed or the answer was unreadable");
      }
      if (timedOut) {
        throw new BConnectConnectionError(
          `The bConnect API didn't answer within ${seconds} s (BCONNECT_TIMEOUT_MS). ` +
          "The bMS may be busy; try a smaller page size or raise the timeout."
        );
      }
      // do not expose internal hostname
      throw new BConnectConnectionError(
        "Cannot connect to the bConnect API. " +
        "Check network connectivity and BCONNECT_BASE_URL configuration."
      );
    } else {
      // Error in request configuration
      throw new Error(`Request error: ${error.message}`);
    }
  }

  /**
   * Health check / test connection
   */
  async testConnection(): Promise<boolean> {
    return (await this.checkConnection()) === undefined;
  }

  /**
   * Sends the probe request; returns why it failed, or undefined when it
   * succeeded. Whether to skip the check is the startup routine's decision
   * (runServer), not the client's.
   */
  async checkConnection(): Promise<string | undefined> {
    const path = this.config.healthCheckPath ?? this.probeRoute;
    if (!path) {
      return "this server's client sets no probeRoute";
    }
    try {
      await this.client.get(path, { params: { PageSize: 1 } });
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  /** The bConnect address this client sends to (for startup messages). */
  get baseUrl(): string {
    return this.config.baseUrl;
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
