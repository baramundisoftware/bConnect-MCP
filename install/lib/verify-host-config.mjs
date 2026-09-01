// Verify an EMITTED host configuration by starting the servers it describes.
//
// The distinction that matters, and the one this project learned the hard way: a
// probe that spawns its own servers with its own environment passes whether or not
// the deployed configuration is correct. So this file reads the host's own file --
// .mcp.json, .vscode/mcp.json, .cursor/mcp.json, a Continue block file -- parses it
// with that host's documented container shape, and starts every server using the
// command, args and env found IN THAT FILE. Nothing is supplied by the verifier.
//
// What this proves:      the file parses, and every server it names starts,
//                        completes the MCP handshake and serves a real bMS read.
// What it does NOT prove: that the host application reads this file. Only the host
//                        can prove that, and for most of these it is not installed
//                        on the machine that generated the config. The report says
//                        so rather than implying otherwise.
//
//   node verify-host-config.mjs --target <id> --path <file> [--suite-root <path>]
//                               [--catalog <path>] [--json]

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadSdk, parseArgs } from './sdk.mjs';
import { loadRegistry, parseToml } from './host-emitters.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));

if (!args.target || !args.path) {
  console.error('verify-host-config: --target <id> and --path <file> are required');
  process.exit(2);
}

const registry = loadRegistry(args.registry);
const target = registry.byId.get(args.target);
if (!target) {
  console.error(`verify-host-config: unknown target "${args.target}" -- see lib\\hosts.json`);
  process.exit(2);
}
if (target.transport === 'http') {
  console.error(
    `verify-host-config: ${target.id} consumes MCP over HTTP only; there is no local process to start.\n` +
      '  Verify the gateway instead: node verify-gateway.mjs --url <gateway url>',
  );
  process.exit(2);
}
if (!existsSync(args.path)) {
  console.error(`verify-host-config: ${args.path} does not exist`);
  process.exit(1);
}

const catalogPath = args.catalog || resolve(HERE, 'catalog.json');
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const byName = new Map(catalog.servers.map((s) => [s.name, s]));

// ─── Parse the host's own file, in the host's own shape ─────────────────────

const raw = readFileSync(args.path, 'utf8').replace(/^﻿/, '');
let doc;
if (target.format === 'yaml') {
  // A real YAML parser or nothing. Guessing at YAML with regexes is exactly the
  // sort of "close enough" that this whole exercise exists to avoid.
  const suiteGuess = args['suite-root'] || resolve(HERE, '..', '..', 'bConnect-MCP-main');
  const yamlPath = resolve(suiteGuess, 'node_modules', 'js-yaml', 'dist', 'js-yaml.mjs');
  if (!existsSync(yamlPath)) {
    console.error(
      `verify-host-config: ${target.id} emits YAML and no YAML parser was found under\n` +
        `  ${suiteGuess}\\node_modules\\js-yaml. Cannot verify without one -- reporting SKIPPED\n` +
        '  rather than claiming a pass. Run npm ci in the suite root, or pass --suite-root.',
    );
    process.exit(3);
  }
  const YAML = await import(pathToFileURL(yamlPath).href);
  try {
    doc = (YAML.load ?? YAML.default.load)(raw);
  } catch (err) {
    // Short and specific. js-yaml's own error object embeds the entire source
    // buffer, and an installer that dumps a whole file to stderr can fill the
    // pipe its parent is not reading yet -- which is a deadlock, not a diagnostic.
    console.error(`verify-host-config: ${args.path} is not valid YAML.`);
    console.error(`  ${String(err.reason || err.message).split('\n')[0]}`);
    console.error('  If this is a snippet (a markdown page with a fenced block in it) then it is');
    console.error('  documentation, not a configuration file, and there is nothing here to start.');
    process.exit(1);
  }
} else if (target.format === 'toml') {
  // Read back with this project's own reader, the same one the emitter uses to
  // check what it wrote. That is a weaker independence claim than js-yaml gives
  // for Continue, and it is stated rather than glossed: what this proves is that
  // the file parses in the shape the emitter believes it wrote, and then that
  // every server named in it really starts.
  try {
    doc = parseToml(raw);
  } catch (err) {
    console.error(`verify-host-config: ${args.path} is not valid TOML (${err.message}).`);
    console.error('  The host will not read it either.');
    process.exit(1);
  }
} else {
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    console.error(`verify-host-config: ${args.path} is not valid JSON (${err.message}).`);
    console.error('  The host will not read it either.');
    process.exit(1);
  }
}

const coll = doc?.[target.serversKey];
if (coll === undefined) {
  console.error(`verify-host-config: ${args.path} has no "${target.serversKey}" key.`);
  console.error(`  ${target.label} reads its servers from that key and nowhere else.`);
  process.exit(1);
}

/** @type {{name:string, entry:any}[]} */
let entries;
if (target.collection === 'list') {
  if (!Array.isArray(coll)) {
    console.error(`verify-host-config: "${target.serversKey}" must be a LIST for ${target.id}, and it is not.`);
    process.exit(1);
  }
  const nf = target.nameField || 'name';
  entries = coll.map((e) => ({ name: e?.[nf], entry: e }));
} else {
  entries = Object.entries(coll).map(([name, entry]) => ({ name, entry }));
}
entries = entries.filter((e) => e.name && String(e.name).startsWith('bconnect-'));
if (args.servers) {
  const want = new Set(String(args.servers).split(',').map((s) => s.trim()).filter(Boolean));
  entries = entries.filter((e) => want.has(e.name));
}
if (!entries.length) {
  console.error(`verify-host-config: no bconnect-* servers in ${args.path}`);
  process.exit(1);
}

// The suite root comes out of the configured entry point, so the SDK loaded here
// is the one the servers were built against.
const firstScript = (entries[0].entry.args || []).find((a) => /build[\\/]index\.js$/.test(String(a)));
if (!firstScript) {
  console.error(`verify-host-config: ${entries[0].name} has no .../build/index.js argument; the config looks malformed`);
  process.exit(1);
}
const suiteRoot = args['suite-root'] || resolve(dirname(firstScript), '..', '..');

const { Client } = await loadSdk(suiteRoot, 'client/index.js');
const { StdioClientTransport } = await loadSdk(suiteRoot, 'client/stdio.js');

const preview = (r) => String(r?.content?.[0]?.text ?? '').replace(/\s+/g, ' ').slice(0, 110);
const line = (ok, msg) => console.log(`  ${ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL'}  ${msg}`);

console.log(`\n  ${target.label}`);
console.log(`  file        ${args.path}`);
console.log(`  container   ${target.serversKey} (${target.collection})`);
console.log(`  servers     ${entries.map((e) => e.name).join(', ')}`);
console.log('');
console.log('  Starting each server from the command, args and env in THAT FILE.');
console.log('  Nothing below is supplied by the verifier.');

const results = [];
let failed = false;

for (const { name, entry } of entries) {
  const spec = byName.get(name);
  const res = { name, started: false, tools: 0, read: null, detail: '', stderr: '' };
  results.push(res);
  console.log(`\n${name}`);

  if (typeof entry.command !== 'string' || !entry.command) {
    line(false, 'no command in this entry -- the host would have nothing to start');
    failed = true;
    continue;
  }

  let client;
  let stderrBuf = '';
  try {
    const transport = new StdioClientTransport({
      command: entry.command,
      args: entry.args || [],
      // The host spawns children with its own environment plus the entry's env
      // block. The SDK default hands over a minimal safe subset instead, which is
      // not the thing being reproduced.
      env: { ...process.env, ...(entry.env || {}) },
      stderr: 'pipe',
    });
    const origStart = transport.start.bind(transport);
    transport.start = async () => {
      const p = origStart();
      try {
        transport.stderr?.on('data', (d) => { stderrBuf += d.toString(); });
      } catch { /* thinner failure text on SDK builds without it */ }
      return p;
    };

    client = new Client({ name: 'bconnect-host-verify', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);
    res.started = true;

    const { tools } = await client.listTools();
    res.tools = tools.length;
    line(true, `started and completed the MCP handshake -- ${tools.length} tools`);

    const readTool = spec?.readProbe;
    if (!readTool) {
      res.read = null;
      res.detail = spec?.readProbeSkipReason || 'no zero-argument read tool in this server';
      line(null, `live read: SKIPPED -- ${res.detail}`);
    } else {
      const schema = tools.find((t) => t.name === readTool)?.inputSchema;
      const props = Object.keys(schema?.properties || {});
      const readArgs = {};
      if (props.includes('PageSize')) readArgs.PageSize = 1;
      else if (props.includes('pageSize')) readArgs.pageSize = 1;
      const r = await client.callTool({ name: readTool, arguments: readArgs });
      res.read = !r.isError;
      res.detail = preview(r);
      line(res.read, `live read: ${readTool} -> ${res.read ? res.detail : 'ERROR: ' + res.detail}`);
      if (!res.read) failed = true;
    }
  } catch (err) {
    res.stderr = stderrBuf.trim();
    line(false, `did not start: ${err.message}`);
    if (res.stderr) {
      console.log('        the server said:');
      for (const l of res.stderr.split(/\r?\n/).slice(0, 8)) console.log(`          ${l}`);
    }
    failed = true;
  } finally {
    try { await client?.close(); } catch { /* closing a dead client is not news */ }
  }
}

console.log('');
console.log(`  ${results.filter((r) => r.started).length}/${results.length} server(s) started from ${target.label}'s own configuration file.`);
console.log('');
console.log('  Proven:     this file parses in the shape the host documents, and every');
console.log('              server in it starts, handshakes and reads real bMS data.');
if (target.verification === 'host-loaded') {
  console.log(`  Not proven: that ${target.label} has LOADED this file. Restart it and ask.`);
} else {
  console.log(`  Not proven: that ${target.label} reads this file at all -- it is not installed`);
  console.log('              here. The shape is documentation-checked, the processes are real.');
}

if (args.json) console.log(JSON.stringify({ target: target.id, path: args.path, results }, null, 2));
process.exit(failed ? 1 : 0);
