/**
 * Root test run: stop before the first test when a stale
 * bconnect-mcp-gateway/node_modules would load old packages into the gateway
 * tests (#365). The check itself is in bconnect-mcp-gateway/check-install.mjs.
 */
import { staleGatewayModules } from '../bconnect-mcp-gateway/check-install.mjs';

export default function setup(): void {
  const stale = staleGatewayModules();
  if (stale) throw new Error(stale);
}
