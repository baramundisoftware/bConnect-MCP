/**
 * A model cannot be talked into an unattended wipe.
 *
 * ── The path this closes ────────────────────────────────────────────────────
 * `preview_assignment` computes a "REFUSE" verdict for a job the bMS flags
 * `Destructive` — a job carrying a wipe or OS-deployment step. That verdict was
 * ADVISORY ONLY: nothing checked it before an assignment ran. And
 * `preview_assignment` accepted only a `logicalGroupId`, so the two
 * dynamic-group assignment tools had no preview at all — while dynamic-group
 * membership is computed server-side, meaning the set of machines affected is
 * not enumerable before the call.
 *
 * So the worst concrete outcome was: text an attacker planted in an estate
 * string (an endpoint name, a job's failure message) leads a model to
 * `assign_job_to_dynamic_group` with a destructive job against a broad group;
 * every matching endpoint creates an instance and executes it at next
 * check-in. No preview, no check, no confirmation.
 *
 * The gate is deliberately INSIDE the write gate rather than replacing it: a
 * deployer who has accepted `ALLOW_WRITE_OPERATIONS` has not thereby accepted
 * unattended wipes, and the opt-out is an environment variable an operator
 * sets on the server — not an argument a model can pass.
 *
 * ── The limit, stated rather than hidden ────────────────────────────────────
 * `Destructive` lives in bConnect v1.1 only. Where v1.1 is unconfigured or
 * unreachable, `isDestructiveJob` returns `null` and the assignment PROCEEDS —
 * refusing every assignment whenever v1.1 is absent would make the suite
 * unusable in the majority deployment. That is a real gap and it is asserted
 * here so it stays a decision rather than becoming a surprise.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  destructiveAssignmentAllowed,
  destructiveRefusalMessage,
  ALLOW_DESTRUCTIVE_ENV,
  isDestructiveJob,
} from '../bconnect-jobs-mcp/src/modules/v11.js';

const GUID = 'd0000001-0001-0001-0001-000000000001';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the destructive-assignment gate', () => {
  it('is shut by default', () => {
    expect(destructiveAssignmentAllowed({})).toBe(false);
    expect(destructiveAssignmentAllowed({ [ALLOW_DESTRUCTIVE_ENV]: 'false' })).toBe(false);
    // Not "truthy" — exactly "true", like every other gate in the suite.
    expect(destructiveAssignmentAllowed({ [ALLOW_DESTRUCTIVE_ENV]: '1' })).toBe(false);
    expect(destructiveAssignmentAllowed({ [ALLOW_DESTRUCTIVE_ENV]: 'yes' })).toBe(false);
  });

  it('opens only on the exact opt-in', () => {
    expect(destructiveAssignmentAllowed({ [ALLOW_DESTRUCTIVE_ENV]: 'true' })).toBe(true);
  });

  it('the refusal tells an operator what to do, and does not tell a model it can self-grant', () => {
    const message = destructiveRefusalMessage('assign_job_to_dynamic_group', GUID);
    expect(message).toContain('Destructive');
    // Names the specific reason a dynamic group is worse.
    expect(message).toContain('computed server-side');
    expect(message).toContain('preview_assignment');
    // The opt-out is an operator action on the server, not an argument.
    expect(message).toContain('an operator (not a model)');
    expect(message).toContain(ALLOW_DESTRUCTIVE_ENV);
  });

  it('reports UNKNOWN rather than false when v1.1 cannot answer', async () => {
    // The stated limit. `null` is not `true`, so the assignment proceeds — and
    // that is the decision, recorded here so it cannot drift into a silent
    // `false` that reads as "checked, and it is safe".
    vi.stubEnv('BCONNECT_V11_USERNAME', '');
    vi.stubEnv('BCONNECT_V11_PASSWORD', '');
    const client = { defaults: { baseURL: 'https://bms/bconnect' } } as never;
    const check = await isDestructiveJob(client, GUID);
    expect(check.destructive).toBeNull();
    // The unreadable state must also say WHY, so the caller's note can name it.
    expect(check.reason).toBeTruthy();
  });
});

describe('the four assignment tools are all gated, and only those', () => {
  it('the gate covers every group-assignment tool', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, '..', 'bconnect-jobs-mcp/src/index.ts'), 'utf8');

    const declared = src.match(/const ASSIGNMENT_TOOLS = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? '';
    for (const tool of [
      'assign_job_to_logical_group',
      'assign_job_to_static_group',
      'assign_job_to_dynamic_group',
      'assign_job_to_universal_dynamic_group',
    ]) {
      expect(declared, `${tool} is not in ASSIGNMENT_TOOLS`).toContain(tool);
    }

    // Pre-dispatch, with the other policy gates. An `await` inside a case arm
    // is read by readToolDispatch as that tool's module method, which silently
    // unmapped all four tools from their routes when this was first written.
    const gateAt = src.indexOf('ASSIGNMENT_TOOLS.has(name)');
    const switchAt = src.indexOf('switch (name) {');
    expect(gateAt).toBeGreaterThan(0);
    expect(gateAt, 'the destructive gate must run before dispatch').toBeLessThan(switchAt);
  });
});
