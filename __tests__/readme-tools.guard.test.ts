/**
 * README tools guard: each server's README lists exactly the tools the server
 * offers, and its tool count matches.
 *
 * The docs review (2026-10-03) found the groups README missing 6 of its 33
 * tools, endpoints and jobs missing 3 more, and wrong counts for 25R2 in three
 * READMEs. The tables are written by hand, so this compares them with the
 * server's own tool list, for each release:
 *
 * - the rows under "## Available Tools" name exactly the tools offered on 25R2, 26R1 or 26R2;
 * - rows marked **(26R1)** are exactly the tools missing on 25R2 (among 26R1's), **(25R2)**
 *   those missing on 26R1 (among 25R2's), **(26R2)** those new in 26R2, and **(up to 26R1)**
 *   those 26R1 has and 26R2 doesn't (since #159 a release lists only the tools whose routes it has);
 * - the `**Tools:**` line gives the 26R1 count, and the 26R2 and 25R2 counts where they differ.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, SERVERS, connect, guardEnv } from './lib/exerciser.js';
import type { Release } from './lib/spec.js';

const saved = { ...process.env };
afterAll(() => {
  process.env = saved;
});

async function toolNames(server: string, release: Release): Promise<string[]> {
  // Writes on: the README documents every tool, also those tools/list hides while writes are off (REQ-SRV-026).
  Object.assign(process.env, guardEnv(release, { writes: true, secretRead: false }));
  const connected = await connect(server);
  try {
    return connected.tools.map((t) => t.name).sort();
  } finally {
    await connected.close();
  }
}

const MARKS = { only26R1: '**(26R1)**', only25R2: '**(25R2)**', only26R2: '**(26R2)**', upTo26R1: '**(up to 26R1)**' } as const;
type Mark = keyof typeof MARKS;

/** The tool rows of the "## Available Tools" section: name and its release marks. */
function documentedTools(readme: string): Array<{ name: string } & Record<Mark, boolean>> {
  const start = readme.indexOf('## Available Tools');
  if (start < 0) {return [];}
  const end = readme.indexOf('\n## ', start + 1);
  const section = readme.slice(start, end < 0 ? undefined : end);
  return [...section.matchAll(/^\| `([a-z_0-9]+)` \|(.*)$/gm)].map((m) => ({
    name: m[1], ...Object.fromEntries(Object.entries(MARKS).map(([k, mark]) => [k, m[2].includes(mark)])) as Record<Mark, boolean>,
  }));
}

const count = (n: number): string => (n === 0 ? 'none' : String(n));

describe.each(SERVERS)('%s README', (server) => {
  const readme = readFileSync(join(ROOT, server, 'README.md'), 'utf8');

  it('lists exactly the tools the server offers, with the ones of some releases only marked', async () => {
    const on26 = await toolNames(server, '26R1');
    const on25 = await toolNames(server, '25R2');
    const onR2 = await toolNames(server, '26R2');
    const documented = documentedTools(readme);
    const marked = (mark: Mark) => documented.filter((t) => t[mark]).map((t) => t.name).sort();
    expect(documented.map((t) => t.name).sort()).toEqual([...new Set([...on26, ...on25, ...onR2])].sort());
    expect(marked('only26R1')).toEqual(on26.filter((t) => !on25.includes(t)));
    expect(marked('only25R2')).toEqual(on25.filter((t) => !on26.includes(t)));
    expect(marked('only26R2')).toEqual(onR2.filter((t) => !on26.includes(t)));
    expect(marked('upTo26R1')).toEqual(on26.filter((t) => !onR2.includes(t)));
  });

  it('gives the tool count for 26R1, and for 26R2 and 25R2 where they differ', async () => {
    const n26 = (await toolNames(server, '26R1')).length;
    const line = readme.match(/^\*\*Tools:\*\* (.*)$/m)?.[1] ?? '';
    expect(line.startsWith(`${n26}`)).toBe(true);
    for (const release of ['26R2', '25R2'] as const) {
      const n = (await toolNames(server, release)).length;
      if (n !== n26) {
        expect(line, release).toMatch(new RegExp(`[(;] ?${count(n)} on bMS ${release}[;)]`));
      } else {
        expect(line, release).not.toMatch(new RegExp(release));
      }
    }
  });
});

describe('root README server table', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  /** Rows: server, 26R2 count, 26R1 count, 25R2 cell. */
  const rows = [...readme.matchAll(/^\| `(bconnect-[a-z]+-mcp)` \| (\d+) \| (\d+) \| ([^|]+) \|/gm)]
    .map((m) => ({ server: m[1], nR2: Number(m[2]), n26: Number(m[3]), cell25: m[4].trim() }));
  const totals = readme.match(/^\| \*\*Total\*\* \| \*\*(\d+)\*\* \| \*\*(\d+)\*\* \| \*\*(\d+)\*\* \|/m);

  it('lists every server once', () => {
    expect(rows.map((r) => r.server).sort()).toEqual([...SERVERS].sort());
  });

  it('gives each server\'s tool counts for 26R2, 26R1 and 25R2, and the totals', async () => {
    let sumR2 = 0;
    let sum26 = 0;
    let sum25 = 0;
    for (const row of rows) {
      const nR2 = (await toolNames(row.server, '26R2')).length;
      const n26 = (await toolNames(row.server, '26R1')).length;
      const n25 = (await toolNames(row.server, '25R2')).length;
      expect(row.nR2, row.server).toBe(nR2);
      expect(row.n26, row.server).toBe(n26);
      sumR2 += nR2;
      // "—": the server needs 26R1 and offers no tool on 25R2.
      if (row.cell25 === '—') {
        expect(n25, row.server).toBe(0);
      } else {
        expect(Number(row.cell25), row.server).toBe(n25);
        sum25 += n25;
      }
      sum26 += n26;
    }
    expect(totals?.slice(1).map(Number)).toEqual([sumR2, sum26, sum25]);
  });
});
