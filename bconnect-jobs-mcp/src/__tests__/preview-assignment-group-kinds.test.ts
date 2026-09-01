/**
 * `preview_assignment` covers all four group kinds.
 *
 * ── The gap this closes ─────────────────────────────────────────────────────
 * The preview accepted `logicalGroupId` only, so three of the four
 * `assign_job_to_*` tools had no preview at all — including the two whose
 * membership is computed server-side. The destructive gate
 * (`ALLOW_DESTRUCTIVE_JOB_ASSIGNMENT`) covered the worst case; everything short
 * of a wipe step was assignable with no way to ask what it would touch.
 *
 * ── The two things most likely to be wrong ──────────────────────────────────
 * 1. A 404 read as zero reach. There is no GET-by-id route for static, dynamic
 *    or universal dynamic groups, so a bad id cannot be checked in advance.
 *    Verified live 2026-08-04: bConnect answers a nonexistent group with 404
 *    and the title "Object [<id>] not found or not visible due to missing
 *    rights.", so missing IS distinguishable from empty — and this file pins
 *    that a 404 raises rather than rendering LOW RISK on 0 endpoints.
 * 2. "0 descendants" read as "no cascade". For these kinds it is a fact about
 *    the kind, not an unmeasured default, and the response has to say which.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { AxiosInstance } from 'axios';
import { previewAssignment } from '../modules/preview-assignment.js';

const JOB = 'a0000001-0001-0001-0001-000000000001';
const GROUP = 'b0000002-0002-0002-0002-000000000002';

const JOB_DEF = { name: 'Deploy Reader', folder: 'Software', type: 'Standard' };

function endpoint(name: string, daysAgo: number): Record<string, unknown> {
  return {
    displayName: name,
    lastSeen: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    isDeactivated: false,
  };
}

/** A client that answers the job-definition read and one membership route. */
function client(members: Record<string, unknown>[], opts: { memberStatus?: number } = {}): AxiosInstance {
  return {
    get: async (url: string) => {
      if (url.includes('/JobDefinitions/')) { return { data: JOB_DEF }; }
      if (opts.memberStatus === 404) {
        const err = new Error('Resource not found.') as Error & { status: number };
        err.status = 404;
        throw err;
      }
      return { data: { data: members, totalPages: 1 } };
    },
    defaults: { baseURL: 'https://bms/bconnect' },
  } as unknown as AxiosInstance;
}

afterEach(() => { vi.unstubAllEnvs(); });

describe('preview_assignment — choosing the target', () => {
  it('refuses when no group id is given, rather than guessing', async () => {
    await expect(previewAssignment(client([]), { jobDefinitionId: JOB }))
      .rejects.toThrow(/exactly one group id/i);
  });

  it('refuses when two group ids are given', async () => {
    await expect(
      previewAssignment(client([]), {
        jobDefinitionId: JOB, staticGroupId: GROUP, dynamicGroupId: GROUP,
      })
    ).rejects.toThrow(/exactly one/i);
  });
});

describe('preview_assignment — non-nesting kinds', () => {
  it('reads a static group\'s reach from its own membership route', async () => {
    const out = await previewAssignment(
      client([endpoint('WORKSTATION1', 1), endpoint('WIN10CLIENT9', 400)]),
      { jobDefinitionId: JOB, staticGroupId: GROUP }
    );

    const scope = out.scope as Record<string, unknown>;
    expect(scope.endpointsInReach).toBe(2);
    expect(scope.endpointsOnlineNow).toBe(1);
    expect((out.query as Record<string, unknown>).groupKind).toBe('static');
    expect((out.query as Record<string, unknown>).staticGroupId).toBe(GROUP);
  });

  it('says 0 descendants is a property of the kind, not a measurement', async () => {
    const out = await previewAssignment(client([endpoint('WORKSTATION1', 1)]), {
      jobDefinitionId: JOB, staticGroupId: GROUP,
    });
    const meta = out.meta as Record<string, unknown>;
    expect((out.scope as Record<string, unknown>).descendantGroups).toBe(0);
    expect(String(meta.scopeModel)).toMatch(/HAS no descendants — not because none were found/);
  });

  it('a 404 raises and is never reported as zero reach', async () => {
    // The whole point. Rendering LOW RISK / 0 endpoints for a group that does
    // not exist would be an authoritative-looking green light on an
    // un-previewed assignment.
    await expect(
      previewAssignment(client([], { memberStatus: 404 }), {
        jobDefinitionId: JOB, dynamicGroupId: GROUP,
      })
    ).rejects.toThrow(/not found \(HTTP 404\)[\s\S]*not "no endpoints"/);
  });

  it('the 404 message names the wrong-kind-id trap', async () => {
    await expect(
      previewAssignment(client([], { memberStatus: 404 }), {
        jobDefinitionId: JOB, universalDynamicGroupId: GROUP,
      })
    ).rejects.toThrow(/different group kind/i);
  });

  it('an empty group is a real zero, and stays LOW RISK', async () => {
    // The other side of the same coin: an empty 200 genuinely means "exists,
    // no members", so it must NOT be degraded into an error or a warning.
    const out = await previewAssignment(client([]), { jobDefinitionId: JOB, staticGroupId: GROUP });
    expect((out.scope as Record<string, unknown>).endpointsInReach).toBe(0);
    expect(out.verdict).toBe('CONFIRM FIRST'); // safety metadata is unavailable in this harness
    expect((out.blockers as string[]).join(' ')).not.toMatch(/404|not found/i);
  });
});

describe('preview_assignment — computed membership is a snapshot', () => {
  it('warns for a dynamic group that the set can move on its own', async () => {
    const out = await previewAssignment(client([endpoint('WORKSTATION1', 1)]), {
      jobDefinitionId: JOB, dynamicGroupId: GROUP,
    });
    expect((out.blockers as string[]).join(' ')).toMatch(/SNAPSHOT/);
    expect(String((out.meta as Record<string, unknown>).note)).toMatch(/server-computed/);
  });

  it('does NOT warn for a static group, whose membership is stored', async () => {
    const out = await previewAssignment(client([endpoint('WORKSTATION1', 1)]), {
      jobDefinitionId: JOB, staticGroupId: GROUP,
    });
    expect((out.blockers as string[]).join(' ')).not.toMatch(/SNAPSHOT/);
  });
});

describe('preview_assignment — safety reporting is shared with the logical path', () => {
  it('never presents an unreadable job as safe', async () => {
    // v1.1 credentials absent in this harness, so destructive is null — which
    // must surface as a blocker, not as "not destructive".
    const out = await previewAssignment(client([endpoint('WORKSTATION1', 1)]), {
      jobDefinitionId: JOB, staticGroupId: GROUP,
    });
    expect((out.job as Record<string, unknown>).destructive).toBeNull();
    expect((out.blockers as string[]).join(' ')).toMatch(/safety metadata unavailable/);
    expect(out.verdict).not.toBe('LOW RISK');
  });
});
