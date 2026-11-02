/**
 * Refuse a stale bconnect-mcp-gateway/node_modules (#365).
 *
 * The gateway isn't a workspace member and has no lockfile of its own: it runs
 * on the root install. A node_modules folder here is left over from an older
 * source build, survives `npm ci` at the root, and Node resolves its packages
 * first (Express 4 instead of 5, for example). Tool caches such as `.vite` are
 * dot-entries and don't count.
 *
 * Runs before the gateway's build and tests (`prebuild`, `pretest`) and before
 * the root test run (vitest globalSetup).
 */
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GATEWAY_DIR = dirname(fileURLToPath(import.meta.url));

/** The message to stop with, or undefined when the gateway resolves from the root install. */
export function staleGatewayModules(gatewayDir = GATEWAY_DIR) {
  const modules = join(gatewayDir, 'node_modules');
  if (!existsSync(modules)) return undefined;
  if (readdirSync(modules).every((name) => name.startsWith('.'))) return undefined;
  return `Stale ${modules}: the gateway runs on the root install. Remove the folder (rm -rf bconnect-mcp-gateway/node_modules; PowerShell: Remove-Item -Recurse -Force bconnect-mcp-gateway\\node_modules) and run again.`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stale = staleGatewayModules();
  if (stale) {
    console.error(stale);
    process.exit(1);
  }
}
