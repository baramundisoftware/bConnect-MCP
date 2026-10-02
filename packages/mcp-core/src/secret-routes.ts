/**
 * Secret-route gate (REQ-SRV-017, ADR-0004): the second of two locks.
 *
 * The first lock is each server's tool-name list (SECRET_READ_TOOLS). This one
 * sits in the shared HTTP client and looks at the request itself, so a new,
 * renamed or overlooked tool that reaches one of these operations is refused as
 * well, whichever server sent it.
 *
 * Each entry is an operation whose response carries a credential, written as the
 * OpenAPI path template of its spec. The secret-gate guard test derives the same
 * set from the specs' response schemas and fails if the two disagree, so this
 * list can't drift from the API.
 */

export interface SecretRoute {
  method: string;   // upper-case HTTP method
  domain: string;   // URL segment under the bConnect base URL, e.g. "defensecontrol"
  path: string;     // spec path template, e.g. /v2.0/BitLocker/WindowsEndpoints/{id}/Secrets
}

export const SECRET_ROUTES: readonly SecretRoute[] = Object.freeze([
  // BitLocker recovery keys + initial startup PIN (26R1)
  { method: "GET", domain: "defensecontrol", path: "/v2.0/BitLocker/WindowsEndpoints/{id}/Secrets" },
  { method: "PATCH", domain: "defensecontrol", path: "/v2.0/BitLocker/WindowsEndpoints/{id}/Secrets" },
  // LAPS local administrator username + password (25R2, 26R1)
  { method: "GET", domain: "defensecontrol", path: "/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id}" },
  { method: "PATCH", domain: "defensecontrol", path: "/v2.0/LocalAdministrativeAccounts/WindowsEndpoints/{id}" },
]);

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A matcher for a route table entry. Exact path shape: the template's
 * placeholders match one segment, and the path must end there
 * (…/{id}/TriggerUpdateOnClient is not the LAPS resource).
 */
export function routeMatcher(route: SecretRoute): { method: string; pattern: RegExp } {
  // Segment by segment, not a regex over the template: a "{placeholder}"
  // segment matches any one segment, every other segment literally (CodeQL:
  // a placeholder regex backtracks polynomially on input like "\\{\\{\\{…").
  const segments = route.path.split("/").map((segment) =>
    segment.startsWith("{") && segment.endsWith("}") && segment.length > 2 ? "[^/]+" : escape(segment));
  return {
    method: route.method,
    pattern: new RegExp("(?:^|/)" + escape(route.domain) + segments.join("/") + "/?$", "i"),
  };
}

const MATCHERS = SECRET_ROUTES.map(routeMatcher);

/** Refusal raised before a secret-bearing request is sent. */
export class SecretRouteBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretRouteBlockedError";
  }
}

/** The URL path of a request, without query or fragment. */
function pathOf(url: string): string {
  const raw = String(url ?? "");
  const path = /^https?:\/\//i.test(raw) ? new URL(raw).pathname : raw;
  return path.split(/[?#]/)[0];
}

/**
 * The path a server will actually serve for this request: percent-decoded
 * (repeatedly, so double encoding doesn't hide a slash), backslashes read as
 * slashes, dot segments resolved. Matching the raw string would let an encoded
 * or relative form of a secret route through.
 */
/** Decode one escape; one that isn't valid UTF-8 on its own stays as is. */
function decodeEscape(escape: string): string {
  try {
    return decodeURIComponent(escape);
  } catch {
    return escape;
  }
}

const isSpace = (c: string): boolean => /\s/.test(c);

/** `s` without its trailing characters that pass `test`; one scan from the end (no backtracking regex). */
function trimEndWhere(s: string, test: (c: string) => boolean): string {
  let end = s.length;
  while (end > 0 && test(s[end - 1])) {
    end--;
  }
  return s.slice(0, end);
}

/** `s` without a path parameter (";x" up to the end). */
function withoutPathParameter(s: string): string {
  const at = s.indexOf(";");
  return at < 0 ? s : s.slice(0, at);
}

export function canonicalPathOf(url: string): string {
  // URL parsers drop tab, LF and CR anywhere in a path before sending it.
  let path = pathOf(url).replace(/[\t\n\r]/g, "");
  for (let round = 0; round < 3; round++) {
    // Run by run of escapes, so a malformed escape elsewhere doesn't stop the rest
    // from being decoded (fail closed); a multi-byte character decodes as a whole,
    // and a run that isn't valid UTF-8 falls back to escape by escape.
    const decoded = path.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        return run.replace(/%[0-9a-f]{2}/gi, decodeEscape);
      }
    });
    if (decoded === path) {
      break;
    }
    path = decoded;
  }
  const segments: string[] = [];
  for (const raw of path.replace(/\\/g, "/").split("/")) {
    // Control characters, a path parameter (";x") and trailing spaces may be
    // dropped by the web server, so the segment is matched without them.
    const segment = trimEndWhere(withoutPathParameter(raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, "")), isSpace);
    if (segment === "..") {
      segments.pop();
    } else if (segment !== ".") {
      // Trailing dots too, once dot segments are resolved.
      segments.push(trimEndWhere(segment, (c) => c === "." || isSpace(c)));
    }
  }
  return "/" + segments.filter((s, i) => s !== "" || i === segments.length - 1).join("/");
}

export function isSecretRoute(method: string, url: string): boolean {
  const upper = String(method ?? "GET").toUpperCase();
  const path = canonicalPathOf(url);
  return MATCHERS.some((m) => m.method === upper && m.pattern.test(path));
}

/** Throws SecretRouteBlockedError unless ALLOW_SECRET_READ=true. */
export function assertSecretRouteAllowed(
  method: string,
  url: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isSecretRoute(method, url) || env.ALLOW_SECRET_READ === "true") {
    return;
  }
  throw new SecretRouteBlockedError(
    `Refusing ${String(method).toUpperCase()} ${pathOf(url)}: the response contains live credentials ` +
    `(BitLocker recovery keys / PIN or a LAPS password). An operator must set ALLOW_SECRET_READ=true ` +
    `in the MCP server's environment and restart it; the model cannot set it.`,
  );
}
