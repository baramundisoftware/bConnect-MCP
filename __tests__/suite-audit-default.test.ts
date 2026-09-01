import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The shipped audit default must be what the documentation says it is.
 *
 * `CHANGELOG.md` and `SECURITY.md` both state that `BCONNECT_AUDIT_LEVEL` ships
 * as `write`, so an injected or abused write is attributable. That was true of
 * the fourteen per-server and template `.env.example` files and FALSE of the
 * three files that govern the gateway — the root `.env.example` shipped `none`,
 * `docker-compose.gateway.yml` defaulted to `none`, and `.env.gateway.example`
 * declared the variable nowhere at all.
 *
 * So the only component reachable over the network — the one whose callers are
 * not the local operator — was the one shipping unaudited, while two documents
 * said otherwise. It is the same reach failure this suite has now caught several
 * times: a correct change applied at fourteen sites and missed at the three that
 * mattered most. Nothing detected it because the claim lived in prose and the
 * value lived in config, and no test compared them.
 *
 * This rule compares them. It deliberately reads the SHIPPED files rather than
 * the parsed default in `client-provider.ts`: the code default is `none` on
 * purpose (an unset variable must not silently start writing audit records), and
 * that is not the thing that drifted. What ships to a deployer is.
 */

const ROOT = join(__dirname, '..');

/** `write` or stricter. `security` is excluded: it is narrower than `write`, not stronger. */
const ACCEPTABLE = new Set(['write', 'all']);

function declaredLevel(text: string): string | null {
  // Matches `BCONNECT_AUDIT_LEVEL=write` and the compose form
  // `BCONNECT_AUDIT_LEVEL: ${BCONNECT_AUDIT_LEVEL:-write}`.
  const assignment = text.match(/^\s*BCONNECT_AUDIT_LEVEL\s*=\s*([a-z]+)\s*$/m);
  if (assignment) {return assignment[1];}
  const compose = text.match(/^\s*BCONNECT_AUDIT_LEVEL\s*:\s*\$\{BCONNECT_AUDIT_LEVEL:-([a-z]*)\}/m);
  if (compose) {return compose[1] || null;}
  return null;
}

function envExampleFiles(): string[] {
  const found = [join(ROOT, '.env.example'), join(ROOT, '.env.gateway.example')];
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) {continue;}
    const candidate = join(ROOT, entry.name, '.env.example');
    if (existsSync(candidate)) {found.push(candidate);}
  }
  return found;
}

describe('the shipped audit default matches what the documentation claims', () => {
  it('every shipped .env.example declares an attributable level', () => {
    const offenders: string[] = [];
    for (const file of envExampleFiles()) {
      const level = declaredLevel(readFileSync(file, 'utf8'));
      if (level === null) {offenders.push(`${file.slice(ROOT.length + 1)}: declares no BCONNECT_AUDIT_LEVEL`);}
      else if (!ACCEPTABLE.has(level)) {offenders.push(`${file.slice(ROOT.length + 1)}: ships "${level}"`);}
    }
    expect(
      offenders,
      `CHANGELOG.md and SECURITY.md state the audit default ships as "write". These files disagree:\n  ${offenders.join('\n  ')}`
    ).toEqual([]);
  });

  it('the gateway compose file defaults to an attributable level', () => {
    const compose = join(ROOT, 'docker-compose.gateway.yml');
    const level = declaredLevel(readFileSync(compose, 'utf8'));
    expect(level, 'docker-compose.gateway.yml must default BCONNECT_AUDIT_LEVEL explicitly').not.toBeNull();
    expect(
      ACCEPTABLE.has(level as string),
      `docker-compose.gateway.yml defaults BCONNECT_AUDIT_LEVEL to "${level}". The gateway is the ` +
        `only network-listening component; an unattributable write there is the case the setting exists for.`
    ).toBe(true);
  });

  it('finds every .env.example rather than a hard-coded list', () => {
    // Guards the guard: a glob that silently matched nothing would pass the two
    // rules above vacuously, which is how the original defect survived.
    const files = envExampleFiles();
    expect(files.length).toBeGreaterThanOrEqual(16);
    expect(files.some((f) => f.endsWith('.env.gateway.example'))).toBe(true);
  });
});
