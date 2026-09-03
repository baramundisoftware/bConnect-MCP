/**
 * One error channel (INT-11 / INT-53, INT-1).
 *
 * The rule being pinned:
 *
 *   400 / 403 / 404 / 429  -> isError tool result, the same shape the write and
 *                             secret gates already return
 *   validation, gates      -> protocol error, untouched
 *   401 / 5xx / transport  -> protocol InternalError, text unchanged from the
 *                             thirteen hand-written catch-alls
 *
 * The end-to-end block drives a real `BConnectClientBase` through a stub axios
 * adapter, so what is asserted is what a tool call actually produces — not what
 * a hand-built error object produces. Nothing here touches a network or the
 * live bMS estate.
 */

import { describe, it, expect } from 'vitest';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import {
  BConnectApiError,
  BConnectClientBase,
  BareMcpError,
  EXPECTED_HTTP_STATUSES,
  classifyToolError,
  handleToolError,
  toolErrorResult,
  toolTextResult,
} from '@bconnect/mcp-core';

function makeClient(): BConnectClientBase {
  return new BConnectClientBase({
    baseUrl: 'https://bms.example.invalid/bconnect',
    username: 'svcacct',
    password: 'SuperSecret123',
  });
}

/** Fail the request the way a real bMS would. */
function failingTransport(client: BConnectClientBase, status: number, body: unknown) {
  client.getHttpClient().defaults.adapter = async (config) => {
    throw new AxiosError(
      `Request failed with status code ${status}`,
      String(status),
      config as InternalAxiosRequestConfig,
      {},
      { data: body, status, statusText: 'Error', headers: {}, config } as never
    );
  };
}

describe('classification', () => {
  it('routes every caller-recoverable status to the tool-result channel', () => {
    expect(EXPECTED_HTTP_STATUSES).toEqual([400, 403, 404, 409, 412, 423, 429]);
    for (const status of EXPECTED_HTTP_STATUSES) {
      const classified = classifyToolError(new BConnectApiError(status, 'nope'));
      expect(classified).toEqual({ kind: 'expected', status, message: 'nope' });
    }
  });

  it('409 in particular, because it was the most-hit error path in the suite', () => {
    // Measured live: 25 of 26 endpoints and 18 of 19 logical groups answer
    // GET .../MaintenanceWindow with 409 and the detail "Requested resource has
    // no maintenance window" — a complete, ordinary answer to "does this
    // machine have a maintenance window?". It used to arrive as -32603
    // InternalError, which most hosts render as a hard failure, on 96% of
    // calls. A model that sees that concludes the tool is broken.
    const classified = classifyToolError(
      new BConnectApiError(409, 'Requested resource has no maintenance window')
    );
    expect(classified.kind).toBe('expected');
    // 26R1 declares 409 on 47 operations, 412 on 1 and 423 on 2.
    for (const status of [412, 423]) {
      expect(classifyToolError(new BConnectApiError(status, 'nope')).kind).toBe('expected');
    }
  });

  it('keeps 401 and 5xx on the fault channel', () => {
    // Nothing the model can choose fixes bad service credentials or a bMS that
    // is down; answering with a readable result invites a retry loop.
    for (const status of [401, 500, 502, 503]) {
      expect(classifyToolError(new BConnectApiError(status, 'nope')).kind).toBe('fault');
    }
  });

  it('rethrows protocol errors as protocol errors', () => {
    const validation = new BareMcpError(ErrorCode.InvalidParams, 'id must be a valid GUID');
    const classified = classifyToolError(validation);

    expect(classified.kind).toBe('protocol');
    expect(classified.code).toBe(ErrorCode.InvalidParams);
  });

  it('recovers the status from the message when the error never went through the client', () => {
    // Modules construct errors by hand; an older build of mcp-core threw plain
    // Errors. Both still land on the right channel.
    expect(classifyToolError(new Error('Resource not found. [GET /endpoints/v2.0/Endpoints/0]')))
      .toMatchObject({ kind: 'expected', status: 404 });
    expect(classifyToolError(new Error('bConnect API error (HTTP 400). [PATCH /x]')))
      .toMatchObject({ kind: 'expected', status: 400 });
    expect(classifyToolError(new Error('Rate limit exceeded. Please try again later.')))
      .toMatchObject({ kind: 'expected', status: 429 });
    expect(classifyToolError(new Error('Access denied. Insufficient permissions for this operation.')))
      .toMatchObject({ kind: 'expected', status: 403 });
    expect(classifyToolError(new Error('Authentication failed. Check your credentials (username/password or API key).')))
      .toMatchObject({ kind: 'fault', status: 401 });
    expect(classifyToolError(new Error('bConnect API returned an internal server error.')))
      .toMatchObject({ kind: 'fault', status: 500 });
  });

  it('reads a status off any shape that carries one', () => {
    expect(classifyToolError({ status: 404, message: 'x' }).status).toBe(404);
    expect(classifyToolError({ response: { status: 429 }, message: 'x' }).status).toBe(429);
  });

  it('treats an unrecognisable failure as a fault', () => {
    expect(classifyToolError(new Error('Cannot connect to the bConnect API.')).kind).toBe('fault');
    expect(classifyToolError('a thrown string')).toEqual({ kind: 'fault', message: 'a thrown string' });
  });
});

describe('handleToolError', () => {
  it('returns a readable result for an expected failure', () => {
    const result = handleToolError(
      new BConnectApiError(404, 'Resource not found. [GET /endpoints/v2.0/Endpoints/0000]')
    );

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Resource not found. [GET /endpoints/v2.0/Endpoints/0000]' }],
      isError: true,
    });
  });

  it('produces the same shape the write gate produces', () => {
    // One failure shape for policy refusals and API failures alike — that is
    // the whole of INT-53's core half.
    const gate = { content: [{ type: 'text', text: "Write operation 'x' is disabled." }], isError: true };
    const api = handleToolError(new BConnectApiError(403, 'Access denied.'));

    expect(Object.keys(api).sort()).toEqual(Object.keys(gate).sort());
    expect(api.isError).toBe(true);
    expect(api.content[0].type).toBe('text');
  });

  it('rethrows a protocol error untouched', () => {
    const validation = new BareMcpError(ErrorCode.InvalidParams, 'id must be a valid GUID');

    expect(() => handleToolError(validation)).toThrow(validation);
    try {
      handleToolError(validation);
    } catch (error) {
      expect(error).toBe(validation);
      expect((error as McpError).code).toBe(ErrorCode.InvalidParams);
    }
  });

  it('throws InternalError for a fault, with the text the old catch-alls used', () => {
    try {
      handleToolError(new BConnectApiError(500, 'bConnect API returned an internal server error.'));
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(McpError);
      expect((error as McpError).code).toBe(ErrorCode.InternalError);
      expect((error as McpError).message).toBe(
        'Tool execution failed: bConnect API returned an internal server error.'
      );
    }
  });

  it('does not double the "MCP error" prefix (A2)', () => {
    try {
      handleToolError(new Error('MCP error -32603: Tool execution failed: boom'));
      throw new Error('should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toBe('Tool execution failed: Tool execution failed: boom');
      expect(message).not.toMatch(/MCP error/);
    }
  });

  it('strips a stale prefix off a readable result too', () => {
    const result = toolErrorResult('MCP error -32602: MCP error -32602: id must be a valid GUID');
    expect(result.content[0].text).toBe('id must be a valid GUID');
  });
});

describe('result helpers', () => {
  it('toolTextResult is a success result', () => {
    expect(toolTextResult('{"ok":true}')).toEqual({ content: [{ type: 'text', text: '{"ok":true}' }] });
    expect(toolTextResult('x').isError).toBeUndefined();
  });
});

describe('end to end through BConnectClientBase', () => {
  it('carries the status on a 404 and keeps the message it always had', async () => {
    const client = makeClient();
    failingTransport(client, 404, { message: 'No endpoint with that id' });

    try {
      await client.getHttpClient().get('/endpoints/v2.0/Endpoints/00000000-0000-0000-0000-000000000000');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(BConnectApiError);
      expect((error as BConnectApiError).status).toBe(404);
      expect((error as BConnectApiError).method).toBe('GET');
      expect((error as Error).message).toContain('Resource not found.');
      // INT-43's detail is still there — the status is additive.
      expect((error as Error).message).toContain('No endpoint with that id');
      expect(error).toBeInstanceOf(Error);
    }
  });

  it('answers a 404 as a readable tool result, not an internal error', async () => {
    const client = makeClient();
    failingTransport(client, 404, {});

    try {
      await client.getHttpClient().get('/endpoints/v2.0/Endpoints/0000');
      throw new Error('should have thrown');
    } catch (error) {
      const result = handleToolError(error);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Resource not found.');
    }
  });

  it('answers a 400 with the API’s own validation detail', async () => {
    const client = makeClient();
    failingTransport(client, 400, { errors: { displayName: 'must not be empty' } });

    try {
      await client.getHttpClient().post('/endpoints/v2.0/WindowsEndpoints', {});
      throw new Error('should have thrown');
    } catch (error) {
      const result = handleToolError(error);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('must not be empty');
    }
  });

  it('still throws InternalError on a 500', async () => {
    const client = makeClient();
    failingTransport(client, 500, {});

    try {
      await client.getHttpClient().get('/endpoints/v2.0/Endpoints');
      throw new Error('should have thrown');
    } catch (error) {
      expect(() => handleToolError(error)).toThrow(McpError);
    }
  });
});
