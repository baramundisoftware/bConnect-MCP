/**
 * bconnect-mcp-gateway — request body-size limit resolution (SC-1).
 *
 * ── The defect this exists to remove ────────────────────────────────────────
 * `app.ts` used to do this:
 *
 *     app.use(express.json({ limit: process.env.MCP_GATEWAY_MAX_BODY ?? "1mb" }));
 *
 * — handing an operator-supplied string straight to body-parser, which resolves
 * it with `bytes.parse()` deep inside `raw-body`. That parser does not fail
 * loudly. It fails in two silent directions, and both were reproduced against
 * the versions this repo actually resolves (`body-parser@2.2.2`, `bytes@3.1.2`):
 *
 *   - `bytes.parse("")` and `bytes.parse("abc")` return **null**, and raw-body's
 *     enforcement is written `if (limit !== null && received > limit)`. A null
 *     limit therefore **removes the body cap entirely** — this is
 *     GHSA-v422-hmwv-36x6, and it is the only advisory in the current `npm
 *     audit` whose reachability is local code rather than an unreached
 *     dependency. The realistic trigger is not exotic: `MCP_GATEWAY_MAX_BODY=`
 *     left blank in a compose/`.env.gateway` file is an empty string, which is
 *     not nullish, so `?? "1mb"` does not catch it.
 *   - `bytes.parse("1mib")`, `"10m"`, `"1mb "`, `" 1mb"` and `"1 megabyte"` all
 *     return **1** — one byte — because the unit regex fails and `parseInt`
 *     salvages the leading digit. Every request then 413s. That direction fails
 *     closed, so it is an availability bug rather than a security one, but it is
 *     the same root cause and a deployer deserves to be told.
 *
 * ── Why this is a local fix and not only a dependency bump ──────────────────
 * Upgrading body-parser is worth doing and is done (see the root `overrides`),
 * but it is not sufficient and it is not the control. The gateway is not an npm
 * workspace member; `Dockerfile` deletes `bconnect-mcp-gateway/node_modules` so
 * every import resolves up at the root install. Which express — and therefore
 * which body-parser — the gateway gets is a property of somebody else's
 * dependency tree, and today that is express@5/body-parser@2 arriving via the
 * MCP SDK, not the `express: ^4.21.0` this package declares. A control that
 * depends on winning that resolution race is not a control.
 *
 * So we resolve the limit to an explicit **number of bytes** here and pass the
 * number. `bytes.parse(1048576)` returns the number unchanged on every version,
 * which means the fail-open branch is unreachable by construction regardless of
 * what body-parser resolves to.
 *
 * Dependency-free on purpose, matching rate-limit.ts: the gateway adds no
 * package to gain a strict parser it can write in twenty lines.
 */

import type { Logger } from "./logger.js";

/** Documented default, as it appears in `.env.gateway.example` and docs/. */
export const DEFAULT_MAX_BODY = "1mb";

/** The same default, resolved. */
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

/**
 * Upper bound we will accept. An MCP JSON-RPC request body is kilobytes; a cap
 * above this is indistinguishable from having no cap, so it is refused rather
 * than honoured silently.
 */
export const MAX_ACCEPTED_BODY_BYTES = 1024 * 1024 * 1024;

const UNIT_BYTES: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
};

/**
 * Strictly parse a byte-size string.
 *
 * Accepts a bare integer count of bytes, or a decimal followed by one of
 * b/kb/mb/gb with at most one space between. Anything else — including the
 * `mib`/`m`/`megabyte` spellings `bytes.parse` silently misreads as 1 — returns
 * null, which the caller turns into a warning plus the documented default.
 *
 * Returns null (never a guess) for: empty/blank input, an unknown or missing
 * unit, a non-positive size, a non-integer byte count, or a size above
 * MAX_ACCEPTED_BODY_BYTES.
 */
export function parseByteSize(raw: string): number | null {
  const match = /^(\d+(?:\.\d+)?)\s?(b|kb|mb|gb)?$/i.exec(raw.trim());
  if (!match) {
    return null;
  }
  const scale = match[2] ? UNIT_BYTES[match[2].toLowerCase()] : 1;
  const value = Number(match[1]) * scale;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    return null;
  }
  if (value > MAX_ACCEPTED_BODY_BYTES) {
    return null;
  }
  return value;
}

/** Bound what we echo of an operator-supplied value into a log line. */
function forLog(raw: string): string {
  const flat = raw.replace(/\s+/g, " ");
  return flat.length > 64 ? `${flat.slice(0, 64)}…` : flat;
}

/**
 * Resolve MCP_GATEWAY_MAX_BODY to a byte count.
 *
 * Unset falls back to the documented default silently — that is the supported
 * configuration, not a mistake. Anything SET but unusable warns and falls back:
 * a deployer who typed a limit believes they have one, so silently reverting to
 * the default would be the same silence this module exists to remove.
 */
export function resolveMaxBodyBytes(
  raw: string | undefined = process.env.MCP_GATEWAY_MAX_BODY,
  logger?: Logger,
): number {
  if (raw === undefined) {
    return DEFAULT_MAX_BODY_BYTES;
  }
  const parsed = parseByteSize(raw);
  if (parsed === null) {
    logger?.warn(
      "MCP_GATEWAY_MAX_BODY is not a usable size; falling back to the default body cap. " +
        "Use a bare byte count or a number with b/kb/mb/gb (for example 1mb). " +
        "Note that 'mib', 'm' and 'megabyte' are NOT accepted — body-parser reads them as 1 byte.",
      { value: forLog(raw), fallback: DEFAULT_MAX_BODY },
    );
    return DEFAULT_MAX_BODY_BYTES;
  }
  return parsed;
}
