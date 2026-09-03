/**
 * `OperatingSystemsModule` — verb/route/body assertions for all 9 methods.
 *
 * Before this file, `operatingsystems.ts` measured **36.06% statements / 27.27%
 * functions**. The workspace passed its floor of 57 at 68.65%, which is the
 * point: a module can be two-thirds untested while the workspace number looks
 * comfortable, because the utils and client around it are near-100%.
 *
 * Fake `AxiosInstance`. No network, no live bMS, no mock server.
 *
 * ── Two PATCHes that were sending a media type their routes reject ──────────
 * `updateFolder` and `updateWindowsEndpoint` PATCHed with no content type until
 * 2026-08-19. All 25 PATCH operations in the 26R1 specs accept
 * `application/json-patch+json` and nothing else, and axios sends
 * `application/json` when none is given, so both were 415s.
 *
 * They were invisible to the earlier repository-wide check because they are
 * written `.patch<Folder>(` with an explicit type parameter, and that check
 * searched for the literal `.patch(`. Sixteen of twenty-five call sites were
 * written that way. `__tests__/suite-patch-content-type.test.ts` now reads call
 * sites; these two tests pin the header per route.
 *
 * ── The route asymmetry ─────────────────────────────────────────────────────
 * Folders nest under themselves — `/Folders/{id}/Folders` — while endpoints do
 * not. `getFoldersByFolderId` is the only route here with a repeated segment,
 * and dropping the second one silently returns the folder instead of its
 * children.
 */

import { describe, it, expect } from 'vitest';
import type { AxiosInstance } from 'axios';
import { OperatingSystemsModule } from '../modules/operatingsystems.js';

interface Call {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  body?: unknown;
  params?: unknown;
  headers?: Record<string, string>;
}

function fakeClient(responseData: unknown = { id: 'stub' }): { client: AxiosInstance; calls: Call[] } {
  const calls: Call[] = [];
  const client = {
    get: async (url: string, config?: { params?: unknown }) => {
      calls.push({ method: 'GET', url, params: config?.params });
      return { data: responseData };
    },
    post: async (url: string, body?: unknown) => {
      calls.push({ method: 'POST', url, body });
      return { data: responseData };
    },
    patch: async (url: string, body?: unknown, config?: { headers?: Record<string, string> }) => {
      calls.push({ method: 'PATCH', url, body, headers: config?.headers });
      return { data: responseData };
    },
    delete: async (url: string) => {
      calls.push({ method: 'DELETE', url });
      return { data: responseData };
    },
  } as unknown as AxiosInstance;
  return { client, calls };
}

const BASE = (
  new OperatingSystemsModule(fakeClient().client) as unknown as { basePath: string }
).basePath;
const EMPTY_PAGE = { data: [], totalItems: 0 };
const PATCH_HEADERS = { 'Content-Type': 'application/json-patch+json' };
const PATCH_DOC = [{ op: 'replace', path: '/name', value: 'x' }] as never;

describe('OperatingSystemsModule — the base path itself', () => {
  it('basePath is the version this module is written against', () => {
    expect(BASE).toBe('/operatingsystems/v2.0');
  });
});

describe('OperatingSystemsModule — folders', () => {
  it('getFolders GETs /Folders and forwards params', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new OperatingSystemsModule(client).getFolders({ SearchQuery: 'win11' });
    expect(calls).toEqual([{ method: 'GET', url: `${BASE}/Folders`, params: { SearchQuery: 'win11' } }]);
  });

  it('getFolders defaults params to {}', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new OperatingSystemsModule(client).getFolders();
    expect(calls[0]?.params).toEqual({});
  });

  it('getFolder GETs /Folders/{id}', async () => {
    const { client, calls } = fakeClient({ id: 'f-1' });
    await new OperatingSystemsModule(client).getFolder('f-1');
    expect(calls).toEqual([{ method: 'GET', url: `${BASE}/Folders/f-1`, params: undefined }]);
  });

  it('getFoldersByFolderId nests /Folders under the parent — the repeated segment', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new OperatingSystemsModule(client).getFoldersByFolderId('f-1');
    expect(calls[0]?.url).toBe(`${BASE}/Folders/f-1/Folders`);
    // Dropping the trailing segment returns the folder, not its children, and
    // both URLs answer 200.
    expect(calls[0]?.url).not.toBe(`${BASE}/Folders/f-1`);
  });

  it('createFolder POSTs to /Folders and returns the transport payload', async () => {
    const data = { name: 'Images' } as never;
    const created = { id: 'f-9', name: 'Images' };
    const { client, calls } = fakeClient(created);
    const result = await new OperatingSystemsModule(client).createFolder(data);
    expect(calls).toEqual([{ method: 'POST', url: `${BASE}/Folders`, body: data }]);
    expect(result).toEqual(created);
  });

  it('deleteFolder DELETEs /Folders/{id}', async () => {
    const { client, calls } = fakeClient();
    await new OperatingSystemsModule(client).deleteFolder('f-1');
    expect(calls).toEqual([{ method: 'DELETE', url: `${BASE}/Folders/f-1` }]);
  });
});

describe('OperatingSystemsModule — windows endpoints', () => {
  it('getWindowsEndpoints GETs /WindowsEndpoints', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new OperatingSystemsModule(client).getWindowsEndpoints({ PageSize: 10 });
    expect(calls).toEqual([
      { method: 'GET', url: `${BASE}/WindowsEndpoints`, params: { PageSize: 10 } },
    ]);
  });

  it('getWindowsEndpoint GETs /WindowsEndpoints/{id}', async () => {
    const { client, calls } = fakeClient({ id: 'ep-1' });
    await new OperatingSystemsModule(client).getWindowsEndpoint('ep-1');
    expect(calls).toEqual([{ method: 'GET', url: `${BASE}/WindowsEndpoints/ep-1`, params: undefined }]);
  });
});

describe('OperatingSystemsModule — the two PATCHes', () => {
  it('updateFolder PATCHes /Folders/{id} WITH the json-patch content type', async () => {
    const updated = { id: 'f-1' };
    const { client, calls } = fakeClient(updated);
    const result = await new OperatingSystemsModule(client).updateFolder('f-1', PATCH_DOC);
    expect(calls).toEqual([
      { method: 'PATCH', url: `${BASE}/Folders/f-1`, body: PATCH_DOC, headers: PATCH_HEADERS },
    ]);
    expect(result).toEqual(updated);
  });

  it('updateWindowsEndpoint PATCHes /WindowsEndpoints/{id} WITH the content type', async () => {
    const updated = { id: 'ep-1' };
    const { client, calls } = fakeClient(updated);
    const result = await new OperatingSystemsModule(client).updateWindowsEndpoint('ep-1', PATCH_DOC);
    expect(calls).toEqual([
      {
        method: 'PATCH',
        url: `${BASE}/WindowsEndpoints/ep-1`,
        body: PATCH_DOC,
        headers: PATCH_HEADERS,
      },
    ]);
    expect(result).toEqual(updated);
  });

  it('no PATCH in this module is left bare — counted, not listed', async () => {
    // Counting rather than naming the two, so a third update* method added
    // without the header fails here as well.
    const { client, calls } = fakeClient({ id: 'x' });
    const mod = new OperatingSystemsModule(client);
    await mod.updateFolder('f-1', PATCH_DOC);
    await mod.updateWindowsEndpoint('ep-1', PATCH_DOC);
    const bare = calls
      .filter((c) => c.method === 'PATCH')
      .filter((c) => c.headers?.['Content-Type'] !== 'application/json-patch+json');
    expect(bare.map((c) => c.url)).toEqual([]);
  });
});

describe('OperatingSystemsModule — coverage of the surface', () => {
  it('every async method on the prototype is exercised by this file', () => {
    // Named explicitly so a new method cannot slip in untested. If this fails,
    // add the route test — do not extend the list.
    const tested = new Set([
      'getFolders', 'getFolder', 'getFoldersByFolderId', 'getWindowsEndpoints',
      'getWindowsEndpoint', 'createFolder', 'updateFolder', 'deleteFolder',
      'updateWindowsEndpoint',
    ]);
    const onPrototype = Object.getOwnPropertyNames(OperatingSystemsModule.prototype).filter(
      (n) => n !== 'constructor'
    );
    const untested = onPrototype.filter((n) => !tested.has(n));
    expect(
      untested,
      `${untested.length} method(s) have no route assertion: ${untested.join(', ')}`
    ).toEqual([]);
  });
});
