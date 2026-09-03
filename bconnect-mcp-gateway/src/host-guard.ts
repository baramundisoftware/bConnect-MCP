/**
 * bconnect-mcp-gateway — DNS-rebinding and Origin protection (SEC-9).
 *
 * The gateway has no built-in auth (ADR-0003) and authenticates downstream with
 * an ambient bMS service credential, so any process that can POST JSON-RPC to
 * its port acts with the full authority of that credential. A browser is such a
 * process: a page the operator visits can point its own hostname at 127.0.0.1
 * (DNS rebinding) and POST to the loopback-bound gateway. Host and Origin are
 * the two headers the browser will not let that page forge, which is why the
 * MCP SDK checks them and why this middleware exists.
 *
 * Two checks, both fail-closed with 403 and a JSON-RPC-shaped error:
 *
 *   Host   — the request's Host header must name an address this gateway is
 *            actually served on. Enforced whenever the gateway is bound to
 *            loopback (the shape exposed to rebinding), or whenever the
 *            operator has named the hosts explicitly. On a non-loopback bind
 *            with no explicit list the gateway is, by its own startup contract,
 *            behind a proxy that owns Host validation and rewrites it to an
 *            arbitrary public name we cannot predict, so enforcing a guess
 *            would break the documented deployment; a startup warning is
 *            emitted instead.
 *
 *   Origin — a request carrying an Origin header came from a browser. The
 *            gateway is not a browser API, so the default allowlist is empty
 *            and ANY Origin is rejected. Always enforced; an operator running a
 *            browser-based MCP client must name its origin explicitly.
 *
 * Host matching is port-insensitive: the port a client connects to is not a
 * security boundary (the attacker page targets our port either way), and
 * createApp() does not know the port gateway.ts will listen on. The SDK's own
 * allowedHosts compares the Host header verbatim including port, which is why
 * the host check lives here rather than being delegated to the transport. What
 * the transport is still given is `sdkTransportOptions()` — see its header for
 * why that is an honest `false` by default rather than a flag with nothing
 * behind it.
 *
 * Config (env):
 *   MCP_GATEWAY_ALLOWED_HOSTS    comma-separated hostnames (ports ignored).
 *                                Default: loopback names + MCP_GATEWAY_BIND.
 *                                "*" disables the Host check.
 *   MCP_GATEWAY_ALLOWED_ORIGINS  comma-separated origins, matched verbatim.
 *                                Default: empty — every Origin is rejected.
 *                                "*" disables the Origin check.
 */

import type { Request, Response, NextFunction } from "express";
import type { Logger } from "./logger.js";

const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "::1", "[::1]"];

function splitList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/**
 * Reduce a Host header or allowlist entry to a comparable hostname.
 * Strips the port and the brackets around an IPv6 literal, and lowercases.
 */
export function normalizeHost(value: string): string {
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

export interface HostGuardConfig {
  /** Allowed hostnames, already normalized. Empty = check disabled. */
  allowedHosts: string[];
  /** Allowed origins, matched verbatim. Empty = every Origin is rejected. */
  allowedOrigins: string[];
  /** "*" in MCP_GATEWAY_ALLOWED_ORIGINS — Origin check disabled. */
  anyOrigin: boolean;
}

/** Resolve the guard's configuration from the environment. */
export function resolveHostGuardConfig(): HostGuardConfig {
  const hostsRaw = splitList(process.env.MCP_GATEWAY_ALLOWED_HOSTS);
  const originsRaw = splitList(process.env.MCP_GATEWAY_ALLOWED_ORIGINS);
  const bind = (process.env.MCP_GATEWAY_BIND ?? "127.0.0.1").trim();
  const bindIsLoopback = LOOPBACK_HOSTS.includes(normalizeHost(bind));

  let allowedHosts: string[];
  if (hostsRaw.includes("*")) {
    allowedHosts = [];
  } else if (hostsRaw.length > 0) {
    allowedHosts = hostsRaw.map(normalizeHost);
  } else if (bindIsLoopback) {
    allowedHosts = [...LOOPBACK_HOSTS.map(normalizeHost), normalizeHost(bind)];
  } else {
    allowedHosts = [];
  }

  return {
    allowedHosts: [...new Set(allowedHosts)],
    allowedOrigins: originsRaw.includes("*") ? [] : originsRaw,
    anyOrigin: originsRaw.includes("*"),
  };
}

function deny(res: Response, message: string): void {
  res.status(403).json({
    jsonrpc: "2.0",
    error: { code: -32000, message },
    id: null,
  });
}

/**
 * Is this host an IP literal rather than a name?
 *
 * After normalizeHost, an IPv6 literal has lost its brackets and keeps its
 * colons, and an IPv4 literal is four dotted numbers.
 */
function isIpLiteral(host: string): boolean {
  return host.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/**
 * Host + Origin guard. Mount before the MCP routes.
 *
 * SEC-10 — /health used to be exempt from the Host check entirely, so a raw
 * socket sending `Host: evil.example.com` was answered. It is no longer exempt.
 * The exemption existed for one real case: a container or orchestrator probe
 * addresses the gateway by its container ADDRESS, which is not a name anyone
 * can put in an allowlist in advance. So that case is what is allowed — a bare
 * IP literal, on the liveness route only — instead of every Host on it. That is
 * not a rebinding vector: a page that resolves its own hostname to this port
 * still sends THAT HOSTNAME in Host; a browser will not let it send an IP it
 * did not navigate to.
 */
export function createHostGuardMiddleware(
  logger?: Logger,
): (req: Request, res: Response, next: NextFunction) => void {
  const config = resolveHostGuardConfig();

  if (config.allowedHosts.length === 0 && !process.env.MCP_GATEWAY_ALLOWED_HOSTS) {
    logger?.warn(
      "Host allowlist not enforced on a non-loopback bind — the fronting reverse proxy is " +
        "responsible for rejecting forged Host headers. Set MCP_GATEWAY_ALLOWED_HOSTS to the " +
        "hostname(s) this gateway is served on to enforce it here as well.",
      { bind: process.env.MCP_GATEWAY_BIND ?? "127.0.0.1" },
    );
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!config.anyOrigin) {
      const origin = req.headers.origin;
      if (typeof origin === "string" && origin !== "" && !config.allowedOrigins.includes(origin)) {
        deny(res, `Forbidden Origin '${origin}'. The gateway is not a browser API; set MCP_GATEWAY_ALLOWED_ORIGINS to permit one.`);
        return;
      }
    }

    if (config.allowedHosts.length > 0) {
      const host = req.headers.host;
      const normalized = typeof host === "string" ? normalizeHost(host) : "";
      const probeByAddress = req.path === "/health" && isIpLiteral(normalized);
      if (!probeByAddress && !config.allowedHosts.includes(normalized)) {
        deny(res, `Forbidden Host '${host ?? ""}'. Set MCP_GATEWAY_ALLOWED_HOSTS if the gateway is served under another name.`);
        return;
      }
    }

    next();
  };
}

/**
 * The transport options handed to the MCP SDK, alongside this middleware.
 *
 * AUD-architect-1 — app.ts used to pass `enableDnsRebindingProtection: true`
 * with an allowedOrigins list it spread only when non-empty, and
 * resolveHostGuardConfig defaults that list to []. The SDK SKIPS a check whose
 * list is empty, so the "second layer" the code advertised did nothing in
 * precisely the configuration everybody runs: the default one. A flag that
 * reads as protection and enforces nothing is worse than an honest `false`,
 * because the next person to audit this stops looking.
 *
 * allowedHosts is still deliberately not passed. The SDK compares the Host
 * header VERBATIM including the port, and the port a client connects to is not
 * known here — `docker run -p 3005:3001` makes the client's Host port 3005 and
 * the process's port 3001, and a verbatim list would 403 a legitimate caller.
 * The middleware above owns the Host decision and matches port-insensitively.
 * So the SDK layer is enabled exactly when an operator has named origins for it
 * to enforce, and reports itself off otherwise.
 */
export function sdkTransportOptions(
  config: HostGuardConfig,
): { enableDnsRebindingProtection: boolean; allowedOrigins?: string[] } {
  if (config.anyOrigin || config.allowedOrigins.length === 0) {
    return { enableDnsRebindingProtection: false };
  }
  return { enableDnsRebindingProtection: true, allowedOrigins: [...config.allowedOrigins] };
}
