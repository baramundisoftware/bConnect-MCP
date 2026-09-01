/**
 * Tool-surface tests for the Class C revision (TOK-20, TOK-25, TOK-27, INT-47).
 *
 * This file pins the three things a surface revision can silently get wrong:
 *
 *   TOK-20  writes are advertised only when ALLOW_WRITE_OPERATIONS=true, and
 *           hiding one does not disable it — the refusal a client gets by
 *           calling a hidden write by name is byte-identical to the string the
 *           hand-written gate returned.
 *   INT-47  `list_endpoint_job_instances` is GONE from the catalogue in both
 *           postures, and `list_job_instances_by_endpoint` is there instead.
 *           A rename that leaves the old name advertised is not a rename.
 *   TOK-25/27
 *           the shaping vocabulary is declared on exactly the tools that
 *           implement it — a declared `countOnly` no handler reads returns a
 *           full page to a caller who asked for a number.
 *
 * The thirteen protected names are asserted present in the gate-open posture
 * (ALLOW_WRITE_OPERATIONS=true), which is the only one where they are listed.
 */

import { describe, it, expect, afterEach } from 'vitest';

import { JOB_INSTANCE_LIST_TOOLS } from '../index.js';
import { connectTestClient } from './lib/connect.js';

const GATE = 'ALLOW_WRITE_OPERATIONS';
const originalGate = process.env[GATE];

afterEach(() => {
  if (originalGate === undefined) {
    delete process.env[GATE];
  } else {
    process.env[GATE] = originalGate;
  }
});

interface RegisteredTool {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, unknown> };
}

async function tools(gateOpen: boolean): Promise<RegisteredTool[]> {
  if (gateOpen) {
    process.env[GATE] = 'true';
  } else {
    delete process.env[GATE];
  }
  const client = await connectTestClient();
  const { tools: registered } = await client.listTools();
  return registered as RegisteredTool[];
}

const names = (registered: RegisteredTool[]): string[] => registered.map((t) => t.name);

/** The fourteen mutating tools this server ships. */
const WRITE_TOOLS = [
  'create_job_instance',
  'start_job_instance',
  'stop_job_instance',
  'resume_job_instance',
  'delete_job_instance',
  'create_job_folder',
  'update_job_folder',
  'delete_job_folder',
  'assign_job_to_logical_group',
  'assign_job_to_static_group',
  'assign_job_to_dynamic_group',
  'assign_job_to_universal_dynamic_group',
  'create_kiosk_release',
  'withdraw_kiosk_release',
];

/**
 * The subset of the thirteen demo-protected names that live in this server.
 * Their names must not change and they must keep working end to end.
 */
const DEMO_PROTECTED_JOBS_TOOLS = [
  'assign_job_to_logical_group',
  'create_job_instance',
  'delete_job_folder',
  'delete_job_instance',
  'diagnose_job',
  'explain_job_failure',
  'preview_assignment',
  'start_job_instance',
  'stop_job_instance',
  'update_job_folder',
];

/** Every paged list tool that declares `countOnly` and implements it. */
const COUNT_ONLY_TOOLS = [
  'list_job_definitions',
  'list_job_definitions_by_folder',
  'list_job_instances',
  'list_job_instances_by_endpoint',
  'list_job_instances_by_definition',
  'list_job_instances_by_logical_group',
  'list_job_instances_by_static_group',
  'list_job_instances_by_dynamic_group',
  'list_job_instances_by_universal_dynamic_group',
  'list_job_folders',
  'list_job_subfolders',
  'list_kiosk_releases',
  'list_kiosk_releases_by_job_definition',
  'list_kiosk_releases_by_endpoint',
  'list_kiosk_releases_by_ad_object',
  'list_kiosk_releases_by_logical_group',
];

describe('INT-47 — list_endpoint_job_instances renamed to list_job_instances_by_endpoint', () => {
  it('no longer advertises the old name, in either posture', async () => {
    expect(names(await tools(false))).not.toContain('list_endpoint_job_instances');
    expect(names(await tools(true))).not.toContain('list_endpoint_job_instances');
  });

  it('advertises the new name, which sorts with its five siblings', async () => {
    const registered = names(await tools(true));

    expect(registered).toContain('list_job_instances_by_endpoint');
    for (const sibling of [
      'list_job_instances_by_definition',
      'list_job_instances_by_logical_group',
      'list_job_instances_by_static_group',
      'list_job_instances_by_dynamic_group',
      'list_job_instances_by_universal_dynamic_group',
    ]) {
      expect(registered).toContain(sibling);
    }
  });

  it('answers the old name with MethodNotFound rather than silently aliasing it', async () => {
    process.env[GATE] = 'true';
    // Credentials only so the lazily built client does not fail first; the
    // dispatch never reaches the network for an unknown tool name.
    const client = await connectTestClient({ baseUrl: 'https://bms.invalid', apiKey: 'test' });

    await expect(
      client.callTool({
        name: 'list_endpoint_job_instances',
        arguments: { endpointId: '11111111-2222-3333-4444-555555555555' },
      })
    ).rejects.toThrow(/Unknown tool: list_endpoint_job_instances/);
  });
});

describe('TOK-20 — write tools are advertised only when the gate is open', () => {
  it('hides all fourteen write tools when ALLOW_WRITE_OPERATIONS is unset', async () => {
    const registered = names(await tools(false));

    for (const write of WRITE_TOOLS) {
      expect(registered, `${write} must not be advertised with the gate shut`).not.toContain(write);
    }
    expect(registered).toHaveLength(23);
  });

  it('advertises every declared tool when the gate is open', async () => {
    const registered = names(await tools(true));

    for (const write of WRITE_TOOLS) {
      expect(registered).toContain(write);
    }
    expect(registered).toHaveLength(37);
  });

  it('advertises every demo-protected tool in the posture the demo runs in', async () => {
    const registered = names(await tools(true));

    for (const demoTool of DEMO_PROTECTED_JOBS_TOOLS) {
      expect(registered, `demo tool ${demoTool} must stay advertised`).toContain(demoTool);
    }
  });

  it('hiding is not disabling: a hidden write called by name still gets the same refusal', async () => {
    delete process.env[GATE];
    const client = await connectTestClient();

    const result = (await client.callTool({
      name: 'delete_job_folder',
      arguments: { id: '11111111-2222-3333-4444-555555555555' },
    })) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    // Byte-identical to the string the hand-written gate produced.
    expect(result.content[0].text).toBe(
      "Write operation 'delete_job_folder' is disabled. " +
        'Set ALLOW_WRITE_OPERATIONS=true to enable write operations.'
    );
  });

  it('leaves every read tool advertised with the gate shut', async () => {
    const closed = names(await tools(false));
    const open = names(await tools(true));

    expect(open.filter((name) => !WRITE_TOOLS.includes(name))).toEqual(closed);
  });
});

describe('TOK-25 / TOK-27 — the shaping vocabulary is declared where it is implemented', () => {
  it('declares countOnly on exactly the sixteen paged list tools', async () => {
    const registered = await tools(true);
    const declaring = registered
      .filter((tool) => tool.inputSchema?.properties?.countOnly !== undefined)
      .map((tool) => tool.name);

    expect(declaring.sort()).toEqual([...COUNT_ONLY_TOOLS].sort());
  });

  it('declares detail and includeSteps on exactly the seven job-instance list tools', async () => {
    const registered = await tools(true);

    for (const key of ['detail', 'includeSteps']) {
      const declaring = registered
        .filter((tool) => tool.inputSchema?.properties?.[key] !== undefined)
        .map((tool) => tool.name);
      expect(declaring.sort(), `${key} is declared on the wrong tools`).toEqual(
        [...JOB_INSTANCE_LIST_TOOLS].sort()
      );
    }
  });

  it('tells the caller the default response is shaped', async () => {
    const registered = await tools(true);

    for (const name of JOB_INSTANCE_LIST_TOOLS) {
      const tool = registered.find((t) => t.name === name);
      expect(tool?.description, `${name} must say its rows are compact`).toMatch(
        /compact by default/i
      );
    }
  });
});
