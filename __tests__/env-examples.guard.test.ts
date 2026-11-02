/**
 * The per-server .env.example files agree (#340).
 *
 * Each names the write gate, off; a server with secret-read tools names that
 * gate too, off, and only such a server does. A server without write tools
 * says so. No example keeps the comment about #160 (the rate limit now
 * applies across a server's tool calls).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, SERVERS } from './lib/exerciser.js';

const EXAMPLES = [...SERVERS, 'bconnect-server-template'];
const example = (dir: string) => readFileSync(join(ROOT, dir, '.env.example'), 'utf8').replace(/\r\n/g, '\n');

/** Whether a server has write tools: a method other than GET in its tool-methods table. */
function hasWrites(server: string): boolean {
  return /['"](?:POST|PUT|PATCH|DELETE)['"]/.test(readFileSync(join(ROOT, server, 'src', 'tool-methods.ts'), 'utf8'));
}

/** Whether a server has secret-read tools (SECRET_READ_TOOLS in its index.ts). */
function hasSecretReads(server: string): boolean {
  return /\bSECRET_READ_TOOLS\b/.test(readFileSync(join(ROOT, server, 'src', 'index.ts'), 'utf8'));
}

describe('.env.example files', () => {
  it('there is one per server and one for the template', () => {
    expect(EXAMPLES.filter((dir) => !existsSync(join(ROOT, dir, '.env.example')))).toEqual([]);
    expect(EXAMPLES).toHaveLength(14);
  });

  it.each(EXAMPLES)('%s names the write gate, off', (dir) => {
    expect(example(dir)).toMatch(/^ALLOW_WRITE_OPERATIONS=false$/m);
  });

  it.each(SERVERS)('%s names the secret-read gate, off, exactly when it has secret-read tools', (server) => {
    expect(/^ALLOW_SECRET_READ=false$/m.test(example(server))).toBe(hasSecretReads(server));
  });

  it.each(SERVERS)('%s says it has no write tools exactly when it has none', (server) => {
    expect(example(server).includes('This server has no write tools')).toBe(!hasWrites(server));
  });

  it.each(EXAMPLES)('%s has no outdated rate-limit comment (#160)', (dir) => {
    expect(example(dir)).not.toMatch(/#160|doesn't apply across calls yet/);
  });

  it('the checks see what they check: some servers write, one reads secrets', () => {
    expect(SERVERS.filter(hasWrites).length).toBeGreaterThan(5);
    expect(SERVERS.filter(hasSecretReads)).toEqual(['bconnect-defensecontrol-mcp']);
  });
});
