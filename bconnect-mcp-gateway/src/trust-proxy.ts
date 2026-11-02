/**
 * bconnect-mcp-gateway — MCP_GATEWAY_TRUST_PROXY (#331).
 *
 * Behind a reverse proxy every request comes from the proxy's address, so all
 * callers share one rate-limit bucket and the access log shows only the proxy.
 * With this setting the gateway takes the client address from the
 * X-Forwarded-For header the trusted proxy adds (Express `trust proxy`), and
 * the rate limit and access log use it.
 *
 * Accepted, strictly:
 *   unset, empty or `false`  off: the address the connection comes from (default)
 *   1 to 10                  trust that many proxy hops in front of the gateway
 *   addresses and ranges     trust proxies at these addresses, comma-separated:
 *                            IPv4 or IPv6, optionally with a prefix length
 *                            (10.0.0.5, 10.0.0.0/8, fd00::/8)
 *
 * `true` (trust every hop) is refused: any client could then name any address
 * in X-Forwarded-For and get a fresh rate-limit bucket.
 */

import { isIP } from "node:net";

/** What Express gets as `trust proxy`, or false to leave it off. */
export type TrustProxy = false | number | string[];

const MAX_HOPS = 10;

function invalid(setting: string | undefined): Error {
  return new Error(
    `MCP_GATEWAY_TRUST_PROXY=${JSON.stringify(setting)} isn't valid. Use false, a number of proxy hops ` +
      `from 1 to ${MAX_HOPS}, or the proxy's addresses or ranges, comma-separated (for example 10.0.0.5 or 10.0.0.0/8).`,
  );
}

/** One address or range: an IP, optionally with a prefix length that fits it. */
function isAddressOrRange(entry: string): boolean {
  const slash = entry.indexOf("/");
  const address = slash === -1 ? entry : entry.slice(0, slash);
  const version = isIP(address);
  if (version === 0) {return false;}
  if (slash === -1) {return true;}
  const prefix = entry.slice(slash + 1);
  return /^\d{1,3}$/.test(prefix) && Number(prefix) <= (version === 4 ? 32 : 128);
}

/** The trust-proxy setting; throws on anything but the forms above. */
export function trustProxySetting(setting: string | undefined = process.env.MCP_GATEWAY_TRUST_PROXY): TrustProxy {
  const raw = (setting ?? "").trim();
  if (raw === "" || raw.toLowerCase() === "false") {return false;}
  if (/^\d+$/.test(raw)) {
    const hops = Number(raw);
    if (hops >= 1 && hops <= MAX_HOPS) {return hops;}
    throw invalid(setting);
  }
  const entries = raw.split(",").map((entry) => entry.trim());
  if (entries.some((entry) => !isAddressOrRange(entry))) {throw invalid(setting);}
  return entries;
}
