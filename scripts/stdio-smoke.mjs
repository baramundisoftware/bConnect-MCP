// End-to-end: launch each Phase 1 server exactly as Claude Desktop does and
// make one real read-only call against the live bMS.
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = resolve(import.meta.dirname, '..');
const { ENV_FILE: ENV } = await import('./lib/env-path.mjs');

const CASES = [
  ['endpoints', 'list_windows_endpoints'],
  ['software', 'list_installed_windows_software'],
  ['jobs', 'list_job_definitions'],
  ['compliance', 'list_detected_rule_violations'],
];

for (const [mod, tool] of CASES) {
  const c = new Client({ name: 'smoke', version: '1.0.0' }, { capabilities: {} });
  try {
    const t = new StdioClientTransport({
      command: process.execPath,
      args: [`--env-file=${ENV}`, resolve(ROOT, `bconnect-${mod}-mcp`, 'build', 'index.js')],
      stderr: 'ignore',
    });
    await c.connect(t);
    const { tools } = await c.listTools();
    const r = await c.callTool({ name: tool, arguments: { PageSize: 1 } });
    const txt = String(r.content?.[0]?.text ?? '').replace(/\s+/g, ' ');
    const total = txt.match(/"totalItems":\s*(\d+)/)?.[1];
    const verdict = r.isError ? `ERROR ${txt.slice(0, 70)}` : `${tool} -> totalItems=${total ?? '?'}`;
    console.log(`bconnect-${mod}`.padEnd(22) + `${String(tools.length).padStart(3)} tools   ${verdict}`);
    await c.close();
  } catch (e) {
    console.log(`bconnect-${mod}`.padEnd(22) + `FAILED  ${e.message}`);
  }
}
