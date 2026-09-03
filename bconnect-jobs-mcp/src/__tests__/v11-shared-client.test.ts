/**
 * The v1.1 hop, and what an unchecked assignment says (ARCH-2 / ARCH-3).
 *
 * This server used to carry two hand-rolled v1.1 readers — one in `v11.ts`, one
 * in `preview-assignment.ts` — each a bare `axios.get` with an
 * `Authorization: Basic` header holding a DOMAIN account, no `maxRedirects`,
 * and no consultation of BCONNECT_ENABLE_V11. Both are gone; the single hop is
 * mcp-core's `V11Client`.
 *
 * Two real loopback servers stand in for the bMS here rather than a spy on
 * axios, because the property under test is what goes out on the wire: the
 * "redirect target" server asserts on what it RECEIVED, so a client that
 * follows a 302 fails these tests no matter how it is written. Nothing here
 * touches a live estate.
 *
 * On what the redirect assertion claims. `follow-redirects` does strip
 * `Authorization` when the target is a different origin, so restoring the bare
 * axios call leaks a REQUEST to the target rather than the password itself —
 * measured, not assumed. That is exactly why the control is "never redirect"
 * and not "trust the dependency's allow-list": the allow-list is a transitive
 * dependency's implementation detail, and a domain password is not something to
 * stake on one. So these assert the property mcp-core actually guarantees —
 * nothing at all is sent to a redirect target — which is the stronger one.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createServer as createHttpServer, type Server as HttpServer, type IncomingMessage } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AxiosInstance } from 'axios';

import { fetchV11Job, isDestructiveJob } from '../modules/v11.js';
import { previewAssignment } from '../modules/preview-assignment.js';
import { connectTestClient } from './lib/connect.js';

const JOB_ID = '11111111-2222-3333-4444-555555555555';
const GROUP_ID = '99999999-8888-7777-6666-555555555555';
const USER = 'svc-bconnect@example.local';
const PASS = 'domain-password';

// ── Two stand-in servers ─────────────────────────────────────────────────────

interface Recorder {
  server: HttpServer;
  port: number;
  /** Every request seen, with the headers it carried. */
  hits: Array<{ url: string; auth: string | undefined }>;
}

/** `handler` returns the body; a null return sends 404. */
async function listen(
  handler: (req: IncomingMessage) => { status?: number; headers?: Record<string, string>; body?: unknown } | null
): Promise<Recorder> {
  const hits: Recorder['hits'] = [];
  const server = createHttpServer((req, res) => {
    hits.push({ url: req.url ?? '', auth: req.headers.authorization });
    const out = handler(req);
    if (!out) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }
    res.writeHead(out.status ?? 200, { 'Content-Type': 'application/json', ...(out.headers ?? {}) });
    res.end(JSON.stringify(out.body ?? {}));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return { server, port, hits };
}

/** The server a redirect points AT. It must never be offered the credential. */
let redirectTarget: Recorder;
/** The stand-in bMS. Its v1.1 behaviour is switched per test. */
let bms: Recorder;

/** What the fake bMS answers on /bConnect/v1.1/jobs.json for the next test. */
let v11Response: { status?: number; headers?: Record<string, string>; body?: unknown } | null = null;

beforeAll(async () => {
  redirectTarget = await listen(() => ({ body: { Destructive: false } }));
  bms = await listen((req) => {
    const url = req.url ?? '';
    if (url.includes('/v1.1/')) {
      return v11Response;
    }
    if (url.includes('AssignJobDefinition')) {
      return { body: [{ id: 'instance-1' }] };
    }
    return null;
  });
});

afterAll(async () => {
  await new Promise<void>((r) => redirectTarget.server.close(() => r()));
  await new Promise<void>((r) => bms.server.close(() => r()));
});

const bmsBaseUrl = (): string => `http://127.0.0.1:${bms.port}/bconnect`;

/** v1.1 hits only — the v2.0 traffic shares the same stand-in server. */
const v11Hits = (): Recorder['hits'] => bms.hits.filter((h) => h.url.includes('/v1.1/'));

beforeEach(() => {
  redirectTarget.hits.length = 0;
  bms.hits.length = 0;
  v11Response = { body: { Destructive: false, Steps: [] } };
  vi.stubEnv('BCONNECT_V11_USERNAME', USER);
  vi.stubEnv('BCONNECT_V11_PASSWORD', PASS);
  vi.stubEnv('BCONNECT_ENABLE_V11', 'true');
  vi.stubEnv('ALLOW_DESTRUCTIVE_JOB_ASSIGNMENT', '');
});

/** An AxiosInstance stub whose baseURL is the stand-in bMS. */
function v2Client(get = vi.fn()): AxiosInstance {
  return { get, defaults: { baseURL: bmsBaseUrl() } } as unknown as AxiosInstance;
}

// ── ARCH-2: the credential never reaches a redirect target ───────────────────

describe('a redirect target is never contacted, so it is never offered the credential', () => {
  it('refuses to follow a 302 rather than re-issuing the Basic-auth request', async () => {
    v11Response = {
      status: 302,
      headers: { Location: `http://127.0.0.1:${redirectTarget.port}/bConnect/v1.1/jobs.json` },
    };

    const result = await fetchV11Job(v2Client(), JOB_ID);

    // The credential was offered to the bMS and to nothing else.
    expect(v11Hits()).toHaveLength(1);
    expect(v11Hits()[0]!.auth).toMatch(/^Basic /);
    expect(redirectTarget.hits.map((h) => h.auth)).toEqual([]);
    expect(redirectTarget.hits).toHaveLength(0);

    // And the 302 is reported, not silently resolved into a job.
    expect(result.job).toBeNull();
    expect(result.reason).toMatch(/302/);
  });

  it('reports a redirected lookup as unreadable rather than as a healthy job', async () => {
    v11Response = {
      status: 307,
      headers: { Location: `http://127.0.0.1:${redirectTarget.port}/anything` },
    };

    const check = await isDestructiveJob(v2Client(), JOB_ID);

    expect(redirectTarget.hits).toHaveLength(0);
    expect(check.destructive).toBeNull();
    expect(check.reason).toMatch(/307/);
  });
});

// ── ARCH-2: both former call sites consult the enable gate ───────────────────

describe('both v1.1 call sites respect BCONNECT_ENABLE_V11', () => {
  it('sends nothing from fetchV11Job when the gate is shut but credentials exist', async () => {
    vi.stubEnv('BCONNECT_ENABLE_V11', '');

    const result = await fetchV11Job(v2Client(), JOB_ID);

    expect(v11Hits()).toHaveLength(0);
    expect(result.job).toBeNull();
    expect(result.reason).toContain('BCONNECT_ENABLE_V11');
  });

  it('sends nothing from preview_assignment when the gate is shut but credentials exist', async () => {
    vi.stubEnv('BCONNECT_ENABLE_V11', '');
    const get = vi.fn(async (url: string) => {
      if (url.includes('/JobDefinitions/')) {
        return { data: { name: 'Nightly wipe', folder: 'Ops', type: 'Job' } };
      }
      if (url.includes('/LogicalGroups')) {
        return { data: { data: [{ id: GROUP_ID, name: 'Target', parentId: null }], totalPages: 1 } };
      }
      return { data: { data: [], totalPages: 1 } };
    });

    const out = (await previewAssignment(v2Client(get), {
      jobDefinitionId: JOB_ID,
      logicalGroupId: GROUP_ID,
    })) as { blockers: string[]; verdict: string };

    expect(v11Hits()).toHaveLength(0);
    expect(out.verdict).toBe('CONFIRM FIRST');
    expect(out.blockers.join(' ')).toContain('BCONNECT_ENABLE_V11');
  });

  it('reads v1.1 from both call sites once the gate is open', async () => {
    await fetchV11Job(v2Client(), JOB_ID);
    expect(v11Hits()).toHaveLength(1);

    const get = vi.fn(async (url: string) => {
      if (url.includes('/JobDefinitions/')) {
        return { data: { name: 'Nightly wipe', folder: 'Ops', type: 'Job' } };
      }
      if (url.includes('/StaticGroups/')) {
        return { data: { data: [], totalPages: 1 } };
      }
      return { data: { data: [], totalPages: 1 } };
    });
    await previewAssignment(v2Client(get), { jobDefinitionId: JOB_ID, staticGroupId: GROUP_ID });

    expect(v11Hits()).toHaveLength(2);
  });
});

// ── ARCH-2: no server-local axios call may carry a credential again ──────────

describe('this server has no hand-rolled v1.1 client', () => {
  it('never calls axios directly outside mcp-core', () => {
    const srcDir = join(fileURLToPath(new URL('../', import.meta.url)));
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__' && entry.name !== 'generated') {walk(path);}
          continue;
        }
        if (!entry.name.endsWith('.ts')) {continue;}
        const text = readFileSync(path, 'utf8');
        if (/\baxios\s*\.\s*(get|post|put|patch|delete|request)\s*\(/.test(text)) {
          offenders.push(entry.name);
        }
      }
    };
    walk(srcDir);

    expect(
      offenders,
      'a bare axios call here bypasses V11Client — no maxRedirects, no enable gate, ' +
        'no ISO-8859-1 credential encoding. Route v1.1 through modules/v11.ts instead.'
    ).toEqual([]);
  });
});

// ── ARCH-3: an assignment that could not read the flag says so ───────────────

describe('the Destructive check discloses when it could not run', () => {
  const assignArgs = { logicalGroupId: GROUP_ID, jobDefinitionId: JOB_ID };

  beforeEach(() => {
    vi.stubEnv('ALLOW_WRITE_OPERATIONS', 'true');
    // Set-but-empty is a real narrowing to "no tools" — this gate is not the
    // subject here, so it has to be absent rather than blank.
    vi.stubEnv('ALLOWED_WRITE_TOOLS', undefined);
  });

  async function assign(): Promise<{ text: string; isError: boolean }> {
    const client = await connectTestClient({
      baseUrl: bmsBaseUrl(),
      username: 'api-user',
      password: 'api-password',
    });
    const res = (await client.callTool({
      name: 'assign_job_to_logical_group',
      arguments: assignArgs,
    })) as { content: Array<{ text: string }>; isError?: boolean };
    return { text: res.content.map((c) => c.text).join('\n'), isError: res.isError === true };
  }

  it('carries a NOT CHECKED note when v1.1 is off — the default posture', async () => {
    vi.stubEnv('BCONNECT_ENABLE_V11', '');
    vi.stubEnv('BCONNECT_V11_USERNAME', '');
    vi.stubEnv('BCONNECT_V11_PASSWORD', '');

    const { text, isError } = await assign();

    // The assignment still runs — refusing every assignment without v1.1 would
    // break the majority deployment — but it cannot pass for a checked one.
    expect(isError).toBe(false);
    // The assignment produced a result. Asserted as "a result came back"
    // rather than by quoting the count sentence: that wording changed when
    // the four assign arms stopped reporting a 207 as an unqualified success,
    // and these two tests are about the DESTRUCTIVE-check disclosure, not
    // about how the outcome is phrased.
    expect(text).toMatch(/1 job instance/);
    expect(text).toContain('NOT CHECKED');
    expect(text).toContain('BCONNECT_V11_USERNAME');
  });

  it('carries the note when the v1.1 read fails, naming the failure', async () => {
    v11Response = { status: 500, body: { Message: 'bMS is unwell' } };

    const { text } = await assign();

    expect(text).toContain('NOT CHECKED');
    expect(text).toMatch(/500/);
  });

  it('adds no note when the flag was read and is false', async () => {
    v11Response = { body: { Destructive: false, Steps: [] } };

    const { text } = await assign();

    // The assignment produced a result. Asserted as "a result came back"
    // rather than by quoting the count sentence: that wording changed when
    // the four assign arms stopped reporting a 207 as an unqualified success,
    // and these two tests are about the DESTRUCTIVE-check disclosure, not
    // about how the outcome is phrased.
    expect(text).toMatch(/1 job instance/);
    expect(text).not.toContain('NOT CHECKED');
  });

  it('still refuses outright when the flag was read and is true', async () => {
    v11Response = { body: { Destructive: true, Steps: [] } };

    const { text, isError } = await assign();

    expect(isError).toBe(true);
    expect(text).toContain('is flagged Destructive');
    // A refusal is not an unchecked assignment.
    expect(text).not.toContain('NOT CHECKED');
    expect(bms.hits.some((h) => h.url.includes('AssignJobDefinition'))).toBe(false);
  });
});
