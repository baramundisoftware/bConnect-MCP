/**
 * `AssetsModule` — verb/route/body assertions for all 26 methods.
 *
 * Before this file, `assets.ts` measured **20.26% statements / 7.14%
 * functions** and the workspace sat at 57.27% against a 61 floor. The
 * shortfall was entirely here: `bconnect-client.ts` was 100%.
 *
 * Fake `AxiosInstance`. No network, no live bMS, no mock server.
 *
 * ── One asymmetry that WILL be typed wrong from memory ──────────────────────
 * Three of the four parent-scoped asset reads use a PLURAL parent segment and
 * the fourth does not:
 *
 *   /LogicalGroups/{id}/Assets     plural
 *   /OrgUnits/{id}/Assets          plural
 *   /ADObjects/{id}/Assets         plural
 *   /WindowsEndpoint/{id}/Assets   SINGULAR
 *
 * Every other server in this repository spells that segment `WindowsEndpoints`.
 * The singular here is pinned deliberately: if it is ever "corrected" to the
 * plural, this test fails and someone has to check the live route before
 * changing it, rather than the tool quietly 404ing in production.
 *
 * ── A defect this file caught, and now guards ──────────────────────────────
 * The three `update*` methods used to PATCH with NO content type. This file
 * pinned that, deliberately, so changing it would be visible. It has since been
 * fixed and those pins are inverted to assert the correct header.
 *
 * The fix rests on two measurements, neither of which touched the live estate:
 *
 *   1. All 25 PATCH operations across every 26R1 OpenAPI spec declare
 *      `application/json-patch+json` and NOTHING else — including the three
 *      assets routes here.
 *   2. axios sends `application/json` when no content type is set, measured
 *      against a capturing adapter rather than assumed.
 *
 * So these three tools were sending a content type their routes do not accept,
 * and bMS answers that with 415.
 *
 * TWO EARLIER CLAIMS HERE WERE WRONG, and both were wrong the same way — by
 * counting occurrences of the media type in a file rather than reading call
 * sites. "Eight modules set it" counted generated TYPE references in modules
 * that make no PATCH call. "This module was the only one" then missed
 * `variables`, which names the media type twice in type aliases while PATCHing
 * bare, and missed sixteen further call sites written `.patch<T>(`.
 *
 * The measured figure is 21 of 25 call sites bare, across seven modules.
 * `__tests__/suite-patch-content-type.test.ts` now guards the class by parsing
 * arguments, and carries the full account.
 *
 * It is still unconfirmed against a live bMS, because that would mean a write to
 * a production estate. The spec is the vendor's own declaration of what the
 * route accepts, which is why it was treated as sufficient.
 */

import { describe, it, expect } from 'vitest';
import type { AxiosInstance } from 'axios';
import { AssetsModule } from '../modules/assets.js';

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

const BASE = (new AssetsModule(fakeClient().client) as unknown as { basePath: string }).basePath;
const EMPTY_PAGE = { data: [], totalItems: 0 };
const PATCH_HEADERS = { 'Content-Type': 'application/json-patch+json' };
const PATCH_OPS = [{ op: 'replace', path: '/displayName', value: 'Renamed' }] as never;

describe('AssetsModule — the base path itself', () => {
  it('basePath is the version this module is written against', () => {
    expect(BASE).toBe('/assets/v2.0');
  });
});

describe('AssetsModule — assets', () => {
  it('getAssets GETs /Assets and forwards params', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new AssetsModule(client).getAssets({ SearchQuery: 'laptop', PageSize: 25 });
    expect(calls).toEqual([
      { method: 'GET', url: `${BASE}/Assets`, params: { SearchQuery: 'laptop', PageSize: 25 } },
    ]);
  });

  it('getAssets defaults params to {}', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new AssetsModule(client).getAssets();
    expect(calls[0]?.params).toEqual({});
  });

  it('getAsset GETs /Assets/{id}', async () => {
    const { client, calls } = fakeClient({ id: 'a-1' });
    await new AssetsModule(client).getAsset('a-1');
    expect(calls).toEqual([{ method: 'GET', url: `${BASE}/Assets/a-1`, params: undefined }]);
  });

  it('createAsset POSTs to /Assets and returns the transport payload', async () => {
    // ARCH-2: the write must RETURN what came back. A fabricated
    // `{ success: true }` here is the hallucinated-fact family, and a mutation
    // that did exactly this to createAsset once passed the whole suite.
    const data = { displayName: 'Dell XPS' } as never;
    const created = { id: 'a-9', displayName: 'Dell XPS' };
    const { client, calls } = fakeClient(created);
    const result = await new AssetsModule(client).createAsset(data);
    expect(calls).toEqual([{ method: 'POST', url: `${BASE}/Assets`, body: data }]);
    expect(result).toEqual(created);
  });

  it('updateAsset PATCHes /Assets/{id} with the operations array as the body', async () => {
    const updated = { id: 'a-1', displayName: 'Renamed' };
    const { client, calls } = fakeClient(updated);
    const result = await new AssetsModule(client).updateAsset('a-1', PATCH_OPS);
    expect(calls).toEqual([
      { method: 'PATCH', url: `${BASE}/Assets/a-1`, body: PATCH_OPS, headers: PATCH_HEADERS },
    ]);
    expect(result).toEqual(updated);
  });

  it('deleteAsset DELETEs /Assets/{id}', async () => {
    const { client, calls } = fakeClient();
    await new AssetsModule(client).deleteAsset('a-1');
    expect(calls).toEqual([{ method: 'DELETE', url: `${BASE}/Assets/a-1` }]);
  });

  it('getAssetsAssetStock GETs /AssetStock/Assets, not /Assets', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new AssetsModule(client).getAssetsAssetStock({ Page: 2 });
    expect(calls).toEqual([{ method: 'GET', url: `${BASE}/AssetStock/Assets`, params: { Page: 2 } }]);
  });
});

describe('AssetsModule — parent-scoped asset reads, three plural and one singular', () => {
  it('getAssetsByLogicalGroup GETs /LogicalGroups/{id}/Assets', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new AssetsModule(client).getAssetsByLogicalGroup('lg-1', { PageSize: 5 });
    expect(calls).toEqual([
      { method: 'GET', url: `${BASE}/LogicalGroups/lg-1/Assets`, params: { PageSize: 5 } },
    ]);
  });

  it('getAssetsByOrgUnit GETs /OrgUnits/{id}/Assets', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new AssetsModule(client).getAssetsByOrgUnit('ou-1');
    expect(calls).toEqual([{ method: 'GET', url: `${BASE}/OrgUnits/ou-1/Assets`, params: {} }]);
  });

  it('getAssetsByADObject GETs /ADObjects/{id}/Assets', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new AssetsModule(client).getAssetsByADObject('ad-1');
    expect(calls).toEqual([{ method: 'GET', url: `${BASE}/ADObjects/ad-1/Assets`, params: {} }]);
  });

  it('getAssetsByWindowsEndpoint uses the SINGULAR /WindowsEndpoint/{id}/Assets', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new AssetsModule(client).getAssetsByWindowsEndpoint('ep-1');
    expect(calls).toEqual([{ method: 'GET', url: `${BASE}/WindowsEndpoint/ep-1/Assets`, params: {} }]);
    // Pinned, not endorsed: every other server spells this plural. If this line
    // is ever "fixed", verify the live route first.
    expect(calls[0]?.url).not.toContain('/WindowsEndpoints/');
  });

  it('all four wrapped reads return the payload through readSubResource unchanged', async () => {
    const payload = { data: [{ id: 'a-1' }], totalItems: 1 };
    const mod = new AssetsModule(fakeClient(payload).client);
    expect(await mod.getAssetsByLogicalGroup('lg-1')).toEqual(payload);
    expect(await mod.getAssetsByOrgUnit('ou-1')).toEqual(payload);
    expect(await mod.getAssetsByWindowsEndpoint('ep-1')).toEqual(payload);
    expect(await mod.getAssetsByADObject('ad-1')).toEqual(payload);
  });
});

describe('AssetsModule — asset stock folders', () => {
  it('getAssetStockFolders GETs /AssetStock/Folders', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new AssetsModule(client).getAssetStockFolders({ Name: 'Spares' });
    expect(calls).toEqual([
      { method: 'GET', url: `${BASE}/AssetStock/Folders`, params: { Name: 'Spares' } },
    ]);
  });

  it('createAssetStockFolder POSTs to /AssetStock/Folders and returns the result', async () => {
    const data = { name: 'Spares' } as never;
    const created = { id: 'f-9', name: 'Spares' };
    const { client, calls } = fakeClient(created);
    const result = await new AssetsModule(client).createAssetStockFolder(data);
    expect(calls).toEqual([{ method: 'POST', url: `${BASE}/AssetStock/Folders`, body: data }]);
    expect(result).toEqual(created);
  });

  it('getAssetStockFolder GETs /AssetStock/Folders/{id}', async () => {
    const { client, calls } = fakeClient({ id: 'f-1' });
    await new AssetsModule(client).getAssetStockFolder('f-1');
    expect(calls).toEqual([{ method: 'GET', url: `${BASE}/AssetStock/Folders/f-1`, params: undefined }]);
  });

  it('updateAssetStockFolder PATCHes /AssetStock/Folders/{id}', async () => {
    const updated = { id: 'f-1' };
    const { client, calls } = fakeClient(updated);
    const result = await new AssetsModule(client).updateAssetStockFolder('f-1', PATCH_OPS);
    expect(calls).toEqual([
      { method: 'PATCH', url: `${BASE}/AssetStock/Folders/f-1`, body: PATCH_OPS, headers: PATCH_HEADERS },
    ]);
    expect(result).toEqual(updated);
  });

  it('deleteAssetStockFolder DELETEs /AssetStock/Folders/{id}', async () => {
    const { client, calls } = fakeClient();
    await new AssetsModule(client).deleteAssetStockFolder('f-1');
    expect(calls).toEqual([{ method: 'DELETE', url: `${BASE}/AssetStock/Folders/f-1` }]);
  });

  it('getAssetStockFoldersByParent nests /Folders under the parent folder', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new AssetsModule(client).getAssetStockFoldersByParent('f-1', { includeSubfolders: true });
    expect(calls).toEqual([
      {
        method: 'GET',
        url: `${BASE}/AssetStock/Folders/f-1/Folders`,
        params: { includeSubfolders: true },
      },
    ]);
  });
});

describe('AssetsModule — asset TYPE folders, a different tree from asset STOCK folders', () => {
  it('getAssetTypeFolders GETs /AssetTypes/Folders — not /AssetStock/Folders', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new AssetsModule(client).getAssetTypeFolders();
    expect(calls).toEqual([{ method: 'GET', url: `${BASE}/AssetTypes/Folders`, params: {} }]);
    expect(calls[0]?.url).not.toContain('AssetStock');
  });

  it('createAssetTypeFolder POSTs to /AssetTypes/Folders and returns the result', async () => {
    const data = { name: 'Peripherals' } as never;
    const created = { id: 'tf-9', name: 'Peripherals' };
    const { client, calls } = fakeClient(created);
    const result = await new AssetsModule(client).createAssetTypeFolder(data);
    expect(calls).toEqual([{ method: 'POST', url: `${BASE}/AssetTypes/Folders`, body: data }]);
    expect(result).toEqual(created);
  });

  it('getAssetTypeFolder GETs /AssetTypes/Folders/{id}', async () => {
    const { client, calls } = fakeClient({ id: 'tf-1' });
    await new AssetsModule(client).getAssetTypeFolder('tf-1');
    expect(calls).toEqual([{ method: 'GET', url: `${BASE}/AssetTypes/Folders/tf-1`, params: undefined }]);
  });

  it('updateAssetTypeFolder PATCHes /AssetTypes/Folders/{id}', async () => {
    const updated = { id: 'tf-1' };
    const { client, calls } = fakeClient(updated);
    const result = await new AssetsModule(client).updateAssetTypeFolder('tf-1', PATCH_OPS);
    expect(calls).toEqual([
      { method: 'PATCH', url: `${BASE}/AssetTypes/Folders/tf-1`, body: PATCH_OPS, headers: PATCH_HEADERS },
    ]);
    expect(result).toEqual(updated);
  });

  it('deleteAssetTypeFolder DELETEs /AssetTypes/Folders/{id}', async () => {
    const { client, calls } = fakeClient();
    await new AssetsModule(client).deleteAssetTypeFolder('tf-1');
    expect(calls).toEqual([{ method: 'DELETE', url: `${BASE}/AssetTypes/Folders/tf-1` }]);
  });

  it('getAssetTypeFoldersByParent nests /Folders under the parent type folder', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new AssetsModule(client).getAssetTypeFoldersByParent('tf-1');
    expect(calls).toEqual([
      { method: 'GET', url: `${BASE}/AssetTypes/Folders/tf-1/Folders`, params: {} },
    ]);
  });
});

describe('AssetsModule — asset types', () => {
  it('getAssetTypes GETs /AssetTypes and forwards the boolean params', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new AssetsModule(client).getAssetTypes({ ShowSummary: true, Icon: false });
    expect(calls).toEqual([
      { method: 'GET', url: `${BASE}/AssetTypes`, params: { ShowSummary: true, Icon: false } },
    ]);
  });

  it('createAssetType POSTs to /AssetTypes and returns the result', async () => {
    const data = { name: 'Monitor' } as never;
    const created = { id: 't-9', name: 'Monitor' };
    const { client, calls } = fakeClient(created);
    const result = await new AssetsModule(client).createAssetType(data);
    expect(calls).toEqual([{ method: 'POST', url: `${BASE}/AssetTypes`, body: data }]);
    expect(result).toEqual(created);
  });

  it('getAssetType GETs /AssetTypes/{id}, distinct from the folders sub-tree', async () => {
    const { client, calls } = fakeClient({ id: 't-1' });
    await new AssetsModule(client).getAssetType('t-1');
    expect(calls).toEqual([{ method: 'GET', url: `${BASE}/AssetTypes/t-1`, params: undefined }]);
    expect(calls[0]?.url).not.toContain('/Folders');
  });

  it('deleteAssetType DELETEs /AssetTypes/{id}', async () => {
    const { client, calls } = fakeClient();
    await new AssetsModule(client).deleteAssetType('t-1');
    expect(calls).toEqual([{ method: 'DELETE', url: `${BASE}/AssetTypes/t-1` }]);
  });
});

describe('AssetsModule — the PATCH content type, now correct', () => {
  it('all three update* methods send application/json-patch+json', async () => {
    // The routes accept nothing else (25 of 25 PATCH operations across the 26R1
    // specs), and axios defaults to application/json when this is omitted — so
    // dropping it again means 415 on three shipped write tools, with no test
    // failing anywhere else to say so.
    const { client, calls } = fakeClient({ id: 'x' });
    const mod = new AssetsModule(client);
    await mod.updateAsset('a-1', PATCH_OPS);
    await mod.updateAssetStockFolder('f-1', PATCH_OPS);
    await mod.updateAssetTypeFolder('tf-1', PATCH_OPS);
    expect(calls.map((c) => c.headers)).toEqual([PATCH_HEADERS, PATCH_HEADERS, PATCH_HEADERS]);
  });

  it('every PATCH this module makes carries it — none is left bare', async () => {
    // Counted rather than listed: a fourth update* method added without the
    // header would pass the test above, which only names three.
    const { client, calls } = fakeClient({ id: 'x' });
    const mod = new AssetsModule(client);
    await mod.updateAsset('a-1', PATCH_OPS);
    await mod.updateAssetStockFolder('f-1', PATCH_OPS);
    await mod.updateAssetTypeFolder('tf-1', PATCH_OPS);
    const patches = calls.filter((c) => c.method === 'PATCH');
    const bare = patches.filter((c) => c.headers?.['Content-Type'] !== 'application/json-patch+json');
    expect(
      bare.map((c) => c.url),
      `${bare.length} PATCH call(s) omit application/json-patch+json, which those routes answer with 415`
    ).toEqual([]);
    expect(patches.length).toBe(3);
  });
});
