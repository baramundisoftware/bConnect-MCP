/**
 * Host and Origin check for the HTTP transports (gateway and the servers' HTTP mode),
 * which have no authentication of their own: DNS-rebinding protection.
 *
 * Allowed: localhost, 127.0.0.1 and [::1], plus the names the operator lists
 * (the gateway's MCP_GATEWAY_ALLOWED_HOSTS, a server's MCP_ALLOWED_HOSTS).
 * Ports are ignored. A request with an `Origin` (browsers send one, MCP clients
 * usually don't) is accepted only when that origin's host name is allowed too;
 * scheme and port aren't compared, so any page served from an allowed name counts.
 * Header values must be plain host names or addresses (no user info, path or query).
 */

/** Host names always allowed: the loopback names. */
export const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"] as const;

/** A host name, an IPv4 address or a bracketed IPv6 address, with an optional port; nothing else. */
const HOST_VALUE = /^(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;

/** The lower-cased host name of a strict Host value (`name` or `name:port`), or undefined. */
function hostOfHeader(value: string): string | undefined {
  if (!HOST_VALUE.test(value)) {return undefined;}
  try {
    return new URL(`http://${value}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** The host of an Origin (`scheme://host[:port]`, nothing after it), or undefined. */
function hostOfOrigin(value: string): string | undefined {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/]+)$/i.exec(value);
  return match ? hostOfHeader(match[1]) : undefined;
}

/**
 * The allowed host names: the loopback names plus a comma-separated list (e.g.
 * the value of MCP_GATEWAY_ALLOWED_HOSTS), lower-cased, without ports. An entry
 * may be `name`, `name:port` or `scheme://name[:port]`; an IPv6 address may be
 * given without brackets. `onIgnored` is told about every entry that can't
 * match (wildcards, spaces, paths), so a typo doesn't go unnoticed.
 */
export function allowedHosts(list: string | undefined, onIgnored?: (entry: string) => void): string[] {
  const extra: string[] = [];
  for (const raw of (list ?? "").split(",")) {
    const entry = raw.trim();
    if (entry === "") {continue;}
    const bare = entry.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
    const withBrackets = /^[0-9A-Fa-f]*:[0-9A-Fa-f:.]*$/.test(bare) ? `[${bare}]` : bare;
    const name = hostOfHeader(withBrackets);
    if (name) {extra.push(name);} else {onIgnored?.(entry);}
  }
  return [...new Set([...LOOPBACK_HOSTS, ...extra])];
}

/** Why a request is refused, or undefined when its Host and Origin are allowed. */
export function hostCheckRefusal(
  headers: { host?: string; origin?: string },
  allowed: readonly string[],
): string | undefined {
  const host = hostOfHeader(headers.host ?? "");
  if (!host || !allowed.includes(host)) {
    return "host";
  }
  if (headers.origin !== undefined) {
    const origin = hostOfOrigin(headers.origin);
    if (!origin || !allowed.includes(origin)) {
      return "origin";
    }
  }
  return undefined;
}

interface MinimalRequest { headers: { host?: string; origin?: string } }
interface MinimalResponse { status(code: number): { json(body: unknown): unknown } }

/**
 * Express middleware: refuses a request whose Host or Origin isn't allowed with
 * 403 and a JSON-RPC error, before it reaches any MCP handler. `onRefuse` gets
 * the reason and the header values, for the operator's log.
 */
export function hostCheck(
  allowed: readonly string[],
  onRefuse?: (reason: string, host: string | undefined, origin: string | undefined) => void,
): (req: MinimalRequest, res: MinimalResponse, next: () => void) => void {
  return (req, res, next) => {
    const reason = hostCheckRefusal(req.headers, allowed);
    if (!reason) {
      next();
      return;
    }
    onRefuse?.(reason, req.headers.host, req.headers.origin);
    res.status(403).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: `Forbidden: the request's ${reason === "host" ? "Host" : "Origin"} isn't an allowed host name. ` +
          "The operator lists the names this server is reached under in its allowed-hosts setting.",
      },
      id: null,
    });
  };
}
