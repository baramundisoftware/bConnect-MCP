/**
 * Tool-catalogue composition and the write-visibility gate (TOK-1 / TOK-20).
 *
 * Two properties carry the whole change and are pinned first: with the gate
 * open the advertised surface is byte-identical to what the server declared
 * (adoption must be a no-op in the write posture), and with the gate shut the
 * write schemas are gone from tools/list but the gate itself still answers.
 *
 * Nothing here touches a network or the live bMS estate.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  defineToolCatalogue,
  writeOperationsEnabled,
  writeDisabledMessage,
  writeVerbCandidates,
  ALLOW_WRITE_OPERATIONS_ENV,
} from '@bconnect/mcp-core';

/** A tool array shaped like the ones the servers hand-write, reads and writes interleaved. */
const TOOLS = [
  { name: 'list_windows_endpoints', description: 'List Windows endpoints.', inputSchema: { type: 'object', properties: { Page: { type: 'number' }, PageSize: { type: 'number' } } } },
  { name: 'create_windows_endpoint', description: 'Create a Windows endpoint.', inputSchema: { type: 'object', properties: { displayName: { type: 'string' } }, required: ['displayName'] } },
  { name: 'get_windows_endpoint', description: 'Get one Windows endpoint.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'delete_windows_endpoint', description: 'Delete a Windows endpoint.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
];
const WRITE_NAMES = ['create_windows_endpoint', 'delete_windows_endpoint'];

const readOnlyEnv = {} as NodeJS.ProcessEnv;
const writeEnv = { [ALLOW_WRITE_OPERATIONS_ENV]: 'true' } as NodeJS.ProcessEnv;

afterEach(() => {
  delete process.env[ALLOW_WRITE_OPERATIONS_ENV];
});

describe('writeOperationsEnabled', () => {
  it('is true only for the exact string "true"', () => {
    expect(writeOperationsEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(writeOperationsEnabled({ ALLOW_WRITE_OPERATIONS: 'TRUE' } as NodeJS.ProcessEnv)).toBe(false);
    expect(writeOperationsEnabled({ ALLOW_WRITE_OPERATIONS: '1' } as NodeJS.ProcessEnv)).toBe(false);
    expect(writeOperationsEnabled(writeEnv)).toBe(true);
  });

  it('reads the environment per call, so a running server can be flipped', () => {
    const catalogue = defineToolCatalogue({ tools: TOOLS, write: WRITE_NAMES });

    expect(catalogue.listTools()).toHaveLength(2);
    process.env[ALLOW_WRITE_OPERATIONS_ENV] = 'true';
    expect(catalogue.listTools()).toHaveLength(4);
  });
});

describe('surface with the write gate OPEN (must be a no-op)', () => {
  it('advertises exactly the declared array, in the declared order', () => {
    const catalogue = defineToolCatalogue({ tools: TOOLS, write: WRITE_NAMES });

    expect(catalogue.listTools(writeEnv)).toEqual(TOOLS);
    expect(JSON.stringify({ tools: catalogue.listTools(writeEnv) })).toBe(
      JSON.stringify({ tools: TOOLS })
    );
  });

  it('hands back the very objects the server declared', () => {
    const catalogue = defineToolCatalogue({ tools: TOOLS, write: WRITE_NAMES });
    expect(catalogue.listTools(writeEnv)[0]).toBe(TOOLS[0]);
  });

  it('lets every write tool through the gate', () => {
    const catalogue = defineToolCatalogue({ tools: TOOLS, write: WRITE_NAMES });
    for (const name of WRITE_NAMES) {
      expect(catalogue.gateWriteTool(name, writeEnv)).toBeUndefined();
    }
  });
});

describe('surface with the write gate SHUT (the TOK-20 saving)', () => {
  it('omits every write tool from tools/list', () => {
    const catalogue = defineToolCatalogue({ tools: TOOLS, write: WRITE_NAMES });
    const names = catalogue.listTools(readOnlyEnv).map((tool) => tool.name);

    expect(names).toEqual(['list_windows_endpoints', 'get_windows_endpoint']);
    for (const write of WRITE_NAMES) {
      expect(names).not.toContain(write);
    }
  });

  it('measurably shrinks the advertised payload', () => {
    const catalogue = defineToolCatalogue({ tools: TOOLS, write: WRITE_NAMES });

    const before = JSON.stringify({ tools: catalogue.listTools(writeEnv) }).length;
    const after = JSON.stringify({ tools: catalogue.listTools(readOnlyEnv) }).length;

    expect(after).toBeLessThan(before);
    // The suite-wide figure this stands in for: 45,154 B of 187,722 B (24%).
    expect((before - after) / before).toBeGreaterThan(0.2);
  });

  it('still refuses a write tool called by name, with the unchanged message', () => {
    const catalogue = defineToolCatalogue({ tools: TOOLS, write: WRITE_NAMES });

    // Hiding a tool is a token optimisation. The gate is the security control
    // and it does not move: a client that already knows the name still gets the
    // refusal, not an execution.
    const denied = catalogue.gateWriteTool('delete_windows_endpoint', readOnlyEnv);
    expect(denied).toEqual({
      content: [{
        type: 'text',
        text: "Write operation 'delete_windows_endpoint' is disabled. Set ALLOW_WRITE_OPERATIONS=true to enable write operations.",
      }],
      isError: true,
    });
  });

  it('never gates a read tool', () => {
    const catalogue = defineToolCatalogue({ tools: TOOLS, write: WRITE_NAMES });
    expect(catalogue.gateWriteTool('list_windows_endpoints', readOnlyEnv)).toBeUndefined();
  });

  it('keeps the refusal text byte-identical to the hand-written gates', () => {
    expect(writeDisabledMessage('create_job_instance')).toBe(
      "Write operation 'create_job_instance' is disabled. Set ALLOW_WRITE_OPERATIONS=true to enable write operations."
    );
  });
});

describe('the { read, write } form', () => {
  it('advertises reads first, then writes when the gate is open', () => {
    const catalogue = defineToolCatalogue({
      read: [TOOLS[0], TOOLS[2]],
      write: [TOOLS[1], TOOLS[3]],
    });

    expect(catalogue.listTools(writeEnv).map((t) => t.name)).toEqual([
      'list_windows_endpoints', 'get_windows_endpoint',
      'create_windows_endpoint', 'delete_windows_endpoint',
    ]);
    expect(catalogue.listTools(readOnlyEnv).map((t) => t.name)).toEqual([
      'list_windows_endpoints', 'get_windows_endpoint',
    ]);
    expect(catalogue.isWriteTool('create_windows_endpoint')).toBe(true);
    expect(catalogue.isWriteTool('get_windows_endpoint')).toBe(false);
  });

  it('works with reads only', () => {
    const catalogue = defineToolCatalogue({ read: [TOOLS[0]] });
    expect(catalogue.listTools(readOnlyEnv)).toHaveLength(1);
    expect(catalogue.listTools(writeEnv)).toHaveLength(1);
    expect(catalogue.writeToolNames.size).toBe(0);
  });
});

describe('composition mistakes fail loudly', () => {
  it('rejects a duplicate tool name', () => {
    expect(() =>
      defineToolCatalogue({ tools: [TOOLS[0], TOOLS[0]], write: [] })
    ).toThrow(/duplicate tool name/i);
  });

  it('rejects a gated name that matches no advertised tool', () => {
    // The F21 class of bug: a hand-maintained write set drifting away from the
    // tool array, so the gate covers a name nothing serves and misses one it does.
    expect(() =>
      defineToolCatalogue({ tools: TOOLS, write: ['create_widnows_endpoint'] })
    ).toThrow(/not present in `tools`/);
  });
});

describe('declaredParameters', () => {
  it('reports each tool’s advertised property names', () => {
    const catalogue = defineToolCatalogue({ tools: TOOLS, write: WRITE_NAMES });
    const declared = catalogue.declaredParameters();

    expect([...(declared.get('list_windows_endpoints') ?? [])]).toEqual(['Page', 'PageSize']);
    expect([...(declared.get('get_windows_endpoint') ?? [])]).toEqual(['id']);
  });
});

describe('writeVerbCandidates', () => {
  it('flags the suite’s write verbs, and only those', () => {
    const flagged = writeVerbCandidates([
      'list_endpoints', 'get_endpoint', 'search_endpoints', 'preview_assignment',
      'create_job_instance', 'update_job_folder', 'delete_job_folder',
      'start_job_instance', 'stop_job_instance', 'assign_job_to_logical_group',
      'refresh_local_admin_account_expiry', 'patch_local_admin_user_credentials',
    ]);

    expect(flagged).toEqual([
      'create_job_instance', 'update_job_folder', 'delete_job_folder',
      'start_job_instance', 'stop_job_instance', 'assign_job_to_logical_group',
      'refresh_local_admin_account_expiry', 'patch_local_admin_user_credentials',
    ]);
    // `preview_assignment` reads. Verb inference is a cross-check, never the gate.
    expect(flagged).not.toContain('preview_assignment');
  });
});
