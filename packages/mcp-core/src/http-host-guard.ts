/**
 * Standalone HTTP transport — DNS-rebinding and Origin protection (ARCH-4).
 *
 * ── The gap ─────────────────────────────────────────────────────────────────
 * The suite has two HTTP surfaces. The gateway enables the SDK's rebinding
 * protection and mounts its own Host/Origin middleware; `runServer`'s
 * `MCP_TRANSPORT=http` branch constructed `StreamableHTTPServerTransport({
 * sessionIdGenerator: undefined })` and mounted nothing, and the SDK defaults
 * `enableDnsRebindingProtection` to false. So every server run in standalone
 * HTTP mode answered a request with any Host and any Origin.
 *
 * The loopback default does not rescue it — it is the exposure. A browser page
 * the operator visits can resolve its own hostname to 127.0.0.1 and POST to a
 * loopback-bound port; Host and Origin are the two headers that page cannot
 * forge, which is the whole reason the MCP specification asks a local server to
 * check them. This transport carries no client authentication at all, so the
 * check is the only thing between a visited web page and a bConnect proxy.
 *
 * ── Two layers, and why the middleware is the enforcing one ─────────────────
 * The SDK compares the Host header VERBATIM, including the port. That is not
 * usable as the primary check: the port a client connects to is not a security
 * boundary, and an operator who names a host in `MCP_ALLOWED_HOSTS` will write
 * `mcp.internal.example`, not `mcp.internal.example:3000`. So the middleware
 * here owns the decision and matches port-insensitively, exactly as the gateway
 * does; `sdkTransportOptions()` then hands the SDK a host:port list built from
 * the same configuration so its own check is live rather than decorative.
 *
 * That last point is deliberate. An option list the SDK skips when it is empty
 * is a layer that does nothing precisely when nobody configured anything, which
 * is the default. `sdkTransportOptions()` is therefore never empty.
 *
 * ── Defaults ────────────────────────────────────────────────────────────────
 * Hosts:   loopback names plus whatever MCP_BIND names. This transport refuses
 *          a non-loopback bind unless MCP_ALLOW_NO_AUTH=true, so the default
 *          allowlist covers every configuration that does not opt out.
 * Origins: empty, and an empty list REJECTS every Origin rather than skipping
 *          the check. A request carrying an Origin came from a browser, and
 *          this is not a browser API.
 *
 * Both are overridable, and "*" disables a check for an operator who has put
 * their own proxy in front:
 *
 *   MCP_ALLOWED_HOSTS    comma-separated hostnames (ports ignored). "*" off.
 *   MCP_ALLOWED_ORIGINS  comma-separated origins, matched verbatim. "*" off.
 */

const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "::1"];

function splitList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/**
 * Reduce a Host header or allowlist entry to a comparable hostname: strip the
 * port and the brackets around an IPv6 literal, and lowercase.
 */
export function normalizeHostHeader(value: string): string {
  const host = value.trim().toLowerCase();
  if (host.startsWith("[")) {
    // IPv6 literal: [::1] or [::1]:3001
    const end = host.indexOf("]");
    return end === -1 ? host : host.slice(1, end);
  }
  // Bare IPv6 (no brackets, so no port can be present) — leave it alone.
  if (host.split(":").length > 2) {
    return host;
  }
  const colon = host.lastIndexOf(":");
  return colon === -1 ? host : host.slice(0, colon);
}

export interface HttpGuardConfig {
  /** Allowed hostnames, normalized and port-free. */
  allowedHosts: string[];
  /** Allowed origins, matched verbatim. Empty rejects every Origin. */
  allowedOrigins: string[];
  /** "*" in MCP_ALLOWED_HOSTS — the Host check is off. */
  anyHost: boolean;
  /** "*" in MCP_ALLOWED_ORIGINS — the Origin check is off. */
  anyOrigin: boolean;
}

/**
 * Resolve the guard from the environment and the address being bound.
 *
 * `bind` is passed rather than read here because `runServer` has already
 * resolved and validated it — the two must not be able to disagree.
 */
export function resolveHttpGuardConfig(
  env: NodeJS.ProcessEnv = process.env,
  bind = "127.0.0.1"
): HttpGuardConfig {
  const hostsRaw = splitList(env.MCP_ALLOWED_HOSTS);
  const originsRaw = splitList(env.MCP_ALLOWED_ORIGINS);
  const anyHost = hostsRaw.includes("*");

  const hosts = anyHost
    ? []
    : hostsRaw.length > 0
      ? hostsRaw.map(normalizeHostHeader)
      : [...LOOPBACK_HOSTS, normalizeHostHeader(bind)];

  return {
    allowedHosts: [...new Set(hosts)],
    allowedOrigins: originsRaw.includes("*") ? [] : originsRaw,
    anyHost,
    anyOrigin: originsRaw.includes("*"),
  };
}

/** Just enough of an express request for the guard. */
export interface GuardRequestLike {
  headers: Record<string, string | string[] | undefined>;
}

/** Just enough of an express response for the guard. */
export interface GuardResponseLike {
  writeHead(status: number, headers?: Record<string, string>): { end(body?: string): unknown };
}

/** Refusal body, JSON-RPC shaped so an MCP client reports it as an error. */
export function hostGuardDenial(message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null });
}

/**
 * Host + Origin guard for the standalone HTTP transport. Mount before the
 * routes, ahead of the body parser: a forged-Host request should not get a
 * megabyte of JSON parsed on its behalf first.
 */
export function createHttpGuardMiddleware(
  config: HttpGuardConfig
): (req: GuardRequestLike, res: GuardResponseLike, next: () => void) => void {
  return (req, res, next) => {
    const deny = (message: string): void => {
      res.writeHead(403, { "Content-Type": "application/json" }).end(hostGuardDenial(message));
    };

    if (!config.anyOrigin) {
      const origin = req.headers.origin;
      if (typeof origin === "string" && origin !== "" && !config.allowedOrigins.includes(origin)) {
        deny(
          `Forbidden Origin '${origin}'. This transport is not a browser API; ` +
            `set MCP_ALLOWED_ORIGINS to permit one.`
        );
        return;
      }
    }

    if (!config.anyHost) {
      const host = req.headers.host;
      if (
        typeof host !== "string" ||
        !config.allowedHosts.includes(normalizeHostHeader(host))
      ) {
        deny(
          `Forbidden Host '${typeof host === "string" ? host : ""}'. ` +
            `Set MCP_ALLOWED_HOSTS if this server is served under another name.`
        );
        return;
      }
    }

    next();
  };
}

/**
 * The transport options that make the SDK's own check a real second layer.
 *
 * Always non-empty, both lists: the SDK skips a check whose list is empty, so
 * passing `enableDnsRebindingProtection: true` with nothing else configures a
 * layer that does nothing. Hosts are expanded to bare and `host:port` forms
 * because the SDK compares the header verbatim.
 */
export function sdkTransportOptions(
  config: HttpGuardConfig,
  port: number
): { enableDnsRebindingProtection: boolean; allowedHosts?: string[]; allowedOrigins?: string[] } {
  if (config.anyHost && config.anyOrigin) {
    return { enableDnsRebindingProtection: false };
  }

  const options: {
    enableDnsRebindingProtection: boolean;
    allowedHosts?: string[];
    allowedOrigins?: string[];
  } = { enableDnsRebindingProtection: true };

  if (!config.anyHost) {
    const forms = config.allowedHosts.flatMap((host) => {
      const bracketed = host.includes(":") ? `[${host}]` : host;
      return [host, bracketed, `${bracketed}:${port}`];
    });
    options.allowedHosts = [...new Set(forms)];
  }
  if (!config.anyOrigin && config.allowedOrigins.length > 0) {
    options.allowedOrigins = [...config.allowedOrigins];
  }
  return options;
}

/** The startup line naming what is enforced, so an operator can see it. */
export function httpGuardStartupLine(serverName: string, config: HttpGuardConfig): string {
  const hosts = config.anyHost ? "any (MCP_ALLOWED_HOSTS=*)" : config.allowedHosts.join(", ");
  const origins = config.anyOrigin
    ? "any (MCP_ALLOWED_ORIGINS=*)"
    : config.allowedOrigins.length > 0
      ? config.allowedOrigins.join(", ")
      : "none — every browser Origin is refused";
  return `${serverName}: HTTP Host allowlist [${hosts}]; Origin allowlist: ${origins}.`;
}
