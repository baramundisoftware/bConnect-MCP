/**
 * Every advertised tool must REFUSE an argument key its schema does not declare.
 *
 * ── The defect this exists to catch ─────────────────────────────────────────
 * `validateParameters()` iterates over *rules*. An argument with no matching
 * rule was therefore never looked at by anything, and no tool schema sets
 * `additionalProperties: false`. Meanwhile bConnect answers HTTP 200 and
 * silently ignores a query key it does not recognise (finding D6).
 *
 * Those two facts compose into a wrong answer that looks right. Measured live
 * through the real MCP dispatch path against a 26R1 server:
 *
 *   list_vulnerabilities {countOnly, SearchQuery:"CVE-2024-21412"} -> 1
 *   list_vulnerabilities {countOnly, SearchQuer :"CVE-2024-21412"} -> 37,571
 *
 * One transposed character, a 37,571x overcount, HTTP 200, and the bogus key
 * echoed back in `filters` as though it had been honoured. `minCvss` behaves
 * the same way — and `minCvss` is a REAL parameter of a different tool in the
 * same server, so this is not only reachable by typo but by a model correctly
 * remembering a name from the wrong tool.
 *
 * Eleven of thirteen servers forwarded unknown keys when this was found.
 * `endpoints` and `groups` refused, because they alone had grown a local check.
 * The whole 1,378-test suite was green throughout.
 *
 * ── Why it is a suite guard and not thirteen server tests ───────────────────
 * The thing that failed was not any one server; it was that the check lived in
 * two servers and nothing asserted the other eleven had it. A per-server test
 * would have been written for the two that already passed. This asks the
 * question mechanically, of every advertised tool in every posture, so a new
 * server or a new tool is covered on the day it is added rather than the day
 * someone remembers.
 *
 * ── Made to fail before being trusted ───────────────────────────────────────
 * Per the project rule that a guard which has not been made to fail is not
 * evidence: this guard was run against the pre-fix build and reported 178
 * tools across 11 servers accepting `__unknown_probe__`. It reports zero after
 * the fix. To re-confirm, delete the `assertKnownParameters` call from any
 * server's `index.ts` and re-run — that server's tools reappear here.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

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
 * A key no schema could plausibly declare. Deliberately not a near-miss of a
 * real parameter: this guard asks whether unknown keys are rejected at all,
 * and a near-miss would confuse that question with fuzzy-matching behaviour.
 */
const PROBE_KEY = '__unknown_probe__';

/** The refusal we require. Must name the offending key, or it is not actionable. */
const REJECTED = /unknown parameter/i;

const DUMMY_GUID = '00000000-0000-4000-8000-000000000000';

interface ToolDef {
  name: string;
  inputSchema?: {
    properties?: Record<string, { type?: string; enum?: unknown[] }>;
    required?: string[];
  };
}

/**
 * Valid arguments, so the call is refused for the RIGHT reason.
 *
 * Without this the probe would stop at "id is required" and prove nothing —
 * the same mistake an earlier version of `every-advertised-tool-dispatches`
 * made, which is why that file says so in its own header.
 */
function synthesiseArgs(tool: ToolDef): Record<string, unknown> {
  const props = tool.inputSchema?.properties ?? {};
  const args: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(props)) {
    if (Array.isArray(spec?.enum) && spec.enum.length) { args[key] = spec.enum[0]; continue; }
    switch (spec?.type) {
      case 'number':
      case 'integer': args[key] = 1; break;
      case 'boolean': args[key] = false; break;
      case 'array': args[key] = []; break;
      case 'object': args[key] = {}; break;
      default:
        args[key] = /(^|[a-z])id$|guid|^id$/i.test(key) ? DUMMY_GUID : 'probe';
    }
  }
  return args;
}

interface Leak { server: string; tool: string; outcome: string }

async function probeServer(name: string, posture: string): Promise<Leak[]> {
  const entry = join(ROOT, `bconnect-${name}-mcp`, 'build', 'index.js');
  if (!existsSync(entry)) {throw new Error(`not built: ${entry}`);}

  const mod = await import(`${pathToFileURL(entry).href}?unknownparam=${posture}`);
  const { server } = mod.createServer();
  const handlers = (server as {
    _requestHandlers: Map<string, (r: unknown) => Promise<{ tools?: { name: string }[] }>>;
  })._requestHandlers;

  const list = await handlers.get('tools/list')?.({ method: 'tools/list' });
  const call = handlers.get('tools/call');
  if (!call) {return [];}

  const leaks: Leak[] = [];
  for (const tool of (list?.tools ?? []) as ToolDef[]) {
    const args = { ...synthesiseArgs(tool), [PROBE_KEY]: 'probe' };
    let message = '';
    try {
      const result = await call({
        method: 'tools/call',
        params: { name: tool.name, arguments: args },
      });
      // No throw at all is the worst case: the key was carried past validation
      // and, on a live server, would have reached the wire.
      message = `resolved without rejection: ${JSON.stringify(result).slice(0, 120)}`;
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    if (!REJECTED.test(message)) {
      leaks.push({ server: name, tool: tool.name, outcome: message.slice(0, 160) });
    }
  }
  return leaks;
}

describe('no advertised tool accepts an undeclared argument key', () => {
  const leaks: Leak[] = [];

  beforeAll(async () => {
    // Three postures, matching every-advertised-tool-dispatches: a gated tool
    // is still callable by name, so a gate that hides a tool would otherwise
    // hide a missing check from this guard too.
    const POSTURES: Array<{ writes: boolean; v11: boolean }> = [
      { writes: false, v11: false },
      { writes: true, v11: false },
      { writes: true, v11: true },
    ];
    const saved = {
      writes: process.env.ALLOW_WRITE_OPERATIONS,
      v11: process.env.BCONNECT_ENABLE_V11,
      v11User: process.env.BCONNECT_V11_USERNAME,
      v11Pass: process.env.BCONNECT_V11_PASSWORD,
      vitest: process.env.VITEST,
    };
    try {
      for (const { writes, v11 } of POSTURES) {
        process.env.ALLOW_WRITE_OPERATIONS = writes ? 'true' : '';
        process.env.BCONNECT_ENABLE_V11 = v11 ? 'true' : '';
        process.env.BCONNECT_V11_USERNAME = v11 ? 'probe@example.test' : '';
        process.env.BCONNECT_V11_PASSWORD = v11 ? 'probe' : '';
        // The servers skip their startup connectivity probe under VITEST.
        process.env.VITEST = 'true';
        for (const name of SERVERS) {
          leaks.push(...(await probeServer(name, `${writes}-${v11}`)));
        }
      }
    } finally {
      process.env.ALLOW_WRITE_OPERATIONS = saved.writes ?? '';
      process.env.BCONNECT_ENABLE_V11 = saved.v11 ?? '';
      process.env.BCONNECT_V11_USERNAME = saved.v11User ?? '';
      process.env.BCONNECT_V11_PASSWORD = saved.v11Pass ?? '';
      process.env.VITEST = saved.vitest ?? '';
    }
  }, 120_000);

  it('every advertised tool rejects an undeclared key, in every posture', () => {
    const summary = leaks
      .map((l) => `  ${l.server}/${l.tool}: ${l.outcome}`)
      .join('\n');
    expect(
      leaks,
      `${leaks.length} tool(s) did not reject '${PROBE_KEY}'. bConnect answers 200 and ` +
        `ignores an unrecognised query key, so each of these can return the full ` +
        `unfiltered collection labelled as a filtered result:\n${summary}`
    ).toEqual([]);
  });

  it('the refusal names the offending key, so a caller can fix it', async () => {
    // A rejection that says only "invalid parameters" costs a turn and teaches
    // nothing. This asserts the message is actionable, not merely present.
    const entry = join(ROOT, 'bconnect-compliance-mcp', 'build', 'index.js');
    const mod = await import(`${pathToFileURL(entry).href}?unknownparam=message`);
    const { server } = mod.createServer();
    const handlers = (server as {
      _requestHandlers: Map<string, (r: unknown) => Promise<unknown>>;
    })._requestHandlers;

    let message = '';
    try {
      await handlers.get('tools/call')?.({
        method: 'tools/call',
        params: { name: 'list_vulnerabilities', arguments: { SearchQuer: 'CVE-2024-21412' } },
      });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain('SearchQuer');
    expect(message).toMatch(/this tool accepts/i);
    // The reason matters as much as the refusal: it is why the key was not
    // simply dropped and the call allowed through.
    expect(message).toMatch(/full unfiltered/i);
  });
});
