/**
 * Audit Logger - Comprehensive API Operation Logging
 *
 * Provides audit logging for all bConnect API operations with configurable levels,
 * structured log format, and support for external logging systems.
 *
 * ── Destination (upstream finding B5) ────────────────────────────────────────
 * The default handler used to emit non-error entries with `console.info`, which
 * is STDOUT. On a stdio MCP server stdout is the JSON-RPC channel, so every
 * audit line was injected into the protocol stream:
 *
 *     stdout lines total : 4
 *       JSON-RPC frames  : 2
 *       NON-JSON lines   : 2
 *     [AUDIT] 2026-07-28T18:13:31.980Z api-key-user GET /variables/v2.0/...
 *
 * Calls still succeeded only because the TypeScript SDK skips lines it cannot
 * parse. A stricter client, or an audit line containing a `{`, corrupts framing.
 * Everything now goes to STDERR, which is already the convention `main()` uses
 * for startup messages.
 *
 * The second half of B5 is that there was no way to persist an audit trail at
 * all for a stdio deployment — the logger had no file destination and its output
 * went into a transport that discards it. `logFile` (wired to
 * `BCONNECT_AUDIT_FILE`) appends one JSON object per line, so a requirement like
 * "100% of writes visible in the audit log" is achievable as shipped.
 */

import * as fs from "node:fs";
import { isSecuritySensitiveRoute } from "./security-routes.js";

export type AuditLevel = 'all' | 'write' | 'security' | 'none';
export type LogLevel = 'info' | 'warn' | 'error';

export interface AuditLogEntry {
  timestamp: string;
  level: LogLevel;
  operation: string;      // e.g., "GET /endpoints/v2.0/WindowsEndpoints"
  user: string;           // Username from config
  method: string;         // HTTP method
  path: string;           // API path
  parameters?: Record<string, unknown>;  // Query params or request body
  statusCode?: number;    // HTTP status code
  duration?: number;      // Request duration in ms
  error?: string;         // Error message if failed
  securitySensitive?: boolean; // Flag for security-sensitive operations
}

export interface AuditLoggerConfig {
  /**
   * Audit logging level
   * - 'all': Log all API operations
   * - 'write': Log only write operations (POST, PATCH, DELETE)
   * - 'security': Log only security-sensitive operations (BitLocker secrets, etc.)
   * - 'none': Disable audit logging
   * @default 'none'
   */
  level: AuditLevel;

  /**
   * Username for audit log entries
   */
  username: string;

  /**
   * Custom log handler (optional)
   * If not provided, logs to console
   */
  logHandler?: (entry: AuditLogEntry) => void;

  /**
   * Include request parameters in audit log (query params, body)
   * @default false (for security - may contain sensitive data)
   */
  includeParameters?: boolean;

  /**
   * Append each entry as one JSON object per line to this file, in addition to
   * the stderr line. Unset means stderr only. Wired to `BCONNECT_AUDIT_FILE`.
   *
   * Only consulted by the default handler — a custom `logHandler` owns its own
   * destination.
   */
  logFile?: string;
}

/**
 * Words whose presence in a parameter name means the value must never reach an
 * audit record.
 *
 * Matched against the NORMALISED name (see `normaliseParameterName`), where
 * every word boundary — camelCase, `_`, `-`, `.`, `/` — has become a single
 * `_`, so `(?:^|_)…(?:_|$)` is a real word boundary and not a substring match.
 *
 * A4: the previous form was one unanchored alternation
 * (`/(pass|pwd|secret|…|pin)/i`), which redacted the value of every parameter
 * whose name merely *contained* one of those letters runs — `mapping`,
 * `spinner`, `pinned`, `passenger`, `compass`, `tokenizer`. An audit log that
 * redacts `mapping` teaches operators that `[redacted]` means nothing.
 * Inflections are therefore spelled out rather than approximated with a prefix
 * match, because `pass` as a prefix is `passenger`.
 */
// `community` is here because an SNMP community string IS the credential on
// SNMP v1 and v2c — it is a shared secret that happens not to be spelled
// "password". It became reachable when the network-endpoint write fields were
// restored: `snmpConfiguration` is patched as a whole object, and its
// `authenticationPassword` / `encryptionPassword` were already matched while
// `community` was not, so a v3 write was redacted and a v1/v2c write was
// logged in clear.
const SENSITIVE_PARAMETER_WORD =
  /(?:^|_)(?:pass|passes|passwd|passwds|password|passwords|passphrase|passphrases|pwd|pwds|secret|secrets|credential|credentials|token|tokens|apikey|apikeys|api_key|api_keys|api_token|api_tokens|authorization|pin|pins|community)(?:_|$)/;

/**
 * Lower-case `name` and turn every word boundary into `_`.
 *
 *   `startupPin`  -> `startup_pin`      `mapping`   -> `mapping`
 *   `apiKey`      -> `api_key`          `spinner`   -> `spinner`
 *   `X-API-Key`   -> `x_api_key`        `/password` -> `_password`
 */
function normaliseParameterName(name: string): string {
  return String(name ?? '')
    // camelCase and PascalCase: fooBar -> foo_Bar
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    // acronym followed by a word: APIKey -> API_Key
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    // every other separator run (-, _, ., /, space) collapses to one _
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase();
}

/**
 * Does this parameter name — or JSON-Pointer path — name a credential?
 *
 * Accepts both a bare key (`newPassword`) and a JSON Patch pointer
 * (`/localAdministrator/password`), because a JSON Patch body names the field
 * in `path` and carries the value in `value`.
 */
export function isSensitiveParameterName(name: string): boolean {
  return SENSITIVE_PARAMETER_WORD.test(normaliseParameterName(name));
}

/** Depth cap — an audit record is a line, not a heap dump. */
const REDACT_MAX_DEPTH = 4;

/**
 * Copy `value`, replacing anything that looks like a credential with a marker.
 *
 * SEC-4 wires `includeParameters` to `BCONNECT_AUDIT_INCLUDE_PARAMS` so write
 * records can finally say *what* was changed. The parameters of a write against
 * `/LocalAdministrativeAccounts/...` or `/BitLocker/.../Pin` are exactly the
 * values the audit log must not become a second copy of, hence this.
 */
export function redactSensitiveParameters(value: unknown, depth = 0): unknown {
  if (depth >= REDACT_MAX_DEPTH) {
    return '[depth-limited]';
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveParameters(item, depth + 1));
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    // JSON Patch bodies name the field in `path` and carry it in `value`, so a
    // key-name check alone would miss `{op:'replace', path:'/password', value:'…'}`.
    const patchTargetsSecret =
      key === 'value' &&
      typeof (value as { path?: unknown }).path === 'string' &&
      isSensitiveParameterName((value as { path: string }).path);

    out[key] = isSensitiveParameterName(key) || patchTargetsSecret
      ? '[redacted]'
      : redactSensitiveParameters(item, depth + 1);
  }
  return out;
}

/**
 * Audit Logger
 *
 * Logs API operations based on configured audit level. Supports:
 * - Structured logging with timestamps, user, operation, status
 * - Configurable audit levels (all, write, security-only, none)
 * - Custom log handlers for external systems (Splunk, ELK, etc.)
 * - Security-sensitive operation flagging
 */
export class AuditLogger {
  private readonly config: Required<AuditLoggerConfig>;

  constructor(config: AuditLoggerConfig) {
    this.config = {
      level: config.level,
      username: config.username,
      logHandler: config.logHandler || this.defaultLogHandler.bind(this),
      includeParameters: config.includeParameters || false,
      logFile: config.logFile || '',
    };
  }

  /**
   * Check if audit logging should occur for this operation
   */
  shouldLog(method: string, path: string): boolean {
    if (this.config.level === 'none') {
      return false;
    }

    if (this.config.level === 'all') {
      return true;
    }

    if (this.config.level === 'write') {
      return ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method.toUpperCase());
    }

    if (this.config.level === 'security') {
      return this.isSecuritySensitive(path);
    }

    return false;
  }

  /**
   * Check if path is security-sensitive
   *
   * SEC-4: this used to carry its own six regexes, of which exactly one matched
   * a route the suite issues. The LAPS route
   * (`/LocalAdministrativeAccounts/WindowsEndpoints/{id}`) contains no
   * "Secrets", "Password" or "Credential" segment, and the PIN route
   * (`.../Pin`) was matched against `/\/BitLockerPINs/i` — so at
   * `BCONNECT_AUDIT_LEVEL=security`, the setting an operator picks precisely to
   * watch credential access, reading a cleartext local-administrator password
   * produced no record at all. The patterns now live in `security-routes.ts`,
   * shared with the client's deny-list so the two cannot drift apart again.
   */
  isSecuritySensitive(path: string): boolean {
    return isSecuritySensitiveRoute(path);
  }

  /**
   * Log API request start
   */
  logRequest(method: string, path: string, parameters?: Record<string, unknown>): number {
    if (!this.shouldLog(method, path)) {
      return Date.now(); // Return start time for duration calculation
    }

    const entry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      level: 'info',
      operation: `${method} ${path}`,
      user: this.config.username,
      method: method.toUpperCase(),
      path,
      parameters: this.config.includeParameters
        ? (redactSensitiveParameters(parameters) as Record<string, unknown> | undefined)
        : undefined,
      securitySensitive: this.isSecuritySensitive(path),
    };

    this.config.logHandler(entry);
    return Date.now();
  }

  /**
   * Log API response
   */
  logResponse(method: string, path: string, statusCode: number, startTime: number): void {
    if (!this.shouldLog(method, path)) {
      return;
    }

    const duration = Date.now() - startTime;
    const level: LogLevel = statusCode >= 400 ? 'error' : statusCode >= 300 ? 'warn' : 'info';

    const entry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      operation: `${method} ${path}`,
      user: this.config.username,
      method: method.toUpperCase(),
      path,
      statusCode,
      duration,
      securitySensitive: this.isSecuritySensitive(path),
    };

    this.config.logHandler(entry);
  }

  /**
   * Log API error
   */
  logError(method: string, path: string, error: Error, startTime: number): void {
    if (!this.shouldLog(method, path)) {
      return;
    }

    const duration = Date.now() - startTime;

    const entry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      level: 'error',
      operation: `${method} ${path}`,
      user: this.config.username,
      method: method.toUpperCase(),
      path,
      duration,
      error: error.message,
      securitySensitive: this.isSecuritySensitive(path),
    };

    this.config.logHandler(entry);
  }

  /**
   * Default log handler — STDERR, plus an optional append-only file.
   *
   * B5: this must never write to stdout. On a stdio MCP server stdout carries
   * JSON-RPC frames, and an audit line landing there is protocol corruption.
   * `process.stderr.write` is used rather than `console.*` so no future console
   * reconfiguration can silently redirect it back onto the protocol channel.
   */
  private defaultLogHandler(entry: AuditLogEntry): void {
    const prefix = entry.securitySensitive ? '[SECURITY AUDIT]' : '[AUDIT]';
    const timestamp = entry.timestamp;
    const operation = entry.operation;
    const user = entry.user;
    const status = entry.statusCode ? ` - ${entry.statusCode}` : '';
    const duration = entry.duration ? ` (${entry.duration}ms)` : '';
    const error = entry.error ? ` - ERROR: ${entry.error}` : '';

    const message = `${prefix} ${timestamp} ${user} ${operation}${status}${duration}${error}`;

    process.stderr.write(`${message}\n`);

    // Include parameters if configured (separate line for readability).
    // Compact, single-line: a multi-line audit record is harder to grep and,
    // historically, was the shape most likely to break framing.
    if (entry.parameters && this.config.includeParameters) {
      process.stderr.write(`${prefix} Parameters: ${JSON.stringify(entry.parameters)}\n`);
    }

    this.appendToFile(entry);
  }

  /**
   * Append one JSON object per line to the configured audit file.
   *
   * Synchronous by design — an audit record that loses a race with process exit
   * is not an audit record. A write failure degrades to a single stderr warning
   * rather than failing the API call that triggered it.
   */
  private appendToFile(entry: AuditLogEntry): void {
    if (!this.config.logFile) {
      return;
    }
    try {
      fs.appendFileSync(this.config.logFile, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch (err) {
      if (!this.fileWriteFailed) {
        this.fileWriteFailed = true;
        process.stderr.write(
          `[AUDIT] cannot write to BCONNECT_AUDIT_FILE (${this.config.logFile}): ` +
          `${(err as Error).message} — audit records continue on stderr only.\n`
        );
      }
    }
  }

  /** Warn once, not once per request, if the audit file cannot be written. */
  private fileWriteFailed = false;

  /**
   * Get current configuration
   */
  getConfig(): Readonly<Required<AuditLoggerConfig>> {
    return { ...this.config };
  }
}
