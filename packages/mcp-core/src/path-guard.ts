/**
 * Path-segment safety and request-path containment (upstream finding SEC-0 / C1)
 *
 * ── The defect this exists to fix ────────────────────────────────────────────
 * Every module builds its URLs by interpolating a caller-supplied id into a
 * template literal:
 *
 *     this.client.get(`${this.basePath}/Endpoints/${id}`)      // ~28 call sites
 *
 * `basePath` is only a *prefix* (`/endpoints/v2.0`), so an id containing `../`
 * walks out of the module and reaches any route the shared bMS service
 * credential can read. Verified live against labcorp.local: `get_endpoint`
 * with `id: "../../../defensecontrol/v2.0/BitLocker/WindowsEndpoints"` returned
 * 23 BitLocker records, and `get_job_definition` with
 * `id: "../../../servermanagement/v2.0/ApiKeys"` returned the API-key inventory.
 *
 * ── Why the guard lives here and not only in the per-server validators ───────
 * Wiring each server's `validateToolParameters()` is the right ergonomic fix and
 * is being done in the server packages. But a per-tool validator allowlist has
 * to be hand-maintained across 284 tools forever, and this repo already has
 * evidence that hand-maintained per-server sets drift (the F21 write-gate
 * omission recorded at bconnect-endpoints-mcp/src/index.ts:1040-1044). The
 * containment check below runs in a request interceptor in
 * `BConnectClientBase`, so it covers all 13 servers at once and a newly added
 * tool cannot forget it.
 *
 * ── What is deliberately NOT done here ──────────────────────────────────────
 * No per-server basePath *allowlist*. Legitimate cross-module traffic exists:
 * the endpoints server GETs `/jobs/v2.0/JobInstances` from
 * `stale-endpoints.ts`, and diagnose-job reads a v1.1 side channel. Containment
 * is expressed as "the resolved path must be the path the module actually
 * wrote" — i.e. no `..` segment may pop a directory off it — which blocks
 * traversal without constraining which module a server may legitimately
 * address.
 */

import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { BareMcpError } from "./protocol-error.js";

/**
 * Base class for a request the client refuses to send at all.
 *
 * Extends `BareMcpError` — itself an `McpError` — so a server that lets it
 * propagate still produces a protocol error with a useful code rather than an
 * opaque HTTP failure, so `BConnectClientBase.handleError()` can pass it
 * through untouched instead of flattening it into "Request error: ...", and so
 * the client sees one `MCP error <code>: ` prefix rather than two (A2).
 */
export class RequestBlockedError extends BareMcpError {
  constructor(code: ErrorCode, message: string) {
    super(code, message);
    this.name = "RequestBlockedError";
  }
}

/** A tool argument that is meant to be one path segment is not one. */
export class UnsafePathSegmentError extends RequestBlockedError {
  constructor(message: string) {
    super(ErrorCode.InvalidParams, message);
    this.name = "UnsafePathSegmentError";
  }
}

/** An outgoing request path contains traversal and would escape its module. */
export class PathContainmentError extends RequestBlockedError {
  constructor(message: string) {
    super(ErrorCode.InvalidParams, message);
    this.name = "PathContainmentError";
  }
}

const PERCENT_ESCAPE = /%[0-9a-f]{2}/i;

/** True if the value contains a C0 control character or DEL. */
function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Percent-decode repeatedly so `%2e%2e%2f` and `%252e%252e%252f` are seen for
 * what they are. Bounded, and tolerant of malformed escapes: a value that is
 * not valid percent-encoding still gets its traversal characters unmasked.
 */
function decodeRepeatedly(value: string, rounds = 3): string {
  let out = value;
  for (let i = 0; i < rounds && PERCENT_ESCAPE.test(out); i++) {
    let next: string;
    try {
      next = decodeURIComponent(out);
    } catch {
      next = out
        .replace(/%2e/gi, ".")
        .replace(/%2f/gi, "/")
        .replace(/%5c/gi, "\\");
    }
    if (next === out) {
      break;
    }
    out = next;
  }
  return out;
}

/** Short, control-character-free echo of the offending value for the message. */
function preview(value: string): string {
  let flat = "";
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    flat += code < 0x20 || code === 0x7f ? "?" : value[i];
  }
  return flat.length > 80 ? `${flat.slice(0, 80)}...` : flat;
}

/**
 * Assert that `value` is usable as a single URL path segment, and return it.
 *
 * Rejects `/`, `\`, `..` and their percent-encoded forms (including
 * double-encoded), empty values, non-strings and control characters. Throws
 * `UnsafePathSegmentError`, which is an `McpError` carrying `InvalidParams`, so
 * a tool handler that does no other validation still answers a traversal
 * attempt with -32602 rather than a successful read of another module.
 *
 * @param value          the caller-supplied argument
 * @param parameterName  name used in the error message (e.g. "endpointId")
 */
export function assertSafePathSegment(value: unknown, parameterName = "id"): string {
  if (typeof value !== "string") {
    throw new UnsafePathSegmentError(
      `${parameterName} must be a string, received ${value === null ? "null" : typeof value}.`
    );
  }
  if (value.length === 0) {
    throw new UnsafePathSegmentError(`${parameterName} must not be empty.`);
  }

  const decoded = decodeRepeatedly(value);
  for (const candidate of value === decoded ? [value] : [value, decoded]) {
    if (hasControlCharacters(candidate)) {
      throw new UnsafePathSegmentError(
        `${parameterName} must not contain control characters.`
      );
    }
    if (candidate.includes("/") || candidate.includes("\\")) {
      throw new UnsafePathSegmentError(
        `${parameterName} must be a single path segment — '/' and '\\' are not allowed ` +
        `(received "${preview(value)}"). Pass only the resource id.`
      );
    }
    if (candidate.includes("..")) {
      throw new UnsafePathSegmentError(
        `${parameterName} must not contain '..' (received "${preview(value)}"). ` +
        `Path traversal is not permitted; pass only the resource id.`
      );
    }
  }

  return value;
}

/**
 * Assert `value` is a safe segment and return it percent-encoded, ready to be
 * interpolated into a template-literal URL.
 *
 * `encodeURIComponent` alone would already neutralise `/` and `\`, but the
 * assertion runs first so the caller gets a precise -32602 instead of a 404
 * from a nonsense path.
 */
export function encodePathSegment(value: unknown, parameterName = "id"): string {
  return encodeURIComponent(assertSafePathSegment(value, parameterName));
}

/**
 * Return the offending segment if `rawUrl`'s path would resolve above where it
 * was written, otherwise `null`. Query string and fragment are ignored — they
 * cannot change which resource is addressed.
 */
export function findPathEscape(rawUrl: string): string | null {
  const pathOnly = String(rawUrl ?? "").split(/[?#]/)[0];
  const decoded = decodeRepeatedly(pathOnly);

  // Encoding that SURVIVES the bounded decode is itself the finding.
  //
  // `decodeRepeatedly` stops after 3 rounds, so a quad-encoded traversal
  // (`%2525252e%2525252e%2525252f`) still reads as opaque text here and every
  // `..` test below passes it. Raising the round count only moves the boundary;
  // the durable answer is that a legitimate bConnect resource id never contains
  // a percent sign at all, so a residual `%` after decoding is refused outright
  // rather than being decoded further and argued about.
  if (/%/.test(decoded)) {
    return decoded.slice(decoded.indexOf("%"), decoded.indexOf("%") + 12);
  }

  for (const candidate of pathOnly === decoded ? [pathOnly] : [pathOnly, decoded]) {
    for (const rawSegment of candidate.split(/[/\\]/)) {
      // IIS/ASP.NET strips `;`-delimited path parameters BEFORE resolving the
      // path, so `..;` arrives at the filesystem layer as `..`. bMS bConnect is
      // hosted on IIS, which makes this the concrete residual bypass: the
      // segment is not literally `..`, so the old check allowed it and the
      // interceptor sent it. Compare the part before the first `;`.
      const withoutPathParams = rawSegment.split(";")[0]!;

      // Fullwidth and other compatibility forms of `.` normalise to `.` on a
      // server that applies NFKC. `．．` is not literally `..` but can
      // become it downstream, so both forms are collapsed before the test
      // rather than after.
      const normalised = withoutPathParams.normalize("NFKC");

      if (normalised === "..") {
        return rawSegment;
      }
    }
  }
  return null;
}

/**
 * Throw `PathContainmentError` if the outgoing request path contains traversal.
 *
 * Called from a `BConnectClientBase` request interceptor, so it sees the final
 * URL the module built — including anything a caller managed to inject through
 * an unvalidated tool argument.
 */
export function assertRequestPathContained(rawUrl: string): void {
  if (findPathEscape(rawUrl) === null) {
    return;
  }
  throw new PathContainmentError(
    `Refusing to send a request whose path escapes its API module: ` +
    `"${preview(String(rawUrl ?? ""))}". A '..' segment in a resource id would ` +
    `address a different bConnect module than the tool belongs to. ` +
    `Pass a plain resource id.`
  );
}
