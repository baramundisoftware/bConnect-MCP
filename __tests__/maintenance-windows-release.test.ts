/**
 * Maintenance windows per bMS release (REQ-SRV-031, #307).
 *
 * The window types differ: 25R2 has Unrestricted (its default), Everyday,
 * WorkdayWeekend and IndividualWeekday, and only Unrestricted takes no
 * intervals; 26R1 adds Anytime and Never (interval-free), and the tools leave
 * Unrestricted out there (Q2 a). The create tools offer and accept the selected
 * release's types and apply its interval rule, so their body fits that
 * release's schema. Updating needs 26R1: 25R2 updates with PUT, which isn't
 * offered (declared in src/unsupported-operations.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, createRecorder, guardEnv, ID, type ConnectedServer } from './lib/exerciser.js';
import type { Release } from './lib/spec.js';
import { UNSUPPORTED_OPERATIONS } from '../bconnect-endpoints-mcp/src/unsupported-operations.js';

const INTERVALS = [{ maintenancePeriod: 'Everyday', start: { hour: 22, minute: 0 }, end: { hour: 23, minute: 0 } }];
const TYPES: Record<Release, string[]> = {
  '25R2': ['Unrestricted', 'Everyday', 'WorkdayWeekend', 'IndividualWeekday'],
  '26R1': ['Anytime', 'Never', 'Everyday', 'WorkdayWeekend', 'IndividualWeekday'],
};

const recorder = createRecorder(() => ({ maintenanceWindowDefinitionType: 'Everyday' }));
const saved = { ...process.env };
const conns: Partial<Record<Release, ConnectedServer>> = {};
beforeAll(async () => {
  recorder.listen();
  for (const release of ['25R2', '26R1'] as const) {
    Object.assign(process.env, guardEnv(release, { writes: true, secretRead: false }));
    conns[release] = await connect('bconnect-endpoints-mcp');
  }
});
afterAll(async () => {
  await Promise.all(Object.values(conns).map((c) => c!.close()));
  recorder.close();
  process.env = saved;
});
const use = (release: Release): ConnectedServer => {
  Object.assign(process.env, guardEnv(release, { writes: true, secretRead: false }));
  return conns[release]!;
};
const route = (target: string) => (target === 'endpoint' ? `/endpoints/v2.0/Endpoints/${ID}/MaintenanceWindow` : `/endpoints/v2.0/LogicalGroups/${ID}/MaintenanceWindow`);

describe.each(['endpoint', 'logical_group'])('%s', (target) => {
  const create = `create_maintenance_window_for_${target}`;
  const update = `update_maintenance_window_for_${target}`;

  it.each(['25R2', '26R1'] as const)('%s: create offers that release\'s window types, its default first', async (release) => {
    const t = (await use(release).list()).find((x) => x.name === create)!;
    expect(t.inputSchema.properties.maintenanceWindowDefinitionType.enum).toEqual(TYPES[release]);
  });

  it('25R2: create states the 25R2 interval rule, without the 26R1-only types', async () => {
    const t = (await use('25R2').list()).find((x) => x.name === create)!;
    expect(t.description).toContain('Unrestricted takes no intervals');
    expect(t.description).not.toMatch(/Anytime|Never/);
    expect(String(t.inputSchema.properties.maintenanceWindowDefinitionType.description)).not.toMatch(/Anytime|Never/);
  });

  it('25R2: Anytime and Never are refused before any request, naming the release\'s types', async () => {
    const conn = use('25R2');
    recorder.take();
    for (const type of ['Anytime', 'Never']) {
      const r = await conn.call(create, { id: ID, maintenanceWindowDefinitionType: type });
      expect(r.isError, type).toBe(true);
      expect(r.text).toContain('Unrestricted');
    }
    expect(recorder.take()).toEqual([]);
  });

  it('25R2: Unrestricted takes no intervals; the other types need at least one', async () => {
    const conn = use('25R2');
    recorder.take();
    const withIntervals = await conn.call(create, { id: ID, maintenanceWindowDefinitionType: 'Unrestricted', intervals: INTERVALS });
    expect(withIntervals.isError).toBe(true);
    expect(withIntervals.text).toContain("'Unrestricted' takes no intervals");
    const without = await conn.call(create, { id: ID, maintenanceWindowDefinitionType: 'Everyday' });
    expect(without.isError).toBe(true);
    expect(without.text).toContain("'Everyday' needs at least one interval");
    expect(recorder.take()).toEqual([]);
  });

  it('25R2: a valid create sends the 25R2 body', async () => {
    const conn = use('25R2');
    recorder.take();
    expect((await conn.call(create, { id: ID, maintenanceWindowDefinitionType: 'Unrestricted' })).isError).toBe(false);
    expect((await conn.call(create, { id: ID, maintenanceWindowDefinitionType: 'Everyday', intervals: INTERVALS })).isError).toBe(false);
    expect(recorder.take().map((r) => [r.method, r.path, JSON.parse(r.body)])).toEqual([
      ['POST', route(target), { maintenanceWindowDefinitionType: 'Unrestricted' }],
      ['POST', route(target), { maintenanceWindowDefinitionType: 'Everyday', intervals: INTERVALS }],
    ]);
  });

  it('26R1: Unrestricted is not offered and is refused (Q2 a); Anytime still goes through', async () => {
    const conn = use('26R1');
    recorder.take();
    const r = await conn.call(create, { id: ID, maintenanceWindowDefinitionType: 'Unrestricted' });
    expect(r.isError).toBe(true);
    expect(recorder.take()).toEqual([]);
    expect((await conn.call(create, { id: ID, maintenanceWindowDefinitionType: 'Anytime' })).isError).toBe(false);
    expect(recorder.take().map((x) => [x.method, x.path, JSON.parse(x.body)])).toEqual([['POST', route(target), { maintenanceWindowDefinitionType: 'Anytime' }]]);
  });

  it('25R2: update is not listed and is refused by name, naming 26R1', async () => {
    const conn = use('25R2');
    expect((await conn.list()).map((t) => t.name)).not.toContain(update);
    recorder.take();
    const r = await conn.call(update, { id: ID, maintenanceWindowDefinitionType: 'Everyday', intervals: INTERVALS });
    expect(r.text).toContain(`${update} is only available in bMS 26R1`);
    expect(recorder.take()).toEqual([]);
  });

  it('26R1: update keeps the 26R1 types and rule', async () => {
    const t = (await use('26R1').list()).find((x) => x.name === update)!;
    expect(t.inputSchema.properties.maintenanceWindowDefinitionType.enum).toEqual(TYPES['26R1']);
    expect(t.description).toContain('Anytime and Never take no intervals');
  });
});

it('declares exactly the two 25R2 update operations unsupported, each with a reason', () => {
  expect(Object.keys(UNSUPPORTED_OPERATIONS).sort()).toEqual(['UpdateMaintenanceWindowForEndpointById', 'UpdateMaintenanceWindowForLogicalGroupById']);
  for (const releases of Object.values(UNSUPPORTED_OPERATIONS)) {
    expect(Object.keys(releases)).toEqual(['25R2']);
    expect(String(releases['25R2']).length).toBeGreaterThan(40);
  }
});
