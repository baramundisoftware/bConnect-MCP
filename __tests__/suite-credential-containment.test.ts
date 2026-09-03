/**
 * A credential must not leave this process by any of the three routes that
 * were open.
 *
 * All three are the same mistake in different clothes: a credential travels
 * somewhere a control does not look.
 *
 *   REDIRECT   `follow-redirects` strips only Authorization,
 *              Proxy-Authorization and Cookie when a 30x crosses to another
 *              host. `X-Api-Key` is not on that list, and `maxRedirects` was
 *              never set, so axios's default of 21 applied — a bMS that
 *              answers 30x, or anyone able to inject one, received the
 *              bConnect API key on the redirect target. The documented
 *              default posture is the API key, so the default was the exposed
 *              one; Basic-auth deployments were protected by the stripping.
 *
 *   STDERR     SEC-2 closed `console.error("...", axiosError)` in the client,
 *              because util.inspect walks `error.config.headers` and a stdio
 *              host captures stderr verbatim to disk. The fix was applied to
 *              the client and to nothing else: fourteen server bootstraps
 *              still did exactly that, and one had no `.catch()` at all, so
 *              Node printed the raw error itself.
 *
 *   SCHEME     Nothing anywhere checked that BCONNECT_BASE_URL was https.
 *              The v1.1 client derives its root by rewriting the same URL, so
 *              `http://` sent a DOMAIN ACCOUNT's Basic header in clear text.
 *
 * Every assertion below was made to fail against the unfixed code first.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const SERVER_DIRS = readdirSync(ROOT).filter(
  (d) => /^bconnect-.*-mcp$/.test(d) || d === 'bconnect-server-template'
);

describe('a credential cannot ride a redirect to another host', () => {
  it('the v2.0 client refuses to follow redirects', () => {
    const src = readFileSync(join(ROOT, 'packages/mcp-core/src/bconnect-client-base.ts'), 'utf8');
    expect(src).toMatch(/maxRedirects:\s*0/);
  });

  it('the v1.1 client refuses too — it carries a domain password', () => {
    const src = readFileSync(join(ROOT, 'packages/mcp-core/src/v11-client.ts'), 'utf8');
    expect(src).toMatch(/maxRedirects:\s*0/);
  });

  it('the built artefacts carry it, not just the source', () => {
    // The servers run the build. A source-only assertion would pass against a
    // stale build, which is exactly how a fix gets believed and not shipped.
    for (const file of [
      'packages/mcp-core/build/bconnect-client-base.js',
      'packages/mcp-core/build/v11-client.js',
    ]) {
      const p = join(ROOT, file);
      if (!existsSync(p)) {continue;}
      expect(readFileSync(p, 'utf8'), `${file} was built without maxRedirects`).toMatch(
        /maxRedirects:\s*0/
      );
    }
  });
});

describe('a fatal error never hands the error object to util.inspect', () => {
  it('no server bootstrap passes a raw error as a console.error argument', () => {
    const offenders: string[] = [];
    for (const dir of SERVER_DIRS) {
      const p = join(ROOT, dir, 'src', 'index.ts');
      if (!existsSync(p)) {continue;}
      const src = readFileSync(p, 'utf8');
      // The specific shape SEC-2 closed: a second argument to console.error.
      // `console.error(\`...${describeConnectionFailure(e)}\`)` is a single
      // string argument and does not match.
      const bad = src.match(/console\.error\((["'`][^"'`]*["'`]),\s*\w*[Ee]rror\w*\s*\)/g);
      if (bad) {offenders.push(`${dir}: ${bad.join(' | ')}`);}
    }
    expect(
      offenders,
      `${offenders.length} bootstrap(s) hand a raw error to util.inspect, which walks ` +
        `error.config.headers:\n  ${offenders.join('\n  ')}`
    ).toEqual([]);
  });

  it('every server that starts itself also catches its own failure', () => {
    const uncaught: string[] = [];
    for (const dir of SERVER_DIRS) {
      const p = join(ROOT, dir, 'src', 'index.ts');
      if (!existsSync(p)) {continue;}
      const src = readFileSync(p, 'utf8');
      if (!/shouldAutoStart\(\)/.test(src)) {continue;}
      // An un-caught `void runServer({...})` becomes an unhandled rejection,
      // and Node prints the raw error itself — no console.error needed.
      //
      // Asserted as the PRESENCE of `.catch(` after the call rather than the
      // absence of a closing `});`: the first version of this test looked for
      // the latter and matched the `});` that closes the catch body, so it
      // reported all fourteen servers as uncaught. A guard that fires on
      // everything is as useless as one that fires on nothing.
      const hasCatch = /runServer\(\{[\s\S]*?\}\)\s*\.catch\(/.test(src);
      if (!hasCatch) {uncaught.push(dir);}
    }
    expect(
      uncaught,
      `${uncaught.length} server(s) start without catching, so a rejection becomes an ` +
        `unhandled rejection and Node prints the raw error:\n  ${uncaught.join('\n  ')}`
    ).toEqual([]);
  });
});

describe('a credential is not sent over plaintext http by accident', () => {
  it('runServer refuses an http:// base URL unless it is opted into explicitly', () => {
    const src = readFileSync(join(ROOT, 'packages/mcp-core/src/run-server.ts'), 'utf8');
    expect(src).toMatch(/\^http:\\\/\\\//);
    expect(src).toContain('BCONNECT_ALLOW_INSECURE_HTTP');
    // The refusal has to name what is exposed, not merely refuse.
    expect(src).toMatch(/CLEAR TEXT/);
  });
});
