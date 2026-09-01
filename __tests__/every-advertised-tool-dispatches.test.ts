/**
 * Every tool a server advertises must actually dispatch.
 *
 * The family collapse advertised `delete_maintenance_window_for_logical_group`
 * in the catalogue but dropped its `case` from the executing switch, so calling
 * it fell through to `default:` and returned `MethodNotFound: Unknown tool`.
 * Its endpoint-scoped twin kept its case, which is exactly why nobody noticed:
 * the neighbouring tool worked.
 *
 * Nothing caught it. The per-server surface tests assert what `tools/list`
 * contains, and the drift guard maps tools to API operations — neither asks the
 * simpler question of whether the advertised name reaches an implementation.
 *
 * This drives every advertised tool through the real dispatch path and asserts
 * only one thing: the server does not answer "unknown tool". Any other outcome —
 * a gate refusal, a transport failure because there is no live bMS — proves the
 * case arm exists, which is the whole question. Both write postures are
 * exercised, because a hidden write tool is still callable by name.
 *
 * Arguments are synthesised from each tool's own inputSchema rather than left
 * empty. That is not a nicety: parameter validation runs BEFORE the executing
 * switch, so an empty `{}` stops at "Invalid parameters: id is required" and
 * never reaches dispatch. A first version of this test did exactly that and
 * passed against the known-broken build — it proved nothing. If a call is
 * rejected as invalid, the probe cannot see past it, so those are reported
 * separately rather than counted as evidence either way.
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

/** Marker the SDK/servers use for a name that reached no implementation. */
const UNKNOWN = /unknown tool/i;
/** Validation refused the synthesised arguments, so dispatch was never reached. */
const UNREACHED = /invalid parameters|is required|must be a valid|must be a single path segment/i;

const DUMMY_GUID = '00000000-0000-4000-8000-000000000000';

interface ToolDef {
  name: string;
  inputSchema?: {
    properties?: Record<string, { type?: string; enum?: unknown[]; items?: { type?: string } }>;
    required?: string[];
  };
}

/**
 * Build arguments a tool's own validator will accept. Deliberately conservative:
 * every declared property is filled, not just the required ones, because some
 * validators reject a partial object. GUID-shaped names get a GUID — the
 * validators check format, and a bare "x" is refused before dispatch.
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

interface Probe { server: string; tool: string; message: string }

async function probeServer(name: string, posture: string): Promise<Probe[]> {
  const entry = join(ROOT, `bconnect-${name}-mcp`, 'build', 'index.js');
  if (!existsSync(entry)) {throw new Error(`not built: ${entry}`);}

  const mod = await import(`${pathToFileURL(entry).href}?dispatch=${posture}`);
  const { server } = mod.createServer();
  const handlers = (server as {
    _requestHandlers: Map<string, (r: unknown) => Promise<{ tools?: { name: string }[] }>>;
  })._requestHandlers;

  const list = await handlers.get('tools/list')?.({ method: 'tools/list' });
  const call = handlers.get('tools/call');
  if (!call) {return [];}

  const misses: Probe[] = [];
  for (const tool of (list?.tools ?? []) as ToolDef[]) {
    let message = '';
    try {
      await call({
        method: 'tools/call',
        params: { name: tool.name, arguments: synthesiseArgs(tool) },
      });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    if (UNKNOWN.test(message)) {
      misses.push({ server: name, tool: tool.name, message });
    } else if (UNREACHED.test(message)) {
      unreached.push({ server: name, tool: tool.name, message });
    }
  }
  return misses;
}

/** Tools whose validator refused the synthesised arguments — dispatch unproven. */
const unreached: Probe[] = [];

describe('every advertised tool reaches an implementation', () => {
  const found: Probe[] = [];

  beforeAll(async () => {
    // Three postures, not two. A gated tool is still a tool: it appears in
    // tools/list when its gate is open and is callable by name either way, so a
    // gate that hides a tool also hides a missing case arm from this guard.
    // BCONNECT_ENABLE_V11 was added for the v1.1 slice and would have been a
    // blind spot the moment a second slice landed — the defect this file exists
    // to catch is exactly the one that shipped last round.
    const POSTURES: Array<{ writes: boolean; v11: boolean }> = [
      { writes: false, v11: false },
      { writes: true, v11: false },
      { writes: true, v11: true },
    ];
    for (const { writes, v11 } of POSTURES) {
      const prev = process.env.ALLOW_WRITE_OPERATIONS;
      const prevTest = process.env.VITEST;
      const prevV11 = process.env.BCONNECT_ENABLE_V11;
      const prevV11User = process.env.BCONNECT_V11_USERNAME;
      const prevV11Pass = process.env.BCONNECT_V11_PASSWORD;
      process.env.ALLOW_WRITE_OPERATIONS = writes ? 'true' : '';
      // Stub v1.1 credentials: the gate needs both present, and the probe needs
      // the call to reach a transport rather than being refused for a missing
      // credential — same reasoning as the v2.0 dummies below.
      process.env.BCONNECT_ENABLE_V11 = v11 ? 'true' : '';
      process.env.BCONNECT_V11_USERNAME = v11 ? 'probe@example.invalid' : '';
      process.env.BCONNECT_V11_PASSWORD = v11 ? 'dispatch-probe' : '';
      process.env.VITEST = '1';
      process.env.BCONNECT_SKIP_CONNECTIVITY_CHECK = 'true';
      // Dummy credentials pointed at an unroutable address. Both halves matter:
      // WITHOUT credentials the client provider throws before the switch is ever
      // consulted, so every tool looks identical and a missing case arm is
      // invisible — an earlier version of this test failed exactly that way and
      // passed against a build with the arm deleted. WITH them, a dispatched tool
      // reaches the transport and fails to connect, while an undispatched one
      // still answers "Unknown tool". That difference is the whole test.
      process.env.BCONNECT_API_KEY = 'dispatch-probe';
      process.env.BCONNECT_BASE_URL = 'https://127.0.0.1:1/bconnect';
      try {
        for (const s of SERVERS) {found.push(...(await probeServer(s, `${writes}-${v11}`)));}
      } finally {
        const restore = (key: string, value: string | undefined) => {
          if (value === undefined) {delete process.env[key];}
          else {process.env[key] = value;}
        };
        restore('ALLOW_WRITE_OPERATIONS', prev);
        restore('VITEST', prevTest);
        restore('BCONNECT_ENABLE_V11', prevV11);
        restore('BCONNECT_V11_USERNAME', prevV11User);
        restore('BCONNECT_V11_PASSWORD', prevV11Pass);
      }
    }
  }, 300_000);

  it('advertises no tool whose name reaches no case arm', () => {
    const summary = found.map((f) => `${f.server}/${f.tool}`).sort();
    expect(
      [...new Set(summary)],
      'These tools appear in tools/list but dispatch to "unknown tool" — the ' +
        'catalogue entry exists and the executing switch case does not. Add the ' +
        'case (or stop advertising the tool); do not weaken this test.'
    ).toEqual([]);
  });
});
