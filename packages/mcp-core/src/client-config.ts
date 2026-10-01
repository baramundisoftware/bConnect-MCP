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

/** Neither an API key nor both username and password are set. */
export class MissingCredentialsError extends Error {
  constructor() {
    super("Either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD are required");
    this.name = "MissingCredentialsError";
  }
}

const DEFAULT_BASE_URL = "https://bms.example.com:443/bconnect";
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 100;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60000;
const AUDIT_LEVELS: readonly AuditLevel[] = ["all", "write", "security", "none"];

const isAuditLevel = (value: string | undefined): value is AuditLevel =>
  AUDIT_LEVELS.some((level) => level === value);

const intOr = (value: string | undefined, fallback: number): number => {
  const parsed = parseInt(value ?? "", 10);
  return isNaN(parsed) ? fallback : parsed;
};

/**
 * The BConnectClient config every server uses, for tool calls and the startup
 * probe alike. Reads only `env` (servers load their .env file before calling)
 * and never writes to stdout, which carries JSON-RPC in stdio mode.
 *
 * Certificate verification is off only for NODE_TLS_REJECT_UNAUTHORIZED=0.
 * Throws MissingCredentialsError when no way to authenticate is set, and the
 * fs error when BCONNECT_CA_CERT_PATH can't be read.
 */
export function clientConfigFromEnv(env: NodeJS.ProcessEnv, credentials?: BConnectCredentials): BConnectConfig {
  const baseUrl = credentials?.baseUrl || env.BCONNECT_BASE_URL || DEFAULT_BASE_URL;
  const username = credentials?.username ?? env.BCONNECT_USERNAME;
  const password = credentials?.password ?? env.BCONNECT_PASSWORD;
  const apiKey = credentials?.apiKey ?? env.BCONNECT_API_KEY;

  if (!apiKey && (!username || !password)) {
    throw new MissingCredentialsError();
  }

  const caCertPath = env.BCONNECT_CA_CERT_PATH;
  const ca = caCertPath ? fs.readFileSync(caCertPath, "utf8") : undefined;
  const auditLevel = env.BCONNECT_AUDIT_LEVEL;

  return {
    baseUrl,
    username,
    password,
    apiKey,
    rejectUnauthorized: env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
    ...(ca !== undefined && { ca }),
    ...(env.BCONNECT_RATE_LIMIT_ENABLED === "true" && {
      rateLimit: {
        enabled: true,
        maxRequests: intOr(env.BCONNECT_RATE_LIMIT_MAX_REQUESTS, DEFAULT_RATE_LIMIT_MAX_REQUESTS),
        windowMs: intOr(env.BCONNECT_RATE_LIMIT_WINDOW_MS, DEFAULT_RATE_LIMIT_WINDOW_MS),
      },
    }),
    auditLog: { level: isAuditLevel(auditLevel) ? auditLevel : "none" },
  };
}
