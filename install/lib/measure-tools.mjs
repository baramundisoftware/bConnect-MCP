// Offline tool-surface measurement -- how much context a server selection costs
// before the user's first message.
//
// Needs no bMS and no credentials: it imports each server's exported createServer()
// factory and drives it over an in-memory transport, so the real initialize +
// tools/list handshake runs without the entrypoint's main(), which would otherwise
// process.exit(1) when bConnect is unreachable.
//
// Output is TSV on stdout -- dir<TAB>tools<TAB>bytes -- so PowerShell can consume it.
// Diagnostics go to stderr. A server that fails to load reports tools=ERROR rather
// than aborting the run, because "one package did not build" is exactly the state
// the installer needs to describe.
//
// Usage: node measure-tools.mjs --root <suiteRoot> [--dirs a,b,c] [--release 26R1]

import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadSdk, parseArgs } from './sdk.mjs';

const args = parseArgs(process.argv.slice(2));
const ROOT = args.root;
if (!ROOT) {
  console.error('measure-tools: --root <suiteRoot> is required');
  process.exit(2);
}

// Suppress the entrypoint's main() auto-run on import (same lever the suite's own
// vitest suite uses).
process.env.VITEST = '1';
process.env.BCONNECT_RELEASE = args.release || '26R1';

const { Client } = await loadSdk(ROOT, 'client/index.js');
const { InMemoryTransport } = await loadSdk(ROOT, 'inMemory.js');

const dirs = args.dirs
  ? String(args.dirs).split(',').map((s) => s.trim()).filter(Boolean)
  : readdirSync(ROOT)
      .filter((d) => /^bconnect-.*-mcp$/.test(d) && d !== 'bconnect-mcp-gateway')
      .sort();

for (const dir of dirs) {
  try {
    const mod = await import(pathToFileURL(resolve(ROOT, dir, 'build', 'index.js')).href);
    const { server } = mod.createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'installer-measure', version: '1.0.0' }, { capabilities: {} });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const { tools } = await client.listTools();
    const bytes = Buffer.byteLength(JSON.stringify(tools), 'utf8');
    process.stdout.write(`${dir}\t${tools.length}\t${bytes}\n`);

    await client.close();
    await server.close();
  } catch (err) {
    process.stdout.write(`${dir}\tERROR\t0\n`);
    console.error(`measure-tools: ${dir}: ${err.message}`);
  }
}
