/**
 * Suite-wide assertions for R3, B11 and D21.
 *
 * All three findings are "every server does the same wrong thing" defects, and
 * all three survived because every test in this repo checks one server in
 * isolation:
 *
 *   R3  — `getBconnect()` was declared *inside* the `CallToolRequestSchema`
 *         handler in 13 of 13 servers, so the client (and everything stateful
 *         it owned) was rebuilt on every tool call.
 *   B11 — `config.cache` was passed by 0 of 13 servers, `config.rateLimit` by
 *         4 of 13, `config.batch` by 0 of 13. Three built, unit-tested,
 *         documented subsystems that no deployment could reach.
 *   D21 — 251 call sites serialised results with `JSON.stringify(x, null, 2)`.
 *
 * A per-server test cannot catch "12 of 13 were fixed". This file can, and is
 * the reason a future server added from the template cannot quietly regress:
 * the template is checked alongside the servers.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveClientConfig } from '@bconnect/mcp-core';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SERVER_DIRS = fs
  .readdirSync(REPO_ROOT)
  .filter((d) => /^bconnect-.*-mcp$/.test(d) || d === 'bconnect-server-template')
  .filter((d) => fs.existsSync(path.join(REPO_ROOT, d, 'src', 'index.ts')))
  .sort();

const sources = new Map<string, string>(
  SERVER_DIRS.map((d) => [d, fs.readFileSync(path.join(REPO_ROOT, d, 'src', 'index.ts'), 'utf8')])
);

describe('suite shape', () => {
  it('finds the 14 servers plus the template', () => {
    // 13 domain servers + bconnect-insights-mcp (the cross-module composite
    // server, 2026-08-12) + the template. The count is pinned rather than
    // derived so that ADDING a server is a deliberate edit here: this file
    // drives per-server assertions with it.each, and a silently-growing list
    // would let a new server join the suite without anyone confirming it obeys
    // the client-lifetime rules below.
    expect(SERVER_DIRS).toHaveLength(15);
    expect(SERVER_DIRS).toContain('bconnect-server-template');
    expect(SERVER_DIRS).toContain('bconnect-insights-mcp');
  });
});

describe('R3 — the client outlives a single tool call', () => {
  it.each(SERVER_DIRS)('%s builds its client through createClientProvider', (dir) => {
    expect(sources.get(dir)).toContain('createClientProvider<BConnectClient>(');
  });

  it.each(SERVER_DIRS)('%s creates the provider outside the tool-call handler', (dir) => {
    const src = sources.get(dir)!;
    const provider = src.indexOf('createClientProvider<BConnectClient>(');
    const handler = src.indexOf('server.setRequestHandler(CallToolRequestSchema');
    expect(provider).toBeGreaterThan(-1);
    expect(handler).toBeGreaterThan(-1);
    // One scope out. This ordering IS the fix — the original comment already
    // said "lazy-initialize client on first tool call"; the closure was simply
    // nested one level too deep.
    expect(provider).toBeLessThan(handler);
  });

  it.each(SERVER_DIRS)('%s constructs no client inside the tool-call handler', (dir) => {
    const src = sources.get(dir)!;
    const handler = src.indexOf('server.setRequestHandler(CallToolRequestSchema');
    const afterHandler = src.slice(handler);
    // `main()` legitimately builds a startup client, but it lives after the
    // handler in these files, so restrict to the handler body itself.
    const handlerBody = afterHandler.slice(0, afterHandler.indexOf('\n  });'));
    expect(handlerBody).not.toContain('new BConnectClient(');
  });
});

describe('B11 — every subsystem is reachable from configuration', () => {
  const withEnv = (env: Record<string, string>, fn: () => void) => {
    const saved: Record<string, string | undefined> = {};
    for (const k of Object.keys(env)) {
      saved[k] = process.env[k];
      process.env[k] = env[k];
    }
    try {
      fn();
    } finally {
      for (const k of Object.keys(env)) {
        if (saved[k] === undefined) { delete process.env[k]; } else { process.env[k] = saved[k]; }
      }
    }
  };

  const base = {
    credentials: { baseUrl: 'https://bms.test.local/bconnect', apiKey: 'k' },
    factory: (c: unknown) => c,
    onMissingCredentials: (): never => { throw new Error('unreachable'); },
  };

  it('constructs no subsystem by default', () => {
    const cfg = resolveClientConfig(base);
    expect(cfg.cache).toBeUndefined();
    expect(cfg.rateLimit).toBeUndefined();
    expect(cfg.batch).toBeUndefined();
    expect(cfg.auditLog?.level).toBe('none');
  });

  it('constructs the response cache from BCONNECT_CACHE_*', () => {
    withEnv(
      { BCONNECT_CACHE_ENABLED: 'true', BCONNECT_CACHE_TTL_MS: '1234', BCONNECT_CACHE_MAX_SIZE: '7' },
      () => {
        const cfg = resolveClientConfig(base);
        expect(cfg.cache).toEqual({ enabled: true, maxSize: 7, ttl: 1234, getOnly: true });
      }
    );
  });

  it('constructs the rate limiter from BCONNECT_RATE_LIMIT_*', () => {
    withEnv(
      {
        BCONNECT_RATE_LIMIT_ENABLED: 'true',
        BCONNECT_RATE_LIMIT_MAX_REQUESTS: '5',
        BCONNECT_RATE_LIMIT_WINDOW_MS: '1000',
      },
      () => {
        const cfg = resolveClientConfig(base);
        expect(cfg.rateLimit).toEqual({ enabled: true, maxRequests: 5, windowMs: 1000 });
      }
    );
  });

  it('constructs batch operations from BCONNECT_BATCH_*', () => {
    withEnv({ BCONNECT_BATCH_ENABLED: 'true', BCONNECT_BATCH_CONCURRENCY: '3' }, () => {
      const cfg = resolveClientConfig(base);
      expect(cfg.batch).toMatchObject({ concurrency: 3, stopOnError: false });
    });
  });

  it('carries the audit file destination from BCONNECT_AUDIT_FILE (B5)', () => {
    withEnv({ BCONNECT_AUDIT_LEVEL: 'all', BCONNECT_AUDIT_FILE: 'C:/tmp/audit.jsonl' }, () => {
      const cfg = resolveClientConfig(base);
      expect(cfg.auditLog).toMatchObject({ level: 'all', logFile: 'C:/tmp/audit.jsonl' });
    });
  });

  it('ignores an unrecognised audit level rather than passing it through', () => {
    withEnv({ BCONNECT_AUDIT_LEVEL: 'verbose' }, () => {
      expect(resolveClientConfig(base).auditLog?.level).toBe('none');
    });
  });

  it('rejects a non-numeric limit instead of producing NaN', () => {
    withEnv(
      { BCONNECT_RATE_LIMIT_ENABLED: 'true', BCONNECT_RATE_LIMIT_MAX_REQUESTS: 'lots' },
      () => {
        expect(resolveClientConfig(base).rateLimit?.maxRequests).toBe(100);
      }
    );
  });
});

describe('D21 — no server pretty-prints its tool results', () => {
  it.each(SERVER_DIRS)('%s routes serialisation through serializeToolResult', (dir) => {
    const src = sources.get(dir)!;
    expect(src).not.toMatch(/JSON\.stringify\(.+, null, 2\)/);
    // Every server returns tool content, so every server must use the helper.
    expect(src).toContain('serializeToolResult(');
  });
});
