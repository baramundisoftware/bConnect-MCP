/**
 * `UniversalDynamicGroupsModule` — verb/route/param assertions for all six
 * methods.
 *
 * Before this file, `universaldynamicgroups.ts` measured **15.49% statements /
 * 25% functions** and the workspace sat at 46.55% against a 48 floor. As in
 * every other workspace that fell short, the whole shortfall was the module:
 * `bconnect-client.ts` was already 100% and the validation rules 95%.
 *
 * Fake `AxiosInstance`. No network, no live bMS, no mock server.
 *
 * ── The asymmetry this module is easy to get wrong ──────────────────────────
 * This module spells "folder" TWO different ways, and both are load-bearing:
 *
 *   folders themselves      /UniversalDynamicGroupsFolder        (SINGULAR)
 *   folders under a folder  /UniversalDynamicGroupsFolder/{id}/Folders
 *   UDGs under a folder     /Folders/{id}/UniversalDynamicGroups (PLURAL, bare)
 *
 * So `/Folders` and `/UniversalDynamicGroupsFolder` both appear, meaning either
 * one is a plausible typo for the other and neither reads as obviously wrong.
 * Nothing but a route assertion distinguishes them, which is why each is pinned
 * explicitly below rather than covered incidentally.
 *
 * BASE is read off the instance so a version bump fails once, in the test that
 * pins the literal, rather than under six unrelated failures. `basePath` is
 * private, hence the cast.
 */

import { describe, it, expect } from 'vitest';
import type { AxiosInstance } from 'axios';
import { UniversalDynamicGroupsModule } from '../modules/universaldynamicgroups.js';

interface Call {
  method: 'GET';
  url: string;
  params?: unknown;
}

function fakeClient(responseData: unknown = { id: 'stub' }): { client: AxiosInstance; calls: Call[] } {
  const calls: Call[] = [];
  const client = {
    get: async (url: string, config?: { params?: unknown }) => {
      calls.push({ method: 'GET', url, params: config?.params });
      return { data: responseData };
    },
  } as unknown as AxiosInstance;
  return { client, calls };
}

const BASE = (
  new UniversalDynamicGroupsModule(fakeClient().client) as unknown as { basePath: string }
).basePath;

const EMPTY_PAGE = { data: [], totalItems: 0 };

describe('UniversalDynamicGroupsModule — the base path itself', () => {
  it('basePath is the version this module is written against', () => {
    expect(BASE).toBe('/universaldynamicgroups/v2.0');
  });
});

describe('UniversalDynamicGroupsModule — group reads', () => {
  it('getUniversalDynamicGroups GETs /UniversalDynamicGroups and forwards params', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new UniversalDynamicGroupsModule(client).getUniversalDynamicGroups({ SearchQuery: 'win11' });
    expect(calls).toEqual([
      { method: 'GET', url: `${BASE}/UniversalDynamicGroups`, params: { SearchQuery: 'win11' } },
    ]);
  });

  it('getUniversalDynamicGroups defaults params to {} rather than omitting them', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new UniversalDynamicGroupsModule(client).getUniversalDynamicGroups();
    expect(calls[0]?.params).toEqual({});
  });

  it('getUniversalDynamicGroup GETs /UniversalDynamicGroups/{id}, distinct from the collection', async () => {
    const { client, calls } = fakeClient({ id: 'udg-1' });
    await new UniversalDynamicGroupsModule(client).getUniversalDynamicGroup('udg-1');
    expect(calls).toEqual([
      { method: 'GET', url: `${BASE}/UniversalDynamicGroups/udg-1`, params: undefined },
    ]);
  });
});

describe('UniversalDynamicGroupsModule — the two spellings of "folder"', () => {
  it('getUniversalDynamicGroupsByFolder uses the BARE PLURAL /Folders/{id}/UniversalDynamicGroups', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new UniversalDynamicGroupsModule(client).getUniversalDynamicGroupsByFolder('f-1', { Name: 'Sales' });
    expect(calls).toEqual([
      { method: 'GET', url: `${BASE}/Folders/f-1/UniversalDynamicGroups`, params: { Name: 'Sales' } },
    ]);
    // The other spelling must NOT appear on this route.
    expect(calls[0]?.url).not.toContain('UniversalDynamicGroupsFolder');
  });

  it('getFolders uses the SINGULAR /UniversalDynamicGroupsFolder — not /Folders, not …Folders', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new UniversalDynamicGroupsModule(client).getFolders({ OrderBy: 'Name' });
    expect(calls).toEqual([
      { method: 'GET', url: `${BASE}/UniversalDynamicGroupsFolder`, params: { OrderBy: 'Name' } },
    ]);
    expect(calls[0]?.url).toBe(`${BASE}/UniversalDynamicGroupsFolder`);
    expect(calls[0]?.url.endsWith('Folders')).toBe(false);
  });

  it('getFolder GETs /UniversalDynamicGroupsFolder/{id}', async () => {
    const { client, calls } = fakeClient({ id: 'f-1' });
    await new UniversalDynamicGroupsModule(client).getFolder('f-1');
    expect(calls).toEqual([
      { method: 'GET', url: `${BASE}/UniversalDynamicGroupsFolder/f-1`, params: undefined },
    ]);
  });

  it('getFoldersByFolder nests PLURAL /Folders under the SINGULAR parent segment', async () => {
    // Both spellings in one URL. This is the route most likely to be written
    // wrong from memory, in either direction.
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new UniversalDynamicGroupsModule(client).getFoldersByFolder('f-1');
    expect(calls).toEqual([
      { method: 'GET', url: `${BASE}/UniversalDynamicGroupsFolder/f-1/Folders`, params: {} },
    ]);
  });
});

describe('UniversalDynamicGroupsModule — readSubResource is transparent on success', () => {
  it('both wrapped reads return the payload unchanged', async () => {
    // readSubResource exists to translate a 404. On the success path it must
    // not reshape the envelope — every count the tools report comes through it.
    const payload = { data: [{ id: 'udg-1' }], totalItems: 1 };
    const mod = new UniversalDynamicGroupsModule(fakeClient(payload).client);
    expect(await mod.getUniversalDynamicGroupsByFolder('f-1')).toEqual(payload);
    expect(await mod.getFoldersByFolder('f-1')).toEqual(payload);
  });
});
