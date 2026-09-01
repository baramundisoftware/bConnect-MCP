/**
 * `JobsModule` — HTTP verb/route/body assertions for every write-capable
 * method (F2 / EVAL-2026-08-02 optimization audit).
 *
 * Before this file, `jobs.ts` measured 15.96% statements and NONE of its
 * write methods (createJobInstance, startJobInstance, stopJobInstance,
 * resumeJobInstance, deleteJobInstance, createFolder, updateFolder,
 * deleteFolder, the four assignJobDefinitionTo* variants, createKioskRelease,
 * withdrawKioskRelease) had a single assertion that the right HTTP verb,
 * route or body reached the transport. This is the same defect class as the
 * historical `update_bitlocker_pin` bug: a PATCH built against a route the
 * API does not serve, unnoticed for four rounds because nothing asserted the
 * URL a write method actually built.
 *
 * These use a fake `AxiosInstance` — no network, no live bMS.
 *
 * ── Why BASE is read off the module (E6, audit 2026-08-03) ──────────────────
 * This header used to claim the tests asserted against the module's own
 * `basePath` "so a rename doesn't false-fail these tests". They did not: line
 * 57 was a hard-coded `const BASE = '/jobs/v2.0'`, and the auditor's basePath
 * mutation (`v2.0` -> `v2.1`) false-failed **31 of 32** tests. The comment
 * described the opposite of the code. Re-measured here before the fix: 31
 * failed, 1 passed. Confirmed.
 *
 * Both halves are now true rather than only the comment. Each route test pins
 * the *relative* structure (verb, sub-path, body) against a BASE read from the
 * module, so a version bump does not bury a real route regression under 31
 * unrelated failures. The base path is still pinned — once, by
 * `basePath is the version this module is written against` below — so the bump
 * itself fails loudly, with one message that names what changed.
 *
 * BASE is read through a cast because `basePath` is `private`; that privacy is
 * why the original was hard-coded. Deriving it from a probe call instead was
 * rejected: it would make every route assertion relative to whichever call the
 * probe used, so an error in *that* route would be absorbed into BASE and
 * silence the rest.
 */

import { describe, it, expect } from 'vitest';
import type { AxiosInstance } from 'axios';
import { BConnectApiError } from '@bconnect/mcp-core';
import { JobsModule } from '../modules/jobs.js';

interface Call {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  body?: unknown;
  params?: unknown;
}

/** Records every call the module makes and answers each with `responseData`. */
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
    patch: async (url: string, body?: unknown) => {
      calls.push({ method: 'PATCH', url, body });
      return { data: responseData };
    },
    delete: async (url: string) => {
      calls.push({ method: 'DELETE', url });
      return { data: responseData };
    },
  } as unknown as AxiosInstance;
  return { client, calls };
}

/**
 * The module's own base path. Read from the instance, so the route tests below
 * survive a version bump; the bump is caught once, by the test that follows.
 */
const BASE = (
  new JobsModule(fakeClient().client) as unknown as { basePath: string }
).basePath;

describe('JobsModule — the base path itself', () => {
  it('basePath is the version this module is written against', () => {
    // The single place the literal is pinned. If this fails and the route
    // tests below still pass, the base path moved and nothing else did —
    // check that every route in this module exists under the new version
    // before updating the literal.
    expect(BASE).toBe('/jobs/v2.0');
  });
});

describe('JobsModule — basic job-definition and job-instance reads', () => {
  it('getJobDefinitions GETs /JobDefinitions', async () => {
    const { client, calls } = fakeClient({ data: [] });
    const jobs = new JobsModule(client);
    await jobs.getJobDefinitions({ SearchQuery: 'patch' });
    expect(calls).toEqual([{ method: 'GET', url: `${BASE}/JobDefinitions`, params: { SearchQuery: 'patch' } }]);
  });

  it('getJobDefinition GETs /JobDefinitions/{id}', async () => {
    const { client, calls } = fakeClient({ id: 'jd-1' });
    const jobs = new JobsModule(client);
    await jobs.getJobDefinition('jd-1');
    expect(calls).toEqual([{ method: 'GET', url: `${BASE}/JobDefinitions/jd-1`, params: undefined }]);
  });

  it('getJobDefinitionsByFolder GETs /Folders/{folderId}/JobDefinitions', async () => {
    const { client, calls } = fakeClient({ data: [] });
    const jobs = new JobsModule(client);
    await jobs.getJobDefinitionsByFolder('f-1');
    expect(calls).toEqual([
      { method: 'GET', url: `${BASE}/Folders/f-1/JobDefinitions`, params: undefined },
    ]);
  });

  it('getJobInstances GETs /JobInstances', async () => {
    const { client, calls } = fakeClient({ data: [] });
    const jobs = new JobsModule(client);
    await jobs.getJobInstances({ PageSize: 20 });
    expect(calls).toEqual([{ method: 'GET', url: `${BASE}/JobInstances`, params: { PageSize: 20 } }]);
  });

  it('getJobInstance GETs /JobInstances/{id}, distinct from the collection route', async () => {
    const { client, calls } = fakeClient({ id: 'ji-1' });
    const jobs = new JobsModule(client);
    await jobs.getJobInstance('ji-1');
    expect(calls).toEqual([{ method: 'GET', url: `${BASE}/JobInstances/ji-1`, params: undefined }]);
  });

  it('getEndpointJobInstances GETs /Endpoints/{id}/JobInstances', async () => {
    const { client, calls } = fakeClient({ data: [] });
    const jobs = new JobsModule(client);
    await jobs.getEndpointJobInstances('ep-1', { PageSize: 5 });
    expect(calls).toEqual([
      { method: 'GET', url: `${BASE}/Endpoints/ep-1/JobInstances`, params: { PageSize: 5 } },
    ]);
  });
});

describe('JobsModule — job-instance lookups by definition/group', () => {
  it('getJobInstancesByJobDefinition GETs /JobDefinitions/{id}/JobInstances', async () => {
    const { client, calls } = fakeClient({ data: [] });
    const jobs = new JobsModule(client);
    await jobs.getJobInstancesByJobDefinition('jd-1', { PageSize: 3 });
    expect(calls).toEqual([
      { method: 'GET', url: `${BASE}/JobDefinitions/jd-1/JobInstances`, params: { PageSize: 3 } },
    ]);
  });

  it('getJobInstancesByLogicalGroup GETs /LogicalGroups/{id}/JobInstances, not the JobDefinitions route', async () => {
    const { client, calls } = fakeClient({ data: [] });
    const jobs = new JobsModule(client);
    await jobs.getJobInstancesByLogicalGroup('lg-1');
    expect(calls).toEqual([
      { method: 'GET', url: `${BASE}/LogicalGroups/lg-1/JobInstances`, params: undefined },
    ]);
  });
});

describe('JobsModule — job instance lifecycle writes', () => {
  it('createJobInstance POSTs the caller body to /JobInstances and returns the created instance', async () => {
    const { client, calls } = fakeClient({ id: 'ji-1', jobDefinitionId: 'jd-1' });
    const jobs = new JobsModule(client);
    const body = { jobDefinitionId: 'jd-1', endpointId: 'ep-1' } as never;

    const result = await jobs.createJobInstance(body);

    expect(calls).toEqual([{ method: 'POST', url: `${BASE}/JobInstances`, body }]);
    expect(result).toEqual({ id: 'ji-1', jobDefinitionId: 'jd-1' });
  });

  it('startJobInstance POSTs to /JobInstances/{id}/Start with no body', async () => {
    const { client, calls } = fakeClient();
    const jobs = new JobsModule(client);

    await jobs.startJobInstance('ji-42');

    expect(calls).toEqual([{ method: 'POST', url: `${BASE}/JobInstances/ji-42/Start`, body: undefined }]);
  });

  it('stopJobInstance POSTs to /JobInstances/{id}/Stop', async () => {
    const { client, calls } = fakeClient();
    const jobs = new JobsModule(client);

    await jobs.stopJobInstance('ji-42');

    expect(calls).toEqual([{ method: 'POST', url: `${BASE}/JobInstances/ji-42/Stop`, body: undefined }]);
  });

  it('resumeJobInstance POSTs to /JobInstances/{id}/Resume', async () => {
    const { client, calls } = fakeClient();
    const jobs = new JobsModule(client);

    await jobs.resumeJobInstance('ji-42');

    expect(calls).toEqual([{ method: 'POST', url: `${BASE}/JobInstances/ji-42/Resume`, body: undefined }]);
  });

  it('deleteJobInstance DELETEs /JobInstances/{id}', async () => {
    const { client, calls } = fakeClient();
    const jobs = new JobsModule(client);

    await jobs.deleteJobInstance('ji-42');

    expect(calls).toEqual([{ method: 'DELETE', url: `${BASE}/JobInstances/ji-42` }]);
  });

  it('the four lifecycle verbs hit four DISTINCT sub-paths off the same id', async () => {
    // A direct regression guard for exactly the kind of mistake this class of
    // defect is: Start/Stop/Resume collapsing onto the same route because
    // they were copy-pasted from one another.
    const { client, calls } = fakeClient();
    const jobs = new JobsModule(client);

    await jobs.startJobInstance('ji-1');
    await jobs.stopJobInstance('ji-1');
    await jobs.resumeJobInstance('ji-1');
    await jobs.deleteJobInstance('ji-1');

    const urls = calls.map((c) => c.url);
    expect(new Set(urls).size).toBe(4);
    expect(urls).toEqual([
      `${BASE}/JobInstances/ji-1/Start`,
      `${BASE}/JobInstances/ji-1/Stop`,
      `${BASE}/JobInstances/ji-1/Resume`,
      `${BASE}/JobInstances/ji-1`,
    ]);
  });
});

describe('JobsModule — folder writes', () => {
  it('createFolder POSTs the body to /Folders', async () => {
    const { client, calls } = fakeClient({ id: 'f-1', name: 'Deployments' });
    const jobs = new JobsModule(client);
    const body = { name: 'Deployments' } as never;

    const result = await jobs.createFolder(body);

    expect(calls).toEqual([{ method: 'POST', url: `${BASE}/Folders`, body }]);
    expect(result).toEqual({ id: 'f-1', name: 'Deployments' });
  });

  it('updateFolder PATCHes /Folders/{id} with a JSON Patch document, not a whole-object body', async () => {
    const { client, calls } = fakeClient({ id: 'f-1', name: 'Renamed' });
    const jobs = new JobsModule(client);
    const patch = [{ op: 'replace', path: '/name', value: 'Renamed' }] as never;

    const result = await jobs.updateFolder('f-1', patch);

    expect(calls).toEqual([{ method: 'PATCH', url: `${BASE}/Folders/f-1`, body: patch }]);
    // The whole point of JSON Patch: the body is the array of operations,
    // never the target resource shape.
    expect(Array.isArray(calls[0].body)).toBe(true);
    expect(result.name).toBe('Renamed');
  });

  it('deleteFolder DELETEs /Folders/{id}', async () => {
    const { client, calls } = fakeClient();
    const jobs = new JobsModule(client);

    await jobs.deleteFolder('f-1');

    expect(calls).toEqual([{ method: 'DELETE', url: `${BASE}/Folders/f-1` }]);
  });
});

describe('JobsModule — job-to-group assignment writes', () => {
  const body = { jobDefinitionId: 'jd-1' } as never;

  it('assignJobDefinitionToLogicalGroup POSTs to LogicalGroups/{id}/AssignJobDefinition', async () => {
    const { client, calls } = fakeClient([{ id: 'ji-1' }]);
    const jobs = new JobsModule(client);

    const result = await jobs.assignJobDefinitionToLogicalGroup('lg-1', body);

    expect(calls).toEqual([
      { method: 'POST', url: `${BASE}/LogicalGroups/lg-1/AssignJobDefinition`, body },
    ]);
    expect(result).toEqual([{ id: 'ji-1' }]);
  });

  it('assignJobDefinitionToStaticGroup POSTs to StaticGroups/{id}/AssignJobDefinition', async () => {
    const { client, calls } = fakeClient([]);
    const jobs = new JobsModule(client);

    await jobs.assignJobDefinitionToStaticGroup('sg-1', body);

    expect(calls).toEqual([
      { method: 'POST', url: `${BASE}/StaticGroups/sg-1/AssignJobDefinition`, body },
    ]);
  });

  it('assignJobDefinitionToWindowsDynamicGroup POSTs to DynamicGroups/{id}/AssignJobDefinition', async () => {
    const { client, calls } = fakeClient([]);
    const jobs = new JobsModule(client);

    await jobs.assignJobDefinitionToWindowsDynamicGroup('dg-1', body);

    expect(calls).toEqual([
      { method: 'POST', url: `${BASE}/DynamicGroups/dg-1/AssignJobDefinition`, body },
    ]);
  });

  it('assignJobDefinitionToUniversalDynamicGroup POSTs to UniversalDynamicGroups/{id}/AssignJobDefinition', async () => {
    const { client, calls } = fakeClient([]);
    const jobs = new JobsModule(client);

    await jobs.assignJobDefinitionToUniversalDynamicGroup('udg-1', body);

    expect(calls).toEqual([
      { method: 'POST', url: `${BASE}/UniversalDynamicGroups/udg-1/AssignJobDefinition`, body },
    ]);
  });

  it('the four group-assignment writers hit four DISTINCT collection roots', () => {
    // Guards against the exact substring-confusion class documented in
    // HANDOFF.md ("dynamicgroup is a substring of universaldynamicgroup") —
    // if WindowsDynamicGroup and UniversalDynamicGroup ever collapsed onto
    // the same route, this fails.
    const roots = [
      `${BASE}/LogicalGroups/x/AssignJobDefinition`,
      `${BASE}/StaticGroups/x/AssignJobDefinition`,
      `${BASE}/DynamicGroups/x/AssignJobDefinition`,
      `${BASE}/UniversalDynamicGroups/x/AssignJobDefinition`,
    ];
    expect(new Set(roots).size).toBe(4);
  });
});

describe('JobsModule — kiosk release writes', () => {
  it('createKioskRelease POSTs the body to /KioskReleases', async () => {
    const { client, calls } = fakeClient({ id: 'kr-1' });
    const jobs = new JobsModule(client);
    // The real body key is assignmentTargetId (KioskReleaseForCreation) —
    // this fixture said `targetId` until 2026-08-11, quietly matching the
    // tool-schema defect fixed the same day (TOOL-REVIEW-MATRIX.md H2).
    const body = { jobDefinitionId: 'jd-1', assignmentTargetId: 't-1' } as never;

    const result = await jobs.createKioskRelease(body);

    expect(calls).toEqual([{ method: 'POST', url: `${BASE}/KioskReleases`, body }]);
    expect(result).toEqual({ id: 'kr-1' });
  });

  it('withdrawKioskRelease DELETEs /KioskReleases/{id}', async () => {
    const { client, calls } = fakeClient();
    const jobs = new JobsModule(client);

    await jobs.withdrawKioskRelease('kr-1');

    expect(calls).toEqual([{ method: 'DELETE', url: `${BASE}/KioskReleases/kr-1` }]);
  });

  it('create and withdraw hit different routes (POST collection vs DELETE by id)', async () => {
    const { client, calls } = fakeClient({ id: 'kr-9' });
    const jobs = new JobsModule(client);

    await jobs.createKioskRelease({ jobDefinitionId: 'jd-1' } as never);
    await jobs.withdrawKioskRelease('kr-9');

    expect(calls[0]).toMatchObject({ method: 'POST', url: `${BASE}/KioskReleases` });
    expect(calls[1]).toMatchObject({ method: 'DELETE', url: `${BASE}/KioskReleases/kr-9` });
  });
});

describe('JobsModule — read methods this server exposes for groups/folders/kiosk context', () => {
  // Cheap to cover in the same pass as the writes above: same fake-client
  // pattern, and these were also 0%-covered lines in jobs.ts.
  it('getKioskReleases GETs /KioskReleases with the caller\'s pagination params', async () => {
    const { client, calls } = fakeClient({ data: [] });
    const jobs = new JobsModule(client);
    await jobs.getKioskReleases({ PageSize: 5 });
    expect(calls).toEqual([{ method: 'GET', url: `${BASE}/KioskReleases`, params: { PageSize: 5 } }]);
  });

  it('getKioskRelease GETs /KioskReleases/{id}, distinct from the collection route', async () => {
    const { client, calls } = fakeClient({ id: 'kr-1' });
    const jobs = new JobsModule(client);
    await jobs.getKioskRelease('kr-1');
    expect(calls).toEqual([{ method: 'GET', url: `${BASE}/KioskReleases/kr-1`, params: undefined }]);
  });

  it('getJobFolders GETs /Folders', async () => {
    const { client, calls } = fakeClient({ data: [] });
    const jobs = new JobsModule(client);
    await jobs.getJobFolders({ PageSize: 10 });
    expect(calls).toEqual([{ method: 'GET', url: `${BASE}/Folders`, params: { PageSize: 10 } }]);
  });

  it('getJobFolder GETs /Folders/{id}', async () => {
    const { client, calls } = fakeClient({ id: 'f-1' });
    const jobs = new JobsModule(client);
    await jobs.getJobFolder('f-1');
    expect(calls).toEqual([{ method: 'GET', url: `${BASE}/Folders/f-1`, params: undefined }]);
  });

  it('getJobSubfolders GETs /Folders/{folderId}/Folders', async () => {
    const { client, calls } = fakeClient({ data: [] });
    const jobs = new JobsModule(client);
    await jobs.getJobSubfolders('f-1');
    expect(calls).toEqual([{ method: 'GET', url: `${BASE}/Folders/f-1/Folders`, params: undefined }]);
  });

  it('getKioskReleasesByJobDefinition/ByEndpoint/ByAdObject/ByLogicalGroup each hit a distinct route', async () => {
    // A NON-EMPTY page on purpose. getKioskReleasesByJobDefinition confirms its
    // parent when the page comes back empty (that route answers 200 with
    // totalItems 0 for a job definition that does not exist — measured live
    // 2026-08-14), and the confirmation would add a call here that has nothing
    // to do with what this test is about. The confirmation itself is pinned by
    // 'the KioskReleases 200 is overloaded' below.
    const { client, calls } = fakeClient({ data: [{ id: 'k-1' }], totalItems: 1 });
    const jobs = new JobsModule(client);

    await jobs.getKioskReleasesByJobDefinition('jd-1');
    await jobs.getKioskReleasesByEndpoint('ep-1');
    await jobs.getKioskReleasesByAdObject('ad-1');
    await jobs.getKioskReleasesByLogicalGroup('lg-1');

    expect(calls.map((c) => c.url)).toEqual([
      `${BASE}/JobDefinitions/jd-1/KioskReleases`,
      `${BASE}/Endpoints/ep-1/KioskReleases`,
      `${BASE}/ADObjects/ad-1/KioskReleases`,
      `${BASE}/LogicalGroups/lg-1/KioskReleases`,
    ]);
  });

  describe('the KioskReleases 200 is overloaded', () => {
    /**
     * Measured live 2026-08-14 against 26.1.161.0:
     * `GET /jobs/v2.0/JobDefinitions/{id}/KioskReleases` answers **200 with
     * totalItems 0 for a job definition that does not exist** — two independent
     * nonexistent GUIDs — while `/JobDefinitions/{id}/JobInstances` answers 404
     * for the same ids. Unguarded, a stale id reads as "no kiosk releases".
     *
     * These pin it at the module, where the wrapper is wired. The wrapper's own
     * behaviour is pinned in mcp-core against fixtures.
     */
    function routedClient(
      answer: (url: string) => unknown
    ): { client: AxiosInstance; urls: string[] } {
      const urls: string[] = [];
      const client = {
        get: async (url: string) => {
          urls.push(url);
          const value = answer(url);
          if (value instanceof Error) {throw value;}
          return { data: value };
        },
      } as unknown as AxiosInstance;
      return { client, urls };
    }

    const EMPTY = { data: [], totalItems: 0 };

    it('refuses to report zero kiosk releases for a job definition that does not exist', async () => {
      const { client, urls } = routedClient((url) =>
        url.endsWith('/KioskReleases')
          ? EMPTY
          : new BConnectApiError(404, 'Resource not found.', { method: 'GET', path: url })
      );
      await expect(new JobsModule(client).getKioskReleasesByJobDefinition('jd-gone')).rejects.toThrow(
        /does not exist, so this is NOT "no kiosk releases"/
      );
      // Vacuity: the parent really was consulted, so the rejection is the
      // confirmation firing and not the read itself failing.
      expect(urls).toEqual([
        `${BASE}/JobDefinitions/jd-gone/KioskReleases`,
        `${BASE}/JobDefinitions/jd-gone`,
      ]);
    });

    it('still reports a real zero for a job definition that exists', async () => {
      // The benign case is REACHABLE: a genuine job definition with zero kiosk
      // releases exists on the reference estate. Turning that into an error
      // would trade one false answer for another.
      const { client, urls } = routedClient((url) =>
        url.endsWith('/KioskReleases') ? EMPTY : { id: 'jd-1' }
      );
      await expect(
        new JobsModule(client).getKioskReleasesByJobDefinition('jd-1')
      ).resolves.toEqual(EMPTY);
      expect(urls).toHaveLength(2);
    });

    it('leaves the other three KioskReleases parents alone — they 404 honestly', async () => {
      // Endpoints, LogicalGroups and ADObjects all answer 404 for a bad id, so
      // they need no confirmation and must not pay for one.
      const { client, urls } = routedClient(() => EMPTY);
      const jobs = new JobsModule(client);
      await jobs.getKioskReleasesByEndpoint('ep-1');
      await jobs.getKioskReleasesByAdObject('ad-1');
      await jobs.getKioskReleasesByLogicalGroup('lg-1');
      expect(urls).toEqual([
        `${BASE}/Endpoints/ep-1/KioskReleases`,
        `${BASE}/ADObjects/ad-1/KioskReleases`,
        `${BASE}/LogicalGroups/lg-1/KioskReleases`,
      ]);
    });
  });

  it('getJobInstancesByStaticGroup/ByDynamicGroup/ByUniversalDynamicGroup each hit a distinct route', async () => {
    const { client, calls } = fakeClient({ data: [] });
    const jobs = new JobsModule(client);

    await jobs.getJobInstancesByStaticGroup('sg-1');
    await jobs.getJobInstancesByDynamicGroup('dg-1');
    await jobs.getJobInstancesByUniversalDynamicGroup('udg-1');

    expect(calls.map((c) => c.url)).toEqual([
      `${BASE}/StaticGroups/sg-1/JobInstances`,
      `${BASE}/DynamicGroups/dg-1/JobInstances`,
      `${BASE}/UniversalDynamicGroups/udg-1/JobInstances`,
    ]);
    // The exact substring trap named in HANDOFF.md: DynamicGroups is a
    // substring of UniversalDynamicGroups, so a `.includes()`-style check
    // (rather than the route each method hard-codes) could conflate them.
    expect(calls[1].url).not.toContain('UniversalDynamicGroups');
  });
});
