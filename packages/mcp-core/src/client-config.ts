import fs from "fs";
import type { AuditLevel } from "./audit-logger.js";
import type { BConnectConfig } from "./bconnect-client-base.js";

/**
 * Credentials passed per request (gateway). All or nothing: a request that
 * brings any non-empty value uses only its own secrets, never the
 * environment's (REQ-SRV-023 AC 6). Empty values count as missing.
 */
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
  constructor(source: "environment" | "request" = "environment") {
    super(source === "request"
      ? "The request's credentials are incomplete: give an API key, or both a username and a password"
      : "Either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD are required");
    this.name = "MissingCredentialsError";
  }
}

/** BCONNECT_BASE_URL is unset or empty (REQ-SRV-023 AC 8): there is no address to send anything to. */
export class MissingBaseUrlError extends ClientConfigError {
  constructor() {
    super("BCONNECT_BASE_URL isn't set. Set it to the bConnect address, for example https://bms.example.com/bconnect");
    this.name = "MissingBaseUrlError";
  }
}

/**
 * Every variable clientConfigFromEnv reads. A server's shared client is
 * rebuilt when one of them changes (serverClients); a test keeps the list
 * equal to the reads.
 */
export const CLIENT_ENV_VARS = [
  "BCONNECT_BASE_URL",
  "BCONNECT_USERNAME",
  "BCONNECT_PASSWORD",
  "BCONNECT_API_KEY",
  "BCONNECT_ALLOW_INSECURE_HTTP",
  "BCONNECT_CA_CERT_PATH",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "BCONNECT_RELEASE",
  "BCONNECT_AUDIT_LEVEL",
  "BCONNECT_TIMEOUT_MS",
  "BCONNECT_MAX_RETRIES",
  "BCONNECT_RATE_LIMIT_ENABLED",
  "BCONNECT_RATE_LIMIT_MAX_REQUESTS",
  "BCONNECT_RATE_LIMIT_WINDOW_MS",
] as const;

/** Whether a request brings credentials of its own: any non-empty value. */
export function hasRequestCredentials(credentials: BConnectCredentials | undefined): credentials is BConnectCredentials {
  return !!credentials && [credentials.baseUrl, credentials.username, credentials.password, credentials.apiKey].some((v) => !!v);
}

/** The base URL would send credentials unencrypted, or isn't an http(s) URL (REQ-SRV-020). */
export class InsecureBaseUrlError extends ClientConfigError {
  constructor(message: string) {
    super(message);
    this.name = "InsecureBaseUrlError";
  }
}

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

/** The bMS releases the servers know, spelt as the servers compare them. */
export const RELEASES = ["26R1", "25R2"] as const;

/**
 * BCONNECT_RELEASE: unset means 26R1. The servers compare the value exactly
 * (`=== "26R1"`), so anything else, even `26r1` or an empty value, would quietly
 * give the 25R2 tool set; it stops the server instead.
 */
export function checkRelease(value: string | undefined): void {
  if (value === undefined || (RELEASES as readonly string[]).includes(value)) {
    return;
  }
  const shown = JSON.stringify(value.length > 64 ? `${value.slice(0, 64)}…` : value);
  throw new ClientConfigError(`BCONNECT_RELEASE ${shown} isn't valid. Use 26R1 or 25R2, spelt exactly so, or leave it unset for 26R1.`);
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
 * so it is refused, naming where it came from, never the value. Callers pass
 * the NFC form (see basicAuthHeader), so a decomposed "a" + U+0308 counts as "ä".
 */
export function assertLatin1Credential(source: string, value: string | undefined): void {
  if (value === undefined) {return;}
  for (const ch of value) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp > 0xff) {
      const encoding = cp === 0xfffd ? " (U+FFFD usually means the file holding it isn't saved as UTF-8)" : "";
      throw new ClientConfigError(
        `${source} contains a character Basic authentication can't carry${encoding}: bConnect reads Basic ` +
        "credentials as Latin-1, which goes up to U+00FF (umlauts and the section sign are fine, the euro sign isn't). " +
        "Use an API key (BCONNECT_API_KEY) instead, or choose credentials without such characters."
      );
    }
  }
}

/**
 * bConnect's API layer rejects a Basic password with a non-ASCII character
 * (401 "Unauthenticated user"), although the Windows logon behind it accepts
 * the Latin-1 form (#265, live on bMS 26.1.161). No encoding passes both, and
 * each attempt counts toward the account lockout, so such a password is
 * refused before anything is sent, naming where it came from, never the value.
 */
export function assertAsciiPassword(source: string, value: string | undefined): void {
  if (value === undefined) {return;}
  for (const ch of value) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp > 0x7f) {
      const encoding = cp === 0xfffd ? " (U+FFFD usually means the file holding it isn't saved as UTF-8)" : "";
      throw new ClientConfigError(
        `${source} contains a non-ASCII character${encoding}. bConnect's API rejects such passwords (401) ` +
        "even though Windows accepts them, so the server doesn't try: each attempt would count toward the " +
        "account lockout. Use an ASCII-only password, or an API key (BCONNECT_API_KEY) instead."
      );
    }
  }
}

/**
 * The Authorization header for Basic auth as bConnect reads it: NFC, then
 * Latin-1, then base64 (#228). The username may use Latin-1; the password must
 * be ASCII (#265).
 */
export function basicAuthHeader(username: string, password: string): string {
  const user = username.normalize("NFC");
  // The raw password: NFC would turn a few non-ASCII characters into ASCII
  // (U+212A Kelvin sign -> "K") and send a different password. An ASCII password
  // needs no normalising.
  assertLatin1Credential("The username", user);
  assertAsciiPassword("The password", password);
  return `Basic ${Buffer.from(`${user}:${password}`, "latin1").toString("base64")}`;
}

/**
 * The BConnectClient config every server uses, for tool calls and the startup
 * probe alike. Reads only `env` (servers load their .env file before calling)
 * and never writes to stdout, which carries JSON-RPC in stdio mode. The result
 * is frozen: a server can't change the shared settings for one of its clients.
 *
 * Certificate verification is off only for NODE_TLS_REJECT_UNAUTHORIZED=0.
 * Throws a ClientConfigError: MissingCredentialsError when no way to
 * authenticate is set, MissingBaseUrlError without a base URL, InsecureBaseUrlError for a base URL that isn't https
 * (loopback http and BCONNECT_ALLOW_INSECURE_HTTP=true excepted), and the base
 * class when BCONNECT_CA_CERT_PATH can't be read or the file is empty.
 */
export function clientConfigFromEnv(env: NodeJS.ProcessEnv, credentials?: BConnectCredentials): Readonly<BConnectConfig> {
  // All or nothing: a request's own credentials never borrow a secret from the
  // environment, and its base URL never receives the environment's secrets.
  const fromRequest = hasRequestCredentials(credentials);
  const secrets = fromRequest ? credentials : { username: env.BCONNECT_USERNAME, password: env.BCONNECT_PASSWORD, apiKey: env.BCONNECT_API_KEY };
  const username = secrets.username || undefined;
  const password = secrets.password || undefined;
  const apiKey = secrets.apiKey || undefined;

  if (!apiKey && (!username || !password)) {
    throw new MissingCredentialsError(fromRequest ? "request" : "environment");
  }
  const baseUrl = ((fromRequest && credentials.baseUrl) || env.BCONNECT_BASE_URL || "").trim();
  if (baseUrl === "") {
    throw new MissingBaseUrlError();
  }
  assertSecureBaseUrl(baseUrl, env);
  if (!apiKey) {
    assertLatin1Credential(fromRequest ? "The request's username" : "BCONNECT_USERNAME", username?.normalize("NFC"));
    assertAsciiPassword(fromRequest ? "The request's password" : "BCONNECT_PASSWORD", password);
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
  checkRelease(env.BCONNECT_RELEASE);
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
