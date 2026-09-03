// Verify the LIVE Claude Desktop configuration -- not the mechanism, the config.
//
// This distinction is the whole point of this file. The suite already ships probes
// that spawn their own servers with their own environment; they pass whether or not
// the deployed configuration is correct, which is how a write-tool allowlist in this
// project was written up as applied for a week while the live config had no allowlist
// at all. So: every server here is started from the command, args and env block read
// out of claude_desktop_config.json itself. Nothing is supplied by the verifier.
//
// For each configured bconnect-* server:
//   1. spawn it exactly as Claude Desktop does, over stdio
//   2. confirm it completes the MCP handshake instead of exiting (finding B1/F1:
//      a bad health path makes main() process.exit(1) and Desktop reports only
//      "server disconnected", so stderr is captured and printed on failure)
//   3. list its tools and measure their schema weight
//   4. make one real read call against the bMS
//   5. probe the write gate in whichever direction can be proven without writing
//
// Usage:
//   node verify-install.mjs --config <path> [--catalog <path>] [--servers a,b]
//                           [--json] [--probe-allowlist-positive]

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSdk, parseArgs } from './sdk.mjs';
import { classifyTlsFailure, describeTlsResult, knownTlsCodes } from './probe-tls.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const configPath = args.config;
if (!configPath) {
  console.error('verify-install: --config <path> is required');
  process.exit(2);
}
const catalogPath = args.catalog || resolve(HERE, 'catalog.json');
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const ZERO = catalog.zeroGuid;
const byName = new Map(catalog.servers.map((s) => [s.name, s]));

if (!existsSync(configPath)) {
  console.error(`verify-install: ${configPath} does not exist`);
  process.exit(1);
}
let config;
try {
  config = JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
} catch (err) {
  console.error(`verify-install: ${configPath} is not valid JSON (${err.message}).`);
  console.error('  Claude Desktop will not load it either. Restore the most recent');
  console.error('  claude_desktop_config.json.bak-* alongside it, or fix the syntax.');
  process.exit(1);
}
const mcpServers = config.mcpServers || {};

let names = Object.keys(mcpServers).filter((n) => n.startsWith('bconnect-'));
if (args.servers) {
  const want = new Set(String(args.servers).split(',').map((s) => s.trim()).filter(Boolean));
  names = names.filter((n) => want.has(n));
}
if (!names.length) {
  console.error('verify-install: no bconnect-* servers found in the configuration');
  process.exit(1);
}

// The suite root is derived from the configured entry point, so the verifier reads
// the SDK out of the same tree the servers were built in.
const firstScript = (mcpServers[names[0]].args || []).find((a) => /build[\\/]index\.js$/.test(a));
if (!firstScript) {
  console.error(`verify-install: ${names[0]} has no .../build/index.js argument; config looks malformed`);
  process.exit(1);
}
const suiteRoot = resolve(dirname(firstScript), '..', '..');

const { Client } = await loadSdk(suiteRoot, 'client/index.js');
const { StdioClientTransport } = await loadSdk(suiteRoot, 'client/stdio.js');

const results = [];
const line = (ok, msg) => console.log(`  ${ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL'}  ${msg}`);
const preview = (r) => String(r?.content?.[0]?.text ?? '').replace(/\s+/g, ' ').slice(0, 110);

for (const name of names) {
  const entry = mcpServers[name];
  const spec = byName.get(name);
  const res = {
    name,
    started: false,
    tools: 0,
    schemaBytes: 0,
    read: null,
    readDetail: '',
    gate: null,
    gateDetail: '',
    stderr: '',
    // Phase 4 finding F2. The whole per-server body sits in ONE try, so a throw
    // anywhere in it was reported as "did not start" even when the server had
    // started and the handshake had succeeded — and it left `read` at null,
    // which the summary reads as "skipped, nothing attempted" rather than
    // "attempted and failed". The result was PASS started and FAIL did not
    // start on adjacent lines, a summary claiming the credentials "authenticate
    // to bConnect and return real data", and exit 0 on a completely broken
    // install. These two fields make the failure impossible to filter away.
    error: null,
    phase: 'startup',
  };
  results.push(res);
  console.log(`\n${name}`);

  const envBlock = entry.env || {};
  const allowWrites = envBlock.ALLOW_WRITE_OPERATIONS === 'true';
  const allowlistRaw = envBlock.ALLOWED_WRITE_TOOLS;

  let client;
  let stderrBuf = '';
  try {
    const transport = new StdioClientTransport({
      command: entry.command,
      args: entry.args,
      // Claude Desktop spawns children with its own environment plus the entry's
      // env block; the SDK default would hand over a minimal safe subset instead,
      // which is not what we are trying to reproduce.
      env: { ...process.env, ...envBlock },
      stderr: 'pipe',
    });
    // Attach the stderr reader the moment the child exists. When a server hard-exits
    // at launch, its stderr is the only place the real cause appears.
    const origStart = transport.start.bind(transport);
    transport.start = async () => {
      const p = origStart();
      try {
        transport.stderr?.on('data', (d) => {
          stderrBuf += d.toString();
        });
      } catch {
        /* stderr not available on this SDK build; failure text will be thinner */
      }
      return p;
    };

    client = new Client({ name: 'bconnect-installer-verify', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);
    res.started = true;
    res.phase = 'read probe';

    const { tools } = await client.listTools();
    res.tools = tools.length;
    res.schemaBytes = Buffer.byteLength(JSON.stringify(tools), 'utf8');
    line(true, `started and completed the MCP handshake -- ${tools.length} tools, ~${Math.round(res.schemaBytes / 4).toLocaleString()} tokens of schema`);

    // ── live read ───────────────────────────────────────────────────────────
    const readTool = spec?.readProbe;
    if (!readTool) {
      res.read = null;
      res.readDetail = spec?.readProbeSkipReason || 'no zero-argument read tool in this server';
      line(null, `live read: SKIPPED -- ${res.readDetail}`);
    } else {
      const schema = tools.find((t) => t.name === readTool)?.inputSchema;
      const props = Object.keys(schema?.properties || {});
      const readArgs = {};
      if (props.includes('PageSize')) readArgs.PageSize = 1;
      else if (props.includes('pageSize')) readArgs.pageSize = 1;

      const r = await client.callTool({ name: readTool, arguments: readArgs });
      res.read = !r.isError;
      res.readDetail = preview(r);
      line(res.read, `live read: ${readTool} -> ${res.read ? res.readDetail : 'ERROR: ' + res.readDetail}`);
      if (res.read) {
        // A zero result may mean "not permitted", not "not present" -- the read-only
        // API key returns HTTP 200 with totalItems: 0 for RBAC-filtered collections
        // and there is no 403 to distinguish them (finding F9).
        const m = res.readDetail.match(/"?totalItems"?\s*:\s*(\d+)/i);
        if (m && m[1] === '0') {
          line(true, '        note: totalItems is 0. bConnect returns HTTP 200 with an empty page for');
          console.log('              collections the API key is not authorised to see, so this is NOT');
          console.log('              proof the estate is empty. Spot-check it in the bMC console.');
        }
      }
    }

    res.phase = 'write-gate probe';

    // ── write gate, live ────────────────────────────────────────────────────
    if (!spec || !spec.writeTools.length) {
      res.gate = null;
      res.gateDetail = 'server has no write tools';
      line(null, `write gate: N/A -- ${res.gateDetail}`);
    } else if (!allowWrites) {
      const probe = spec.writeProbe;
      if (!probe) {
        res.gate = null;
        res.gateDetail = 'no safe write probe defined for this server';
        line(null, `write gate: SKIPPED -- ${res.gateDetail}`);
      } else {
        // The gate refuses in-process, before any HTTP call, so this reaches nothing.
        const r = await client.callTool({ name: probe.tool, arguments: substituteZero(probe.args) });
        const blocked = !!r.isError && /is disabled/i.test(preview(r));
        res.gate = blocked;
        res.gateDetail = preview(r);
        line(blocked, `write gate: read-only CONFIRMED live -- ${probe.tool} refused in-server ("${res.gateDetail.slice(0, 70)}...")`);
        if (!blocked) {
          console.log('        A write tool was NOT refused while ALLOW_WRITE_OPERATIONS is unset.');
          console.log('        Treat this configuration as write-capable until explained.');
        }
      }
    } else if (spec.allowlist && allowlistRaw !== undefined) {
      const allowed = new Set(String(allowlistRaw).split(',').map((s) => s.trim()).filter(Boolean));
      const blockedCandidate = spec.writeTools.find((t) => !allowed.has(t) && spec.writeProbe && t === spec.writeProbe.tool)
        || spec.writeTools.find((t) => !allowed.has(t));
      if (!blockedCandidate) {
        res.gate = false;
        res.gateDetail = 'ALLOWED_WRITE_TOOLS lists every write tool -- it narrows nothing';
        line(false, `write gate: ${res.gateDetail}`);
      } else {
        const probeArgs =
          spec.writeProbe && spec.writeProbe.tool === blockedCandidate
            ? substituteZero(spec.writeProbe.args)
            : argsForTool(tools, blockedCandidate);
        const r = await client.callTool({ name: blockedCandidate, arguments: probeArgs });
        const blocked = !!r.isError && /approved tool set/i.test(preview(r));
        res.gate = blocked;
        res.gateDetail = preview(r);
        line(
          blocked,
          `write gate: allowlist ACTIVE live -- ${allowed.size} of ${spec.writeTools.length} write tools permitted; ` +
            `"${blockedCandidate}" refused in-server`
        );
        if (!blocked) {
          console.log(`        Expected a refusal naming the approved tool set; got: ${res.gateDetail}`);
        }
        console.log(`        permitted: ${[...allowed].sort().join(', ')}`);

        if (args['probe-allowlist-positive']) {
          // Opt-in. Calls an ALLOWED write tool with an all-zeros GUID: it passes the
          // gate, reaches bConnect, and is rejected there as a bad identifier. Nothing
          // is created or deleted. Without this, a gate that blocks *everything* looks
          // identical to a correctly narrowed one.
          const positive = [...allowed].find((t) => spec.writeTools.includes(t));
          if (positive) {
            const r2 = await client.callTool({ name: positive, arguments: argsForTool(tools, positive) });
            const passedGate = !/approved tool set|is disabled/i.test(preview(r2));
            line(passedGate, `write gate: positive direction -- "${positive}" passed the gate and reached the API (${preview(r2).slice(0, 60)})`);
          }
        }
      }
    } else {
      res.gate = null;
      res.gateDetail = spec.allowlist
        ? 'ALLOW_WRITE_OPERATIONS=true with no ALLOWED_WRITE_TOOLS -- all write tools reachable'
        : 'ALLOW_WRITE_OPERATIONS=true and this server has no ALLOWED_WRITE_TOOLS support -- all write tools reachable';
      line(null, `write gate: NOT VERIFIED -- ${res.gateDetail}`);
      console.log(`        ${spec.writeTools.length} write tools are reachable in this server. Confirming that`);
      console.log('        by probe would mean performing a write, which this installer will not do.');
    }
  } catch (err) {
    res.stderr = stderrBuf.trim();
    res.error = err.message;
    // Report where it actually failed. "did not start" was printed for every
    // throw in this block, including ones that happened after a successful
    // handshake — which is how PASS started and FAIL did not start came to sit
    // on adjacent lines for the same server.
    if (!res.started) {
      line(false, `did not start: ${err.message}`);
    } else {
      // Started, then failed. Record the probe as FAILED, not as skipped: a
      // null here is filtered out of the exit-code test as "never attempted",
      // which is what let a broken install exit 0.
      if (res.phase === 'read probe' && res.read === null) {
        res.read = false;
        res.readDetail = err.message;
      }
      if (res.phase === 'write-gate probe' && res.gate === null) {
        res.gate = false;
        res.gateDetail = err.message;
      }
      line(false, `started, then failed during the ${res.phase}: ${err.message}`);
    }
    if (res.stderr) {
      console.log('        server stderr (this is what Claude Desktop hides behind "server disconnected"):');
      for (const l of res.stderr.split(/\r?\n/).slice(0, 12)) console.log(`          ${l}`);

      // A certificate failure reaches here as an OpenSSL code in the server's own
      // stderr, and it is the one cause with a specific fix. Naming it before the
      // generic connectivity diagnosis matters: that diagnosis ends by telling the
      // operator to check the URL and the credential, which is the wrong place to
      // look when the chain is what was refused. Classified by the same file the
      // installer's Step 4 probe uses, so the two cannot name it differently.
      const tlsCode = findTlsCode(res.stderr);
      if (tlsCode) {
        const described = describeTlsResult({ cause: classifyTlsFailure(tlsCode), code: tlsCode, message: '' });
        console.log('');
        console.log(`        DIAGNOSIS: ${described.headline}`);
        described.remedy.forEach((line, i) => console.log(`          ${i + 1}. ${wrapTo(line, 66, 13)}`));
        if (described.warning) console.log(`          ${wrapTo(described.warning, 66, 10)}`);
      }

      // The bare /connectivity/i this used to match also matches the server's
      // own SUCCESS lines — "verifying bConnect API connectivity..." and "API
      // connectivity verified." — so a healthy server produced a diagnosis
      // telling the operator to set a flag that was already set. Require a
      // failure word, and stand down explicitly if the success line is present.
      if (
        !tlsCode &&
        !/connectivity verified/i.test(res.stderr) &&
        /cannot reach bConnect API|Connection test failed|connectivity[^\n]*(fail|error|refus)/i.test(res.stderr)
      ) {
        console.log('');
        console.log('        DIAGNOSIS: this is the startup connectivity probe. It reads');
        console.log('        "/servermanagement/v2.0/ManagementServer" -- which also yields the bMS');
        console.log('        release the suite gates on -- and falls back to');
        console.log('        "/endpoints/v2.0/Endpoints" when the credential is not scoped for');
        console.log('        servermanagement. Both failing means the base URL, the credentials or');
        console.log('        the TLS trust really are wrong; bConnect answers 401, not 404, for a');
        console.log('        route it does not recognise, so check the URL before the credential.');
        console.log('        BCONNECT_SKIP_CONNECTIVITY_CHECK=true would silence this, and should');
        console.log('        not be used: it also disables the check that this bMS is a release');
        console.log('        the suite supports, which turns a startup error into wrong answers.');
      }
      if (/Cannot find module/i.test(res.stderr)) {
        console.log('');
        console.log('        DIAGNOSIS: the configured entry point does not exist. The package was');
        console.log('        not built, or the path in the configuration is wrong. Re-run the');
        console.log('        installer without -SkipBuild.');
      }
    } else {
      console.log('        no stderr captured. Check that build/index.js exists and that the');
      console.log('        --env-file path in the configuration is readable by this account.');
    }
  } finally {
    try {
      await client?.close();
    } catch {
      /* already down */
    }
  }
}

/**
 * The first OpenSSL/Node error code in a block of server stderr, or ''.
 *
 * mcp-core's describeConnectionFailure appends the code in parentheses, so it is
 * present verbatim. The candidate list comes from probe-tls.mjs rather than being
 * spelled out again here -- a code added there has to be recognised here too, and a
 * second copy of the list is exactly how the two diagnostics would drift apart.
 */
function findTlsCode(stderr) {
  for (const code of knownTlsCodes()) {
    if (new RegExp(`\\b${code}\\b`).test(stderr)) return code;
  }
  return '';
}

/** Wrap a remedy line to the console width the rest of this file prints at. */
function wrapTo(text, width, indent) {
  const pad = ' '.repeat(indent);
  const out = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    if (line && (line.length + 1 + word.length) > width) { out.push(line); line = word; }
    else { line = line ? `${line} ${word}` : word; }
  }
  if (line) out.push(line);
  return out.join('\n' + pad);
}

function substituteZero(obj) {
  return JSON.parse(JSON.stringify(obj).split('"$ZERO"').join(JSON.stringify(ZERO)));
}

/** Build minimally valid arguments for a tool from its own schema. */
function argsForTool(tools, name) {
  const schema = tools.find((t) => t.name === name)?.inputSchema;
  const required = schema?.required || [];
  const props = schema?.properties || {};
  const out = {};
  for (const key of required) {
    const p = props[key] || {};
    if (p.type === 'array' && /patch/i.test(key)) out[key] = [{ op: 'test', path: '/none', value: 'x' }];
    else if (p.type === 'array') out[key] = [];
    else if (p.type === 'number' || p.type === 'integer') out[key] = 0;
    else if (p.type === 'boolean') out[key] = false;
    else if (p.type === 'object') out[key] = {};
    else if (/id$/i.test(key)) out[key] = ZERO;
    else out[key] = 'installer-verification-probe';
  }
  return out;
}

// ── Summary and an honest statement of what was and was not proven ──────────
const started = results.filter((r) => r.started).length;
const readsRun = results.filter((r) => r.read !== null);
const readsOk = readsRun.filter((r) => r.read).length;
const gatesRun = results.filter((r) => r.gate !== null);
const gatesOk = gatesRun.filter((r) => r.gate).length;
const totalTokens = Math.round(results.reduce((a, r) => a + r.schemaBytes, 0) / 4);

const failedServers = results.filter((r) => !r.started || r.error || r.read === false || r.gate === false);

console.log('\n' + '-'.repeat(74));
console.log('Verification summary');
console.log('-'.repeat(74));
console.log(`  servers started            ${started} / ${results.length}`);
console.log(`  live read calls            ${readsOk} / ${readsRun.length} passed (${results.length - readsRun.length} skipped)`);
const noGateTools = results.filter((r) => r.gate === null && /no write tools/.test(r.gateDetail)).length;
const unverifiable = results.length - gatesRun.length - noGateTools;
console.log(
  `  write-gate checks          ${gatesOk} / ${gatesRun.length} passed ` +
    `(${noGateTools} server(s) have no write tools; ${unverifiable} not verifiable without writing)`
);
console.log(`  tool-schema context cost   ~${totalTokens.toLocaleString()} tokens per session, before your first message`);

console.log('\nWhat these checks do and do not prove');
// Claims are now conditional on what actually happened. This block asserted
// that the credentials "authenticate to bConnect and return real data" even on
// a run where every read had failed — the single most misleading line in the
// installer, because it is the line an operator quotes when they believe the
// install is good.
if (failedServers.length) {
  console.log('  NOTHING BELOW IS PROVEN for these servers, which did not complete verification:');
  for (const r of failedServers) {
    console.log(`    - ${r.name}: ${r.error ? r.error : !r.started ? 'did not start' : 'a check failed'}`);
  }
}
console.log('  PROVEN, against the live configuration:');
if (started === results.length) {
  console.log(`    - the command, args and env block in ${configPath}`);
  console.log('      spawn a server that completes the handshake instead of exiting');
} else {
  console.log(`    - ${started} of ${results.length} configured servers start from ${configPath};`);
  console.log('      the rest did not, and nothing about them is verified');
}
if (readsOk > 0 && readsOk === readsRun.length) {
  console.log('    - the credentials that configuration points at authenticate to bConnect');
  console.log('      and return real data (for every server with a zero-argument read tool)');
} else if (readsOk > 0) {
  console.log(`    - the credentials authenticate for ${readsOk} of ${readsRun.length} servers that`);
  console.log('      ran a read. The rest failed; the credentials are NOT proven good for them');
} else {
  console.log('    - NOT the credentials. No live read succeeded, so nothing here shows that');
  console.log('      the configured credentials can authenticate to bConnect at all');
}
console.log('    - the write posture recorded above is the one actually in force in that');
console.log('      server process -- the refusals came from the configured server, not a');
console.log('      test harness with its own environment');
console.log('  NOT PROVEN:');
console.log('    - that Claude Desktop has loaded this configuration. It reads the file at');
console.log('      launch; until you fully quit and relaunch it, the running app may still');
console.log('      be using the previous version. Closing the window is not enough.');
console.log('    - that an empty result means an empty estate. bConnect answers HTTP 200');
console.log('      with totalItems: 0 for collections the key may not read (F9).');
console.log('    - that write tools left unrestricted are safe. Where a server is write-');
console.log('      enabled with no allowlist, the gate was reported, not tested, because');
console.log('      testing it means performing a write.');
console.log('    - anything about bMS-side authorisation. The API key ACL is a second,');
console.log('      independent boundary underneath this one and can refuse calls that pass');
console.log('      every check here.');

if (args.json) {
  console.log('\n__JSON__' + JSON.stringify({ results, started, readsOk, gatesOk, totalTokens }));
}

// `r.error` is the addition, and it is the one that matters. The other three
// terms all read fields that a throw could leave at null, and null is filtered
// out of readsRun/gatesRun as "never attempted" — so a server that started and
// then failed every probe contributed nothing to this expression and the
// installer exited 0 while printing FAIL. An installer that reports success on
// a broken install teaches operators to ignore it, which is worse than no
// verification at all.
const failed =
  results.some((r) => !r.started) ||
  results.some((r) => r.error) ||
  readsRun.some((r) => r.read === false) ||
  gatesRun.some((r) => r.gate === false);
console.log('');
process.exit(failed ? 1 : 0);
