/**
 * Argument-validation regression tests for bconnect-jobs-mcp.
 *
 * Guards the fix for OPT-31 / SEC-1 / INT-49. Before it, src/index.ts ran a
 * local `validateToolArguments()` whose switch had ~37 fall-through case labels
 * and no statements, so a caller-supplied id went straight into a
 * template-literal URL path. `basePath` is only a prefix, so a `../` segment
 * escaped the jobs module entirely: verified live against labcorp.local,
 * `get_job_definition {id: "../../../servermanagement/v2.0/ApiKeys"}` returned
 * the bMS API-key inventory.
 *
 * These tests assert the traversal payload now stops at the MCP boundary with
 * InvalidParams (-32602), before any HTTP client is built — which is why they
 * need no credentials and reach no network.
 */

import { describe, it, expect, vi } from 'vitest';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import { connectTestClient } from './lib/connect.js';

const TRAVERSAL_ID = '../../../servermanagement/v2.0/ApiKeys';

interface RegisteredTool {
  name: string;
  inputSchema?: { required?: string[] };
}

// OPT-39 (B1): these used to call server.request() directly, which worked only
// because createServer() monkey-patched it onto the SDK's private
// _requestHandlers map. They now go over a real InMemoryTransport pair, so the
// rejection they assert on is the one a client actually receives.
async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const client = await connectTestClient();
  return client.callTool({ name, arguments: args });
}

async function listTools(): Promise<RegisteredTool[]> {
  const client = await connectTestClient();
  const { tools } = await client.listTools();
  return tools as RegisteredTool[];
}

async function expectInvalidParams(name: string, args: Record<string, unknown>): Promise<void> {
  let thrown: unknown;
  try {
    await callTool(name, args);
  } catch (error) {
    thrown = error;
  }

  expect(thrown, `${name} must reject invalid arguments`).toBeDefined();
  const err = thrown as { code?: number; message?: string };
  expect(err.code, `${name} must fail with InvalidParams, got: ${err.message}`).toBe(
    ErrorCode.InvalidParams
  );
}

describe('bconnect-jobs-mcp — path traversal in id parameters', () => {
  it('rejects a "../" id on get_job_definition', async () => {
    await expectInvalidParams('get_job_definition', { id: TRAVERSAL_ID });
  });

  it('rejects a "../" id on get_job_instance', async () => {
    await expectInvalidParams('get_job_instance', { id: TRAVERSAL_ID });
  });

  it('rejects a "../" id on get_job_folder', async () => {
    await expectInvalidParams('get_job_folder', { id: TRAVERSAL_ID });
  });

  it('rejects a "../" id on get_kiosk_release', async () => {
    await expectInvalidParams('get_kiosk_release', { id: TRAVERSAL_ID });
  });

  it('rejects a "../" scoping id on list_job_instances_by_definition', async () => {
    await expectInvalidParams('list_job_instances_by_definition', {
      jobDefinitionId: '../LogicalGroups',
    });
  });

  it('rejects a "../" scoping id on list_kiosk_releases_by_logical_group', async () => {
    await expectInvalidParams('list_kiosk_releases_by_logical_group', {
      logicalGroupId: '../LogicalGroups',
    });
  });

  it('rejects a "../" jobDefinitionId on the composite diagnose_job tool', async () => {
    await expectInvalidParams('diagnose_job', { jobDefinitionId: TRAVERSAL_ID });
  });

  it('rejects the percent-encoded form of the same payload', async () => {
    await expectInvalidParams('get_job_definition', {
      id: '%2e%2e%2f%2e%2e%2fservermanagement%2fv2.0%2fApiKeys',
    });
  });
});

describe('bconnect-jobs-mcp — ordinary argument validation', () => {
  it('rejects a malformed GUID with InvalidParams rather than passing it to the API', async () => {
    await expectInvalidParams('get_job_definition', { id: 'not-a-guid' });
  });

  it('rejects a missing required id', async () => {
    await expectInvalidParams('get_job_definition', {});
  });

  it('rejects an out-of-range PageSize', async () => {
    await expectInvalidParams('list_job_definitions', { PageSize: 5000 });
  });

  it('rejects a negative Page', async () => {
    await expectInvalidParams('list_job_instances', { Page: -1 });
  });

  it('validates before the write gate, so a bad id on a write tool is still InvalidParams', async () => {
    // The write gate returns an isError result rather than throwing, so if the
    // gate ran first this would resolve instead of rejecting.
    await expectInvalidParams('delete_job_instance', { id: TRAVERSAL_ID });
  });

  it('has a validation case for every registered tool that declares a required argument', async () => {
    // Drift guard. A tool added to the ListTools handler but forgotten in
    // validateToolParameters() would silently reinstate the unvalidated path
    // that OPT-31 / SEC-1 describe, and nothing else in the suite would notice.
    const tools = await listTools();
    const withRequired = tools.filter((t) => (t.inputSchema?.required?.length ?? 0) > 0);
    expect(withRequired.length).toBeGreaterThan(0);

    const unvalidated: string[] = [];
    for (const tool of withRequired) {
      let threw = false;
      try {
        await callTool(tool.name, {});
      } catch (error) {
        threw = (error as { code?: number }).code === ErrorCode.InvalidParams;
      }
      if (!threw) {
        unvalidated.push(tool.name);
      }
    }

    expect(unvalidated, 'these tools accept empty arguments — no validation rules wired').toEqual([]);
  });

  it('reports the failure once, not "MCP error -32602: MCP error -32602: …"', async () => {
    // A2 / INT-53. McpError bakes "MCP error <code>: " into .message, the
    // server copies .message onto the wire, and the client prefixes it again
    // when it rebuilds the error — so every rejection reached the model
    // doubled. Only visible over a real transport, which is why this test
    // could not exist before the OPT-39 migration above.
    let thrown: unknown;
    try {
      await callTool('get_job_definition', { id: TRAVERSAL_ID });
    } catch (error) {
      thrown = error;
    }

    const message = (thrown as { message?: string }).message ?? '';
    expect(message).toMatch(/^MCP error -32602: /);
    expect(message.match(/MCP error -32602: /g) ?? []).toHaveLength(1);
  });

  it('reports an unknown tool once, not twice', async () => {
    // Credentials are supplied because the client provider is resolved before
    // the tool switch; without them this rejects with the missing-credentials
    // InternalError instead of reaching the `default:` arm. Nothing is sent —
    // an unknown tool never builds a request.
    const client = await connectTestClient({ baseUrl: 'https://bms.invalid/bconnect', apiKey: 'test-key' });

    let thrown: unknown;
    try {
      await client.callTool({ name: 'no_such_tool', arguments: {} });
    } catch (error) {
      thrown = error;
    }

    const err = thrown as { code?: number; message?: string };
    expect(err.code).toBe(ErrorCode.MethodNotFound);
    expect(err.message).toBe('MCP error -32601: Unknown tool: no_such_tool');
  });

  it('reports the missing-credentials failure once, not twice', async () => {
    // The other direct McpError site in this file: the client provider's
    // onMissingCredentials. Pinned empty rather than assumed absent, so an
    // ambient BCONNECT_API_KEY in the shell cannot change what this asserts.
    vi.stubEnv('BCONNECT_API_KEY', '');
    vi.stubEnv('BCONNECT_USERNAME', '');
    vi.stubEnv('BCONNECT_PASSWORD', '');

    let thrown: unknown;
    try {
      await callTool('list_job_definitions', {});
    } catch (error) {
      thrown = error;
    }

    const err = thrown as { code?: number; message?: string };
    expect(err.code).toBe(ErrorCode.InternalError);
    expect(err.message).toBe(
      'MCP error -32603: Either BCONNECT_API_KEY or both BCONNECT_USERNAME and BCONNECT_PASSWORD are required'
    );
  });

  it('accepts a well-formed GUID as far as the write gate', async () => {
    // ALLOW_WRITE_OPERATIONS is unset in the test env, so a valid id gets past
    // validation and is stopped by the gate — proving validation is not
    // rejecting legitimate arguments.
    const result = await callTool('delete_job_instance', {
      id: '11111111-2222-3333-4444-555555555555',
    });
    const text = (result as { content: Array<{ text: string }> }).content[0]!.text;
    expect(text).toContain('ALLOW_WRITE_OPERATIONS');
  });
});
