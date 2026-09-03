/**
 * Every server must enable the optional per-server credential convention.
 *
 * The failure this prevents is quiet and asymmetric: wire twelve servers and
 * miss one, and that one keeps using the SHARED credential while its operator
 * believes it was scoped down. A deployment reads as least-privileged and has
 * one server holding the broad key — which is worse than not offering the
 * feature, because the belief is wrong rather than absent.
 *
 * Asserted against the built catalogue's own source rather than a hand list:
 * the thirteenth server was added to this suite twice in its history and a
 * hand-maintained parallel list is this repository's most repeated defect.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { serverScope } from '@bconnect/mcp-core';

const ROOT = join(__dirname, '..');

/**
 * The text of the `createClientProvider({ … })` call, brace-matched.
 *
 * Written the hard way on purpose. The first version bounded the call with a
 * 600-character window and reported `bconnect-groups-mcp` as unwired while its
 * source was correct — that server's option object is simply longer than the
 * window. A guard that fires on good code is the failure this repository keeps
 * cataloguing: the author "fixes" working code to satisfy it, or silences it.
 * Counting braces has no magic number to be wrong about.
 */
function providerCall(src: string): string | undefined {
  const open = src.search(/createClientProvider(?:<[^>]*>)?\(\{/);
  if (open < 0) {return undefined;}
  const start = src.indexOf('{', open);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') {depth++;}
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) {return src.slice(start, i + 1);}
    }
  }
  return undefined;
}

/** Discovered, never listed: every directory that is a bConnect MCP server. */
function serverDirs(): string[] {
  return readdirSync(ROOT)
    .filter((d) => /^bconnect-.*-mcp$/.test(d) && d !== 'bconnect-mcp-gateway')
    .filter((d) => existsSync(join(ROOT, d, 'src', 'index.ts')));
}

describe('every server passes its own name to the client provider', () => {
  it('finds the servers to check at all', () => {
    // Vacuity: a glob that matches nothing would make every assertion below
    // pass without examining anything.
    expect(serverDirs().length).toBeGreaterThanOrEqual(13);
  });

  it('declares serverName in its createClientProvider call', () => {
    const missing: string[] = [];
    for (const dir of serverDirs()) {
      const src = readFileSync(join(ROOT, dir, 'src', 'index.ts'), 'utf8');
      const call = providerCall(src);
      if (!call) { missing.push(`${dir}: no createClientProvider call found`); continue; }
      // The property must sit inside the provider call, not merely somewhere
      // in the file — a `serverName` in an unrelated object would otherwise
      // satisfy a bare substring check.
      if (!/serverName:\s*["'][^"']+["']/.test(call)) {
        missing.push(dir);
      }
    }
    expect(
      missing,
      `${missing.length} server(s) do not pass serverName, so BCONNECT_API_KEY__<SERVER> is ` +
        `silently ignored for them and they keep the shared credential while an operator ` +
        `believes otherwise:\n  ${missing.join('\n  ')}`
    ).toEqual([]);
  });

  it('names itself accurately, so the variable a deployer sets is the one that is read', () => {
    // The subtler half. A server that passes the WRONG name resolves another
    // server's credential — or none — and nothing in the previous assertion
    // would notice.
    const wrong: string[] = [];
    for (const dir of serverDirs()) {
      const src = readFileSync(join(ROOT, dir, 'src', 'index.ts'), 'utf8');
      const declared = src.match(/serverName:\s*["']([^"']+)["']/)?.[1];
      if (!declared) {continue;}
      if (serverScope(declared) !== serverScope(dir)) {
        wrong.push(`${dir}: declares "${declared}" (scope ${serverScope(declared)})`);
      }
    }
    expect(
      wrong,
      `${wrong.length} server(s) declare a name whose scope is not their own:\n  ${wrong.join('\n  ')}`
    ).toEqual([]);
  });
});
