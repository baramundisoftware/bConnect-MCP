/**
 * Performance Tests: API response time for 8 list/get operations
 *
 * Each test runs 100 sequential MSW-backed calls and asserts:
 *   - P95 < 500ms  (hard ceiling — catches regressions)
 *   - P50 < 200ms  (reasonable expectation for in-process MSW mocking)
 *
 * Modules covered:
 *   1. list_endpoints     — GET /endpoints/v2.0/Endpoints
 *   2. get_endpoint       — GET /endpoints/v2.0/Endpoints/{id}
 *   3. list_jobs          — GET /jobs/v2.0/JobDefinitions
 *   4. get_job_instances  — GET /jobs/v2.0/JobInstances
 *   5. list_assets        — GET /assets/v2.0/Assets
 *   6. get_asset          — GET /assets/v2.0/Assets/{id}
 *   7. list_ad_users      — GET /activedirectory/v2.0/ADUsers
 *   8. list_ad_groups     — GET /activedirectory/v2.0/ADGroups
 *
 * MSW is set up locally in this file; no shared setup file is required.
 * No real HTTP calls are made — CI/CD safe.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { BConnectClient } from '../../bconnect-client.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const BASE_URL = 'https://bms-perf-test:444/bconnect';
const CALL_COUNT = 100;

/** Percentile thresholds in milliseconds */
const P50_THRESHOLD_MS = 200;
const P95_THRESHOLD_MS = 500;

// Fixed GUIDs used in single-item GET tests
const ENDPOINT_GUID = 'aabbccdd-0000-0000-0000-000000000001';
const ASSET_GUID    = 'aabbccdd-0000-0000-0000-000000000002';

// ─── Mock data ────────────────────────────────────────────────────────────────

// Endpoints mock data
const MOCK_ENDPOINTS_RESPONSE = {
  totalItems: 3,
  data: [
    {
      id: '00000001-0000-0000-0000-000000000000',
      displayName: 'perf-test-endpoint-1',
      hostName: 'perf-test-endpoint-1',
      primaryIP: '10.0.0.1',
      operatingSystem: 'Microsoft Windows Server 2022 Standard',
      lastSeen: '2026-03-24T10:00:00Z',
      isOnline: true
    },
    {
      id: '00000002-0000-0000-0000-000000000000',
      displayName: 'perf-test-endpoint-2',
      hostName: 'perf-test-endpoint-2',
      primaryIP: '10.0.0.2',
      operatingSystem: 'Microsoft Windows 11 Pro',
      lastSeen: '2026-03-24T09:50:00Z',
      isOnline: false
    },
    {
      id: '00000003-0000-0000-0000-000000000000',
      displayName: 'perf-test-endpoint-3',
      hostName: 'perf-test-endpoint-3',
      primaryIP: '10.0.0.3',
      operatingSystem: 'Ubuntu 22.04 LTS',
      lastSeen: '2026-03-24T09:30:00Z',
      isOnline: true
    }
  ]
};

const MOCK_SINGLE_ENDPOINT = {
  id: ENDPOINT_GUID,
  displayName: 'perf-single-endpoint',
  hostName: 'perf-single-endpoint',
  primaryIP: '10.1.0.1',
  operatingSystem: 'Microsoft Windows 10 Pro',
  lastSeen: '2026-03-24T08:00:00Z',
  isOnline: true
};

// Jobs mock data
const MOCK_JOB_DEFINITIONS_RESPONSE = {
  totalItems: 2,
  data: [
    {
      id: 'jd-00000001-0000-0000-0000-000000000000',
      name: 'perf-test-job-definition-1',
      displayName: 'Perf Test Job Definition 1',
      description: 'Performance test job definition',
      jobType: 'Software',
      isEnabled: true
    },
    {
      id: 'jd-00000002-0000-0000-0000-000000000000',
      name: 'perf-test-job-definition-2',
      displayName: 'Perf Test Job Definition 2',
      description: 'Performance test job definition 2',
      jobType: 'Script',
      isEnabled: true
    }
  ]
};

const MOCK_JOB_INSTANCES_RESPONSE = {
  totalItems: 3,
  data: [
    {
      id: 'ji-00000001-0000-0000-0000-000000000000',
      jobDefinitionId: 'jd-00000001-0000-0000-0000-000000000000',
      jobDefinitionName: 'Perf Test Job Definition 1',
      endpointId: '00000001-0000-0000-0000-000000000000',
      endpointName: 'perf-test-endpoint-1',
      status: 'Succeeded',
      startedAt: '2026-03-24T09:00:00Z',
      completedAt: '2026-03-24T09:05:00Z'
    },
    {
      id: 'ji-00000002-0000-0000-0000-000000000000',
      jobDefinitionId: 'jd-00000001-0000-0000-0000-000000000000',
      jobDefinitionName: 'Perf Test Job Definition 1',
      endpointId: '00000002-0000-0000-0000-000000000000',
      endpointName: 'perf-test-endpoint-2',
      status: 'Running',
      startedAt: '2026-03-24T10:00:00Z',
      completedAt: null
    },
    {
      id: 'ji-00000003-0000-0000-0000-000000000000',
      jobDefinitionId: 'jd-00000002-0000-0000-0000-000000000000',
      jobDefinitionName: 'Perf Test Job Definition 2',
      endpointId: '00000003-0000-0000-0000-000000000000',
      endpointName: 'perf-test-endpoint-3',
      status: 'Failed',
      startedAt: '2026-03-24T08:00:00Z',
      completedAt: '2026-03-24T08:02:00Z'
    }
  ]
};

// Assets mock data
const MOCK_ASSETS_RESPONSE = {
  totalItems: 2,
  data: [
    {
      assetId: '00000001-aaaa-0000-0000-000000000000',
      manufacturer: 'Dell',
      model: 'Latitude 5520',
      serialNumber: 'SN-PERF-001',
      assetTag: 'AT-PERF-001',
      purchaseDate: '2023-01-15',
      warrantyExpiryDate: '2026-01-15'
    },
    {
      assetId: '00000002-aaaa-0000-0000-000000000000',
      manufacturer: 'HP',
      model: 'EliteBook 840',
      serialNumber: 'SN-PERF-002',
      assetTag: 'AT-PERF-002',
      purchaseDate: '2022-06-20',
      warrantyExpiryDate: '2025-06-20'
    }
  ]
};

const MOCK_SINGLE_ASSET = {
  assetId: ASSET_GUID,
  manufacturer: 'Lenovo',
  model: 'ThinkPad X1 Carbon',
  serialNumber: 'SN-PERF-SINGLE',
  assetTag: 'AT-PERF-SINGLE',
  purchaseDate: '2024-01-10',
  warrantyExpiryDate: '2027-01-10'
};

// Active Directory mock data
const MOCK_AD_USERS_RESPONSE = {
  totalItems: 2,
  data: [
    {
      id: 'adu-00000001-0000-0000-0000-000000000000',
      name: 'perf.user1',
      sAMAccountName: 'perf.user1',
      displayName: 'Perf User 1',
      email: 'perf.user1@example.com',
      isEnabled: true
    },
    {
      id: 'adu-00000002-0000-0000-0000-000000000000',
      name: 'perf.user2',
      sAMAccountName: 'perf.user2',
      displayName: 'Perf User 2',
      email: 'perf.user2@example.com',
      isEnabled: true
    }
  ]
};

const MOCK_AD_GROUPS_RESPONSE = {
  totalItems: 2,
  data: [
    {
      id: 'adg-00000001-0000-0000-0000-000000000000',
      name: 'perf-group-1',
      sAMAccountName: 'perf-group-1',
      displayName: 'Perf Group 1',
      description: 'Performance test group 1',
      groupType: 'Security'
    },
    {
      id: 'adg-00000002-0000-0000-0000-000000000000',
      name: 'perf-group-2',
      sAMAccountName: 'perf-group-2',
      displayName: 'Perf Group 2',
      description: 'Performance test group 2',
      groupType: 'Distribution'
    }
  ]
};

// ─── MSW server setup ─────────────────────────────────────────────────────────

const mswServer = setupServer(
  // 1. list_endpoints — GET /endpoints/v2.0/Endpoints
  http.get(`${BASE_URL}/endpoints/v2.0/Endpoints`, () => {
    return HttpResponse.json(MOCK_ENDPOINTS_RESPONSE);
  }),

  // 2. get_endpoint — GET /endpoints/v2.0/Endpoints/{id}
  http.get(`${BASE_URL}/endpoints/v2.0/Endpoints/:id`, () => {
    return HttpResponse.json(MOCK_SINGLE_ENDPOINT);
  }),

  // 3. list_jobs — GET /jobs/v2.0/JobDefinitions
  http.get(`${BASE_URL}/jobs/v2.0/JobDefinitions`, () => {
    return HttpResponse.json(MOCK_JOB_DEFINITIONS_RESPONSE);
  }),

  // 4. get_job_instances — GET /jobs/v2.0/JobInstances
  http.get(`${BASE_URL}/jobs/v2.0/JobInstances`, () => {
    return HttpResponse.json(MOCK_JOB_INSTANCES_RESPONSE);
  }),

  // 5. list_assets — GET /assets/v2.0/Assets
  http.get(`${BASE_URL}/assets/v2.0/Assets`, () => {
    return HttpResponse.json(MOCK_ASSETS_RESPONSE);
  }),

  // 6. get_asset — GET /assets/v2.0/Assets/{id}
  http.get(`${BASE_URL}/assets/v2.0/Assets/:id`, () => {
    return HttpResponse.json(MOCK_SINGLE_ASSET);
  }),

  // 7. list_ad_users — GET /activedirectory/v2.0/ADUsers
  http.get(`${BASE_URL}/activedirectory/v2.0/ADUsers`, () => {
    return HttpResponse.json(MOCK_AD_USERS_RESPONSE);
  }),

  // 8. list_ad_groups — GET /activedirectory/v2.0/ADGroups
  http.get(`${BASE_URL}/activedirectory/v2.0/ADGroups`, () => {
    return HttpResponse.json(MOCK_AD_GROUPS_RESPONSE);
  })
);

// ─── Helper utilities ─────────────────────────────────────────────────────────

/**
 * Calculate the value at the given percentile of a sorted numeric array.
 * Uses the nearest-rank method (1-indexed).
 */
function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedValues.length);
  return sortedValues[rank - 1];
}

/**
 * Run CALL_COUNT sequential timed calls, print a summary, and assert thresholds.
 */
async function runPerfTest(
  label: string,
  fn: () => Promise<void>
): Promise<void> {
  const durations: number[] = [];

  for (let i = 0; i < CALL_COUNT; i++) {
    const start = performance.now();
    await fn();
    durations.push(performance.now() - start);
  }

  const sorted = [...durations].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const mean = durations.reduce((acc, v) => acc + v, 0) / durations.length;

  console.info(
    `[Performance] ${CALL_COUNT} sequential ${label} calls:\n` +
    `  min=${min.toFixed(2)}ms  mean=${mean.toFixed(2)}ms  ` +
    `P50=${p50.toFixed(2)}ms  P95=${p95.toFixed(2)}ms  P99=${p99.toFixed(2)}ms  ` +
    `max=${max.toFixed(2)}ms`
  );

  expect(
    p95,
    `P95 latency (${p95.toFixed(2)}ms) exceeds ${P95_THRESHOLD_MS}ms threshold for ${label}`
  ).toBeLessThan(P95_THRESHOLD_MS);

  expect(
    p50,
    `P50 latency (${p50.toFixed(2)}ms) exceeds ${P50_THRESHOLD_MS}ms threshold for ${label}`
  ).toBeLessThan(P50_THRESHOLD_MS);
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('Performance: API latency via MSW-mocked handlers', () => {
  let bconnect: BConnectClient;

  beforeAll(() => {
    // Start MSW — warn on unhandled requests so accidental real calls surface immediately
    mswServer.listen({ onUnhandledRequest: 'warn' });

    // BConnectClient pointing at the mock BASE_URL.
    // disableHttpsAgent is required so that axios does NOT attach a custom
    // https.Agent; MSW only intercepts requests made through Node's default
    // http/https stack.
    bconnect = new BConnectClient({
      baseUrl: BASE_URL,
      username: 'perf-test-user',
      password: 'perf-test-pass',
      rejectUnauthorized: false,
      disableHttpsAgent: true
    });
  });

  afterAll(() => {
    mswServer.close();
  });

  // ── Test 1: list_endpoints ─────────────────────────────────────────────────

  it(
    `1/8 list_endpoints: ${CALL_COUNT} calls — P95 < ${P95_THRESHOLD_MS}ms, P50 < ${P50_THRESHOLD_MS}ms`,
    async () => {
      await runPerfTest('list_endpoints', async () => {
        const result = await bconnect.endpoints.getEndpoints({ PageSize: 20, Page: 0 });
        expect(result).toBeDefined();
        expect(result).toHaveProperty('totalItems');
        expect(result).toHaveProperty('data');
        expect(Array.isArray((result as any).data)).toBe(true);
      });
    },
    15_000
  );

  // ── Test 2: get_endpoint ───────────────────────────────────────────────────

  it(
    `2/8 get_endpoint: ${CALL_COUNT} calls — P95 < ${P95_THRESHOLD_MS}ms, P50 < ${P50_THRESHOLD_MS}ms`,
    async () => {
      await runPerfTest('get_endpoint', async () => {
        const result = await bconnect.endpoints.getEndpoint(ENDPOINT_GUID);
        expect(result).toBeDefined();
        expect((result as any).id).toBe(ENDPOINT_GUID);
      });
    },
    15_000
  );

  // ── Test 3: list_jobs (job definitions) ───────────────────────────────────

  it(
    `3/8 list_jobs: ${CALL_COUNT} calls — P95 < ${P95_THRESHOLD_MS}ms, P50 < ${P50_THRESHOLD_MS}ms`,
    async () => {
      await runPerfTest('list_jobs', async () => {
        const result = await bconnect.jobs.getJobDefinitions({ PageSize: 20, Page: 0 });
        expect(result).toBeDefined();
        expect(result).toHaveProperty('totalItems');
        expect(result).toHaveProperty('data');
        expect(Array.isArray((result as any).data)).toBe(true);
      });
    },
    15_000
  );

  // ── Test 4: get_job_instances ─────────────────────────────────────────────

  it(
    `4/8 get_job_instances: ${CALL_COUNT} calls — P95 < ${P95_THRESHOLD_MS}ms, P50 < ${P50_THRESHOLD_MS}ms`,
    async () => {
      await runPerfTest('get_job_instances', async () => {
        const result = await bconnect.jobs.getJobInstances({ PageSize: 20, Page: 0 });
        expect(result).toBeDefined();
        expect(result).toHaveProperty('totalItems');
        expect(result).toHaveProperty('data');
        expect(Array.isArray((result as any).data)).toBe(true);
      });
    },
    15_000
  );

  // ── Test 5: list_assets ───────────────────────────────────────────────────

  it(
    `5/8 list_assets: ${CALL_COUNT} calls — P95 < ${P95_THRESHOLD_MS}ms, P50 < ${P50_THRESHOLD_MS}ms`,
    async () => {
      await runPerfTest('list_assets', async () => {
        const result = await bconnect.assets.getAssets({ PageSize: 20, Page: 0 });
        expect(result).toBeDefined();
        expect(result).toHaveProperty('totalItems');
        expect(result).toHaveProperty('data');
        expect(Array.isArray((result as any).data)).toBe(true);
      });
    },
    15_000
  );

  // ── Test 6: get_asset ─────────────────────────────────────────────────────

  it(
    `6/8 get_asset: ${CALL_COUNT} calls — P95 < ${P95_THRESHOLD_MS}ms, P50 < ${P50_THRESHOLD_MS}ms`,
    async () => {
      await runPerfTest('get_asset', async () => {
        const result = await bconnect.assets.getAsset(ASSET_GUID);
        expect(result).toBeDefined();
        expect((result as any).assetId).toBe(ASSET_GUID);
      });
    },
    15_000
  );

  // ── Test 7: list_ad_users ─────────────────────────────────────────────────

  it(
    `7/8 list_ad_users: ${CALL_COUNT} calls — P95 < ${P95_THRESHOLD_MS}ms, P50 < ${P50_THRESHOLD_MS}ms`,
    async () => {
      await runPerfTest('list_ad_users', async () => {
        const result = await bconnect.activedirectory.getADUsers({ PageSize: 20, Page: 0 });
        expect(result).toBeDefined();
        expect(result).toHaveProperty('totalItems');
        expect(result).toHaveProperty('data');
        expect(Array.isArray((result as any).data)).toBe(true);
      });
    },
    15_000
  );

  // ── Test 8: list_ad_groups ────────────────────────────────────────────────

  it(
    `8/8 list_ad_groups: ${CALL_COUNT} calls — P95 < ${P95_THRESHOLD_MS}ms, P50 < ${P50_THRESHOLD_MS}ms`,
    async () => {
      await runPerfTest('list_ad_groups', async () => {
        const result = await bconnect.activedirectory.getADGroups({ PageSize: 20, Page: 0 });
        expect(result).toBeDefined();
        expect(result).toHaveProperty('totalItems');
        expect(result).toHaveProperty('data');
        expect(Array.isArray((result as any).data)).toBe(true);
      });
    },
    15_000
  );
});
