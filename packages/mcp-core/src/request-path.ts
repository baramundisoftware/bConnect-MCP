/**
 * Canonical request paths (REQ-SRV-018, Lock B).
 *
 * Modules build request paths from a route template and GUID arguments, and pass
 * query parameters through axios `params`. A path that holds a dot segment, a
 * backslash, a percent-encoded separator or a query string can only come from an
 * argument that slipped past validation, and it could point the request at a
 * route of another domain. The shared client refuses such a path before sending.
 */

/** Thrown when a request path isn't in canonical form; nothing was sent. */
export class RequestPathRefusedError extends Error {
  constructor() {
    super(
      "Refusing the request: its path is not in canonical form. " +
      "IDs must be plain GUIDs, without '/', '\\', '.', '%', '?' or '#'.",
    );
    this.name = "RequestPathRefusedError";
  }
}

// Encoded '.', '/', '\' and '%' (the last catches double encoding).
const ENCODED_SEPARATOR = /%(2e|2f|5c|25)/i;
// A '%' that doesn't start a valid escape: decoders disagree on it, so refuse it.
const MALFORMED_ESCAPE = /%(?![0-9a-f]{2})/i;
// Spaces and control characters: URL parsers drop tab, LF and CR anywhere in a
// path, so "Secr<TAB>ets" would arrive as "Secrets". No real path contains them.
const SPACE_OR_CONTROL = /[\u0000-\u0020\u007f-\u009f]/;

export function assertCanonicalRequestPath(url: string): void {
  if (/[?#\\]/.test(url) || ENCODED_SEPARATOR.test(url) || MALFORMED_ESCAPE.test(url) || SPACE_OR_CONTROL.test(url)) {
    throw new RequestPathRefusedError();
  }
  const path = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "");
  if (path.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new RequestPathRefusedError();
  }
}
