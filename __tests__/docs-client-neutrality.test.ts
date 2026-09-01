/**
 * The shipping documentation must describe the product, not one client of it.
 *
 * Three of these rules exist because the docs said something the code had
 * stopped doing, and the reader had no way to tell:
 *
 *   - `install/lib/hosts.json` records that VS Code's top-level key is
 *     `servers`, calls an `mcpServers` block "the single most common way a
 *     hand-copied Claude config fails silently in VS Code", and ships a
 *     negative control proving the emitter rejects it. README.md then handed
 *     the reader an `mcpServers` block for `.vscode/mcp.json`.
 *   - The same registry records that Claude Code reads a `url` entry with no
 *     `"type"` as stdio. Every HTTP example in the docs omitted it.
 *   - `/health` stopped returning the domain list to an unauthenticated caller
 *     (SEC-10). Three documents still printed the old body as the expected
 *     output of the first command a gateway operator runs.
 *
 * None of those is catchable by reading the doc: each is only wrong relative to
 * something else in the repository. So each rule below reads the OTHER artefact
 * — hosts.json, the running gateway, the built catalogue — and compares.
 *
 * Vacuity is the failure mode here: a rule that finds nothing to check passes.
 * Every rule that scans for a pattern also asserts it found some.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import http from 'node:http';

const ROOT = join(__dirname, '..');

/**
 * `install/` sits BESIDE this suite in the working repository and INSIDE it in a
 * publication cut, whose root is this suite. Hard-coding `../install` resolved
 * to `C:\install` in the cut, so the guard reported the registry unreadable and
 * three checks failed for a reason that had nothing to do with the docs.
 *
 * Same defect as the workflow's `../install/lib` and the server-list guard's
 * path derivation — one layout written down, in three places.
 */
const HOSTS_JSON =
  [
    join(ROOT, 'install', 'lib', 'hosts.json'),
    join(ROOT, '..', 'install', 'lib', 'hosts.json'),
  ].find(existsSync) ?? join(ROOT, '..', 'install', 'lib', 'hosts.json');

const SERVER_DIRS = readdirSync(ROOT)
  .filter((d) => /^bconnect-.*-mcp$/.test(d) && d !== 'bconnect-mcp-gateway')
  .sort();

/** Every markdown file this stream owns and ships. */
const SHIPPING_DOCS = [
  'README.md',
  'docs/INSTALLATION.md',
  'docs/TROUBLESHOOTING.md',
  'docs/DOCKER.md',
  'docs/N8N.md',
  'docs/DATA-FLOW.md',
  ...SERVER_DIRS.map((d) => `${d}/README.md`),
  'bconnect-server-template/README.md',
];

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

/** Every fenced ```json block in a document, with its 1-based start line. */
function jsonBlocks(text: string): { line: number; body: string }[] {
  const out: { line: number; body: string }[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*```json\s*$/.test(lines[i])) {continue;}
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length && !/^\s*```\s*$/.test(lines[j]); j++) {body.push(lines[j]);}
    out.push({ line: i + 1, body: body.join('\n') });
    i = j;
  }
  return out;
}

/** Walk every plain object in a parsed JSON value. */
function* objects(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) {
    for (const item of value) {yield* objects(item);}
    return;
  }
  if (value && typeof value === 'object') {
    yield value as Record<string, unknown>;
    for (const v of Object.values(value)) {yield* objects(v);}
  }
}

// ── The registry the installer enforces, read as data ────────────────────────

describe('the docs agree with the host registry the installer enforces', () => {
  it('hosts.json is readable — these rules are worthless without it', () => {
    expect(existsSync(HOSTS_JSON), `not found: ${HOSTS_JSON}`).toBe(true);
  });

  it('never offers one container key for two files that do not share one', () => {
    // Built from hosts.json so the expectation cannot drift from what the
    // installer's emitters enforce: file the reader is told to edit -> the key
    // that file's client actually reads.
    const registry = JSON.parse(readFileSync(HOSTS_JSON, 'utf8')) as {
      targets: { id: string; serversKey: string | null; defaultPath: string }[];
    };
    const keyForFile = new Map<string, string>();
    for (const t of registry.targets) {
      if (!t.serversKey || !t.defaultPath) {continue;}
      // "{PROJECT}\\.vscode\\mcp.json" -> ".vscode/mcp.json"
      // "{APPDATA}\\Claude\\claude_desktop_config.json" -> "claude_desktop_config.json"
      // A dot-directory is part of how a reader identifies the file; a normal
      // one (Claude\, out\) is machine-specific and never written in prose.
      const segs = t.defaultPath.replace(/^\{[A-Z]+\}[\\/]?/, '').replace(/\\/g, '/').split('/');
      const file =
        segs.length >= 2 && segs[segs.length - 2].startsWith('.')
          ? segs.slice(-2).join('/')
          : segs[segs.length - 1];
      keyForFile.set(file, t.serversKey);
    }
    expect(keyForFile.get('.vscode/mcp.json'), 'hosts.json no longer says what VS Code reads')
      .toBe('servers');
    expect(keyForFile.get('.mcp.json')).toBe('mcpServers');

    // A config block is addressed to whichever files the prose right before it
    // names. If those files disagree about the container key, one block cannot
    // serve them — which is exactly how a Claude-shaped `mcpServers` block got
    // offered for `.vscode/mcp.json`.
    let evaluated = 0;
    const bad: string[] = [];

    for (const rel of SHIPPING_DOCS) {
      const text = read(rel);
      for (const block of jsonBlocks(text)) {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(block.body) as Record<string, unknown>;
        } catch {
          continue;
        }
        const topKeys = Object.keys(parsed);
        if (topKeys.length !== 1) {continue;}
        const container = topKeys[0];
        if (container !== 'servers' && container !== 'mcpServers') {continue;}

        // A block's own prose is what sits between it and the nearest preceding
        // heading or fence — not the section above, which is addressed to a
        // different client and names a different file.
        const fenceOffset = text.split('\n').slice(0, block.line - 1).join('\n').length;
        const before = text.slice(0, fenceOffset);
        const start = Math.max(before.lastIndexOf('\n#'), before.lastIndexOf('\n```'));
        const preamble = before.slice(start + 1);

        const addressed = [...keyForFile.entries()].filter(([file]) =>
          preamble.includes(file) || preamble.includes(file.replace(/\//g, '\\'))
        );
        if (addressed.length === 0) {continue;}
        evaluated++;

        const wrong = addressed.filter(([, key]) => key !== container);
        for (const [file, key] of wrong) {
          bad.push(
            `${rel}:${block.line} offers "${container}" for ${file}, which reads "${key}"`
          );
        }
      }
    }

    expect(evaluated, 'no config block was addressed to a named file — pattern is stale')
      .toBeGreaterThan(0);
    expect(
      bad,
      `hosts.json: VS Code's top-level key is "servers", NOT "mcpServers" — ` +
        `"the single most common way a hand-copied Claude config fails silently in VS Code".\n  ` +
        bad.join('\n  ')
    ).toEqual([]);
  });

  it('gives every url-shaped server entry a "type"', () => {
    let entriesSeen = 0;
    const bad: string[] = [];

    for (const rel of SHIPPING_DOCS) {
      for (const block of jsonBlocks(read(rel))) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(block.body);
        } catch {
          continue; // annotated/partial snippets are not config the reader pastes whole
        }
        for (const obj of objects(parsed)) {
          if (typeof obj.url !== 'string') {continue;}
          entriesSeen++;
          if (typeof obj.type !== 'string') {
            bad.push(`${rel}:${block.line} — url entry ${JSON.stringify(obj.url)} has no "type"`);
          }
        }
      }
    }

    expect(entriesSeen, 'no url server entries found in any doc — pattern is stale').toBeGreaterThan(0);
    expect(
      bad,
      `hosts.json (claude-code): 'A url entry with no "type" is a documented configuration ` +
        `ERROR -- Claude Code reads a type-less entry as stdio.'\n  ` + bad.join('\n  ')
    ).toEqual([]);
  });

  it('puts no credential inside a client-configuration block', () => {
    // The installer's emitters throw on this (HOST_CONFIG_ENV_ALLOWLIST); the
    // docs used to teach it, thirteen times over.
    const credentialKeys = /"(BCONNECT_PASSWORD|BCONNECT_API_KEY|BCONNECT_USERNAME|BCONNECT_V11_PASSWORD|MCP_GATEWAY_AUTH_TOKEN)"\s*:/;
    let blocksSeen = 0;
    const bad: string[] = [];

    for (const rel of SHIPPING_DOCS) {
      for (const block of jsonBlocks(read(rel))) {
        // Only blocks that are a client config: they name a command or a url.
        if (!/"command"\s*:|"url"\s*:/.test(block.body)) {continue;}
        blocksSeen++;
        const hit = block.body.match(credentialKeys);
        if (hit) {bad.push(`${rel}:${block.line} — ${hit[1]} inside a client config block`);}
      }
    }

    expect(blocksSeen, 'no client-config JSON blocks found — pattern is stale').toBeGreaterThan(0);
    expect(
      bad,
      `A credential belongs in the file --env-file points at, never in a client config.\n  ` +
        bad.join('\n  ')
    ).toEqual([]);
  });
});

// ── The gateway's real /health, not the one the docs remember ────────────────

describe('the documented gateway smoke test matches the running gateway', () => {
  let anonymousBody = '';
  let server: http.Server | undefined;

  beforeAll(async () => {
    const entry = join(ROOT, 'bconnect-mcp-gateway', 'build', 'app.js');
    if (!existsSync(entry)) {throw new Error(`gateway not built: ${entry} — run the build first`);}
    const { createApp } = (await import(pathToFileURL(entry).href)) as {
      createApp: () => http.RequestListener;
    };
    server = http.createServer(createApp());
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const { port } = server.address() as { port: number };
    anonymousBody = await (await fetch(`http://127.0.0.1:${port}/health`)).text();
  }, 120_000);

  afterAll(() => server?.close());

  it('the unauthenticated probe answers something, so the comparison is real', () => {
    expect(anonymousBody).not.toBe('');
    expect(JSON.parse(anonymousBody)).toHaveProperty('status', 'ok');
  });

  it('no doc claims an unauthenticated /health returns more than it does', () => {
    // The shape every gateway doc uses:
    //     curl http://localhost:3001/health
    //     # → {"status":"ok"}
    // A curl carrying an Authorization header documents the authenticated form
    // and is a different claim, so it is excluded here.
    const real = JSON.parse(anonymousBody) as Record<string, unknown>;
    const extraKeys = ['servers', 'count'];

    let claimsSeen = 0;
    const bad: string[] = [];

    for (const rel of SHIPPING_DOCS) {
      const text = read(rel);
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!/\/health/.test(lines[i])) {continue;}
        if (/Authorization|Bearer/i.test(lines[i])) {continue;} // authenticated form
        // The claimed body is on this line (a table cell) or the next (a curl
        // comment). Take whichever names a JSON object.
        const scope = `${lines[i]}\n${lines[i + 1] ?? ''}`;
        const claim = scope.match(/\{"status"\s*:\s*"ok"[^}]*\}/);
        if (!claim) {continue;}
        claimsSeen++;
        for (const key of extraKeys) {
          if (claim[0].includes(`"${key}"`) && !(key in real)) {
            bad.push(`${rel}:${i + 1} claims ${claim[0]} — the real answer is ${anonymousBody}`);
          }
        }
      }
    }

    expect(claimsSeen, 'no documented /health response found — pattern is stale').toBeGreaterThan(0);
    expect(
      bad,
      `SEC-10 narrowed /health: an unauthenticated caller gets liveness only.\n  ` + bad.join('\n  ')
    ).toEqual([]);
  });
});

// ── Links, and the diagram that forgot a server ──────────────────────────────

describe('the docs point at things that exist', () => {
  it('every relative markdown link resolves on disk', () => {
    let linksSeen = 0;
    const broken: string[] = [];

    for (const rel of SHIPPING_DOCS) {
      const text = read(rel);
      const from = dirname(join(ROOT, rel));
      for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = m[1];
        if (/^(https?:|mailto:|#)/.test(target)) {continue;}
        linksSeen++;
        const path = resolve(from, target.split('#')[0]);
        if (!existsSync(path)) {
          const line = text.slice(0, m.index!).split('\n').length;
          broken.push(`${rel}:${line} → ${target}`);
        }
      }
    }

    expect(linksSeen, 'no relative links found — pattern is stale').toBeGreaterThan(0);
    expect(broken, `broken relative link(s):\n  ${broken.join('\n  ')}`).toEqual([]);
  });

  it("README's architecture diagram names every server the repo ships", () => {
    const text = read('README.md');
    const diagram = text.match(/```\r?\n(Any MCP client[\s\S]*?)```/);
    expect(diagram, 'architecture diagram not found — pattern is stale').not.toBeNull();
    const missing = SERVER_DIRS.filter((d) => !diagram![1].includes(d));
    expect(
      missing,
      `the diagram omits ${missing.length} of ${SERVER_DIRS.length} servers: ${missing.join(', ')}`
    ).toEqual([]);
  });
});

// ── The n8n cost table, measured rather than remembered ─────────────────────

describe("N8N.md's context-cost table matches the built catalogue", () => {
  const measured = new Map<string, { tools: number; bytes: number }>();

  async function measure(writesEnabled: boolean): Promise<Map<string, { tools: number; bytes: number }>> {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const prev = process.env.ALLOW_WRITE_OPERATIONS;
    process.env.ALLOW_WRITE_OPERATIONS = writesEnabled ? 'true' : '';
    try {
      const out = new Map<string, { tools: number; bytes: number }>();
      for (const dir of SERVER_DIRS) {
        const entry = join(ROOT, dir, 'build', 'index.js');
        if (!existsSync(entry)) {throw new Error(`not built: ${entry} — run the build first`);}
        const mod = await import(`${pathToFileURL(entry).href}?writes=${writesEnabled}`);
        const { server } = mod.createServer();
        const [ct, st] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: 'docs-probe', version: '1.0.0' }, { capabilities: {} });
        await Promise.all([server.connect(st), client.connect(ct)]);
        const { tools } = await client.listTools();
        out.set(dir.replace(/^bconnect-|-mcp$/g, ''), {
          tools: tools.length,
          bytes: Buffer.byteLength(JSON.stringify(tools), 'utf8'),
        });
        await client.close();
        await server.close();
      }
      return out;
    } finally {
      if (prev === undefined) {delete process.env.ALLOW_WRITE_OPERATIONS;}
      else {process.env.ALLOW_WRITE_OPERATIONS = prev;}
    }
  }

  let writes = new Map<string, { tools: number; bytes: number }>();

  beforeAll(async () => {
    for (const [k, v] of await measure(false)) {measured.set(k, v);}
    writes = await measure(true);
  }, 180_000);

  it('every row of the table matches a real tools/list', () => {
    const text = read('docs/N8N.md');

    // | `endpoints` + `software` | 21 | 19,948 | ~5,000 |
    // The domain column names one or more domains joined by "+"; the last row
    // carries ALLOW_WRITE_OPERATIONS and is measured in the open posture.
    const row = /^\|\s*(`?[a-z0-9]+`?(?:\s*\+\s*`?[a-z0-9]+`?)*|All \d+ domains)([^|]*)\|\s*(\d+)\s*\|\s*([\d,]+)\s*\|\s*~?([\d,]+)\s*\|/gm;

    let rowsSeen = 0;
    const bad: string[] = [];

    for (const m of text.matchAll(row)) {
      const [, domainCell, qualifier, toolsStr, bytesStr, tokensStr] = m;
      const open = /ALLOW_WRITE_OPERATIONS/.test(qualifier);
      const table = open ? writes : measured;

      // "All N domains" means every domain, whatever N is today. The literal
      // /All 13 domains/ was here until 2026-08-12 and went stale the moment a
      // fourteenth server shipped: the row stopped matching, so it was no
      // longer CHECKED, and the guard reported a stale pattern rather than
      // silently passing — which is the right failure, but the number never
      // belonged in the matcher. The row's own tool/byte counts are what this
      // test verifies; the count in its label is prose.
      const names = /All \d+ domains/.test(domainCell)
        ? [...table.keys()]
        : domainCell.split('+').map((s) => s.replace(/[`\s]/g, '')).filter(Boolean);

      const unknown = names.filter((n) => !table.has(n));
      if (unknown.length) {
        bad.push(`row "${domainCell.trim()}" names unknown domain(s): ${unknown.join(', ')}`);
        continue;
      }
      rowsSeen++;

      const tools = names.reduce((a, n) => a + table.get(n)!.tools, 0);
      const bytes = names.reduce((a, n) => a + table.get(n)!.bytes, 0);
      const claimedTools = Number(toolsStr);
      const claimedBytes = Number(bytesStr.replace(/,/g, ''));
      const claimedTokens = Number(tokensStr.replace(/,/g, ''));

      if (claimedTools !== tools) {
        bad.push(`row "${domainCell.trim()}": doc says ${claimedTools} tools, measured ${tools}`);
      }
      if (claimedBytes !== bytes) {
        bad.push(`row "${domainCell.trim()}": doc says ${claimedBytes} bytes, measured ${bytes}`);
      }
      // Tokens are bytes/4 rounded to the nearest 100 — an order of magnitude,
      // not a quote, but it must not be a different order of magnitude.
      const expectedTokens = Math.round(bytes / 4 / 100) * 100;
      if (Math.abs(claimedTokens - expectedTokens) > 100) {
        bad.push(
          `row "${domainCell.trim()}": doc says ~${claimedTokens} tokens, ` +
            `bytes/4 is ${Math.round(bytes / 4)}`
        );
      }
    }

    expect(rowsSeen, 'no cost-table rows matched — the row pattern is stale').toBeGreaterThanOrEqual(6);
    expect(
      bad,
      `docs/N8N.md's cost table is what a customer sizes their domain selection on.\n  ` +
        bad.join('\n  ') +
        `\nRe-measure with: node scripts/tool-inventory.mjs`
    ).toEqual([]);
  });
});

// ── Parity: the other targets get named too ─────────────────────────────────

describe('the client-facing docs are not written for one client', () => {
  // Every target hosts.json knows about, minus the two Claude ones. A doc that
  // tells a reader how to configure a client must not name only Claude.
  const OTHERS = ['VS Code', 'Cursor', 'Continue', 'LibreChat', 'n8n', 'Open WebUI'];

  it.each(['README.md', 'docs/INSTALLATION.md', 'docs/TROUBLESHOOTING.md'])(
    '%s names the non-Claude targets it claims to support',
    (rel) => {
      const text = read(rel);
      expect(text).toMatch(/Claude/); // the premise: this doc does discuss clients
      const missing = OTHERS.filter((name) => !text.includes(name));
      expect(
        missing,
        `${rel} names Claude but not ${missing.join(', ')} — the product supports eleven ` +
          `targets and Claude must not be the only one a reader can follow.`
      ).toEqual([]);
    }
  );
});
