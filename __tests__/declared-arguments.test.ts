/**
 * declaredArgumentsOnly (REQ-SRV-022, #163): one helper lists the tools with
 * closed input schemas and refuses calls with arguments the schema doesn't
 * declare, using the same tool list.
 */
import { describe, expect, it } from 'vitest';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { declaredArgumentsOnly, queryParameters, withQueryProperties } from '../packages/mcp-core/src/tool-arguments.js';

const tools = declaredArgumentsOnly(async () => ({
  tools: [
    { name: 'list_things', description: 'd', inputSchema: { type: 'object', properties: { groupId: { type: 'string' }, SearchQuery: { type: 'string' } }, required: ['groupId'] } },
    { name: 'ping', description: 'd', inputSchema: { type: 'object', properties: {} } },
    { name: 'open', description: 'd', inputSchema: { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: true } },
  ],
}));

const refusal = async (name: string, args?: Record<string, unknown>): Promise<McpError | undefined> =>
  tools.refuseUndeclared(name, args).then(() => undefined, (e: unknown) => {
    if (e instanceof McpError) {return e;}
    throw e;
  });

describe('list', () => {
  it('closes every input schema', async () => {
    const { tools: listed } = await tools.list();
    expect(listed.map((t) => (t.inputSchema as { additionalProperties?: unknown }).additionalProperties)).toEqual([false, false, false]);
  });
  it('keeps everything else', async () => {
    const { tools: listed } = await tools.list();
    expect(listed[0]).toMatchObject({ name: 'list_things', description: 'd', inputSchema: { required: ['groupId'] } });
  });
});

describe('refuseUndeclared', () => {
  it('accepts declared arguments, none, or undefined', async () => {
    expect(await refusal('list_things', { groupId: 'g', SearchQuery: 'x' })).toBeUndefined();
    expect(await refusal('list_things', {})).toBeUndefined();
    expect(await refusal('ping', undefined)).toBeUndefined();
  });

  it('refuses an undeclared argument with InvalidParams, naming it and the accepted ones', async () => {
    const e = await refusal('list_things', { groupId: 'g', SearchQuer: 'x' });
    expect(e?.code).toBe(ErrorCode.InvalidParams);
    expect(e?.message).toContain('Unknown argument for list_things: SearchQuer. This tool accepts: groupId, SearchQuery.');
  });

  it('names every undeclared argument', async () => {
    expect((await refusal('list_things', { a: 1, b: 2 }))?.message).toContain('Unknown arguments for list_things: a, b.');
  });

  it('says when a tool takes no arguments', async () => {
    expect((await refusal('ping', { x: 1 }))?.message).toContain('Unknown argument for ping: x. This tool takes no arguments.');
  });

  it('refuses even when the tool schema said additionalProperties: true', async () => {
    expect(await refusal('open', { b: 1 })).toBeInstanceOf(McpError);
  });

  it('leaves an unknown tool name to the server', async () => {
    expect(await refusal('no_such_tool', { x: 1 })).toBeUndefined();
  });

  it('does not treat Object.prototype names as declared', async () => {
    expect(await refusal('list_things', { constructor: 1 })).toBeInstanceOf(McpError);
  });
});

describe('withQueryProperties (#179)', () => {
  const table = {
    '25R2': { list_things: { SearchQuery: { type: 'string', description: 'old' } } },
    '26R1': { list_things: { SearchQuery: { type: 'string', description: 'new' }, EntraIdDeviceId: { type: 'string', description: 'x' } } },
  };
  const list = async () => ({ tools: [
    { name: 'list_things', inputSchema: { type: 'object', properties: { groupId: { type: 'string' }, EntraIdDeviceId: { type: 'string' } }, required: ['groupId'] } },
    { name: 'get_thing', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } },
  ] });
  it('keeps path arguments and takes the query parameters of the selected release', async () => {
    const r26 = await withQueryProperties(table, () => '26R1', list)();
    expect(Object.keys((r26.tools[0].inputSchema as { properties: object }).properties)).toEqual(['groupId', 'SearchQuery', 'EntraIdDeviceId']);
    const r25 = await withQueryProperties(table, () => '25R2', list)();
    expect((r25.tools[0].inputSchema as { properties: Record<string, { description?: string }> }).properties).toEqual({ groupId: { type: 'string' }, SearchQuery: { type: 'string', description: 'old' } });
    expect(r25.tools[1]).toEqual((await list()).tools[1]);
  });

  it('keeps the other release\'s parameters for a tool whose route only that release has', async () => {
    const only25 = { '25R2': { list_old: { Page: { type: 'integer', description: 'p' } } }, '26R1': {} };
    const r = await withQueryProperties(only25, () => '26R1', async () => ({ tools: [{ name: 'list_old', inputSchema: { type: 'object', properties: {} } }] }))();
    expect(Object.keys((r.tools[0].inputSchema as { properties: object }).properties)).toEqual(['Page']);
    expect(queryParameters(only25, '26R1', 'list_old')).toEqual(['Page']);
  });
});
