/**
 * `preview_assignment` — every bounded walk is ordered, and says so.
 *
 * The three reads behind this preview (`/LogicalGroups`, `/Endpoints`, and the
 * `/{Kind}/{id}/Endpoints` membership route) are all page-capped. Capped over an
 * UNORDERED collection, each returns an arbitrary subset that differs between
 * runs — and `endpointsInReach` is what decides the verdict, so the same preview
 * of the same job can read CONFIRM FIRST once and LOW RISK the next time with
 * nothing changed in the estate. That is not a cosmetic defect: this tool exists
 * to be the thing a human trusts before a job executes.
 *
 * The orders are the ones each route documents for `OrderBy` — `Name` on
 * `/v2.0/LogicalGroups`, `DisplayName` on `/v2.0/Endpoints` and on every
 * membership route — so an unknown-property HTTP 400 is not on the table.
 *
 * These assert the parameter reaches the wire on EVERY page, not just page 0:
 * a walk that orders its first request and then forgets has exactly the defect
 * the ordering was added to remove.
 */

import { describe, it, expect } from 'vitest';
import type { AxiosInstance } from 'axios';
import { previewAssignment } from '../modules/preview-assignment.js';

const JOB = 'a0000001-0001-0001-0001-000000000001';
const GROUP = 'b0000002-0002-0002-0002-000000000002';
const JOB_DEF = { name: 'Deploy Reader', folder: 'Software', type: 'Standard' };

interface Call { url: string; params: Record<string, unknown> }

function endpoint(name: string): Record<string, unknown> {
  return { displayName: name, logicalGroupId: GROUP, lastSeen: new Date().toISOString() };
}

/**
 * Records every GET. `totalPages: 2` on the collection routes forces a second
 * page so the per-page assertion has something to bite on.
 */
function recordingClient(): { client: AxiosInstance; calls: Call[] } {
  const calls: Call[] = [];
  const client = {
    get: async (url: string, config?: { params?: Record<string, unknown> }) => {
      calls.push({ url, params: config?.params ?? {} });
      if (url.includes('/JobDefinitions/')) {return { data: JOB_DEF };}
      if (url.endsWith('/LogicalGroups')) {
        return { data: { data: [{ id: GROUP, name: 'Clients' }], totalPages: 2 } };
      }
      return { data: { data: [endpoint('WORKSTATION1')], totalPages: 2 } };
    },
    defaults: { baseURL: 'https://bms/bconnect' },
  } as unknown as AxiosInstance;
  return { client, calls };
}

const paged = (calls: Call[], match: (url: string) => boolean): Call[] =>
  calls.filter((c) => match(c.url) && !c.url.includes('/JobDefinitions/'));

describe('preview_assignment — bounded walks send an explicit order', () => {
  it('orders the logical-group tree walk and the estate walk, on every page', async () => {
    const { client, calls } = recordingClient();
    await previewAssignment(client, { jobDefinitionId: JOB, logicalGroupId: GROUP });

    const groupCalls = paged(calls, (u) => u.endsWith('/LogicalGroups'));
    const endpointCalls = paged(calls, (u) => u.endsWith('/v2.0/Endpoints'));

    expect(groupCalls.length).toBeGreaterThan(1);
    expect(endpointCalls.length).toBeGreaterThan(1);
    for (const c of groupCalls) {expect(c.params.OrderBy).toBe('Name asc');}
    for (const c of endpointCalls) {expect(c.params.OrderBy).toBe('DisplayName asc');}
  });

  it.each([
    ['staticGroupId', 'StaticGroups'],
    ['dynamicGroupId', 'DynamicGroups'],
    ['universalDynamicGroupId', 'UniversalDynamicGroups'],
  ])('orders the %s membership walk', async (option, segment) => {
    const { client, calls } = recordingClient();
    await previewAssignment(client, { jobDefinitionId: JOB, [option]: GROUP });

    const memberCalls = paged(calls, (u) => u.includes(`/${segment}/`));
    expect(memberCalls.length).toBeGreaterThan(1);
    for (const c of memberCalls) {expect(c.params.OrderBy).toBe('DisplayName asc');}
  });

  it('reports the order it used alongside the truncation flags', async () => {
    const { client } = recordingClient();
    const out = await previewAssignment(client, { jobDefinitionId: JOB, logicalGroupId: GROUP });

    const estate = (out.meta as Record<string, unknown>).estate as Record<string, Record<string, unknown>>;
    expect(estate.groups.orderBy).toBe('Name asc');
    expect(estate.endpoints.orderBy).toBe('DisplayName asc');
  });
});
