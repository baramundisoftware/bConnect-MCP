import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What `.env.example` recommends must be survivable by the suite's own tools.
 *
 * These files are the one artefact every deployer opens and edits, and they used
 * to recommend `BCONNECT_RATE_LIMIT_MAX_REQUESTS=100` "in production". The
 * limiter is a per-process token bucket with no queue and no backoff — it THROWS
 * on exhaustion, `BCONNECT_MAX_RETRIES` defaults to 0 — and it counts HTTP
 * requests, not tool calls. One cold `get_unpatched_endpoints` walks the CVE
 * library, the detections, the endpoints and the job history inside a single
 * call. On a 26-endpoint estate that is tens of requests and 100 never bites,
 * which is why nobody noticed; on a real one it dies mid-walk, and a security
 * tool that dies mid-walk reports fewer findings than the estate has.
 *
 * So the shipped ceiling is derived from the code rather than chosen: it must be
 * at least the sum of the page bounds that one composite call can reach. Reading
 * those bounds out of the modules is the point — if someone raises a ceiling,
 * this fails and the shipped guidance is raised with it, instead of the two
 * numbers drifting apart in silence the way they did before.
 */

const ROOT = join(__dirname, '..');

/**
 * The four page bounds a single cold `get_unpatched_endpoints` traverses:
 * `unpatched.ts` walks endpoints, calls `analyzeExposure` (CVE library +
 * detections) and `getScanRecency` (job history).
 */
const COMPOSITE_CEILINGS: ReadonlyArray<readonly [string, string]> = [
  ['bconnect-compliance-mcp/src/modules/exposure.ts', 'MAX_LIBRARY_PAGES'],
  ['bconnect-compliance-mcp/src/modules/exposure.ts', 'MAX_DETECTION_PAGES'],
  ['bconnect-compliance-mcp/src/modules/unpatched.ts', 'MAX_ENDPOINT_PAGES'],
  ['bconnect-compliance-mcp/src/modules/scan-recency.ts', 'MAX_HISTORY_PAGES'],
];

function constantValue(relPath: string, name: string): number {
  const text = readFileSync(join(ROOT, relPath), 'utf8');
  const match = text.match(new RegExp(`^const ${name}\\s*=\\s*([0-9_]+)`, 'm'));
  if (!match) {
    throw new Error(
      `${relPath} no longer declares ${name}. The shipped rate-limit ceiling is derived from it — ` +
        `update COMPOSITE_CEILINGS and the .env.example files together, not one of them.`
    );
  }
  return Number.parseInt(match[1].replace(/_/g, ''), 10);
}

function coldWalkCeiling(): number {
  return COMPOSITE_CEILINGS.reduce((sum, [file, name]) => sum + constantValue(file, name), 0);
}

function envExampleFiles(): string[] {
  const found = [join(ROOT, '.env.example')];
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) {continue;}
    const candidate = join(ROOT, entry.name, '.env.example');
    if (existsSync(candidate)) {found.push(candidate);}
  }
  return found;
}

function declaredMaxRequests(text: string): number | null {
  const match = text.match(/^\s*BCONNECT_RATE_LIMIT_MAX_REQUESTS\s*=\s*(\d+)\s*$/m);
  return match ? Number.parseInt(match[1], 10) : null;
}

describe('the shipped rate-limit guidance survives the suite\'s own composite tools', () => {
  it('every .env.example ships a ceiling at least as large as one cold composite walk', () => {
    const ceiling = coldWalkCeiling();
    const offenders: string[] = [];
    for (const file of envExampleFiles()) {
      const declared = declaredMaxRequests(readFileSync(file, 'utf8'));
      if (declared === null) {
        offenders.push(`${file.slice(ROOT.length + 1)}: declares no BCONNECT_RATE_LIMIT_MAX_REQUESTS`);
      } else if (declared < ceiling) {
        offenders.push(`${file.slice(ROOT.length + 1)}: ships ${declared}, below the ${ceiling}-request cold walk`);
      }
    }
    expect(
      offenders,
      `One cold get_unpatched_endpoints can issue ${ceiling} requests. A shipped ceiling below that ` +
        `throttles the product against itself, mid-walk, with no retry:\n  ${offenders.join('\n  ')}`
    ).toEqual([]);
  });

  it('the wall-clock alternative the guidance points at still exists', () => {
    // `.env.example` tells the reader to prefer BCONNECT_COMPOSITE_BUDGET_MS,
    // which degrades to a labelled partial answer instead of an exception.
    const budgetHosts = ['bconnect-compliance-mcp', 'bconnect-defensecontrol-mcp']
      .map((s) => join(ROOT, s, 'src/modules/time-budget.ts'))
      .filter((p) => existsSync(p));
    expect(budgetHosts.length, 'no server implements a composite time budget any more').toBeGreaterThan(0);
    for (const file of budgetHosts) {
      expect(readFileSync(file, 'utf8')).toContain('BCONNECT_COMPOSITE_BUDGET_MS');
    }
  });
});

describe('.env.example is client-neutral and platform-honest', () => {
  it('no .env.example names one MCP client as the transport default', () => {
    // The product is driven from whatever client the customer standardised on.
    // "stdio (default, for Claude Desktop / Claude Code)" told fourteen files'
    // worth of readers otherwise.
    const offenders: string[] = [];
    for (const file of [...envExampleFiles(), join(ROOT, '.env.gateway.example')]) {
      if (/claude/i.test(readFileSync(file, 'utf8'))) {
        offenders.push(file.slice(ROOT.length + 1));
      }
    }
    expect(offenders, `these .env.example files privilege one MCP client:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });

  it('every path example that shows a POSIX path shows a Windows one too', () => {
    // bMS is a Windows Server product and the primary documented install is a
    // PowerShell installer; `/var/log/...` as the only audit-trail example is a
    // path a Windows administrator cannot use.
    const offenders: string[] = [];
    for (const file of envExampleFiles()) {
      const text = readFileSync(file, 'utf8');
      const posix = /=\s*\/(etc|var)\//.test(text);
      const windows = /=\s*[A-Z]:\\/.test(text);
      if (posix && !windows) {offenders.push(file.slice(ROOT.length + 1));}
    }
    expect(
      offenders,
      `these files give POSIX-only example paths:\n  ${offenders.join('\n  ')}`
    ).toEqual([]);
  });

  it('finds every .env.example rather than a hard-coded subset', () => {
    expect(envExampleFiles().length).toBeGreaterThanOrEqual(15);
  });
});
