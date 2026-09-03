/**
 * bconnect-mcp-gateway — structured logger (audit M4).
 *
 * Minimal, dependency-free logger with level filtering and text/JSON output.
 *   LOG_LEVEL   error | warn | info | debug   (default: info)
 *   LOG_FORMAT  text | json                   (default: text)
 *
 * JSON mode emits one object per line ({ts, level, msg, ...fields}) for ingestion
 * by ELK / Loki / CloudWatch. Text mode is human-readable for local/dev use.
 * All output goes to stderr (stdout is reserved for protocol data in stdio mode;
 * the gateway is HTTP, but we keep the convention).
 */

export type LogLevel = "error" | "warn" | "info" | "debug";
export type LogFields = Record<string, unknown>;

const LEVELS: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export interface Logger {
  error(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  debug(msg: string, fields?: LogFields): void;
}

/** Create a logger; reads LOG_LEVEL / LOG_FORMAT once at construction. */
export function createLogger(): Logger {
  const level = (process.env.LOG_LEVEL?.toLowerCase() as LogLevel) ?? "info";
  const threshold = LEVELS[level] ?? LEVELS.info;
  const json = (process.env.LOG_FORMAT?.toLowerCase() ?? "text") === "json";

  function emit(lvl: LogLevel, msg: string, fields?: LogFields): void {
    if (LEVELS[lvl] > threshold) {return;}
    if (json) {
      process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), level: lvl, msg, ...fields }) + "\n");
    } else {
      const extra =
        fields && Object.keys(fields).length
          ? " " + Object.entries(fields).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ")
          : "";
      process.stderr.write(`[mcp-gateway] ${lvl.toUpperCase()} ${msg}${extra}\n`);
    }
  }

  return {
    error: (m, f) => emit("error", m, f),
    warn: (m, f) => emit("warn", m, f),
    info: (m, f) => emit("info", m, f),
    debug: (m, f) => emit("debug", m, f),
  };
}
