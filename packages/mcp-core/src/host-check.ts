/**
 * Host and Origin check for the HTTP transports (gateway and the servers' HTTP mode),
 * which have no authentication of their own: DNS-rebinding protection.
 *
 * Allowed: localhost, 127.0.0.1 and [::1], plus the names the operator lists
 * (the gateway's MCP_GATEWAY_ALLOWED_HOSTS, a server's MCP_ALLOWED_HOSTS).
 * Ports are ignored. A request with an `Origin` (browsers send one, MCP clients
 * usually don't) is accepted only when that origin's host name is allowed too.
 */

/** Host names always allowed: the loopback names. */
export const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"] as const;

/**
 * The allowed host names: the loopback names plus a comma-separated list
 * (e.g. the value of MCP_GATEWAY_ALLOWED_HOSTS), lower-cased, without ports.
 */
export function allowedHosts(list: string | undefined): string[] {
  const extra = (list ?? "")
    .split(",")
    .map((entry) => hostnameOf(entry.trim()))
    .filter((name): name is string => Boolean(name));
  return [...new Set([...LOOPBACK_HOSTS, ...extra])];
}

/** The host name of a Host header value or origin (`name`, `name:port`, `http://name:port`), or undefined. */
function hostnameOf(value: string): string | undefined {
  if (value === "") {return undefined;}
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** Why a request is refused, or undefined when its Host and Origin are allowed. */
export function hostCheckRefusal(
  headers: { host?: string; origin?: string },
  allowed: readonly string[],
): string | undefined {
  const host = hostnameOf(headers.host ?? "");
  if (!host || !allowed.includes(host)) {
    return "host";
  }
  if (headers.origin !== undefined) {
    const origin = hostnameOf(headers.origin);
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
