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
  const raw = value ?? "";
  const normalised = raw.trim().toLowerCase();
  if (normalised === "") {
    return "none";
  }
  const level = AUDIT_LEVELS.find((candidate) => candidate === normalised);
  if (!level) {
    // Quoted with escapes and shortened, so a newline or terminal escape in the value can't forge log lines.
    const shown = JSON.stringify(raw.length > 64 ? `${raw.slice(0, 64)}…` : raw);
    throw new ClientConfigError(`BCONNECT_AUDIT_LEVEL ${shown} isn't valid. Use one of: ${AUDIT_LEVELS.join(", ")}.`);
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

const DEFAULT_TIMEOUT_MS = 30000;

/**
 * A whole-number setting within [min, max]; unset or empty gives the default.
 * Anything else stops the server with the variable and the allowed range
 * (REQ-XC-002 AC 1).
 */
function boundedInt(name: string, setting: string | undefined, min: number, max: number, fallback: number): number {
  const raw = (setting ?? "").trim();
  if (raw === "") {return fallback;}
  const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(value >= min && value <= max)) {
    throw new ClientConfigError(`${name}=${JSON.stringify(setting)} isn't valid. Use a whole number from ${min} to ${max}.`);
  }
  return value;
}

const intOr = (value: string | undefined, fallback: number): number => {
  const parsed = parseInt(value ?? "", 10);
  return isNaN(parsed) ? fallback : parsed;
};

/**
 * Basic credentials go out as Latin-1 (ISO-8859-1): bConnect decodes them that
 * way and announces no charset (#228). A character above U+00FF can't be sent,
 * so it is refused, naming where it came from, never the value.
 */
export function assertLatin1Credential(source: string, value: string | undefined): void {
  if (value === undefined) {return;}
  for (const ch of value) {
    if ((ch.codePointAt(0) ?? 0) > 0xff) {
      throw new ClientConfigError(
        `${source} contains a character Basic authentication can't carry: bConnect reads Basic ` +
        "credentials as Latin-1, which goes up to U+00FF (umlauts and the section sign are fine, the euro sign isn't). " +
        "Use an API key (BCONNECT_API_KEY) instead, or choose a password without such characters."
      );
    }
  }
}

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
  if (!apiKey) {
    assertLatin1Credential(credentials?.username !== undefined ? "The request's username" : "BCONNECT_USERNAME", username);
    assertLatin1Credential(credentials?.password !== undefined ? "The request's password" : "BCONNECT_PASSWORD", password);
  }

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
  const timeout = boundedInt("BCONNECT_TIMEOUT_MS", env.BCONNECT_TIMEOUT_MS, 1000, 600000, DEFAULT_TIMEOUT_MS);
  // Retries apply to reads only, whatever this says (REQ-XC-003 AC 2).
  const maxRetries = boundedInt("BCONNECT_MAX_RETRIES", env.BCONNECT_MAX_RETRIES, 0, 5, 0);

  return Object.freeze({
    baseUrl,
    username,
    password,
    apiKey,
    rejectUnauthorized: env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
    timeout,
    maxRetries,
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
