/**
 * Write-gate regression (#190, REQ-SRV-012).
 *
 * These write tools were missing from their server's write gate and sent their
 * request with ALLOW_WRITE_OPERATIONS off. With writes off each must be refused
 * with the gate's message, and nothing may be sent. The general rule (no tool
 * sends anything but GET with writes off) is checked by the spec-conformance
 * guard for every tool.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, createRecorder, guardEnv, requiredArguments } from './lib/exerciser.js';

const CASES: Array<[server: string, tool: string]> = [
  ['bconnect-jobs-mcp', 'withdraw_kiosk_release'],
  ['bconnect-endpoints-mcp', 'link_entra_id_data'],
  ['bconnect-endpoints-mcp', 'unlink_entra_id_data'],
  ['bconnect-software-mcp', 'replace_application_in_bundle'],
];

const recorder = createRecorder();
const savedEnv = { ...process.env };
beforeAll(() => recorder.listen());
afterAll(() => {
  recorder.close();
  process.env = savedEnv;
});

describe.each(CASES)('%s %s with writes off', (server, tool) => {
  it('is refused with the write-gate message, and sends nothing', async () => {
    Object.assign(process.env, guardEnv('26R1', { writes: false, secretRead: false }));
    const conn = await connect(server);
    const schema = conn.tools.find((t) => t.name === tool)?.inputSchema;
    expect(schema, `${tool} is not registered`).toBeDefined();
    recorder.take();
    const result = await conn.call(tool, requiredArguments(schema!));
    const sent = recorder.take();
    await conn.close();
    expect(sent.map((r) => `${r.method} ${r.path}`)).toEqual([]);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('ALLOW_WRITE_OPERATIONS');
  });

  it('still works with writes on', async () => {
    Object.assign(process.env, guardEnv('26R1', { writes: true, secretRead: false }));
    const conn = await connect(server);
    const schema = conn.tools.find((t) => t.name === tool)!.inputSchema;
    recorder.take();
    await conn.call(tool, requiredArguments(schema));
    const sent = recorder.take();
    await conn.close();
    expect(sent.length).toBeGreaterThan(0);
  });
});
