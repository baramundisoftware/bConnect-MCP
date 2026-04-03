/**
 * Performance Tests: Memory usage for 1,000 sequential calls
 *
 * Asserts that heap memory growth stays below 200MB across 1,000 sequential
 * MSW-backed calls to endpoints.getEndpoints().
 *
 * Measurements:
 *   - heapUsed delta (after - before) < 200MB  (primary assertion)
 *   - RSS growth < 500MB                        (secondary assertion)
 *
 * GC: If --expose-gc is available (Node flag), garbage collection is forced
 * between the baseline measurement and the call loop to give a clean baseline.
 * This is optional — the test does not require --expose-gc to run.
 *
 * MSW is set up locally in this file; no shared setup file is required.
 * No real HTTP calls are made — CI/CD safe.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { BConnectClient } from '../../bconnect-client.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = 'https://bms-memory-test:444/bconnect';
const CALL_COUNT = 1_000;

/** Maximum allowed heap growth in bytes: 200MB */
const MAX_HEAP_DELTA_BYTES = 200 * 1024 * 1024;

/** Maximum allowed RSS growth in bytes: 500MB */
const MAX_RSS_DELTA_BYTES = 500 * 1024 * 1024;

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_ENDPOINTS_RESPONSE = {
  totalItems: 3,
  data: [
    {
      id: '00000001-0000-0000-0000-000000000000',
      displayName: 'mem-test-endpoint-1',
      hostName: 'mem-test-endpoint-1',
      primaryIP: '10.0.0.1',
      operatingSystem: 'Microsoft Windows Server 2022 Standard',
      lastSeen: '2026-03-24T10:00:00Z',
      isOnline: true
    },
    {
      id: '00000002-0000-0000-0000-000000000000',
      displayName: 'mem-test-endpoint-2',
      hostName: 'mem-test-endpoint-2',
      primaryIP: '10.0.0.2',
      operatingSystem: 'Microsoft Windows 11 Pro',
      lastSeen: '2026-03-24T09:50:00Z',
      isOnline: false
    },
    {
      id: '00000003-0000-0000-0000-000000000000',
      displayName: 'mem-test-endpoint-3',
      hostName: 'mem-test-endpoint-3',
      primaryIP: '10.0.0.3',
      operatingSystem: 'Ubuntu 22.04 LTS',
      lastSeen: '2026-03-24T09:30:00Z',
      isOnline: true
    }
  ]
};

// ─── MSW server setup ─────────────────────────────────────────────────────────

const mswServer = setupServer(
  http.get(`${BASE_URL}/endpoints/v2.0/Endpoints`, () => {
    return HttpResponse.json(MOCK_ENDPOINTS_RESPONSE);
  })
);

// ─── Helper utilities ─────────────────────────────────────────────────────────

/** Convert bytes to a human-readable MB string (2 decimal places). */
function toMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

/**
 * Attempt a forced garbage collection if --expose-gc was passed to Node.
 * Falls back silently when gc() is not available (most CI environments).
 */
function tryForceGC(): void {
  if (typeof (globalThis as unknown as { gc?: () => void }).gc === 'function') {
    (globalThis as unknown as { gc: () => void }).gc();
  }
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('Performance: Memory usage across 1,000 sequential MSW-backed calls', () => {
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
      username: 'mem-test-user',
      password: 'mem-test-pass',
      rejectUnauthorized: false,
      disableHttpsAgent: true
    });
  });

  afterAll(() => {
    mswServer.close();
  });

  it(
    `heap delta < 200MB and RSS growth < 500MB across ${CALL_COUNT} sequential getEndpoints() calls`,
    async () => {
      // ── Phase 1: Baseline measurement ──────────────────────────────────────
      // Force GC before measuring baseline so that any allocations from module
      // initialisation are collected first (only effective with --expose-gc).
      tryForceGC();

      const before = process.memoryUsage();

      console.info(
        '[Memory] Baseline before calls:\n' +
        `  heapUsed=${toMB(before.heapUsed)}  heapTotal=${toMB(before.heapTotal)}  rss=${toMB(before.rss)}`
      );

      // ── Phase 2: Run 1,000 sequential calls ────────────────────────────────
      for (let i = 0; i < CALL_COUNT; i++) {
        const result = await bconnect.endpoints.getEndpoints({ PageSize: 20, Page: 0 });
        // Light assertion to prevent the result from being optimised away and
        // to verify each call actually returns data.
        expect(result).toBeDefined();
      }

      // ── Phase 3: Post-call measurement ─────────────────────────────────────
      // Attempt GC again before the final measurement to remove short-lived
      // allocations from the call loop and measure only retained memory.
      tryForceGC();

      const after = process.memoryUsage();

      const heapDelta = after.heapUsed - before.heapUsed;
      const rssDelta  = after.rss      - before.rss;

      // ── Phase 4: Report ────────────────────────────────────────────────────
      console.info(
        `[Memory] After ${CALL_COUNT} sequential calls:\n` +
        `  heapUsed=${toMB(after.heapUsed)}  heapTotal=${toMB(after.heapTotal)}  rss=${toMB(after.rss)}\n` +
        `[Memory] Delta:\n` +
        `  heapUsed delta=${toMB(heapDelta)}  (limit: ${toMB(MAX_HEAP_DELTA_BYTES)})\n` +
        `  RSS delta=${toMB(rssDelta)}  (limit: ${toMB(MAX_RSS_DELTA_BYTES)})`
      );

      // ── Phase 5: Assertions ────────────────────────────────────────────────
      expect(
        heapDelta,
        `Heap used grew by ${toMB(heapDelta)} which exceeds the 200MB limit. ` +
        `This may indicate a memory leak across ${CALL_COUNT} sequential calls.`
      ).toBeLessThan(MAX_HEAP_DELTA_BYTES);

      expect(
        rssDelta,
        `RSS grew by ${toMB(rssDelta)} which exceeds the 500MB limit. ` +
        `This may indicate OS-level memory retention across ${CALL_COUNT} sequential calls.`
      ).toBeLessThan(MAX_RSS_DELTA_BYTES);
    },
    // Generous timeout: 1,000 MSW-backed calls should finish well under 60s,
    // but allow headroom for slow CI machines.
    60_000
  );

  // ─── Test 2: Memory stability across 3 sustained phases ─────────────────────

  it(
    'memory is stable across 3 phases of 1,000 calls each',
    async () => {
      /**
       * Maximum allowed heap increase between consecutive phases: 75MB.
       *
       * Without --expose-gc the V8 heap is not compacted between phases, so
       * some growth is expected as the runtime promotes short-lived allocations
       * into older generations before GC reclaims them.  75MB gives enough
       * headroom to survive normal V8 behaviour while still catching genuine
       * leaks (e.g. unbounded caches, event-listener accumulation) that would
       * show multi-hundred-MB growth per phase.
       */
      const MAX_PHASE_HEAP_INCREASE_BYTES = 75 * 1024 * 1024;

      const phaseHeapUsed: number[] = [];

      for (let phase = 1; phase <= 3; phase++) {
        // Run 1,000 calls for this phase
        for (let i = 0; i < CALL_COUNT; i++) {
          const result = await bconnect.endpoints.getEndpoints({ PageSize: 20, Page: 0 });
          expect(result).toBeDefined();
        }

        // Attempt GC after each phase before measuring so only retained
        // allocations are captured (effective only with --expose-gc).
        tryForceGC();

        const mem = process.memoryUsage();
        phaseHeapUsed.push(mem.heapUsed);

        console.info(
          `[Memory] Phase ${phase}/3 (after ${CALL_COUNT} calls + GC attempt):\n` +
          `  heapUsed=${toMB(mem.heapUsed)}  heapTotal=${toMB(mem.heapTotal)}  rss=${toMB(mem.rss)}`
        );
      }

      // Assert no phase increases heap by more than 50MB relative to the previous phase.
      // This detects sustained memory leaks across repeated load phases.
      for (let i = 1; i < phaseHeapUsed.length; i++) {
        const delta = phaseHeapUsed[i] - phaseHeapUsed[i - 1];
        console.info(
          `[Memory] Phase ${i} → Phase ${i + 1} heap delta: ${toMB(delta)}  ` +
          `(limit: ${toMB(MAX_PHASE_HEAP_INCREASE_BYTES)})`
        );
        expect(
          delta,
          `Heap grew by ${toMB(delta)} between phase ${i} and phase ${i + 1}, ` +
          `exceeding the 75MB inter-phase limit. This indicates a memory leak across sustained load.`
        ).toBeLessThan(MAX_PHASE_HEAP_INCREASE_BYTES);
      }
    },
    // 3 phases × 1,000 calls each; allow up to 3 minutes for slow CI machines.
    180_000
  );
});
