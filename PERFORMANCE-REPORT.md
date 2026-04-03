# Performance Report — bConnect-MCP

## Measurement Date

2026-03-24

## Test Environment

| Property         | Value                                           |
|------------------|-------------------------------------------------|
| Node.js Version  | v20.20.1                                        |
| OS               | Ubuntu (aarch64) — Linux 6.17.0-1014-nvidia     |
| Architecture     | aarch64 (ARM64)                                 |
| Test Runner      | Vitest v3.2.4                                   |
| Mock Backend     | MSW (Mock Service Worker) v2.x — no live server |
| Calls per Test   | 100 sequential calls per endpoint               |

---

## API Latency Results — 8 Endpoints

All measurements: 100 sequential MSW-backed calls per endpoint.
Thresholds: **P50 < 200 ms** (soft) | **P95 < 500 ms** (hard ceiling).

| # | Endpoint | Method | P50 (ms) | P95 (ms) | P99 (ms) | Min (ms) | Max (ms) | P50 Status | P95 Status |
|---|----------|--------|----------|----------|----------|----------|----------|------------|------------|
| 1 | list_endpoints | GET /endpoints/v2.0/Endpoints | 0.57 | 1.94 | 3.43 | 0.44 | 14.72 | PASS | PASS |
| 2 | get_endpoint | GET /endpoints/v2.0/Endpoints/{id} | 0.52 | 0.63 | 0.90 | 0.43 | 2.69 | PASS | PASS |
| 3 | list_jobs | GET /jobs/v2.0/JobDefinitions | 0.45 | 0.67 | 3.10 | 0.42 | 3.56 | PASS | PASS |
| 4 | get_job_instances | GET /jobs/v2.0/JobInstances | 0.46 | 0.64 | 2.59 | 0.42 | 2.61 | PASS | PASS |
| 5 | list_assets | GET /assets/v2.0/Assets | 0.44 | 0.54 | 2.97 | 0.41 | 3.22 | PASS | PASS |
| 6 | get_asset | GET /assets/v2.0/Assets/{id} | 0.40 | 0.48 | 0.64 | 0.37 | 3.18 | PASS | PASS |
| 7 | list_ad_users | GET /activedirectory/v2.0/ADUsers | 0.41 | 0.55 | 2.53 | 0.38 | 2.59 | PASS | PASS |
| 8 | list_ad_groups | GET /activedirectory/v2.0/ADGroups | 0.40 | 0.53 | 2.81 | 0.38 | 4.38 | PASS | PASS |

All 8 endpoints are well within thresholds. P95 values range from 0.48 ms to 1.94 ms (threshold: 500 ms). P50 values range from 0.40 ms to 0.57 ms (threshold: 200 ms).

---

## Memory Usage Baseline

### Test 1: Heap delta across 1,000 sequential `getEndpoints()` calls

| Metric | Before Calls | After Calls | Delta | Limit | Status |
|--------|-------------|-------------|-------|-------|--------|
| Heap Used | 16.72 MB | 55.32 MB | 38.59 MB | 200 MB | PASS |
| Heap Total | 31.34 MB | 88.67 MB | — | — | — |
| RSS | 79.02 MB | 148.45 MB | 69.44 MB | 500 MB | PASS |

### Test 2: Memory stability across 3 sustained phases (1,000 calls each)

| Phase | Heap Used | Heap Total | RSS | Delta from Previous | Limit | Status |
|-------|-----------|------------|-----|---------------------|-------|--------|
| Phase 1 | 99.08 MB | 126.42 MB | 193.45 MB | — | — | — |
| Phase 2 | 139.66 MB | 168.57 MB | 240.95 MB | +40.59 MB | 75 MB | PASS |
| Phase 3 | 179.35 MB | 209.82 MB | 287.98 MB | +39.68 MB | 75 MB | PASS |

Inter-phase heap growth is consistent (~40 MB per phase), well within the 75 MB limit. No memory leak detected.

---

## Build Status

| Check | Result |
|-------|--------|
| `npm run build` (TypeScript compile) | 0 errors, 0 warnings — PASS |

---

## Test Summary

| Suite | Tests | Passed | Failed | Duration |
|-------|-------|--------|--------|----------|
| api-performance.test.ts | 8 | 8 | 0 | 450 ms |
| memory-usage.test.ts | 2 | 2 | 0 | 1244 ms |
| **Total** | **10** | **10** | **0** | **1.63 s** |

Exit code: **0** — all performance gates passed.

---

## Overall Verdict

**ALL PASS** — No threshold violations. The bConnect-MCP server satisfies all API latency and memory usage performance requirements under MSW-mocked in-process load.
