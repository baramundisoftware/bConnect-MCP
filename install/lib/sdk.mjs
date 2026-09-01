// Locate the MCP SDK inside the suite's own node_modules.
//
// The installer deliberately lives OUTSIDE the suite tree (C:\bConnect-MCP\install\)
// so it can be run before anything is installed and can point at a suite root
// anywhere on disk. That means bare specifier resolution ("@modelcontextprotocol/sdk")
// does not work from here -- there is no node_modules above this directory. We resolve
// the package's ESM build by absolute path instead, with a small candidate list so a
// future repack of the SDK does not silently break the installer.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadSdk(suiteRoot, subpath) {
  const base = resolve(suiteRoot, 'node_modules', '@modelcontextprotocol', 'sdk');
  const candidates = [
    resolve(base, 'dist', 'esm', subpath),
    resolve(base, 'dist', subpath),
    resolve(base, subpath),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return import(pathToFileURL(c).href);
  }
  throw new Error(
    `Cannot find @modelcontextprotocol/sdk/${subpath} under ${base}. ` +
      `Run "npm ci" in the suite root first.`
  );
}

/** Parse --flag value / --flag=value / --switch into a plain object. */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
    } else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) {
      out[a.slice(2)] = argv[++i];
    } else {
      out[a.slice(2)] = true;
    }
  }
  return out;
}
