/**
 * README tools guard: each server's README lists exactly the tools the server
 * offers, and its tool count matches.
 *
 * The docs review (2026-10-03) found the groups README missing 6 of its 33
 * tools, endpoints and jobs missing 3 more, and wrong counts for 25R2 in three
 * READMEs. The tables are written by hand, so this compares them with the
 * server's own tool list, for each release:
 *
 * - the rows under "## Available Tools" name exactly the tools offered on 26R1 or 25R2;
 * - rows marked **(26R1)** are exactly the tools missing on 25R2, rows marked
 *   **(25R2)** exactly those missing on 26R1 (since #159 a release lists only the
 *   tools whose routes it has);
 * - the `**Tools:**` line gives the 26R1 count, and the 25R2 count when it differs.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, SERVERS, connect, guardEnv } from './lib/exerciser.js';

const saved = { ...process.env };
afterAll(() => {
  process.env = saved;
});

async function toolNames(server: string, release: '26R1' | '25R2'): Promise<string[]> {
  // Writes on: the README documents every tool, also those tools/list hides while writes are off (REQ-SRV-026).
  Object.assign(process.env, guardEnv(release, { writes: true, secretRead: false }));
  const connected = await connect(server);
  try {
    return connected.tools.map((t) => t.name).sort();
  } finally {
    await connected.close();
  }
}

/** The tool rows of the "## Available Tools" section: name and whether it is marked (26R1) or (25R2). */
function documentedTools(readme: string): Array<{ name: string; only26R1: boolean; only25R2: boolean }> {
  const start = readme.indexOf('## Available Tools');
  if (start < 0) return [];
  const end = readme.indexOf('\n## ', start + 1);
  const section = readme.slice(start, end < 0 ? undefined : end);
  return [...section.matchAll(/^\| `([a-z_0-9]+)` \|(.*)$/gm)].map((m) => ({ name: m[1], only26R1: m[2].includes('**(26R1)**'), only25R2: m[2].includes('**(25R2)**') }));
}

describe.each(SERVERS)('%s README', (server) => {
  const readme = readFileSync(join(ROOT, server, 'README.md'), 'utf8');

  it('lists exactly the tools the server offers, with the ones of one release only marked', async () => {
    const on26 = await toolNames(server, '26R1');
    const on25 = await toolNames(server, '25R2');
    const documented = documentedTools(readme);
    expect(documented.map((t) => t.name).sort()).toEqual([...new Set([...on26, ...on25])].sort());
    expect(documented.filter((t) => t.only26R1).map((t) => t.name).sort()).toEqual(on26.filter((t) => !on25.includes(t)));
    expect(documented.filter((t) => t.only25R2).map((t) => t.name).sort()).toEqual(on25.filter((t) => !on26.includes(t)));
  });

  it('gives the tool count for 26R1, and for 25R2 where it differs', async () => {
    const n26 = (await toolNames(server, '26R1')).length;
    const n25 = (await toolNames(server, '25R2')).length;
    const line = readme.match(/^\*\*Tools:\*\* (.*)$/m)?.[1] ?? '';
    expect(line.startsWith(`${n26}`)).toBe(true);
    if (n25 !== n26) {
      expect(line).toContain(`(${n25 === 0 ? 'none' : n25} on bMS 25R2)`);
    } else {
      expect(line).not.toMatch(/25R2/);
    }
  });
});

describe('root README server table', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  /** Rows: server, 26R1 count, 25R2 cell. */
  const rows = [...readme.matchAll(/^\| `(bconnect-[a-z]+-mcp)` \| (\d+) \| ([^|]+) \|/gm)]
    .map((m) => ({ server: m[1], n26: Number(m[2]), cell25: m[3].trim() }));
  const totals = readme.match(/^\| \*\*Total\*\* \| \*\*(\d+)\*\* \| \*\*(\d+)\*\* \|/m);

  it('lists every server once', () => {
    expect(rows.map((r) => r.server).sort()).toEqual([...SERVERS].sort());
  });

  it('gives each server\'s tool counts for 26R1 and 25R2, and the totals', async () => {
    let sum26 = 0;
    let sum25 = 0;
    for (const row of rows) {
      const n26 = (await toolNames(row.server, '26R1')).length;
      const n25 = (await toolNames(row.server, '25R2')).length;
      expect(row.n26, row.server).toBe(n26);
      // "—": the server needs 26R1 and offers no tool on 25R2.
      if (row.cell25 === '—') {
        expect(n25, row.server).toBe(0);
      } else {
        expect(Number(row.cell25), row.server).toBe(n25);
        sum25 += n25;
      }
      sum26 += n26;
    }
    expect(totals?.slice(1).map(Number)).toEqual([sum26, sum25]);
  });
});
