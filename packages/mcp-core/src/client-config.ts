import fs from "fs";
import type { AuditLevel } from "./audit-logger.js";
import type { BConnectConfig } from "./bconnect-client-base.js";

/** Credentials passed per request (gateway); each one overrides the environment. */
export interface BConnectCredentials {
  baseUrl?: string;
  username?: string;
  password?: string;
  apiKey?: string;
}

/**
 * A configuration problem the operator has to fix (credentials, CA file, base
 * URL). Servers map every subclass to a clean startup exit and tool error.
 */
export class ClientConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientConfigError";
  }
}

/** Neither an API key nor both username and password are set. */
export class MissingCredentialsError extends ClientConfigError {
  constructor() {
    super("Either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD are required");
    this.name = "MissingCredentialsError";
  }
}

/** The base URL would send credentials unencrypted, or isn't an http(s) URL (REQ-SRV-020). */
export class InsecureBaseUrlError extends ClientConfigError {
  constructor(message: string) {
    super(message);
    this.name = "InsecureBaseUrlError";
  }
}

const DEFAULT_BASE_URL = "https://bms.example.com:443/bconnect";
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 100;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60000;
const AUDIT_LEVELS: readonly AuditLevel[] = ["none", "security", "write", "all"];

/**
 * BCONNECT_AUDIT_LEVEL, ignoring case and surrounding spaces; unset or empty is
 * "none". Any other value stops the server: a typo must not switch auditing off.
 */
function auditLevelOf(value: string | undefined): AuditLevel {
  const normalised = (value ?? "").trim().toLowerCase();
  if (normalised === "") {
    return "none";
  }
  const level = AUDIT_LEVELS.find((candidate) => candidate === normalised);
  if (!level) {
    throw new ClientConfigError(`BCONNECT_AUDIT_LEVEL "${value}" isn't valid. Use one of: ${AUDIT_LEVELS.join(", ")}.`);
  }
  return level;
}

const isLoopback = (hostname: string): boolean =>
  hostname === "localhost" || hostname === "[::1]" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);

let insecureHttpWarned = false;

/**
 * Every request carries the credential, so it may only travel over https.
 * Loopback http (the bundled mock, local testing) is allowed; any other http
 * host needs BCONNECT_ALLOW_INSECURE_HTTP=true and is warned about once.
 */
function assertSecureBaseUrl(baseUrl: string, env: NodeJS.ProcessEnv): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new InsecureBaseUrlError("BCONNECT_BASE_URL must be an https:// URL, for example https://bms.example.com/bconnect");
  }
  if (url.protocol === "https:") {
    return;
  }
  if (url.protocol !== "http:") {
    throw new InsecureBaseUrlError(`BCONNECT_BASE_URL must start with https:// (got ${url.protocol}//)`);
  }
  if (isLoopback(url.hostname)) {
    return;
  }
  if ((env.BCONNECT_ALLOW_INSECURE_HTTP ?? "").trim().toLowerCase() !== "true") {
    throw new InsecureBaseUrlError(
      `BCONNECT_BASE_URL uses http:// for ${url.host}, which would send the bConnect credentials unencrypted. ` +
      "Use https://, or set BCONNECT_ALLOW_INSECURE_HTTP=true for a test setup."
    );
  }
  if (!insecureHttpWarned) {
    insecureHttpWarned = true;
    // stderr: stdout carries JSON-RPC in stdio mode.
    console.error(`WARNING: BCONNECT_ALLOW_INSECURE_HTTP=true: bConnect credentials travel unencrypted to ${url.host}.`);
  }
}

const intOr = (value: string | undefined, fallback: number): number => {
  const parsed = parseInt(value ?? "", 10);
  return isNaN(parsed) ? fallback : parsed;
};

/**
 * The BConnectClient config every server uses, for tool calls and the startup
 * probe alike. Reads only `env` (servers load their .env file before calling)
 * and never writes to stdout, which carries JSON-RPC in stdio mode. The result
 * is frozen: a server can't change the shared settings for one of its clients.
 *
 * Certificate verification is off only for NODE_TLS_REJECT_UNAUTHORIZED=0.
 * Throws a ClientConfigError: MissingCredentialsError when no way to
 * authenticate is set, InsecureBaseUrlError for a base URL that isn't https
 * (loopback http and BCONNECT_ALLOW_INSECURE_HTTP=true excepted), and the base
 * class when BCONNECT_CA_CERT_PATH can't be read or the file is empty.
 */
export function clientConfigFromEnv(env: NodeJS.ProcessEnv, credentials?: BConnectCredentials): Readonly<BConnectConfig> {
  const baseUrl = credentials?.baseUrl || env.BCONNECT_BASE_URL || DEFAULT_BASE_URL;
  const username = credentials?.username ?? env.BCONNECT_USERNAME;
  const password = credentials?.password ?? env.BCONNECT_PASSWORD;
  const apiKey = credentials?.apiKey ?? env.BCONNECT_API_KEY;

  if (!apiKey && (!username || !password)) {
    throw new MissingCredentialsError();
  }
  assertSecureBaseUrl(baseUrl, env);

  const caCertPath = env.BCONNECT_CA_CERT_PATH;
  let ca: string | undefined;
  try {
    ca = caCertPath ? fs.readFileSync(caCertPath, "utf8") : undefined;
  } catch (error) {
    throw new ClientConfigError(`BCONNECT_CA_CERT_PATH can't be read: ${caCertPath} (${(error as NodeJS.ErrnoException).code ?? "error"})`);
  }
  if (ca !== undefined && ca.trim() === "") {
    // An empty CA would silently replace the default trust store with Node's bundled CAs only.
    throw new ClientConfigError(`BCONNECT_CA_CERT_PATH points to an empty file: ${caCertPath}`);
  }
  const auditLevel = auditLevelOf(env.BCONNECT_AUDIT_LEVEL);

  return Object.freeze({
    baseUrl,
    username,
    password,
    apiKey,
    rejectUnauthorized: env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
    ...(ca !== undefined && { ca }),
    ...(env.BCONNECT_RATE_LIMIT_ENABLED === "true" && {
      rateLimit: Object.freeze({
        enabled: true,
        maxRequests: intOr(env.BCONNECT_RATE_LIMIT_MAX_REQUESTS, DEFAULT_RATE_LIMIT_MAX_REQUESTS),
        windowMs: intOr(env.BCONNECT_RATE_LIMIT_WINDOW_MS, DEFAULT_RATE_LIMIT_WINDOW_MS),
      }),
    }),
    auditLog: Object.freeze({ level: auditLevel }),
  });
}
