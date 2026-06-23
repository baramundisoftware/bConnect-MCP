/**
 * Audit Logger - Comprehensive API Operation Logging
 *
 * Provides audit logging for all bConnect API operations with configurable levels,
 * structured log format, and support for external logging systems.
 */

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
  private readonly securitySensitivePaths: RegExp[];

  constructor(config: AuditLoggerConfig) {
    this.config = {
      level: config.level,
      username: config.username,
      logHandler: config.logHandler || this.defaultLogHandler.bind(this),
      includeParameters: config.includeParameters || false,
    };

    // Define security-sensitive API paths
    this.securitySensitivePaths = [
      /\/BitLockerSecrets/i,
      /\/TpmOwnerPasswords/i,
      /\/BitLockerPINs/i,
      /\/Secrets/i,
      /\/Password/i,
      /\/Credential/i,
    ];
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
   */
  isSecuritySensitive(path: string): boolean {
    return this.securitySensitivePaths.some(pattern => pattern.test(path));
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
      parameters: this.config.includeParameters ? parameters : undefined,
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
   * Default log handler - outputs to console
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

    if (entry.level === 'error') {
      console.error(message);
    } else if (entry.level === 'warn') {
      console.warn(message);
    } else {
      console.info(message);
    }

    // Include parameters if configured (separate line for readability)
    if (entry.parameters && this.config.includeParameters) {
      console.info(`${prefix} Parameters:`, JSON.stringify(entry.parameters, null, 2));
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<Required<AuditLoggerConfig>> {
    return { ...this.config };
  }
}
