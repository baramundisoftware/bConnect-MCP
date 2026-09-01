/**
 * `SoftwareModule` — HTTP verb/route/body assertions for every method.
 *
 * Before this file, `software.ts` measured **12.56% statements / 9.52%
 * functions** and not one of its 20 methods had an assertion that the right
 * verb, route or body reached the transport. The workspace sat below its
 * coverage floor (41.97% against 43) for that reason alone: `bconnect-client.ts`
 * is 100% and the validation rules 75%, so the whole shortfall was here.
 *
 * This is the same defect class the jobs suite records for
 * `update_bitlocker_pin` — a write built against a route the API does not
 * serve, unnoticed because nothing asserted the URL a method actually built.
 * `jobs.ts` was at 15.96% before `jobs-module-writes.test.ts` and is at 96.3%
 * after; that file is the pattern followed here.
 *
 * These use a fake `AxiosInstance`. No network, no live bMS, no mock server —
 * this tier must run on a CI box that has none of those.
 *
 * ── Two asymmetries this module is easy to get wrong, pinned deliberately ───
 *
 * 1. Bundles live at `/Bundles` but bundle FOLDERS live at `/Bundle/Folders` —
 *    SINGULAR, and not `/Bundles/Folders`. Nothing but a route assertion
 *    catches that, because both spellings are equally plausible to a reader.
 * 2. The two PATCH methods must send `application/json-patch+json`. A PATCH
 *    that reaches the right URL with the wrong content type is rejected by the
 *    API for a reason the message does not explain, so the header is asserted
 *    rather than assumed.
 *
 * ── Why BASE is read off the module ─────────────────────────────────────────
 * Each route test pins the *relative* structure against a BASE read from the
 * instance, so a version bump fails ONCE — in the test below that pins the
 * literal — instead of burying a real route regression under 20 unrelated
 * failures. `basePath` is private, hence the cast.
 */

import { describe, it, expect } from 'vitest';
import type { AxiosInstance } from 'axios';
import type { components } from '../generated/software-types.js';
import { SoftwareModule } from '../modules/software.js';

type SoftwareBundleForCreation = components['schemas']['SoftwareBundleForCreation'];
type AddApplicationRequest = components['schemas']['AddApplicationRequest'];
type JsonPatchDocument = components['schemas']['JsonPatchDocument'];
type BundleFolderForCreation = components['schemas']['BundleFolderForCreation'];

interface Call {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  body?: unknown;
  params?: unknown;
  headers?: Record<string, string>;
}

/**
 * Records every call the module makes and answers each with `responseData`.
 * `patch` captures headers too — without that the content-type assertions
 * below would silently pass against a client that never received them.
 */
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
  new SoftwareModule(fakeClient().client) as unknown as { basePath: string }
).basePath;

const PATCH_HEADERS = { 'Content-Type': 'application/json-patch+json' };

describe('SoftwareModule — the base path itself', () => {
  it('basePath is the version this module is written against', () => {
    // The single place the literal is pinned. If this fails and the route tests
    // below still pass, the base path moved and nothing else did — check every
    // route in this module exists under the new version before editing this.
    expect(BASE).toBe('/software/v2.0');
  });
});

describe('SoftwareModule — installed software reads', () => {
  it('getInstalledWindowsSoftware GETs /InstalledWindowsSoftware and forwards params', async () => {
    const { client, calls } = fakeClient({ data: [], totalItems: 0 });
    await new SoftwareModule(client).getInstalledWindowsSoftware({ SearchQuery: 'chrome', PageSize: 50 });
    expect(calls).toEqual([
      { method: 'GET', url: `${BASE}/InstalledWindowsSoftware`, params: { SearchQuery: 'chrome', PageSize: 50 } },
    ]);
  });

  it('getInstalledWindowsSoftware defaults params to an empty object rather than omitting them', async () => {
    // The default matters: `undefined` params and `{}` params are the same to
    // axios but not to a reader, and the signature promises the latter.
    const { client, calls } = fakeClient({ data: [], totalItems: 0 });
    await new SoftwareModule(client).getInstalledWindowsSoftware();
    expect(calls[0]?.params).toEqual({});
  });

  it('getInstalledSoftwareByEndpoint GETs /WindowsEndpoints/{id}/InstalledWindowsSoftware', async () => {
    const { client, calls } = fakeClient({ data: [], totalItems: 0 });
    await new SoftwareModule(client).getInstalledSoftwareByEndpoint('ep-1', { PageSize: 5 });
    expect(calls).toEqual([
      { method: 'GET', url: `${BASE}/WindowsEndpoints/ep-1/InstalledWindowsSoftware`, params: { PageSize: 5 } },
    ]);
  });

  it('getInstalledSoftwareByLogicalGroup GETs /LogicalGroups/{id}/InstalledWindowsSoftware', async () => {
    const { client, calls } = fakeClient({ data: [], totalItems: 0 });
    await new SoftwareModule(client).getInstalledSoftwareByLogicalGroup('lg-1');
    expect(calls).toEqual([
      { method: 'GET', url: `${BASE}/LogicalGroups/lg-1/InstalledWindowsSoftware`, params: {} },
    ]);
  });

  it('getInstalledSoftwareByUniversalDynamicGroup GETs /UniversalDynamicGroups/{id}/InstalledWindowsSoftware', async () => {
    const { client, calls } = fakeClient({ data: [], totalItems: 0 });
    await new SoftwareModule(client).getInstalledSoftwareByUniversalDynamicGroup('udg-1');
    expect(calls).toEqual([
      { method: 'GET', url: `${BASE}/UniversalDynamicGroups/udg-1/InstalledWindowsSoftware`, params: {} },
    ]);
  });

  it('the three sub-resource reads return the payload through readSubResource unchanged', async () => {
    // readSubResource wraps these to translate a 404. On the success path it
    // must be transparent — a wrapper that reshaped the envelope would change
    // every count the tools report.
    const payload = { data: [{ name: 'Chrome' }], totalItems: 1 };
    const mod = new SoftwareModule(fakeClient(payload).client);
    expect(await mod.getInstalledSoftwareByEndpoint('ep-1')).toEqual(payload);
    expect(await mod.getInstalledSoftwareByLogicalGroup('lg-1')).toEqual(payload);
    expect(await mod.getInstalledSoftwareByUniversalDynamicGroup('udg-1')).toEqual(payload);
  });
});

describe('SoftwareModule — software bundles', () => {
  it('getSoftwareBundles GETs /Bundles', async () => {
    const { client, calls } = fakeClient({ data: [], totalItems: 0 });
    await new SoftwareModule(client).getSoftwareBundles({ SearchQuery: 'base' });
    expect(calls).toEqual([{ method: 'GET', url: `${BASE}/Bundles`, params: { SearchQuery: 'base' } }]);
  });

  it('getSoftwareBundle GETs /Bundles/{id}, distinct from the collection route', async () => {
    const { client, calls } = fakeClient({ id: 'b-1' });
    await new SoftwareModule(client).getSoftwareBundle('b-1');
    expect(calls).toEqual([{ method: 'GET', url: `${BASE}/Bundles/b-1`, params: undefined }]);
  });

  it('createSoftwareBundle POSTs the body to /Bundles and returns what came back', async () => {
    const body = { name: 'Base Image' } as unknown as SoftwareBundleForCreation;
    const created = { id: 'b-9', name: 'Base Image' };
    const { client, calls } = fakeClient(created);
    const result = await new SoftwareModule(client).createSoftwareBundle(body);
    expect(calls).toEqual([{ method: 'POST', url: `${BASE}/Bundles`, body }]);
    // ARCH-2: a write that discards its declared body is the hallucinated-fact
    // family. The returned object must be the transport's, not a fabrication.
    expect(result).toEqual(created);
  });

  it('deleteSoftwareBundle DELETEs /Bundles/{id}', async () => {
    const { client, calls } = fakeClient();
    await new SoftwareModule(client).deleteSoftwareBundle('b-1');
    expect(calls).toEqual([{ method: 'DELETE', url: `${BASE}/Bundles/b-1` }]);
  });
});

describe('SoftwareModule — bundle applications', () => {
  it('getBundleApplications GETs /BundleApplications', async () => {
    const { client, calls } = fakeClient({ data: [], totalItems: 0 });
    await new SoftwareModule(client).getBundleApplications({ PageSize: 10 });
    expect(calls).toEqual([{ method: 'GET', url: `${BASE}/BundleApplications`, params: { PageSize: 10 } }]);
  });

  it('getBundleApplicationsByBundle GETs /Bundles/{id}/BundleApplications', async () => {
    const { client, calls } = fakeClient({ data: [], totalItems: 0 });
    await new SoftwareModule(client).getBundleApplicationsByBundle('b-1');
    expect(calls).toEqual([
      { method: 'GET', url: `${BASE}/Bundles/b-1/BundleApplications`, params: {} },
    ]);
  });

  it('addApplicationToBundle POSTs to the bundle-scoped route, not the flat one', async () => {
    const body = { applicationId: 'app-1' } as unknown as AddApplicationRequest;
    const created = { id: 'ba-1' };
    const { client, calls } = fakeClient(created);
    const result = await new SoftwareModule(client).addApplicationToBundle('b-1', body);
    expect(calls).toEqual([{ method: 'POST', url: `${BASE}/Bundles/b-1/BundleApplications`, body }]);
    expect(result).toEqual(created);
  });

  it('deleteBundleApplication DELETEs the FLAT route, not the bundle-scoped one', async () => {
    // Deliberately asymmetric with the POST above: adding is bundle-scoped,
    // deleting is by application id alone. Both spellings look reasonable.
    const { client, calls } = fakeClient();
    await new SoftwareModule(client).deleteBundleApplication('ba-1');
    expect(calls).toEqual([{ method: 'DELETE', url: `${BASE}/BundleApplications/ba-1` }]);
  });

  it('replaceApplicationInBundle PATCHes with the json-patch content type', async () => {
    const patchDoc = [{ op: 'replace', path: '/name', value: 'x' }] as unknown as JsonPatchDocument;
    const updated = { id: 'ba-1', name: 'x' };
    const { client, calls } = fakeClient(updated);
    const result = await new SoftwareModule(client).replaceApplicationInBundle('b-1', 'ba-1', patchDoc);
    expect(calls).toEqual([
      {
        method: 'PATCH',
        url: `${BASE}/Bundles/b-1/BundleApplications/ba-1`,
        body: patchDoc,
        headers: PATCH_HEADERS,
      },
    ]);
    expect(result).toEqual(updated);
  });
});

describe('SoftwareModule — bundle folders live under /Bundle/Folders, singular', () => {
  it('getBundleFolders GETs /Bundle/Folders — NOT /Bundles/Folders', async () => {
    const { client, calls } = fakeClient({ data: [], totalItems: 0 });
    await new SoftwareModule(client).getBundleFolders({ Name: 'Root' });
    expect(calls).toEqual([{ method: 'GET', url: `${BASE}/Bundle/Folders`, params: { Name: 'Root' } }]);
    expect(calls[0]?.url).not.toContain('/Bundles/Folders');
  });

  it('getBundleFolder GETs /Bundle/Folders/{id}', async () => {
    const { client, calls } = fakeClient({ id: 'f-1' });
    await new SoftwareModule(client).getBundleFolder('f-1');
    expect(calls).toEqual([{ method: 'GET', url: `${BASE}/Bundle/Folders/f-1`, params: undefined }]);
  });

  it('getBundleFoldersByFolder GETs the nested /Bundle/Folders/{id}/Folders', async () => {
    const { client, calls } = fakeClient({ data: [], totalItems: 0 });
    await new SoftwareModule(client).getBundleFoldersByFolder('f-1');
    expect(calls).toEqual([
      { method: 'GET', url: `${BASE}/Bundle/Folders/f-1/Folders`, params: {} },
    ]);
  });

  it('createBundleFolder POSTs to /Bundle/Folders and returns the created folder', async () => {
    const body = { name: 'Apps' } as unknown as BundleFolderForCreation;
    const created = { id: 'f-9', name: 'Apps' };
    const { client, calls } = fakeClient(created);
    const result = await new SoftwareModule(client).createBundleFolder(body);
    expect(calls).toEqual([{ method: 'POST', url: `${BASE}/Bundle/Folders`, body }]);
    expect(result).toEqual(created);
  });

  it('deleteBundleFolder DELETEs /Bundle/Folders/{id}', async () => {
    const { client, calls } = fakeClient();
    await new SoftwareModule(client).deleteBundleFolder('f-1');
    expect(calls).toEqual([{ method: 'DELETE', url: `${BASE}/Bundle/Folders/f-1` }]);
  });

  it('updateBundleFolder PATCHes /Bundle/Folders/{id} with the json-patch content type', async () => {
    const patchDoc = [{ op: 'replace', path: '/name', value: 'Renamed' }] as unknown as JsonPatchDocument;
    const updated = { id: 'f-1', name: 'Renamed' };
    const { client, calls } = fakeClient(updated);
    const result = await new SoftwareModule(client).updateBundleFolder('f-1', patchDoc);
    expect(calls).toEqual([
      { method: 'PATCH', url: `${BASE}/Bundle/Folders/f-1`, body: patchDoc, headers: PATCH_HEADERS },
    ]);
    expect(result).toEqual(updated);
  });
});
