/**
 * One tool per operation, its route chosen by arguments (REQ-SRV-029, #174, ADR-0015).
 *
 * A merged tool's routes are its variants: `list_endpoints[type=WindowsEndpoint]`,
 * `list_endpoints[type=]` (type omitted). The core lists only the selector values the
 * selected release has, resolves a call to its variant, refuses what no variant of the
 * release takes, and answers a removed tool name with its replacement.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import {
  refuseReplacedTool, variantKey, withToolVariants, withUnverifiedWriteMarker, withVariantSelectors,
  UNVERIFIED_WRITE_NOTE, type ReplacedToolTable, type ToolReleaseTable, type ToolVariantTable,
} from '@bconnect/mcp-core';

const VARIANTS: ToolVariantTable = {
  list_things: {
    'list_things[type=]': { type: null },
    'list_things[type=Red]': { type: 'Red' },
    'list_things[type=Blue]': { type: 'Blue' },
  },
  list_members: {
    'list_members[kind=Static,member=]': { kind: 'Static', member: null },
    'list_members[kind=Static,member=Red]': { kind: 'Static', member: 'Red' },
    'list_members[kind=Dynamic,member=]': { kind: 'Dynamic', member: null },
  },
};
const RELEASES: ToolReleaseTable = {
  list_things: ['25R2', '26R1'],
  'list_things[type=]': ['25R2', '26R1'],
  'list_things[type=Red]': ['25R2', '26R1'],
  'list_things[type=Blue]': ['25R2'],
  list_members: ['25R2', '26R1'],
  'list_members[kind=Static,member=]': ['25R2', '26R1'],
  'list_members[kind=Static,member=Red]': ['25R2', '26R1'],
  'list_members[kind=Dynamic,member=]': ['25R2', '26R1'],
};
/** The arguments each variant takes besides its selectors. */
const ARGS: Record<string, string[]> = {
  'list_things[type=]': ['Page'],
  'list_things[type=Red]': ['Page', 'Shade'],
  'list_things[type=Blue]': ['Page', 'Depth'],
  'list_members[kind=Static,member=]': ['groupId'],
  'list_members[kind=Static,member=Red]': ['groupId', 'Shade'],
  'list_members[kind=Dynamic,member=]': ['groupId'],
};

const saved = process.env.BCONNECT_RELEASE;
afterEach(() => { process.env.BCONNECT_RELEASE = saved; });

const call = (name: string, args: Record<string, unknown> = {}) => ({ params: { name, arguments: args } });
async function refusal(run: () => unknown): Promise<McpError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(McpError);
    return error as McpError;
  }
  throw new Error('not refused');
}

describe('variantKey', () => {
  it('finds the variant from the selector arguments; an omitted selector is null', () => {
    expect(variantKey(VARIANTS, 'list_things', {})).toBe('list_things[type=]');
    expect(variantKey(VARIANTS, 'list_things', { type: 'Red', Page: 1 })).toBe('list_things[type=Red]');
    expect(variantKey(VARIANTS, 'list_members', { kind: 'Static', member: 'Red' })).toBe('list_members[kind=Static,member=Red]');
    expect(variantKey(VARIANTS, 'list_members', { kind: 'Dynamic', member: 'Red' })).toBeUndefined();
    expect(variantKey(VARIANTS, 'other_tool', { type: 'Red' })).toBeUndefined();
  });
});

describe('withVariantSelectors', () => {
  const list = async () => ({ tools: [
    { name: 'list_things', inputSchema: { type: 'object', properties: { type: { type: 'string', description: 'Type.' }, Page: { type: 'integer', description: 'Page.' }, Shade: { type: 'string', description: 'Shade.' }, Depth: { type: 'integer', description: 'Depth.' } } } },
    { name: 'list_members', inputSchema: { type: 'object', properties: { kind: { type: 'string' }, member: { type: 'string' }, groupId: { type: 'string' } } } },
    { name: 'plain', inputSchema: { type: 'object', properties: { x: { type: 'string' } } } },
  ] });

  it.each([
    ['25R2', ['Red', 'Blue']],
    ['26R1', ['Red']],
  ])('lists on %s only the values whose route the release has, in variant order', async (release, values) => {
    process.env.BCONNECT_RELEASE = release;
    const { tools } = await withVariantSelectors(VARIANTS, RELEASES, (key) => ARGS[key], list)();
    expect((tools[0].inputSchema.properties as any).type).toEqual({ type: 'string', description: 'Type.', enum: values });
    expect((tools[1].inputSchema.properties as any).kind.enum).toEqual(['Static', 'Dynamic']);
    expect((tools[1].inputSchema.properties as any).member.enum).toEqual(['Red']);
    expect(tools[2]).toEqual((await list()).tools[2]);
  });

  it('says which variants take a property not all of them take; one no listed variant takes is left out', async () => {
    process.env.BCONNECT_RELEASE = '25R2';
    let props = (await withVariantSelectors(VARIANTS, RELEASES, (key) => ARGS[key], list)()).tools[0].inputSchema.properties as any;
    expect(props.Page.description).toBe('Page.');
    expect(props.Shade.description).toBe('Shade. Only for type "Red".');
    expect(props.Depth.description).toBe('Depth. Only for type "Blue".');
    process.env.BCONNECT_RELEASE = '26R1';
    props = (await withVariantSelectors(VARIANTS, RELEASES, (key) => ARGS[key], list)()).tools[0].inputSchema.properties as any;
    expect(props.Depth).toBeUndefined();
    expect(props.Shade.description).toBe('Shade. Only for type "Red".');
    const members = (await withVariantSelectors(VARIANTS, RELEASES, (key) => ARGS[key], list)()).tools[1].inputSchema.properties as any;
    expect(members.groupId).toEqual({ type: 'string' });
  });
});

describe('withToolVariants', () => {
  const seen: string[] = [];
  const handler = withToolVariants(VARIANTS, RELEASES, (key) => ARGS[key], async (request: { params: { name: string; arguments?: Record<string, unknown> } }) => {
    seen.push(request.params.name);
    return { content: [] };
  });
  afterEach(() => { seen.length = 0; });

  it('passes a valid call through unchanged, and a tool without variants', async () => {
    process.env.BCONNECT_RELEASE = '25R2';
    await handler(call('list_things', { type: 'Blue', Depth: 2 }));
    await handler(call('list_things', { Page: 0 }));
    await handler(call('plain', { anything: 1 }));
    expect(seen).toEqual(['list_things', 'list_things', 'plain']);
  });

  it('refuses an unknown value, naming the values the release offers', async () => {
    process.env.BCONNECT_RELEASE = '26R1';
    const e = await refusal(() => handler(call('list_things', { type: 'Green' })));
    expect(e.code).toBe(ErrorCode.InvalidParams);
    expect(e.message).toContain('Unknown type for list_things: "Green". bMS 26R1 offers: Red.');
    expect(seen).toEqual([]);
  });

  it('refuses a value only another release has, naming the release in use', async () => {
    process.env.BCONNECT_RELEASE = '26R1';
    const e = await refusal(() => handler(call('list_things', { type: 'Blue' })));
    expect(e.code).toBe(ErrorCode.InvalidParams);
    expect(e.message).toContain('list_things with type "Blue" is only available in bMS 25R2; this server uses 26R1 (from BCONNECT_RELEASE).');
    expect(seen).toEqual([]);
  });

  it('refuses a combination no route has, listing the valid ones for the given first selector', async () => {
    const e = await refusal(() => handler(call('list_members', { kind: 'Dynamic', member: 'Red', groupId: 'g' })));
    expect(e.code).toBe(ErrorCode.InvalidParams);
    expect(e.message).toContain('list_members has no route for kind "Dynamic" and member "Red". Valid on bMS 26R1: kind "Dynamic" without member.');
    expect(seen).toEqual([]);
  });

  it('refuses an argument of another variant, naming the variants that take it', async () => {
    process.env.BCONNECT_RELEASE = '25R2';
    const e = await refusal(() => handler(call('list_things', { type: 'Red', Depth: 2 })));
    expect(e.code).toBe(ErrorCode.InvalidParams);
    expect(e.message).toContain('Depth is not available for list_things with type "Red" (only with type "Blue").');
    const f = await refusal(() => handler(call('list_things', { Shade: 'x' })));
    expect(f.message).toContain('Shade is not available for list_things without type (only with type "Red").');
    expect(seen).toEqual([]);
  });

  it('leaves an argument no variant declares to the declared-arguments check', async () => {
    await handler(call('list_things', { type: 'Red', notDeclared: 1 }));
    expect(seen).toEqual(['list_things']);
  });

  it('refuses a selector that is not a string', async () => {
    const e = await refusal(() => handler(call('list_things', { type: 3 })));
    expect(e.code).toBe(ErrorCode.InvalidParams);
    expect(e.message).toContain('Unknown type for list_things: 3.');
  });
});

describe('refuseReplacedTool', () => {
  const REPLACED: ReplacedToolTable = {
    list_red_things: { tool: 'list_things', variant: 'list_things[type=Red]' },
    list_blue_things: { tool: 'list_things', variant: 'list_things[type=Blue]' },
    list_all_things: { tool: 'list_things', variant: 'list_things[type=]' },
    search_things: { tool: 'list_things', variant: 'list_things[type=]', rename: { query: 'SearchQuery', pageSize: 'PageSize' } },
  };

  it('answers a removed name with its replacement and the arguments to use', async () => {
    process.env.BCONNECT_RELEASE = '25R2';
    const e = await refusal(() => refuseReplacedTool(REPLACED, RELEASES, 'list_red_things'));
    expect(e.code).toBe(ErrorCode.MethodNotFound);
    expect(e.message).toContain('list_red_things was replaced by list_things: call list_things with type "Red".');
    expect((await refusal(() => refuseReplacedTool(REPLACED, RELEASES, 'list_all_things'))).message)
      .toContain('list_all_things was replaced by list_things: call list_things without type.');
    expect((await refusal(() => refuseReplacedTool(REPLACED, RELEASES, 'search_things'))).message)
      .toContain('search_things was replaced by list_things: call list_things without type, with SearchQuery (was query) and PageSize (was pageSize).');
  });

  it('says when the replacement route is missing in the selected release', async () => {
    process.env.BCONNECT_RELEASE = '26R1';
    expect((await refusal(() => refuseReplacedTool(REPLACED, RELEASES, 'list_blue_things'))).message)
      .toContain('list_blue_things was replaced by list_things: call list_things with type "Blue". That route is only available in bMS 25R2; this server uses 26R1 (from BCONNECT_RELEASE).');
  });

  it('leaves every other name alone', () => {
    expect(() => refuseReplacedTool(REPLACED, RELEASES, 'list_things')).not.toThrow();
    expect(() => refuseReplacedTool(REPLACED, RELEASES, 'constructor')).not.toThrow();
  });
});

describe('withUnverifiedWriteMarker with variants', () => {
  const VARIANT_WRITES: ToolVariantTable = {
    update_endpoint: {
      'update_endpoint[type=WindowsEndpoint]': { type: 'WindowsEndpoint' },
      'update_endpoint[type=AndroidEndpoint]': { type: 'AndroidEndpoint' },
    },
    delete_endpoint: {
      'delete_endpoint[type=WindowsEndpoint]': { type: 'WindowsEndpoint' },
      'delete_endpoint[type=MacEndpoint]': { type: 'MacEndpoint' },
    },
    start_enrollment: {
      'start_enrollment[type=AndroidEndpoint]': { type: 'AndroidEndpoint' },
    },
  };
  const REL: ToolReleaseTable = Object.fromEntries(Object.values(VARIANT_WRITES).flatMap((v) => Object.keys(v)).map((k) => [k, ['25R2', '26R1']]));
  const list = async () => ({ tools: ['update_endpoint', 'delete_endpoint', 'start_enrollment'].map((name) => ({ name, description: 'Does it.' })) });

  it('names the variants without a live check; none → no note; all → the usual note', async () => {
    const writes = new Set(['update_endpoint', 'delete_endpoint', 'start_enrollment']);
    const { tools } = await withUnverifiedWriteMarker(writes, list, { variants: VARIANT_WRITES, releases: REL })();
    // update_windows_endpoint and delete_windows/mac_endpoint were verified live under their old names.
    expect(tools.map((t) => t.description)).toEqual([
      'Does it. Not yet verified against a live bMS for: type "AndroidEndpoint".',
      'Does it.',
      `Does it. ${UNVERIFIED_WRITE_NOTE}`,
    ]);
  });
});
