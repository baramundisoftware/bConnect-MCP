/**
 * Opt-in response projection (TOK-2/-4/-5/-7 = TOK-21/23/24/27).
 *
 * The fixtures are modelled on the row shapes the evaluation measured live on
 * bMS 26R1 — an installed-software page with echoed request keys and null AUT
 * columns, and a Windows endpoint row with the full 53-field detail projection.
 * The numbers asserted are therefore reductions on realistic rows, not on
 * invented ones.
 *
 * Two properties matter more than any byte count and are pinned first: a tool
 * that declares no projection is not reshaped, and `detail: true` returns the
 * payload exactly as the API sent it.
 */

import { describe, it, expect } from 'vitest';
import {
  createListShaper,
  shapeListResponse,
  shapeRecord,
  shapeRows,
  projectRow,
  findNullColumns,
  findConstantColumns,
  DEFAULT_FULL_MODE_HINT,
} from '@bconnect/mcp-core';

/** A page of `list_installed_software_by_endpoint`, live shape (~430 B/row). */
function softwarePage(rows = 20) {
  return {
    page: 0,
    pageSize: 20,
    totalItems: 130,
    totalPages: 7,
    data: Array.from({ length: rows }, (_, i) => ({
      endpointId: 'e57a7e00-0000-4000-8000-000000000027',
      endpointName: 'WORKSTATION1',
      name: `Application ${i}`,
      vendor: 'Microsoft Corporation',
      version: `1.${i}.0`,
      applicationId: null,
      category: null,
      installed: null,
      source: i % 2 === 0 ? 'WindowsInstaller' : 'Registry',
      autFirstUse: null,
      autLastUse: null,
      autLastData: null,
      autUsage: 'AutDeactivated',
    })),
  };
}

/** A `list_windows_endpoints` row, trimmed to the shape that makes it ~3 KB. */
function windowsEndpointRow(i: number) {
  return {
    id: `9dd53b61-888b-42c4-bd1a-9b8dae00${String(i).padStart(4, '0')}`,
    displayName: `WIN11CLIENT${i}`,
    hostName: `win11client${i}`,
    operatingSystem: 'Windows 11 Enterprise',
    osVersionString: '10.0.26100',
    lastSeen: '2026-08-01T22:14:03Z',
    logicalGroup: 'labcorp.local/Clients',
    clientAgentVersion: '26.1.140',
    cpu: { name: 'Intel(R) Core(TM) i7-1185G7', cores: 4, logicalProcessors: 8, maxClockSpeedMhz: 2995 },
    storageMedia: [
      { volumeId: 'e57a7e00-0000-4000-8000-000000000002', letter: 'C', sizeBytes: 511000000000, freeBytes: 213000000000 },
      { volumeId: 'e57a7e00-0000-4000-8000-000000000007', letter: 'D', sizeBytes: 1000000000000, freeBytes: 900000000000 },
    ],
    energyScheme: 'Balanced (recommended) — e57a7e00-0000-4000-8000-000000000011',
    bootMode: 'UEFI',
    coManagement: { enrolled: true, workloads: 'CompliancePolicy,ResourceAccess' },
    consoleLink: `bMC:///navigationCriteria=9dd53b61-888b-42c4-bd1a-9b8dae00${String(i).padStart(4, '0')}%20/navigationCriteriaType=Id%20/navigationObjectType=Endpoint`,
  };
}

const WINDOWS_COMPACT = [
  'id', 'displayName', 'hostName', 'operatingSystem',
  'osVersionString', 'lastSeen', 'logicalGroup', 'clientAgentVersion',
];

describe('nothing is reshaped that was not opted in', () => {
  it('leaves a payload alone when the caller asks for the full record', () => {
    const payload = softwarePage(3);
    const shaped = shapeListResponse(payload, { dropConstantColumns: true }, { full: true });

    // Same object, not a copy that happens to match — `detail: true` is the raw
    // API record, so a model can always reach a field the projection hid.
    expect(shaped).toBe(payload);
  });

  it('passes through a payload that is not a list envelope', () => {
    const single = { id: 'abc', displayName: 'WORKSTATION1' };
    expect(shapeListResponse(single, { compactFields: ['id'] })).toBe(single);
    const bareArray = { items: [{ id: 'a' }] };
    expect(shapeListResponse(bareArray, { compactFields: ['id'] })).toBe(bareArray);
  });

  it('is a per-tool call, so an unshaped tool stays unshaped', () => {
    // There is no interceptor and no client hook to prove absent; the shaper is
    // a function a case arm calls. A tool that does not call it is untouched by
    // construction, which is the point of the design.
    const shaper = createListShaper({ compactFields: WINDOWS_COMPACT });
    expect(typeof shaper).toBe('function');
  });
});

describe('compact projection (TOK-21: list_windows_endpoints)', () => {
  const shape = createListShaper({
    compactFields: WINDOWS_COMPACT,
    meta: { consoleLinkTemplate: 'bMC:///navigationCriteria={id} /navigationCriteriaType=Id /navigationObjectType={type}' },
  });

  it('keeps only the declared fields, in the declared order', () => {
    const page = { data: [windowsEndpointRow(1), windowsEndpointRow(2)], totalItems: 2 };
    const shaped = shape(page) as { data: Record<string, unknown>[] };

    expect(Object.keys(shaped.data[0])).toEqual(WINDOWS_COMPACT);
    expect(shaped.data[0].cpu).toBeUndefined();
    expect(shaped.data[0].storageMedia).toBeUndefined();
    expect(shaped.data[0].consoleLink).toBeUndefined();
  });

  it('preserves the envelope, which is how the caller knows to page', () => {
    const page = { page: 0, pageSize: 20, totalItems: 213, totalPages: 11, data: [windowsEndpointRow(1)] };
    const shaped = shape(page) as Record<string, unknown>;

    expect(shaped.page).toBe(0);
    expect(shaped.pageSize).toBe(20);
    expect(shaped.totalItems).toBe(213);
    expect(shaped.totalPages).toBe(11);
  });

  it('emits the console-link template once instead of per row (TOK-23)', () => {
    const page = { data: [windowsEndpointRow(1), windowsEndpointRow(2)] };
    const shaped = shape(page) as { meta: Record<string, unknown> };

    expect(shaped.meta.consoleLinkTemplate).toMatch(/navigationCriteria=\{id\}/);
    expect(JSON.stringify(shaped)).not.toContain('e57a7e00-0000-4000-8000-000000000026%20');
  });

  it('tells the model how to get the rest, and what its absence does not mean', () => {
    const shaped = shape({ data: [windowsEndpointRow(1)] }) as {
      meta: { hint?: string; projectedAway?: string[] };
    };
    // The escape hatch is still named verbatim...
    expect(shaped.meta.hint).toContain('Pass detail:true for the full API record.');
    // ...but a caller who does not know a field was removed has no reason to
    // reach for it. Measured live, list_endpoints kept 10 fields and silently
    // removed 43 — including isDeactivated, which made "is this endpoint
    // deactivated?" answerable NO on an estate with 20 ghost machines.
    expect(shaped.meta.projectedAway).toBeDefined();
    expect(shaped.meta.hint).toContain('NOT evidence they are unset on the estate');
  });

  it('names every field the compact projection removed', () => {
    const row = windowsEndpointRow(1);
    const shaped = shape({ data: [row] }) as {
      rows?: unknown;
      data?: Record<string, unknown>[];
      meta: { projectedAway?: string[] };
    };
    const kept = new Set(Object.keys((shaped.data ?? [])[0] ?? {}));
    const removed = Object.keys(row).filter((k) => !kept.has(k));
    // Every removed key is named, and nothing that survived is named.
    expect([...(shaped.meta.projectedAway ?? [])].sort()).toEqual(removed.sort());
    for (const key of shaped.meta.projectedAway ?? []) {
      expect(kept.has(key)).toBe(false);
    }
  });

  it('cuts a 20-row page by more than half', () => {
    const page = { page: 0, pageSize: 20, totalItems: 213, totalPages: 11, data: Array.from({ length: 20 }, (_, i) => windowsEndpointRow(i)) };

    const before = JSON.stringify(page).length;
    const after = JSON.stringify(shape(page)).length;

    expect(after).toBeLessThan(before * 0.5);
  });

  it('honours caller-named fields over the declared projection', () => {
    const shaped = shape({ data: [windowsEndpointRow(1)] }, { fields: ['id', 'lastSeen'] }) as {
      data: Record<string, unknown>[];
      meta: { projection: string };
    };

    expect(Object.keys(shaped.data[0])).toEqual(['id', 'lastSeen']);
    expect(shaped.meta.projection).toBe('fields');
  });
});

describe('echo and constant stripping (TOK-24: software inventory)', () => {
  const shape = createListShaper({
    dropEchoedArgs: ['endpointId'],
    dropConstantColumns: true,
  });

  const args = { endpointId: 'e57a7e00-0000-4000-8000-000000000027' };

  it('drops the field that merely echoes the caller’s own argument', () => {
    const shaped = shape(softwarePage(3), { args }) as {
      data: Record<string, unknown>[];
      meta: { echoed?: Record<string, unknown> };
    };

    expect(shaped.data[0].endpointId).toBeUndefined();
    expect(shaped.meta.echoed).toEqual({ endpointId: 'e57a7e00-0000-4000-8000-000000000027' });
  });

  it('drops columns constant across the page, keeping the value once', () => {
    const shaped = shape(softwarePage(20), { args }) as {
      data: Record<string, unknown>[];
      meta: { constant?: Record<string, unknown> };
    };

    expect(shaped.meta.constant).toMatchObject({
      endpointName: 'WORKSTATION1',
      autUsage: 'AutDeactivated',
      autFirstUse: null,
      autLastUse: null,
      autLastData: null,
      applicationId: null,
      category: null,
      installed: null,
      vendor: 'Microsoft Corporation',
    });
    expect(shaped.data[0].endpointName).toBeUndefined();
    expect(shaped.data[0].autUsage).toBeUndefined();
    // Lossless: every dropped value is still in the response, once.
    expect(JSON.stringify(shaped)).toContain('WORKSTATION1');
  });

  it('keeps the fields that actually vary', () => {
    const shaped = shape(softwarePage(20), { args }) as { data: Record<string, unknown>[] };
    expect(Object.keys(shaped.data[0])).toEqual(['name', 'version', 'source']);
    expect(shaped.data[0].name).toBe('Application 0');
  });

  it('reaches the ~60% reduction the evaluation measured as available', () => {
    const page = softwarePage(20);
    const before = JSON.stringify(page).length;
    const after = JSON.stringify(shape(page, { args })).length;

    expect(1 - after / before).toBeGreaterThan(0.55);
  });

  it('does not eat a one-row page', () => {
    // On a single row every column is "constant". Without the guard the
    // projection would return an empty object and call it a saving.
    const shaped = shape(softwarePage(1), { args }) as { data: Record<string, unknown>[] };

    expect(Object.keys(shaped.data[0]).length).toBeGreaterThan(5);
    expect(shaped.data[0].name).toBe('Application 0');
    // The echoed argument is still dropped — that one does not need two rows.
    expect(shaped.data[0].endpointId).toBeUndefined();
  });

  it('does not drop a field whose value only resembles the argument', () => {
    const page = {
      data: [
        { endpointId: 'aaaa', name: 'a' },
        { endpointId: 'bbbb', name: 'b' },
      ],
    };
    const shaped = shapeListResponse(page, { dropEchoedArgs: ['endpointId'] }, { args: { endpointId: 'aaaa' } }) as {
      data: Record<string, unknown>[];
    };

    expect(shaped.data[0].endpointId).toBe('aaaa');
  });
});

describe('alwaysDrop (TOK-27: list_job_instances steps[])', () => {
  it('drops the declared fields and names them once', () => {
    const page = {
      totalItems: 229,
      data: [
        { id: '000e1071', state: 'FinishedSuccessfully', lastAction: '2026-02-04T21:27:40Z', steps: [{ windowsApplicationId: 'aaaa-bbbb' }] },
        { id: '01f841b2', state: 'Running', lastAction: '2026-02-05T09:02:11Z', steps: [{ windowsApplicationId: 'cccc-dddd' }] },
      ],
    };
    const shaped = shapeListResponse(page, {
      alwaysDrop: ['steps'],
      fullModeHint: 'Pass includeSteps:true, or call get_job_instance, for the step detail.',
    }) as { data: Record<string, unknown>[]; meta: { dropped?: string[]; hint?: string } };

    expect(shaped.data[0].steps).toBeUndefined();
    expect(shaped.data[0].state).toBe('FinishedSuccessfully');
    expect(shaped.meta.dropped).toEqual(['steps']);
    expect(shaped.meta.hint).toMatch(/includeSteps:true/);
  });

  it('emits no hint when the projection sets none', () => {
    const shaped = shapeListResponse(
      { data: [{ id: 'a', steps: [1] }, { id: 'b', steps: [2] }] },
      { alwaysDrop: ['steps'], fullModeHint: null }
    ) as { meta: { hint?: string } };

    expect(shaped.meta.hint).toBeUndefined();
  });
});

describe('primitives', () => {
  it('projectRow keeps requested fields and skips absent ones', () => {
    expect(projectRow({ a: 1, b: 2 }, ['b', 'a', 'zz'])).toEqual({ b: 2, a: 1 });
  });

  it('findNullColumns finds only the all-null columns', () => {
    expect(findNullColumns([{ a: null, b: 1 }, { a: null, b: null }])).toEqual(['a']);
  });

  it('findConstantColumns compares by value, including objects', () => {
    const constant = findConstantColumns([
      { a: 1, b: { x: 1 }, c: 'v' },
      { a: 1, b: { x: 1 }, c: 'w' },
    ]);
    expect(constant).toEqual({ a: 1, b: { x: 1 } });
  });

  it('shapeRows works on the nested arrays a composite tool builds', () => {
    // get_fleet_summary's needsAttention / agentVersionOutliers arrays are not
    // in a `data` envelope, and they carry ~4.6 KB of the ~9.6 KB digest.
    const { rows, meta } = shapeRows(
      [
        { id: 'a', displayName: 'A', consoleLink: 'bMC:///…a' },
        { id: 'b', displayName: 'B', consoleLink: 'bMC:///…b' },
      ],
      { alwaysDrop: ['consoleLink'], meta: { consoleLinkTemplate: 'bMC:///…{id}' } }
    );

    expect(rows).toEqual([{ id: 'a', displayName: 'A' }, { id: 'b', displayName: 'B' }]);
    expect(meta.consoleLinkTemplate).toBe('bMC:///…{id}');
  });

  it('shapeRecord projects a single record and never treats it as a page', () => {
    const record = windowsEndpointRow(1);
    const shaped = shapeRecord(record, { compactFields: WINDOWS_COMPACT, dropConstantColumns: true });

    expect(Object.keys(shaped)).toEqual(WINDOWS_COMPACT);
    expect(shapeRecord(record, { compactFields: ['id'] }, { full: true })).toBe(record);
  });
});

// ─── ARCH-9: the full-mode hint is exported, not copied ──────────────────────

describe('DEFAULT_FULL_MODE_HINT', () => {
  it('is exported from the barrel', () => {
    // It was module-private, so two v1.1 slices each declared their own copy of
    // the string with a comment naming this constant. A hand-maintained
    // parallel copy of a shared literal is this codebase's most repeated defect.
    expect(DEFAULT_FULL_MODE_HINT).toBe('Pass detail:true for the full API record.');
  });

  it('still matches the copies the two v1.1 slices carry', async () => {
    // Read from the shipped sources rather than restated here: until those two
    // modules import the constant, this is the only thing holding the wordings
    // together. Delete this test when they do.
    const { readFileSync } = await import('node:fs');
    const copies = [
      'bconnect-endpoints-mcp/src/modules/inventory-scans-v11.ts',
      'bconnect-updatemanagement-mcp/src/modules/microsoft-update-v11.ts',
    ];
    for (const file of copies) {
      const source = readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8');
      const declared = /V11_FULL_MODE_HINT\s*=\s*"([^"]*)"/.exec(source)?.[1];
      expect(declared, `${file} declares no V11_FULL_MODE_HINT`).toBeDefined();
      expect(declared, `${file} has drifted from DEFAULT_FULL_MODE_HINT`).toBe(DEFAULT_FULL_MODE_HINT);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// meta.constant must not state a PAGE fact as a COLLECTION fact
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The hallucinated-fact family, as distinct from the missing-fact family the
 * rest of this suite guards.
 *
 * `findConstantColumns` only ever sees the rows on ONE page. `shapeListResponse`
 * then removes those columns from every row, so the claim cannot be contradicted
 * from within the response — while the envelope alongside it says
 * `totalItems: 52, totalPages: 3`. Nothing in the code compares `rows.length`
 * to `totalItems`, and `minRowsForConstantDrop` is a floor of 2, not a fraction
 * of the collection.
 *
 * Confirmed live on the reference estate: `list_ad_groups` at PageSize 20
 * returned `constant: {domain, type}` over 20 rows of 52, with both columns
 * stripped from the data.
 *
 * `resultTrustworthy` cannot catch this. Nothing was incomplete — the page was
 * served whole. The response simply asserted more than it read, which is why
 * the rule is "never claim more certainty than you have" rather than "disclose
 * incompleteness".
 *
 * The fix scopes the CLAIM rather than abandoning the projection: where the
 * page IS the collection the fact is genuinely collection-wide and costs
 * nothing extra; where it is not, the response says so.
 */
describe("meta.constant is scoped to what was actually read", () => {
  const projection = { dropConstantColumns: true } as const;
  const page = (rows: Array<Record<string, unknown>>, totalItems: number, totalPages: number) => ({
    currentPage: 0, pageSize: rows.length, totalItems, totalPages,
    hasPreviousPage: false, hasNextPage: totalPages > 1, data: rows,
  });
  const rows20 = (): Array<Record<string, unknown>> =>
    Array.from({ length: 20 }, (_, i) => ({ id: `g${i}`, domain: "labcorp.local", type: "Group" }));

  it("says so when the page is only part of the collection", () => {
    const out = shapeListResponse(page(rows20(), 52, 3), projection, {}) as Record<string, unknown>;
    const meta = out.meta as Record<string, unknown>;

    // Vacuity: the projection really did fire, so this is not passing over an
    // unshaped payload.
    expect(meta.constant).toEqual({ domain: "labcorp.local", type: "Group" });
    expect((out.data as Array<Record<string, unknown>>)[0]).not.toHaveProperty("type");

    // The property: the response must not let "constant" read as a fact about
    // all 52. Assert the numbers appear, not any particular sentence.
    const scope = JSON.stringify(meta);
    expect(scope).toMatch(/20/);
    expect(scope).toMatch(/52/);
  });

  it("adds nothing when the page IS the whole collection", () => {
    // The over-flagging control, and the token argument: a single-page read has
    // a genuinely collection-wide fact and must not pay for a caveat.
    const out = shapeListResponse(page(rows20(), 20, 1), projection, {}) as Record<string, unknown>;
    const meta = out.meta as Record<string, unknown>;
    expect(meta.constant).toEqual({ domain: "labcorp.local", type: "Group" });
    expect(JSON.stringify(meta)).not.toMatch(/only|of 20|page/i);
  });

  it("says so when the envelope omits totalItems — unknown is not 'whole'", () => {
    // An absent total cannot be read as "the page covers everything". That is
    // the missing-fact rule applied to the hallucinated-fact fix.
    const noTotal = { currentPage: 0, pageSize: 20, totalPages: 1, data: rows20() };
    const out = shapeListResponse(noTotal, projection, {}) as Record<string, unknown>;
    expect(JSON.stringify((out as { meta: unknown }).meta)).toMatch(/20/);
  });
});
