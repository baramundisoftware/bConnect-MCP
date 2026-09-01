/**
 * Shortfall regression tests for preview_assignment.
 *
 * The input shape is not hypothetical — it was measured LIVE against
 * labcorp.local on 2026-08-12: the bConnect API intermittently answers
 * HTTP 200 with `data: []` while the envelope header stays intact
 * (`totalItems > 0`, real `totalPages`), and its `totalItems` can claim rows
 * the stream never serves (2,454 claimed vs 1,954 served, stable across
 * sweeps). `paginateAll` is totalItems-blind, so before the fix a membership
 * page in that state previewed as zero blast radius — `endpointsInReach: 0`,
 * `instancesExpected: 0`, `truncated: false` — and, with v1.1 safety metadata
 * available and a non-destructive job, the verdict rendered LOW RISK over a
 * group the server itself said has members. This module's own header states
 * why that is the worst place for the defect: the counts feed the
 * REFUSE / CONFIRM FIRST verdict on a write-enabled deployment.
 *
 * The controls matter as much as the defect tests: an empty 200 with
 * `totalItems: 0` really is "this group exists and has no members"
 * (verified live 2026-08-04), and the guard must stay quiet for it —
 * a preview that cries CONFIRM FIRST on every empty group trains operators
 * to ignore it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AxiosInstance } from 'axios';

import { previewAssignment } from '../modules/preview-assignment.js';
import { JobsV11Client } from '../modules/v11.js';

const JOB_ID = '11111111-2222-3333-4444-555555555555';
const STATIC_GROUP_ID = 'sg-target';
const LOGICAL_GROUP_ID = 'lg-target';

interface Envelope {
  data: Record<string, unknown>[];
  totalItems?: number;
  totalPages?: number;
}

/** A stub client serving fixed envelopes per route fragment. */
function stubClient(routes: Record<string, Envelope | Record<string, unknown>>): AxiosInstance {
  const get = vi.fn(async (url: string) => {
    for (const [frag, body] of Object.entries(routes)) {
      if (url.includes(frag)) {
        return { data: body };
      }
    }
    throw new Error(`unexpected request: ${url}`);
  });
  return { get, defaults: { baseURL: 'https://bms.example.com:443/bconnect' } } as unknown as AxiosInstance;
}

beforeEach(() => {
  // v1.1 AVAILABLE, answering a non-destructive job. This is the live
  // deployment's posture (both credential keys are set there), and it is what
  // makes these tests discriminate: with v1.1 unavailable, its own blocker
  // forces CONFIRM FIRST for an unrelated reason and the verdict assertion
  // proves nothing about the shortfall.
  vi.stubEnv('BCONNECT_ENABLE_V11', 'true');
  vi.stubEnv('BCONNECT_V11_USERNAME', 'svc@labcorp.local');
  vi.stubEnv('BCONNECT_V11_PASSWORD', 'not-a-real-password');
  vi.spyOn(JobsV11Client.prototype, 'transport').mockResolvedValue({
    status: 200,
    data: [{ Destructive: false, WindowsProperties: { JobStartType: 'PassiveStart' } }],
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('preview_assignment — an empty page with totalItems > 0 must not preview as zero blast radius', () => {
  it('static group: membership served 0 rows while the server said 5 exist → not LOW RISK, shortfall named', async () => {
    const client = stubClient({
      '/JobDefinitions/': { name: 'UPDATE: Microsoft Updates', folder: 'Ops', type: 'Job' },
      '/StaticGroups/': { data: [], totalItems: 5, totalPages: 1 },
    });

    const result = (await previewAssignment(client, {
      jobDefinitionId: JOB_ID,
      staticGroupId: STATIC_GROUP_ID,
    })) as {
      verdict: string;
      blockers: string[];
      meta: { estate: { members: Record<string, unknown> } };
    };

    // The verdict may not read as safe over a membership nobody saw.
    expect(result.verdict).not.toBe('LOW RISK');
    // A blocker must carry the disagreement itself: rows absorbed vs the
    // server's own count.
    expect(result.blockers.some((b) => /5/.test(b) && /0 row/.test(b))).toBe(true);
    // The envelope's own count must be reported next to what was read.
    expect(result.meta.estate.members.totalItems).toBe(5);
    expect(result.meta.estate.members.rowsExamined).toBe(0);
  });

  it('static group: a SHORT page (2 of 5) is the same defect and gets the same blocker', async () => {
    const client = stubClient({
      '/JobDefinitions/': { name: 'UPDATE: Microsoft Updates' },
      '/StaticGroups/': {
        data: [
          { displayName: 'EP-1', lastSeen: new Date().toISOString() },
          { displayName: 'EP-2', lastSeen: new Date().toISOString() },
        ],
        totalItems: 5,
        totalPages: 1,
      },
    });

    const result = (await previewAssignment(client, {
      jobDefinitionId: JOB_ID,
      staticGroupId: STATIC_GROUP_ID,
    })) as { verdict: string; blockers: string[] };

    expect(result.verdict).not.toBe('LOW RISK');
    expect(result.blockers.some((b) => /5/.test(b) && /2 row/.test(b))).toBe(true);
  });

  it('logical group: the estate endpoints read served 0 rows while the server said 26 exist → not LOW RISK', async () => {
    const client = stubClient({
      '/JobDefinitions/': { name: 'UPDATE: Microsoft Updates' },
      '/LogicalGroups': {
        data: [{ id: LOGICAL_GROUP_ID, name: 'Target', parentId: null }],
        totalItems: 1,
        totalPages: 1,
      },
      '/Endpoints': { data: [], totalItems: 26, totalPages: 1 },
    });

    const result = (await previewAssignment(client, {
      jobDefinitionId: JOB_ID,
      logicalGroupId: LOGICAL_GROUP_ID,
    })) as { verdict: string; blockers: string[]; meta: { estate: { endpoints: Record<string, unknown> } } };

    expect(result.verdict).not.toBe('LOW RISK');
    expect(result.blockers.some((b) => /26/.test(b) && /0 row/.test(b))).toBe(true);
    expect(result.meta.estate.endpoints.totalItems).toBe(26);
  });
});

describe('preview_assignment — the guard must stay QUIET on genuinely empty reads (controls)', () => {
  it('static group with totalItems 0 is an empty group, not a shortfall: LOW RISK, no blockers', async () => {
    const client = stubClient({
      '/JobDefinitions/': { name: 'UPDATE: Microsoft Updates' },
      '/StaticGroups/': { data: [], totalItems: 0, totalPages: 1 },
    });

    const result = (await previewAssignment(client, {
      jobDefinitionId: JOB_ID,
      staticGroupId: STATIC_GROUP_ID,
    })) as { verdict: string; blockers: string[] };

    expect(result.verdict).toBe('LOW RISK');
    expect(result.blockers).toEqual([]);
  });

  it('an envelope that omits totalItems asserts nothing (degenerate case unchanged)', async () => {
    const client = stubClient({
      '/JobDefinitions/': { name: 'UPDATE: Microsoft Updates' },
      '/StaticGroups/': { data: [], totalPages: 1 },
    });

    const result = (await previewAssignment(client, {
      jobDefinitionId: JOB_ID,
      staticGroupId: STATIC_GROUP_ID,
    })) as { verdict: string; blockers: string[] };

    expect(result.verdict).toBe('LOW RISK');
    expect(result.blockers).toEqual([]);
  });

  it('a membership walk that hit its PAGE CAP raises ONE blocker, not a doubled shortfall', async () => {
    // 40 declared pages of 2 rows each against the 20-page cap, totalItems
    // present: rows < totalItems is EXPECTED, and the shortfall guard must
    // stand down in favour of the existing cap blocker (adversarial review,
    // M1) — two blockers on one cause would prescribe a retry that cannot help.
    const get = vi.fn(async (url: string) => {
      if (url.includes('/JobDefinitions/')) { return { data: { name: 'UPDATE: Microsoft Updates' } }; }
      if (url.includes('/StaticGroups/')) {
        return { data: {
          data: [
            { displayName: 'EP-A', lastSeen: '2025-01-01T00:00:00Z' },
            { displayName: 'EP-B', lastSeen: '2025-01-01T00:00:00Z' },
          ],
          totalPages: 40,
          totalItems: 5000,
        } };
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const client = { get, defaults: { baseURL: 'https://bms.example.com:443/bconnect' } } as unknown as AxiosInstance;

    const result = (await previewAssignment(client, {
      jobDefinitionId: JOB_ID,
      staticGroupId: STATIC_GROUP_ID,
    })) as { verdict: string; blockers: string[] };

    expect(result.verdict).toBe('CONFIRM FIRST');
    const incompleteness = result.blockers.filter((b) => /INCOMPLETE/.test(b));
    expect(incompleteness).toHaveLength(1);
    expect(incompleteness[0]).toMatch(/page cap/);
  });

  it('logical group over an estate that genuinely has only in-scope rows stays LOW RISK', async () => {
    const client = stubClient({
      '/JobDefinitions/': { name: 'UPDATE: Microsoft Updates' },
      '/LogicalGroups': {
        data: [{ id: LOGICAL_GROUP_ID, name: 'Target', parentId: null }],
        totalItems: 1,
        totalPages: 1,
      },
      '/Endpoints': {
        data: [
          // Offline for 400 days: in reach, not online, no immediate execution.
          { displayName: 'EP-1', logicalGroupId: LOGICAL_GROUP_ID, lastSeen: '2025-07-01T00:00:00Z' },
        ],
        totalItems: 1,
        totalPages: 1,
      },
    });

    const result = (await previewAssignment(client, {
      jobDefinitionId: JOB_ID,
      logicalGroupId: LOGICAL_GROUP_ID,
    })) as { verdict: string; blockers: string[]; scope: { endpointsInReach: number } };

    expect(result.scope.endpointsInReach).toBe(1);
    expect(result.verdict).toBe('LOW RISK');
    expect(result.blockers).toEqual([]);
  });
});
