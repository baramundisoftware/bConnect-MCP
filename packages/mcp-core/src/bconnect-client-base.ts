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
    logHandler?: (entry: AuditLogEntry) => void; // Custom log handler (default: console)
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

export class BConnectClientBase {
  protected client: AxiosInstance;
  // Probed by testConnection(). WindowsEndpoints exists on every bMS; a domain
  // whose credentials cannot read it should override via config.healthCheckPath.
  protected healthCheckPath: string;
  private config: BConnectConfig;
  private rateLimiter: RateLimiter | null = null;
  private auditLogger: AuditLogger | null = null;
  private responseCache: ResponseCache | null = null;
  private batchOperations: BatchOperations | null = null;


  constructor(config: BConnectConfig) {
    this.config = config;
    this.healthCheckPath = config.healthCheckPath ?? "/v2.0/WindowsEndpoints";

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
              // Return cached response by throwing special marker
              (requestConfig as BConnectRequestConfig).__cachedResponse = cachedResponse;
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
            // Invalidate cache entries related to this URL
            const urlPattern = new RegExp(url.replace(/\/[^\/]+$/, '')); // Remove last path segment
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
      // Server responded with error status
      const status = error.response.status;

      switch (status) {
        case 401:
          throw new Error(
            "Authentication failed. Check your credentials (username/password or API key)."
          );
        case 403:
          throw new Error(
            "Access denied. Insufficient permissions for this operation."
          );
        case 404:
          throw new Error("Resource not found.");
        case 429:
          throw new Error("Rate limit exceeded. Please try again later.");
        case 500:
          throw new Error("bConnect API returned an internal server error.");
        default:
          throw new Error(`bConnect API error (HTTP ${status}).`);
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
   * Health check / test connection
   */
  async testConnection(): Promise<boolean> {
    if (process.env.BCONNECT_SKIP_CONNECTIVITY_CHECK === 'true') {return true;}
    try {
      await this.client.get(this.healthCheckPath, { params: { $top: 1 } });
      return true;
    } catch (error) {
      console.error("Connection test failed:", error);
      return false;
    }
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
