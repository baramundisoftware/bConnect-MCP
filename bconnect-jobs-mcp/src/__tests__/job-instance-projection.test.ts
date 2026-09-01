/**
 * TOK-27 — the job-instance list projection.
 *
 * Measured on the live bMS 26R1 estate (list_job_instances, Page=0,
 * PageSize=20, 2026-08-02), which is what these assertions are calibrated to:
 *
 *     today (raw)                21,389 B
 *     default compact            11,699 B   -45.3%
 *     includeSteps: true         18,975 B   -11.3%
 *     detail: true               21,389 B    0.0%   (identical, by contract)
 *     countOnly: true            ~122 B     -99.4%
 *
 * The fixture below reproduces that page's field set and the three shapes that
 * make the rules non-trivial — a row whose display name differs from its name,
 * a row whose `steps[]` is empty, and a `stateDescription` carrying failure
 * text that is NOT derivable from `state` + `lastAction` — with the estate's
 * own identifiers replaced.
 */

import { describe, it, expect } from 'vitest';

import {
  collapseDuplicateDisplayNames,
  shapeJobInstanceList,
  JOB_INSTANCE_FULL_MODE_HINT,
  OMITTED_WHEN_EQUAL_META_KEY,
} from '../modules/job-instance-projection.js';

interface Step {
  type: string;
  description: string;
  state: string;
  stateDescription: string | null;
  lastAction: string | null;
  windowsApplicationId?: string;
  windowsApplicationName?: string;
  windowsApplicationVendor?: string;
  windowsApplicationVersion?: string | null;
}

interface InstanceRow {
  id: string;
  jobDefinitionId: string;
  jobDefinitionName: string;
  jobDefinitionDisplayName: string;
  jobDefinitionType: string;
  endpointId: string;
  endpointName: string;
  endpointType: string;
  initiator: string;
  start: string | null;
  lastAction: string | null;
  nextExecution: string | null;
  successfulExecutions: number;
  erroneousExecutions: number;
  retries: number;
  delays: number;
  state: string;
  stateDescription: string | null;
  steps: Step[];
}

const AUTO_ASSIGN_INITIATOR =
  'Created by automatic job assignment to Universal Dynamic Group [Build] by security profile [Administration]';

function installStep(app: string): Step {
  return {
    type: 'WindowsApplicationInstallation',
    description: `Install software: ${app}`,
    state: 'FinishedSuccessfully',
    stateDescription: 'Successfully finished.',
    lastAction: '2026-02-04T21:27:38Z',
    windowsApplicationId: '00000000-0000-4000-8000-00000000aaaa',
    windowsApplicationName: app,
    windowsApplicationVendor: 'Vendor',
    windowsApplicationVersion: '1.0.0-x64',
  };
}

function row(overrides: Partial<InstanceRow> = {}): InstanceRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    jobDefinitionId: '00000000-0000-4000-8000-0000000000df',
    jobDefinitionName: 'INSTALL: Example Package',
    jobDefinitionDisplayName: 'INSTALL: Example Package',
    jobDefinitionType: 'WindowsJobDefinition',
    endpointId: '00000000-0000-4000-8000-0000000000e1',
    endpointName: 'CLIENT-01',
    endpointType: 'WindowsEndpoint',
    initiator: AUTO_ASSIGN_INITIATOR,
    start: '2026-02-04T21:27:19Z',
    lastAction: '2026-02-04T21:27:40Z',
    nextExecution: null,
    successfulExecutions: 1,
    erroneousExecutions: 0,
    retries: 0,
    delays: 0,
    state: 'FinishedSuccessfully',
    stateDescription: 'Successfully finished at 04.02.2026 16:27:40',
    steps: [installStep('Example Package')],
    ...overrides,
  };
}

function page(rows: InstanceRow[]): Record<string, unknown> {
  return {
    currentPage: 0,
    pageSize: 20,
    totalPages: 12,
    totalItems: 229,
    hasPreviousPage: false,
    hasNextPage: true,
    data: rows,
  };
}

/** A page shaped like the live one: duplicate names, a differing one, a failure. */
const LIVE_SHAPED_PAGE = page([
  row(),
  row({ id: '...2', endpointName: 'CLIENT-02' }),
  row({
    id: '...3',
    jobDefinitionName: 'INSTALL: Google Chrome',
    jobDefinitionDisplayName: 'Google Chrome',
    endpointName: 'CLIENT-03',
  }),
  row({
    id: '...4',
    endpointName: 'CLIENT-04',
    state: 'Queued',
    stateDescription:
      'Retry pending on 02.08.2026 at 12:27: Could not connect to client. (Unable to reach client [10.0.0.2] via ping)',
    steps: [],
  }),
]);

const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');

describe('TOK-27 — steps[] is omitted by default', () => {
  it('drops steps[] from every row and names it once in meta', () => {
    const shaped = shapeJobInstanceList(structuredClone(LIVE_SHAPED_PAGE)) as {
      data: Record<string, unknown>[];
      meta: { dropped?: string[]; hint?: string };
    };

    for (const shapedRow of shaped.data) {
      expect(shapedRow).not.toHaveProperty('steps');
    }
    expect(shaped.meta.dropped).toContain('steps');
    expect(shaped.meta.hint).toBe(JOB_INSTANCE_FULL_MODE_HINT);
  });

  it('is a real saving, not a rename: the compact page is at least a third smaller', () => {
    const raw = structuredClone(LIVE_SHAPED_PAGE);
    const compact = shapeJobInstanceList(structuredClone(LIVE_SHAPED_PAGE));

    const saved = 1 - bytes(compact) / bytes(raw);
    expect(saved, `only saved ${(saved * 100).toFixed(1)}%`).toBeGreaterThan(0.33);
  });

  it('keeps steps[] when the caller asks with includeSteps', () => {
    const shaped = shapeJobInstanceList(structuredClone(LIVE_SHAPED_PAGE), {
      includeSteps: true,
    }) as { data: Record<string, unknown>[] };

    expect(shaped.data[0]).toHaveProperty('steps');
    expect((shaped.data[0] as { steps: Step[] }).steps).toHaveLength(1);
  });

  it('returns the payload object itself — not a copy — for detail: true', () => {
    const raw = structuredClone(LIVE_SHAPED_PAGE);

    expect(shapeJobInstanceList(raw, { full: true })).toBe(raw);
  });

  it('preserves the paging envelope, which is how the caller knows to page', () => {
    const shaped = shapeJobInstanceList(structuredClone(LIVE_SHAPED_PAGE)) as Record<
      string,
      unknown
    >;

    expect(shaped.totalItems).toBe(229);
    expect(shaped.totalPages).toBe(12);
    expect(shaped.currentPage).toBe(0);
    expect(shaped.pageSize).toBe(20);
  });
});

describe('TOK-27 — page-constant columns are reported once instead of per row', () => {
  it('drops a column that is identical on every row and records its value', () => {
    const shaped = shapeJobInstanceList(structuredClone(LIVE_SHAPED_PAGE)) as {
      data: Record<string, unknown>[];
      meta: { constant?: Record<string, unknown> };
    };

    expect(shaped.meta.constant).toMatchObject({
      jobDefinitionType: 'WindowsJobDefinition',
      endpointType: 'WindowsEndpoint',
      retries: 0,
      delays: 0,
    });
    expect(shaped.data[0]).not.toHaveProperty('endpointType');
  });

  it('leaves a one-row page alone — every column of one row is "constant"', () => {
    const shaped = shapeJobInstanceList(page([row()])) as {
      data: Record<string, unknown>[];
      meta: { constant?: Record<string, unknown> };
    };

    expect(shaped.meta.constant).toBeUndefined();
    expect(shaped.data[0]).toHaveProperty('endpointName', 'CLIENT-01');
    expect(shaped.data[0]).toHaveProperty('state', 'FinishedSuccessfully');
  });

  it('keeps state on a homogeneous page — a caller filtering on it must not see zero', () => {
    // The hazard this guards: scripts/demo/patch-loop-*.mjs read `state` off
    // every row. A page where every job finished successfully would, under a
    // blanket constant-column drop, come back with no `state` at all and the
    // filter would quietly match nothing.
    const homogeneous = page([
      row({ id: 'a', endpointName: 'CLIENT-01' }),
      row({ id: 'b', endpointName: 'CLIENT-02' }),
      row({ id: 'c', endpointName: 'CLIENT-03' }),
    ]);

    const shaped = shapeJobInstanceList(homogeneous) as {
      data: Record<string, unknown>[];
      meta: { constant?: Record<string, unknown> };
    };

    for (const shapedRow of shaped.data) {
      expect(shapedRow).toHaveProperty('state', 'FinishedSuccessfully');
      expect(shapedRow).toHaveProperty('id');
      expect(shapedRow).toHaveProperty('lastAction');
      expect(shapedRow).toHaveProperty('successfulExecutions');
    }
    expect(shaped.meta.constant).not.toHaveProperty('state');
  });

  it('keeps stateDescription, which is the only place failure text lives', () => {
    const shaped = shapeJobInstanceList(structuredClone(LIVE_SHAPED_PAGE)) as {
      data: Record<string, unknown>[];
    };

    expect(shaped.data[3].stateDescription).toMatch(/Unable to reach client/);
  });
});

describe('TOK-27 — jobDefinitionDisplayName is emitted only when it differs', () => {
  it('omits it on the rows where it equals jobDefinitionName', () => {
    const shaped = collapseDuplicateDisplayNames({
      data: [
        { jobDefinitionName: 'A', jobDefinitionDisplayName: 'A' },
        { jobDefinitionName: 'INSTALL: Google Chrome', jobDefinitionDisplayName: 'Google Chrome' },
      ],
    }) as unknown as { data: Record<string, unknown>[]; meta: Record<string, unknown> };

    expect(shaped.data[0]).not.toHaveProperty('jobDefinitionDisplayName');
    expect(shaped.data[0]).toHaveProperty('jobDefinitionName', 'A');
    expect(shaped.data[1]).toHaveProperty('jobDefinitionDisplayName', 'Google Chrome');
    expect(shaped.meta.omittedWhenEqual).toEqual({
      jobDefinitionDisplayName: 'jobDefinitionName',
    });
  });

  it('adds no meta note to a page where nothing was a duplicate', () => {
    const payload = { data: [{ jobDefinitionName: 'A', jobDefinitionDisplayName: 'B' }] };

    expect(collapseDuplicateDisplayNames(payload)).toBe(payload);
  });

  it('passes a non-envelope payload through untouched', () => {
    const payload = { id: 'not-a-list' };

    expect(collapseDuplicateDisplayNames(payload)).toBe(payload);
    expect(shapeJobInstanceList(payload)).toBe(payload);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rule 3 generalised — the same rule over list_job_definitions' column pair
//
// `list_job_definitions` carries the identical duplicate-display-name shape:
// measured across all 170 definitions on the reference estate, `displayName`
// equals `name` on 138 rows (81.2%) and genuinely differs on the other 32
// ("OS: Windows 11 In-Place Upgrade" against "Windows 11 In-Place Upgrade").
// Live result: 7,076 -> 6,353 B on a page, 58,836 -> 53,134 B (-9.7%) over all
// nine pages.
//
// The rule was parameterised rather than copied. The two assertions that matter
// are therefore (a) that the defaults still behave exactly as before, since nine
// job-instance call sites depend on them, and (b) that the new pair works.
// ─────────────────────────────────────────────────────────────────────────────

describe('collapseDuplicateDisplayNames — the column pair is a parameter', () => {
  const definitionsPage = () => ({
    totalItems: 3,
    data: [
      { id: 'a', name: 'INSTALL: Adobe Reader DC-x64', displayName: 'INSTALL: Adobe Reader DC-x64' },
      { id: 'b', name: 'OS: Windows 11 In-Place Upgrade', displayName: 'Windows 11 In-Place Upgrade' },
      { id: 'c', name: 'SCRIPT: Restart Printer Spooler', displayName: 'SCRIPT: Restart Printer Spooler' },
    ],
  });

  it('omits displayName only where it equals name, and keeps it where it differs', () => {
    const shaped = collapseDuplicateDisplayNames(definitionsPage(), 'displayName', 'name') as unknown as {
      data: Record<string, unknown>[];
      meta: Record<string, unknown>;
    };
    expect('displayName' in shaped.data[0]).toBe(false);
    expect('displayName' in shaped.data[2]).toBe(false);
    // The one that genuinely differs survives — that is the whole reason this is
    // emit-when-different rather than a blanket drop.
    expect(shaped.data[1].displayName).toBe('Windows 11 In-Place Upgrade');
    expect(shaped.meta[OMITTED_WHEN_EQUAL_META_KEY]).toEqual({ displayName: 'name' });
  });

  it('is strictly lossless — every omitted value is the name on its own row', () => {
    const raw = definitionsPage();
    const shaped = collapseDuplicateDisplayNames(raw, 'displayName', 'name') as {
      data: Record<string, unknown>[];
    };
    raw.data.forEach((row, i) => {
      const recovered = 'displayName' in shaped.data[i] ? shaped.data[i].displayName : shaped.data[i].name;
      expect(recovered, `row ${i} must still yield its displayName`).toBe(row.displayName);
    });
  });

  it('pays no meta note on a page where nothing collapsed', () => {
    const noDuplicates = { data: [{ id: 'b', name: 'OS: X', displayName: 'X' }] };
    expect(collapseDuplicateDisplayNames(noDuplicates, 'displayName', 'name')).toBe(noDuplicates);
  });

  it('the DEFAULTS still behave exactly as before, for the nine instance call sites', () => {
    // The generalisation must not have moved the original behaviour. Called with
    // no column arguments, it must still collapse the job-instance pair.
    const instances = {
      data: [
        { id: '1', jobDefinitionName: 'INSTALL: Chrome', jobDefinitionDisplayName: 'INSTALL: Chrome' },
        { id: '2', jobDefinitionName: 'INSTALL: Chrome', jobDefinitionDisplayName: 'Google Chrome' },
      ],
    };
    const shaped = collapseDuplicateDisplayNames(instances) as unknown as {
      data: Record<string, unknown>[];
      meta: Record<string, unknown>;
    };
    expect('jobDefinitionDisplayName' in shaped.data[0]).toBe(false);
    expect(shaped.data[1].jobDefinitionDisplayName).toBe('Google Chrome');
    expect(shaped.meta[OMITTED_WHEN_EQUAL_META_KEY]).toEqual({
      jobDefinitionDisplayName: 'jobDefinitionName',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The hand-built meta.constant needs the same scope core's does
// ─────────────────────────────────────────────────────────────────────────────

/**
 * This module builds `meta.constant` itself rather than through core's
 * `dropConstantColumns`, and the reason is good — core's blanket flag would
 * drop `state` on a homogeneous page (see the header). But building it by hand
 * also meant missing the scope core gained on 2026-08-14, and the numbers here
 * are worse than the case that prompted that fix.
 *
 * LIVE_SHAPED_PAGE is this file's own fixture: 4 rows against `totalItems: 229`.
 * `retries: 0` and `endpointType: "WindowsEndpoint"` are stripped from every row
 * and asserted once — so "are jobs retrying?" answers NO from a page of four,
 * and nothing in the payload can contradict it. Seven tools reach this shaper,
 * `list_job_instances` among them.
 */
describe('TOK-27 — the constancy claim is scoped to the rows actually read', () => {
  it('says so when the page is a fraction of the collection', () => {
    const shaped = shapeJobInstanceList(structuredClone(LIVE_SHAPED_PAGE)) as {
      data: Record<string, unknown>[];
      totalItems: number;
      meta: Record<string, unknown>;
    };

    // Vacuity: the projection really fired and really stripped the columns, so
    // a missing scope below is the defect and not an unshaped payload.
    expect(shaped.meta.constant).toBeTruthy();
    expect(shaped.data[0]).not.toHaveProperty('endpointType');
    expect(shaped.data.length).toBeLessThan(shaped.totalItems);

    // The property: the claim names what it was observed over.
    const meta = JSON.stringify(shaped.meta);
    expect(meta).toMatch(String(shaped.data.length));
    expect(meta).toMatch(String(shaped.totalItems));
  });

  it('adds nothing when the page IS the whole collection', () => {
    const whole = structuredClone(LIVE_SHAPED_PAGE) as Record<string, unknown>;
    whole.totalItems = (whole.data as unknown[]).length;
    const shaped = shapeJobInstanceList(whole) as { meta: Record<string, unknown> };

    expect(shaped.meta.constant).toBeTruthy();
    // Asserted by NAME. A control in the core suite passed only because its row
    // count and total were the same number, so its substring sweep matched the
    // very sentence it was meant to exclude.
    expect(shaped.meta.constantScope).toBeUndefined();
  });
});
