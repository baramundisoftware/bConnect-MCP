/**
 * No server sends a request whose path escapes its API module.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * Modules build URLs by interpolating a caller-supplied id into
 * `` `${basePath}/Endpoints/${id}` ``. `basePath` is only a prefix, so an id of
 * `../../../defensecontrol/v2.0/BitLocker/WindowsEndpoints` walks out of the
 * module. A prior phase verified that live: it returned 23 BitLocker records
 * and the API-key inventory. One credential serves all 13 servers, so RBAC
 * bounds the blast radius to the UNION of what every deployed server needs —
 * deploy defensecontrol and the key can read BitLocker, and the traversal from
 * any other server then reaches it.
 *
 * ── Why this file exists, when a guard already did ──────────────────────────
 * Two layers were supposed to stop it, and each had a hole the other did not
 * cover:
 *
 *   `assertRequestPathContained` is universal (a transport interceptor, all 13
 *   servers, cannot be forgotten) but its check was "does any segment equal
 *   `..`". The Phase 4 security audit made it fail: it passed `..;/`, which
 *   IIS/ASP.NET normalises to `..` by stripping the `;` path parameter — and
 *   bMS bConnect is hosted on IIS. It also passed quad-encoded traversal,
 *   because the decode is bounded to three rounds.
 *
 *   `assertSafePathSegment` rejects all of that, and was wired into 3 of 13
 *   servers. The other 10 relied on GUID-format validation, which covers
 *   GUID-typed ids and nothing else.
 *
 * So the fix was both: teach the interceptor about `;` path parameters,
 * residual percent-encoding and Unicode compatibility forms, and put the
 * per-argument check on the catalogue so a server gets it by construction.
 *
 * This file drives real payloads through every server's real dispatch, because
 * the audit's own finding was that a guard nobody made fail is not evidence.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findPathEscape } from '@bconnect/mcp-core';

const ROOT = join(__dirname, '..');
/**
 * Every server, DISCOVERED — never a hand-written list.
 *
 * This was a literal list of thirteen names. `bconnect-insights-mcp` shipped on
 * 2026-08-11/12 and was added to none of the five guards that carried one, so
 * for three days its five tools were outside this check entirely. The audit that
 * found it (2026-08-14) started from the catalogue ratchet in
 * `id-producers.test.ts`, which had the same list and was bounding 13 servers
 * out of 14 while reporting a clean figure.
 *
 * A guard that omits a server does not fail — it passes over a thing it never
 * looked at. Discovery is the only version of this that cannot go stale.
 * `bconnect-mcp-gateway` and `bconnect-server-template` do not end in `-mcp`
 * and are correctly outside the pattern.
 */
const SERVERS: readonly string[] = readdirSync(ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => /^bconnect-(.+)-mcp$/.exec(entry.name)?.[1])
  .filter((name): name is string => Boolean(name))
  .sort();

// Vacuity: a pattern that matched nothing would make every assertion below pass
// over an empty set, which is the failure this discovery replaced.
if (SERVERS.length < 14 || !SERVERS.includes('insights')) {
  throw new Error(`server discovery found ${SERVERS.length}: ${SERVERS.join(', ')}`);
}

/**
 * Every traversal primitive the audit tried, plus the ones that already worked.
 * `..;/` and the quad-encoded form are the two it proved were let through.
 */
const TRAVERSALS = [
  ['plain', '../../../defensecontrol/v2.0/BitLocker/WindowsEndpoints'],
  ['single-encoded', '%2e%2e%2f%2e%2e%2fdefensecontrol'],
  ['double-encoded', '%252e%252e%252fdefensecontrol'],
  ['quad-encoded', '%2525252e%2525252e%2525252fdefensecontrol'],
  ['iis-path-parameter', '..;/..;/defensecontrol/v2.0/BitLocker'],
  ['iis-path-parameter-valued', '..;a=b/defensecontrol'],
  ['fullwidth-dots', '．．/defensecontrol'],
  ['backslash', '..\\..\\defensecontrol'],
] as const;

describe('findPathEscape — the transport backstop', () => {
  it.each(TRAVERSALS)('blocks a %s traversal', (_label, payload) => {
    expect(findPathEscape(`/endpoints/v2.0/Endpoints/${payload}`)).not.toBeNull();
  });

  // The other half of a useful guard: it must not reject real ids. bConnect
  // resource names legitimately contain dots and semicolons.
  it.each([
    ['a guid', '/endpoints/v2.0/Endpoints/e57a7e00-0000-4000-8000-000000000006'],
    ['a host name', '/endpoints/v2.0/Endpoints/WORKSTATION1'],
    ['a dotted product name', '/software/v2.0/InstalledWindowsSoftware/Microsoft.NET.Runtime'],
    ['a name with a semicolon', '/assets/v2.0/Assets/Dell;Latitude'],
    ['dots inside a name', '/endpoints/v2.0/Endpoints/WIN..CLIENT'],
    ['percent-escapes in the QUERY only', '/endpoints/v2.0/Endpoints?SearchQuery=a%20b'],
  ])('allows %s', (_label, url) => {
    expect(findPathEscape(url)).toBeNull();
  });
});

// ─── Every server, through its real dispatch ─────────────────────────────────

interface ToolDef {
  name: string;
  inputSchema?: { properties?: Record<string, unknown>; required?: string[] };
}
interface Probe { server: string; tool: string; payload: string; outcome: string }

const leaks: Probe[] = [];
let probed = 0;

beforeAll(async () => {
  process.env.VITEST = 'true';
  process.env.ALLOW_WRITE_OPERATIONS = 'true';
  for (const name of SERVERS) {
    const entry = join(ROOT, `bconnect-${name}-mcp`, 'build', 'index.js');
    if (!existsSync(entry)) {continue;}
    const mod = await import(`${pathToFileURL(entry).href}?traversal=1`);
    const { server } = mod.createServer();
    const handlers = (server as {
      _requestHandlers: Map<string, (r: unknown) => Promise<unknown>>;
    })._requestHandlers;
    const list = (await handlers.get('tools/list')?.({ method: 'tools/list' })) as {
      tools?: ToolDef[];
    };
    const call = handlers.get('tools/call');
    if (!call) {continue;}

    for (const tool of list?.tools ?? []) {
      // The first required id-shaped parameter is the one that reaches a path.
      const idParam = (tool.inputSchema?.required ?? []).find((p) => /id$/i.test(p));
      if (!idParam) {continue;}

      for (const [, payload] of TRAVERSALS) {
        probed++;
        const args: Record<string, unknown> = { [idParam]: payload };
        // Fill the other required params so validation reaches the id check.
        for (const other of tool.inputSchema?.required ?? []) {
          if (other !== idParam && args[other] === undefined) {args[other] = 'probe';}
        }
        let message = '';
        try {
          const result = await call({
            method: 'tools/call',
            params: { name: tool.name, arguments: args },
          });
          message = `RESOLVED: ${JSON.stringify(result).slice(0, 100)}`;
        } catch (err) {
          message = err instanceof Error ? err.message : String(err);
        }
        // Anything that refuses is fine — the traversal must not reach a socket.
        // A network error would mean the request was actually built and sent.
        const refused =
          /single path segment|traversal|escapes its API module|must not contain|invalid parameters|is not a GUID|must be a valid|unknown parameter|is disabled/i.test(
            message
          );
        if (!refused) {
          leaks.push({ server: name, tool: tool.name, payload, outcome: message.slice(0, 140) });
        }
      }
    }
  }
  process.env.ALLOW_WRITE_OPERATIONS = '';
}, 180_000);

describe('every server refuses a traversal id through its real dispatch', () => {
  it('no advertised tool lets one through', () => {
    expect(probed, 'nothing was probed; the catalogue failed to load').toBeGreaterThan(100);
    const summary = leaks
      .slice(0, 20)
      .map((l) => `  ${l.server}/${l.tool} <- ${l.payload}: ${l.outcome}`)
      .join('\n');
    expect(
      leaks,
      `${leaks.length} tool/payload combination(s) did not refuse a traversal id. One credential ` +
        `serves all 13 servers, so a traversal from any one of them reaches the union of what ` +
        `every deployed server can read:\n${summary}`
    ).toEqual([]);
    console.log(`[traversal] ${probed} tool/payload combinations probed, ${leaks.length} leaks`);
  });
});
