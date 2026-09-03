/**
 * `VariablesModule` — verb/route/body assertions for all 13 methods.
 *
 * Before this file, `variables.ts` measured **16.98% statements** and the
 * workspace sat at 52.55% against a 52 floor — **0.55 points of margin**, so the
 * next unrelated commit would have turned CI red and looked like its author's
 * fault. The shortfall was entirely the module: `bconnect-client.ts` was 100%.
 *
 * Fake `AxiosInstance`. No network, no live bMS, no mock server.
 *
 * ── This module hid a real defect behind a coverage number ──────────────────
 * Both `update*` methods PATCHed with NO content type. All 25 PATCH operations
 * in the 26R1 specs accept `application/json-patch+json` and nothing else, and
 * axios sends `application/json` when none is given, so `update_variable_
 * definition` and `update_variable_instance` were 415s — two shipped write
 * tools that could not have worked.
 *
 * It survived two checks that were looking straight at it, because this file
 * NAMES the media type twice in its generated type aliases —
 * `operations['UpdateVariableDefinition']['requestBody']['content']
 * ['application/json-patch+json']` — so any check counting occurrences of the
 * string concluded the header was set. It was not. `__tests__/
 * suite-patch-content-type.test.ts` now reads call-site ARGUMENTS instead, and
 * the two assertions below pin the header per route.
 */

import { describe, it, expect } from 'vitest';
import type { AxiosInstance } from 'axios';
import { VariablesModule } from '../modules/variables.js';

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

const BASE = (new VariablesModule(fakeClient().client) as unknown as { basePath: string }).basePath;
const EMPTY_PAGE = { data: [], totalItems: 0 };
const PATCH_HEADERS = { 'Content-Type': 'application/json-patch+json' };
const PATCH_DOC = [{ op: 'replace', path: '/value', value: 'x' }] as never;

describe('VariablesModule — the base path itself', () => {
  it('basePath is the version this module is written against', () => {
    expect(BASE).toBe('/variables/v2.0');
  });
});

describe('VariablesModule — variable definitions', () => {
  it('getVariableDefinitions GETs /VariableDefinitions and forwards params', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new VariablesModule(client).getVariableDefinitions({ PageSize: 10 });
    expect(calls).toEqual([
      { method: 'GET', url: `${BASE}/VariableDefinitions`, params: { PageSize: 10 } },
    ]);
  });

  it('getVariableDefinitions defaults params to {}', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new VariablesModule(client).getVariableDefinitions();
    expect(calls[0]?.params).toEqual({});
  });

  it('getVariableDefinition GETs /VariableDefinitions/{id}', async () => {
    const { client, calls } = fakeClient({ id: 'vd-1' });
    await new VariablesModule(client).getVariableDefinition('vd-1');
    expect(calls).toEqual([{ method: 'GET', url: `${BASE}/VariableDefinitions/vd-1`, params: undefined }]);
  });

  it('createVariableDefinition POSTs the body and returns the transport payload', async () => {
    const body = { name: 'SiteCode' } as never;
    const created = { id: 'vd-9', name: 'SiteCode' };
    const { client, calls } = fakeClient(created);
    const result = await new VariablesModule(client).createVariableDefinition(body);
    expect(calls).toEqual([{ method: 'POST', url: `${BASE}/VariableDefinitions`, body }]);
    expect(result).toEqual(created);
  });

  it('updateVariableDefinition PATCHes WITH the json-patch content type', async () => {
    // This was bare. Two mentions of the media type in this module's type
    // aliases made it look set to anything grepping the file.
    const updated = { id: 'vd-1' };
    const { client, calls } = fakeClient(updated);
    const result = await new VariablesModule(client).updateVariableDefinition('vd-1', PATCH_DOC);
    expect(calls).toEqual([
      { method: 'PATCH', url: `${BASE}/VariableDefinitions/vd-1`, body: PATCH_DOC, headers: PATCH_HEADERS },
    ]);
    expect(result).toEqual(updated);
  });

  it('deleteVariableDefinition DELETEs /VariableDefinitions/{id}', async () => {
    const { client, calls } = fakeClient();
    await new VariablesModule(client).deleteVariableDefinition('vd-1');
    expect(calls).toEqual([{ method: 'DELETE', url: `${BASE}/VariableDefinitions/vd-1` }]);
  });
});

describe('VariablesModule — variable instances', () => {
  it('getVariableInstances GETs /VariableInstances', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new VariablesModule(client).getVariableInstances({ PageSize: 5 });
    expect(calls).toEqual([{ method: 'GET', url: `${BASE}/VariableInstances`, params: { PageSize: 5 } }]);
  });

  it('getVariableInstance GETs /VariableInstances/{id}', async () => {
    const { client, calls } = fakeClient({ id: 'vi-1' });
    await new VariablesModule(client).getVariableInstance('vi-1');
    expect(calls).toEqual([{ method: 'GET', url: `${BASE}/VariableInstances/vi-1`, params: undefined }]);
  });

  it('updateVariableInstance PATCHes WITH the json-patch content type', async () => {
    const updated = { id: 'vi-1' };
    const { client, calls } = fakeClient(updated);
    const result = await new VariablesModule(client).updateVariableInstance('vi-1', PATCH_DOC);
    expect(calls).toEqual([
      { method: 'PATCH', url: `${BASE}/VariableInstances/vi-1`, body: PATCH_DOC, headers: PATCH_HEADERS },
    ]);
    expect(result).toEqual(updated);
  });
});

describe('VariablesModule — the five parent-scoped instance reads', () => {
  it('getVariableInstancesByEndpoint GETs /Endpoints/{id}/VariableInstances', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new VariablesModule(client).getVariableInstancesByEndpoint('ep-1', { PageSize: 3 });
    expect(calls).toEqual([
      { method: 'GET', url: `${BASE}/Endpoints/ep-1/VariableInstances`, params: { PageSize: 3 } },
    ]);
  });

  it('getVariableInstancesByLogicalGroup GETs /LogicalGroups/{id}/VariableInstances', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new VariablesModule(client).getVariableInstancesByLogicalGroup('lg-1');
    expect(calls).toEqual([
      { method: 'GET', url: `${BASE}/LogicalGroups/lg-1/VariableInstances`, params: {} },
    ]);
  });

  it('getVariableInstancesByADObject GETs /ADObjects/{id}/VariableInstances', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new VariablesModule(client).getVariableInstancesByADObject('ad-1');
    expect(calls).toEqual([
      { method: 'GET', url: `${BASE}/ADObjects/ad-1/VariableInstances`, params: {} },
    ]);
  });

  it('getVariableInstancesByWindowsJobDefinition uses /WindowsJobDefinitions, not /JobDefinitions', async () => {
    // The jobs server serves /JobDefinitions. This one is Windows-qualified, and
    // the unqualified spelling is the obvious thing to type from memory.
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new VariablesModule(client).getVariableInstancesByWindowsJobDefinition('jd-1');
    expect(calls).toEqual([
      { method: 'GET', url: `${BASE}/WindowsJobDefinitions/jd-1/VariableInstances`, params: {} },
    ]);
    expect(calls[0]?.url).not.toContain('/JobDefinitions/');
  });

  it('getVariableInstancesByWindowsApplication uses /WindowsApplications', async () => {
    const { client, calls } = fakeClient(EMPTY_PAGE);
    await new VariablesModule(client).getVariableInstancesByWindowsApplication('app-1');
    expect(calls).toEqual([
      { method: 'GET', url: `${BASE}/WindowsApplications/app-1/VariableInstances`, params: {} },
    ]);
  });

  it('the wrapped reads return their payload through readSubResource unchanged', async () => {
    const payload = { data: [{ id: 'vi-1' }], totalItems: 1 };
    const mod = new VariablesModule(fakeClient(payload).client);
    expect(await mod.getVariableInstancesByEndpoint('ep-1')).toEqual(payload);
    expect(await mod.getVariableInstancesByWindowsJobDefinition('jd-1')).toEqual(payload);
  });
});
