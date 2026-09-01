// Tests for the host-target emitters.
//
// The thing being tested is not "does a file get written" -- it is "is the shape
// that gets written the shape the host actually documents". So every assertion
// below is traceable to a line in that host's own documentation, recorded in
// lib\hosts.json next to the URL it came from.
//
// The section that carries the most weight is NEGATIVE CONTROLS. A validator that
// has never been seen to reject anything proves nothing at all: eight deliberately
// wrong emissions are fed to it and it is required to catch each one. Two of them
// are real mistakes this project would otherwise have shipped -- VS Code's
// `mcpServers`/`servers` key swap, and Continue's list-versus-map container.
//
//   node test-host-emitters.mjs [--suite-root <path>]
//
// No bMS, no network, no host application, no filesystem writes.

import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  loadRegistry,
  buildServers,
  validateShape,
  renderSnippet,
  renderContinueBlockFile,
  yamlBlock,
  yamlScalar,
  mergeTomlText,
  parseToml,
  splitTomlSections,
  tomlScalar,
  tomlKey,
  containsSecretShapedValue,
} from './host-emitters.mjs';
import { parseArgs } from './sdk.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const suiteRoot = args['suite-root'] || resolve(HERE, '..', '..', 'bConnect-MCP-main');

let pass = 0;
let fail = 0;
let skip = 0;
const failures = [];

function check(ok, what, detail) {
  if (ok) {
    pass++;
    console.log(`  PASS  ${what}`);
  } else {
    fail++;
    failures.push(what);
    console.log(`  FAIL  ${what}`);
    if (detail) console.log(`        ${detail}`);
  }
}
function skipped(what, why) {
  skip++;
  console.log(`  SKIP  ${what}`);
  if (why) console.log(`        ${why}`);
}
function section(t) {
  console.log('');
  console.log(`  -- ${t} ${'-'.repeat(Math.max(0, 62 - t.length))}`);
}

// ─── Fixtures ────────────────────────────────────────────────────────────────
// Deliberately awkward: a path with spaces, an env block that carries a write
// gate (which is legitimate) and a name that has to survive YAML quoting.

const NODE = 'C:\\Program Files\\nodejs\\node.exe';
const ENVF = 'C:\\baramundi MCP\\secrets\\bconnect.env';
const SERVERS = {
  'bconnect-endpoints': {
    command: NODE,
    args: [`--env-file=${ENVF}`, 'C:\\baramundi MCP\\bConnect-MCP-main\\bconnect-endpoints-mcp\\build\\index.js'],
  },
  'bconnect-jobs': {
    command: NODE,
    args: [`--env-file=${ENVF}`, 'C:\\baramundi MCP\\bConnect-MCP-main\\bconnect-jobs-mcp\\build\\index.js'],
    env: { ALLOW_WRITE_OPERATIONS: 'true', ALLOWED_WRITE_TOOLS: 'create_job_instance,start_job_instance' },
  },
};
const GATEWAY = 'http://127.0.0.1:3001';

const registry = loadRegistry();
const T = (id) => registry.byId.get(id);
const stdioOpts = { servers: SERVERS, transport: 'stdio', gatewayUrl: GATEWAY, gatewayPort: 3001 };
const httpOpts = { servers: SERVERS, transport: 'http', gatewayUrl: GATEWAY, gatewayPort: 3001 };
const emit = (id, opts) => buildServers(registry, T(id), opts);
const validate = (id, coll, opts) =>
  validateShape(registry, T(id), { [T(id).serversKey]: coll }, opts);

// ─── 1. Registry integrity ───────────────────────────────────────────────────

section('registry');

check(registry.targets.length >= 10, `hosts.json declares ${registry.targets.length} targets`);
check(
  registry.targets.every((t) => t.id && t.label && t.mode && t.transport && t.verification && t.docUrl),
  'every target has id, label, mode, transport, verification and a doc URL',
);
check(
  registry.targets.every((t) =>
    ['merge-json', 'write-file', 'snippet'].includes(t.mode) &&
    ['stdio', 'http', 'both'].includes(t.transport) &&
    ['host-loaded', 'config-spawn', 'schema-only'].includes(t.verification)),
  'every target uses a known mode, transport and verification level',
);
check(
  registry.targets.every(
    (t) =>
      (!t.stdioStyle || registry.entryStyles[t.stdioStyle]) &&
      (!t.httpStyle || registry.entryStyles[t.httpStyle]),
  ),
  'every entryStyle a target names actually exists',
);
check(
  registry.targets.every((t) => t.transport !== 'stdio' || !t.requiresGateway),
  'no stdio-only target claims to require the gateway',
);
check(
  registry.targets.filter((t) => t.verification === 'schema-only').every((t) => (t.unverified || []).length > 0),
  'every schema-only target records what it does NOT claim',
);
check(
  new Set(registry.targets.map((t) => t.id)).size === registry.targets.length,
  'target ids are unique',
);
check(
  registry.targets.every((t) => !/\{[A-Z]+\}/.test(t.defaultPath.replace(/\{(APPDATA|PROJECT|USERPROFILE|OUT)\}/g, ''))),
  'every defaultPath uses only known {APPDATA} {PROJECT} {USERPROFILE} {OUT} tokens',
);

// ─── 2. Per-host shapes, each traceable to that host's documentation ─────────

section('Claude Desktop — mcpServers map, plain stdio entries');
{
  const c = emit('claude-desktop', stdioOpts);
  check(validate('claude-desktop', c, stdioOpts).length === 0, 'validates clean');
  check(T('claude-desktop').serversKey === 'mcpServers', 'top-level key is mcpServers');
  check(c['bconnect-endpoints'].command === NODE, 'command is the absolute node path');
  check(c['bconnect-endpoints'].args[0] === `--env-file=${ENVF}`, 'first arg is --env-file=<absolute path>');
  check(c['bconnect-jobs'].env.ALLOW_WRITE_OPERATIONS === 'true', 'the per-server write gate survives into env');
  check(c['bconnect-endpoints'].url === undefined, 'no url is emitted (Desktop stdio only)');
  check(!JSON.stringify(c).includes('BCONNECT_API_KEY'), 'no credential in the config');
  check(T('claude-desktop').httpStyle === null, 'no HTTP entry style is claimed for Claude Desktop');
}

section('Claude Code — mcpServers map, TYPED entries (a url without a type is an error)');
{
  const c = emit('claude-code', stdioOpts);
  check(validate('claude-code', c, stdioOpts).length === 0, 'stdio validates clean');
  check(c['bconnect-endpoints'].type === 'stdio', 'stdio entries carry "type": "stdio"');
  const h = emit('claude-code', httpOpts);
  check(validate('claude-code', h, httpOpts).length === 0, 'http validates clean');
  check(h['bconnect-endpoints'].type === 'http', 'http entries carry "type": "http"');
  check(
    h['bconnect-endpoints'].url === `${GATEWAY}/endpoints/mcp`,
    'the gateway URL strips the bconnect- prefix to a domain',
    h['bconnect-endpoints'].url,
  );
  check(h['bconnect-jobs'].url === `${GATEWAY}/jobs/mcp`, 'jobs maps to /jobs/mcp');
  check(h['bconnect-endpoints'].command === undefined, 'an http entry carries no command');
}

section('VS Code — the key is "servers", NOT "mcpServers"');
{
  const t = T('vscode');
  check(t.serversKey === 'servers', 'top-level key is servers');
  const c = emit('vscode', stdioOpts);
  check(validate('vscode', c, stdioOpts).length === 0, 'stdio validates clean');
  check(c['bconnect-endpoints'].type === 'stdio', 'stdio entries carry "type": "stdio"');
  const h = emit('vscode', httpOpts);
  check(h['bconnect-jobs'].type === 'http' && h['bconnect-jobs'].url.endsWith('/jobs/mcp'), 'http entries are typed');
  check(
    (t.unverified || []).some((u) => /user/i.test(u) && /path/i.test(u)),
    'the undocumented user-profile path is recorded as unverified rather than guessed',
  );
}

section('Cursor — follows the vendor EXAMPLES, which omit type');
{
  const c = emit('cursor', stdioOpts);
  check(validate('cursor', c, stdioOpts).length === 0, 'stdio validates clean');
  check(c['bconnect-endpoints'].type === undefined, 'no type field on stdio (every documented example omits it)');
  check(c['bconnect-endpoints'].command === NODE, 'command present');
  const h = emit('cursor', httpOpts);
  check(h['bconnect-endpoints'].type === undefined, 'no type field on remote either');
  check(h['bconnect-endpoints'].url.startsWith('http'), 'remote is declared by the presence of url');
  check(
    (T('cursor').unverified || []).some((u) => /type/i.test(u)),
    "the docs' own table/example contradiction is recorded, not silently resolved",
  );
}

section('Continue — mcpServers is a LIST whose entries carry their own name');
{
  const t = T('continue');
  const c = emit('continue', stdioOpts);
  check(Array.isArray(c), 'the collection is an array, not a map');
  check(validate('continue', c, stdioOpts).length === 0, 'validates clean');
  check(c[0].name === 'bconnect-endpoints', 'each entry carries a name field');
  check(c[0].type === 'stdio', 'entries carry type: stdio');
  check(c.length === Object.keys(SERVERS).length, 'one list entry per selected server');
  const h = emit('continue', httpOpts);
  check(h[0].type === 'streamable-http', 'http entries use type: streamable-http, not http');
  check(t.mode === 'write-file', 'written as a standalone block file, so there is no YAML to re-serialise');
}

section('LibreChat — map, typed, snippet only');
{
  const c = emit('librechat', stdioOpts);
  check(validate('librechat', c, stdioOpts).length === 0, 'validates clean');
  check(c['bconnect-endpoints'].type === 'stdio', 'entries carry type: stdio');
  check(T('librechat').mode === 'snippet', 'emitted as a snippet — librechat.yaml is never rewritten');
  const h = emit('librechat', httpOpts);
  check(h['bconnect-jobs'].type === 'streamable-http', 'http entries use streamable-http');
}

section('Codex — mcp_servers TOML tables, transport inferred from the key present');
{
  const t = T('codex');
  const c = emit('codex', stdioOpts);
  check(validate('codex', c, stdioOpts).length === 0, 'validates clean');
  check(t.serversKey === 'mcp_servers', 'the container is mcp_servers (underscore), not mcpServers');
  check(t.format === 'toml', 'the format is toml — the only non-JSON file this installer owns');
  check(c['bconnect-endpoints'].type === undefined,
        'no type field: Codex infers stdio from `command` and http from `url`, and rejects both');
  check(c['bconnect-endpoints'].command === NODE, 'command is the absolute node path');
  check(c['bconnect-jobs'].env.ALLOW_WRITE_OPERATIONS === 'true', 'the write gate survives into the env sub-table');
  check(t.transport === 'stdio' && t.httpStyle === null,
        'declared stdio-only, so no url form is emitted and no gateway is required');
  check(!t.requiresGateway, 'requires no gateway — this is the point of the target');
  // The mode name is load-bearing in a way its value does not look. Four
  // PowerShell front ends branch on it and the branch that is NOT merge-json
  // DELETES the emitted file whole on uninstall, which is right for a snippet
  // this installer wrote from nothing and catastrophic for a config.toml the
  // operator wrote. Renaming this to merge-toml without changing
  // Install-BConnectMcp.ps1, bconnect.ps1 and State.psm1 loses their file.
  check(t.mode === 'merge-json',
        'the mode is merge-json (the SYNTAX is `format`) — see the note in hosts.json before changing it');
  check(
    (t.unverified || []).some((u) => /ChatGPT desktop/i.test(u)),
    'the ChatGPT-desktop execution question is recorded as unverified rather than claimed in the label',
  );
  check(
    !/ChatGPT/i.test(t.label),
    'the label names only the surfaces that are unambiguously local-process hosts',
    t.label,
  );
}

section('HTTP-only hosts refuse a stdio emission');
for (const id of ['open-webui', 'n8n', 'openai', 'copilot-studio']) {
  const t = T(id);
  check(t.transport === 'http' && t.stdioStyle === null, `${id}: declared http-only with no stdio style`);
  check(t.requiresGateway === true, `${id}: requires the gateway`);
}
check(T('copilot-studio').impractical === true, 'copilot-studio is flagged impractical in the registry itself');

// ─── 3. Snippets say what they do not prove ──────────────────────────────────

section('snippets');
for (const id of ['librechat', 'continue', 'open-webui', 'n8n', 'openai', 'copilot-studio', 'generic']) {
  const t = T(id);
  const opts = t.transport === 'http' ? httpOpts : stdioOpts;
  const coll = t.serversKey ? emit(id, opts) : null;
  const text = renderSnippet(registry, t, { ...opts, outPath: 'X:\\out\\x' }, coll);
  check(text.length > 400, `${id}: snippet renders (${text.length} bytes)`);
  check(/verified how/i.test(text), `${id}: says how it was verified`);
  check(text.includes(t.docUrl), `${id}: cites the documentation URL it was built from`);
  check(!/BCONNECT_API_KEY\s*=/.test(text) && !text.includes('bconnect.env.dpapi\n'), `${id}: leaks no credential`);
}
{
  const gwText = renderSnippet(registry, T('n8n'), httpOpts, null);
  check(/no stdio support at all/i.test(gwText), 'n8n snippet leads with the no-stdio finding');
  check(gwText.includes(`${GATEWAY}/endpoints/mcp`), 'n8n snippet carries the real gateway route');

  const cs = renderSnippet(registry, T('copilot-studio'), httpOpts, null);
  check(/x-ms-agentic-protocol: mcp-streamable-1\.0/.test(cs), 'copilot-studio snippet carries the MCP connector marker');
  // SEC-7 changed this claim rather than removing it: there IS built-in auth
  // now, and the point of the passage is that one shared token is not enough on
  // an internet-facing endpoint. Both halves are asserted so neither can be
  // dropped in a future edit.
  check(/least practical/i.test(cs) && /single shared bearer token/i.test(cs) &&
        /reverse proxy is not optional/i.test(cs),
        'copilot-studio snippet leads with the negative finding and the auth warning');

  const ow = renderSnippet(registry, T('open-webui'), httpOpts, null);
  check(/Streamable HTTP only/i.test(ow), 'open-webui snippet states the streamable-http-only constraint');
  check(/host\.docker\.internal/.test(ow), 'open-webui snippet covers the container-networking trap');

  const oa = renderSnippet(registry, T('openai'), httpOpts, null);
  check(/MCPServerStdio/.test(oa), 'openai snippet offers the local stdio path first');
  check(/require_approval/.test(oa) && /"always"/.test(oa), 'openai snippet leaves require_approval at always');

  const gen = renderSnippet(registry, T('generic'), { ...stdioOpts }, emit('generic', stdioOpts));
  check(gen.includes(NODE), 'generic snippet prints the exact executable');
  check(gen.includes(`--env-file=${ENVF}`), 'generic snippet prints every argument verbatim');
  check(/"type": "stdio"/.test(gen), 'generic snippet includes a portable typed JSON block');
  check(/POSIX shell/.test(gen) && /Windows \(cmd or PowerShell\)/.test(gen), 'generic snippet quotes for both shells');
}

// ─── An emitted file must carry every domain that was SELECTED ───────────────
// These files exist because the operator chose those domains. A block that looks
// complete and holds a subset does not fail: it produces an agent that silently
// cannot answer for the missing ones, which reads as a model limitation rather
// than as a configuration error. The two-server fixture above cannot see this --
// a cap of two and a set of two are the same output -- so this section uses a
// deliberately wider set.
section('every selected domain reaches the emitted file');
{
  const WIDE_DOMAINS = ['endpoints', 'jobs', 'software', 'compliance', 'assets', 'defensecontrol'];
  const wideServers = {};
  for (const d of WIDE_DOMAINS) {
    wideServers[`bconnect-${d}`] = { command: NODE, args: [`--env-file=${ENVF}`, `C:\\x\\bconnect-${d}-mcp\\build\\index.js`] };
  }
  const wide = { servers: wideServers, transport: 'http', gatewayUrl: GATEWAY, gatewayPort: 3001, gatewayAuthRequired: true };

  const oa = renderSnippet(registry, T('openai'), wide, null);
  const labels = [...oa.matchAll(/"server_label":\s*"bconnect_([a-z]+)"/g)].map((m) => m[1]);
  check(
    labels.length === WIDE_DOMAINS.length,
    `openai: the hosted tools array carries all ${WIDE_DOMAINS.length} selected domains`,
    `emitted ${labels.length}: ${labels.join(', ')}`,
  );
  for (const d of WIDE_DOMAINS) {
    check(oa.includes(`${GATEWAY}/${d}/mcp`), `openai: names the ${d} gateway route`);
  }
  // The Agents SDK block genuinely shows one server. That is fine as long as it
  // SAYS so -- the failure this guards against is silence about a partial answer.
  check(
    /one MCPServerStdio per domain/i.test(oa),
    'openai: the Python block states that it shows one server of several',
  );

  const cs = renderSnippet(registry, T('copilot-studio'), wide, null);
  const missing = WIDE_DOMAINS.filter((d) => d !== 'endpoints').filter((d) => !cs.includes(d));
  check(
    missing.length === 0,
    'copilot-studio: the Swagger names every domain it does not cover',
    missing.length ? `never mentioned: ${missing.join(', ')}` : '',
  );
  check(
    /one connector per domain/i.test(cs),
    'copilot-studio: says one connector is needed per domain, not one for all',
  );

  // The n8n and generic emitters already list every domain; assert it, so the
  // rule is "every emitter", not "the one that was found wrong".
  const n8 = renderSnippet(registry, T('n8n'), wide, null);
  check(
    WIDE_DOMAINS.every((d) => n8.includes(`${GATEWAY}/${d}/mcp`)),
    'n8n: every selected domain has a credential URL',
  );
}

// ─── 4. YAML ─────────────────────────────────────────────────────────────────

section('YAML serialisation');
{
  check(yamlScalar("it's") === "'it''s'", 'a single quote is doubled, not escaped with a backslash');
  check(yamlScalar('C:\\a\\b').includes('C:\\a\\b'), 'a Windows path is emitted literally inside single quotes');

  const coll = emit('continue', stdioOpts);
  const text = renderContinueBlockFile(registry, T('continue'), stdioOpts, coll);
  check(/^\s*schema: 'v1'$/m.test(text), 'the block-file header is present');
  check(/^\s*- name: 'bconnect-endpoints'$/m.test(text), 'the list form is emitted, not a map');

  const yamlPath = resolve(suiteRoot, 'node_modules', 'js-yaml', 'dist', 'js-yaml.mjs');
  if (existsSync(yamlPath)) {
    const YAML = await import(pathToFileURL(yamlPath).href);
    const load = YAML.load ?? YAML.default?.load;
    const parsed = load(text);
    check(Array.isArray(parsed.mcpServers), 'a real YAML parser reads mcpServers back as a list');
    check(parsed.mcpServers[0].name === 'bconnect-endpoints', 'names round-trip');
    check(parsed.mcpServers[0].command === NODE, 'the Windows executable path round-trips byte-for-byte');
    check(
      parsed.mcpServers[0].args[0] === `--env-file=${ENVF}`,
      'an argument containing a space and an equals sign round-trips',
    );
    check(parsed.mcpServers[1].env.ALLOWED_WRITE_TOOLS === SERVERS['bconnect-jobs'].env.ALLOWED_WRITE_TOOLS,
      'a comma-separated env value round-trips');

    const lc = yamlBlock({ mcpServers: emit('librechat', stdioOpts) });
    const lcParsed = load(lc);
    check(!Array.isArray(lcParsed.mcpServers) && typeof lcParsed.mcpServers === 'object',
      'LibreChat mcpServers parses back as a MAP (the opposite container from Continue)');
    check(lcParsed.mcpServers['bconnect-jobs'].type === 'stdio', 'LibreChat entries keep their type');

    const nasty = yamlBlock({ k: "a 'quoted' # not-a-comment: value" });
    check(load(nasty).k === "a 'quoted' # not-a-comment: value",
      'quotes, hashes and colons inside a value survive a real parse');
  } else {
    skipped('YAML output parsed by a real YAML parser',
      `js-yaml not found under ${suiteRoot}\\node_modules — run npm ci, or accept that the YAML ` +
      'assertions above are structural only');
  }
}

// ─── 4b. TOML, and the merge that can destroy somebody's Codex configuration ─
//
// Every other emitter writes JSON, where "do not damage the rest of the file" is
// a solved problem: parse, mutate one key, re-serialise. TOML has no canonical
// serialiser and ~/.codex/config.toml is a file the OPERATOR owns -- their model,
// their approval policy, their profiles, every other MCP server they run. So the
// merge is a textual splice and the assertions below are mostly about what it
// LEAVES ALONE. The one that matters most is the last group: the shapes it
// refuses rather than guesses at.

section('TOML serialisation');
{
  check(tomlScalar('C:\\Program Files\\nodejs\\node.exe') === "'C:\\Program Files\\nodejs\\node.exe'",
        'a Windows path is a LITERAL string, so not one backslash is doubled or escaped');
  check(tomlScalar("it's") === '"it\'s"',
        'a value containing a single quote falls back to a basic string, because a literal string cannot hold one');
  check(tomlScalar('a\\b"c') === "'a\\b\"c'",
        'a DOUBLE quote needs no escaping at all inside a literal string, so it stays literal');
  check(tomlScalar('back\\slash and \'quote\'') === '"back\\\\slash and \'quote\'"',
        'the basic-string fallback, forced by the single quote, escapes the backslash');
  check(tomlScalar('line\nbreak') === '"line\\nbreak"', 'a newline is escaped rather than emitted raw');
  check(tomlKey('bconnect-endpoints') === 'bconnect-endpoints', 'a hyphenated server name is a bare TOML key');
  check(tomlKey('has space') === '"has space"', 'a name TOML cannot take bare is quoted');
}

section('Codex merge — the operator owns most of this file');
{
  const coll = emit('codex', stdioOpts);
  const codex = T('codex');
  const merge = (text, c = coll, remove = []) => mergeTomlText(text, codex, c, remove);

  // A realistic file: comments, top-level settings, somebody else's MCP server,
  // an unrelated table, and a profile sub-table. None of it is ours.
  const EXISTING = [
    '# Codex settings, hand-written.',
    'model = "gpt-5-codex"',
    "approval_policy = 'on-request'",
    '',
    '[mcp_servers.someone-elses]',
    '# do not touch this',
    'command = "npx"',
    'args = ["-y", "not-ours"]',
    '',
    '[mcp_servers.someone-elses.env]',
    'THEIR_API_KEY = "not-ours-either"',
    '',
    '[tui]',
    'theme = "dark"',
    '',
    '[profiles.work]',
    'model = "gpt-5"',
    '',
  ].join('\n');

  const m = merge(EXISTING);
  let parsed = null;
  try { parsed = parseToml(m.text); } catch (err) { parsed = { __error: err.message }; }

  check(!parsed.__error, 'the merged file re-parses as TOML', parsed.__error);
  check(parsed.mcp_servers?.['bconnect-endpoints']?.command === NODE,
        'our server is in the file, with the exact executable path');
  check(
    parsed.mcp_servers?.['bconnect-endpoints']?.args?.[0] === `--env-file=${ENVF}`,
    'an argument carrying a space, an equals sign and backslashes round-trips byte-for-byte',
    JSON.stringify(parsed.mcp_servers?.['bconnect-endpoints']?.args?.[0]),
  );
  check(parsed.mcp_servers?.['bconnect-endpoints']?.args?.[1] === SERVERS['bconnect-endpoints'].args[1],
        'the build path round-trips too');
  check(parsed.mcp_servers?.['bconnect-jobs']?.env?.ALLOWED_WRITE_TOOLS === SERVERS['bconnect-jobs'].env.ALLOWED_WRITE_TOOLS,
        'the env SUB-TABLE round-trips, comma-separated value and all');
  check(parsed.mcp_servers?.['bconnect-endpoints']?.env === undefined,
        'a server with no env block gets no empty env sub-table');

  // The whole point. Everything that was already there, unchanged.
  check(parsed.model === 'gpt-5-codex' && parsed.approval_policy === 'on-request',
        'unrelated TOP-LEVEL settings survive the merge');
  check(parsed.tui?.theme === 'dark' && parsed.profiles?.work?.model === 'gpt-5',
        'unrelated TABLES survive the merge, including a nested one');
  check(parsed.mcp_servers?.['someone-elses']?.command === 'npx' &&
        parsed.mcp_servers?.['someone-elses']?.args?.[1] === 'not-ours',
        "somebody else's MCP server survives the merge");
  check(parsed.mcp_servers?.['someone-elses']?.env?.THEIR_API_KEY === 'not-ours-either',
        "and so does that server's own credential — it is not ours to have an opinion about");
  check(m.text.includes('# Codex settings, hand-written.') && m.text.includes('# do not touch this'),
        'COMMENTS survive, which is the thing a parse-and-re-serialise merge always destroys');
  check(m.text.includes("approval_policy = 'on-request'"),
        'a value already written as a literal string is not re-quoted');

  // Byte-level, not just value-level: the lines above our tables are the same lines.
  const foreignLines = (text) => {
    const doc = splitTomlSections(text);
    const out = [...doc.lines.slice(0, doc.preambleEnd)];
    for (const s of doc.sections) {
      if (s.path[0] === 'mcp_servers' && /^bconnect-/.test(s.path[1] || '')) continue;
      out.push(...doc.lines.slice(s.start, s.end));
    }
    return out.join('\n').replace(/[\r\n]+$/, '');
  };
  check(foreignLines(EXISTING) === foreignLines(m.text),
        'every line this installer does not own comes back BYTE-IDENTICAL and in the same order',
        foreignLines(m.text));

  check(m.added.join(',') === 'bconnect-endpoints,bconnect-jobs' && m.updated.length === 0,
        'both servers are reported as added, neither as updated');
  check(m.foreignSections.includes('tui') && m.foreignSections.includes('mcp_servers.someone-elses'),
        'the merge reports which foreign tables it carried across');

  // Running the installer twice must not churn the file.
  const again = merge(m.text);
  check(again.text === m.text, 'a second merge is a no-op — byte-identical output');
  check(again.added.length === 0 && again.updated.length === 0, 'and reports nothing added or updated');

  // A changed launch spec replaces the table rather than appending a second one.
  const moved = { ...coll, 'bconnect-endpoints': { ...coll['bconnect-endpoints'], command: 'D:\\node\\node.exe' } };
  const upd = merge(m.text, moved);
  check(upd.updated.includes('bconnect-endpoints') && upd.added.length === 0, 'a changed spec is reported as updated');
  check((upd.text.match(/\[mcp_servers\.bconnect-endpoints\]/g) || []).length === 1,
        'and there is exactly ONE table for it afterwards, not two');
  check(parseToml(upd.text).mcp_servers['bconnect-endpoints'].command === 'D:\\node\\node.exe',
        'the replacement is what the file now says');

  // Removal (uninstall, and `bconnect servers remove`).
  const gone = merge(m.text, {}, ['bconnect-endpoints', 'bconnect-jobs']);
  const goneParsed = parseToml(gone.text);
  check(gone.removed.length === 2 && !goneParsed.mcp_servers['bconnect-endpoints'] && !goneParsed.mcp_servers['bconnect-jobs'],
        'removal takes our tables out');
  check(goneParsed.mcp_servers['someone-elses'].command === 'npx' && goneParsed.tui.theme === 'dark',
        'and leaves everything else exactly where it was');
  check(!/Managed by bConnect-MCP/.test(gone.text),
        'the provenance comment goes with the table it sits inside, rather than being orphaned above it');
  check(foreignLines(EXISTING) === foreignLines(gone.text), 'a removal is byte-identical to the original file');

  // A file that does not exist yet.
  const fresh = merge('');
  check(!/^\s*\n/.test(fresh.text), 'a file created from nothing does not open on a blank line');
  check(parseToml(fresh.text).mcp_servers['bconnect-jobs'].command === NODE, 'and it parses');

  // CRLF. Every one of these files is written on Windows.
  const crlf = merge(EXISTING.replace(/\n/g, '\r\n'));
  check(!/[^\r]\n/.test(crlf.text), 'a CRLF file stays CRLF, including in the lines this installer added', JSON.stringify(crlf.text.slice(0, 60)));
  check(parseToml(crlf.text).mcp_servers['bconnect-endpoints'].command === NODE, 'and it still parses');

  // A table header inside a multi-line string is text, not a header. A splitter
  // that cannot tell the difference cuts the file in half inside somebody's
  // prompt template.
  const withPrompt = [
    'instructions = """',
    '[mcp_servers.not-a-real-table]',
    'this is prose inside a multi-line string',
    '"""',
    '',
    '[tui]',
    'theme = "dark"',
    '',
  ].join('\n');
  const mp = merge(withPrompt);
  const mpParsed = parseToml(mp.text);
  check(mpParsed.mcp_servers?.['not-a-real-table'] === undefined,
        'a [table] header inside a multi-line string is not treated as a table');
  check(/\[mcp_servers\.not-a-real-table\]/.test(mpParsed.instructions || ''),
        'the multi-line string still carries its own text');
  check(mpParsed.tui?.theme === 'dark' && mpParsed.mcp_servers?.['bconnect-jobs']?.command === NODE,
        'and the real tables around it are read correctly');
}

section('Codex merge — the shapes it REFUSES rather than guesses at');
{
  const codex = T('codex');
  const coll = emit('codex', stdioOpts);
  const refuses = (what, text, expect) => {
    let threw = null;
    try { mergeTomlText(text, codex, coll, []); } catch (err) { threw = err.message; }
    check(threw !== null && (!expect || expect.test(threw)), `refused: ${what}`, threw ?? 'DID NOT THROW');
  };

  refuses(
    'mcp_servers written as a top-level inline table',
    'mcp_servers = { foo = { command = "npx" } }\n',
    /top-level key/,
  );
  refuses(
    'an [[mcp_servers...]] array of tables',
    '[[mcp_servers.bconnect-endpoints]]\ncommand = "npx"\n',
    /array of tables/,
  );
  refuses(
    'one of our server names already defined as an inline key inside a bare [mcp_servers] table',
    '[mcp_servers]\n"bconnect-endpoints" = { command = "npx" }\n',
    /already defines/,
  );
  refuses(
    'a file that ends inside an unterminated multi-line string',
    'instructions = """\nnever closed\n',
    /unterminated/,
  );

  // The control on the controls: a bare [mcp_servers] table that names only
  // SOMEBODY ELSE'S servers is fine, and must still merge.
  let ok = null;
  try {
    ok = mergeTomlText('[mcp_servers]\ntheirs = { command = "npx" }\n', codex, coll, []);
  } catch (err) { ok = { __error: err.message }; }
  check(
    ok && !ok.__error && parseToml(ok.text).mcp_servers.theirs.command === 'npx',
    'control: a bare [mcp_servers] table naming only foreign servers is ACCEPTED, not blanket-refused',
    ok?.__error,
  );
}

section('SEC-3 — the credential backstop reads TOML, not only JSON');
{
  const codex = T('codex');
  const clean = mergeTomlText('', codex, emit('codex', stdioOpts), []);
  check(!containsSecretShapedValue(clean.text),
        'control: a legitimate Codex configuration is NOT flagged (otherwise every check below is meaningless)');

  // The emitted shape of a leak, in TOML: no quotes on the key, an equals sign
  // instead of a colon. The original JSON-shaped pattern could not see this, so
  // a TOML emitter would have shipped with the SEC-3 backstop silently absent.
  for (const key of ['BCONNECT_API_KEY', 'BCONNECT_PASSWORD', 'BCONNECT_V11_PASSWORD',
                     'BCONNECT_V11_USERNAME', 'MCP_GATEWAY_AUTH_TOKEN']) {
    const leaked = mergeTomlText('', codex, {
      'bconnect-endpoints': { command: NODE, args: ['C:\\x\\build\\index.js'], env: { [key]: 'FABRICATED' } },
    }, []);
    check(containsSecretShapedValue(leaked.text),
          `the rendered TOML carrying ${key} is caught by containsSecretShapedValue`,
          leaked.text.split('\n').filter((l) => l.includes(key)).join(' | '));
  }

  // And the structured allowlist still holds on this path — the backstop is
  // defence in depth, not the primary control.
  const opts = {
    servers: { 'bconnect-endpoints': { command: NODE, args: ['C:\\x\\build\\index.js'], env: { BCONNECT_V11_PASSWORD: 'p' } } },
    transport: 'stdio',
  };
  const problems = validateShape(registry, codex, { mcp_servers: buildServers(registry, codex, opts) }, opts);
  check(problems.length > 0 && problems.some((p) => /capability gate|credential/i.test(p)),
        'validateShape refuses a credential for codex exactly as it does for every JSON target',
        problems.join(' | '));

  const gates = {
    servers: {
      'bconnect-endpoints': {
        command: NODE,
        args: ['C:\\x\\build\\index.js'],
        env: { ALLOW_WRITE_OPERATIONS: 'true', ALLOWED_WRITE_TOOLS: 'create_job_instance', BCONNECT_ENABLE_V11: 'true' },
      },
    },
    transport: 'stdio',
  };
  const gateColl = buildServers(registry, codex, gates);
  check(validateShape(registry, codex, { mcp_servers: gateColl }, gates).length === 0,
        'and still permits the three capability gates');
  const gateText = mergeTomlText('', codex, gateColl, []).text;
  check(/^BCONNECT_ENABLE_V11 = 'true'$/m.test(gateText),
        'which reach the emitted [mcp_servers.<name>.env] sub-table');
}

// ─── 5. NEGATIVE CONTROLS ────────────────────────────────────────────────────
// Everything above is worthless if the validator cannot reject anything. Each
// case below is a malformed emission that MUST be caught. Two of them are real
// mistakes this project would otherwise have shipped.

section('negative controls — the validator must REJECT each of these');

function mustReject(what, id, doc, opts, expect) {
  const problems = validateShape(registry, T(id), doc, opts);
  const caught = problems.length > 0 && (!expect || problems.some((p) => expect.test(p)));
  check(caught, `rejected: ${what}`, problems.length ? `got: ${problems.join(' | ')}` : 'NOTHING WAS REJECTED');
}

// The control on the control: a known-good document must PASS, or "everything is
// rejected" would look identical to a working validator.
check(
  validateShape(registry, T('claude-code'), { mcpServers: emit('claude-code', stdioOpts) }, stdioOpts).length === 0,
  'control: a known-good document is ACCEPTED (otherwise every rejection below is meaningless)',
);

mustReject(
  'VS Code config written under "mcpServers" instead of "servers"',
  'vscode',
  { mcpServers: emit('vscode', stdioOpts) },
  stdioOpts,
  /top-level key "servers" is missing/,
);
mustReject(
  'Continue emitted as a map instead of a list',
  'continue',
  { mcpServers: emit('claude-desktop', stdioOpts) },
  stdioOpts,
  /must be a LIST/,
);
mustReject(
  'Claude Code http entry with a url but no type (the vendor names this a config error)',
  'claude-code',
  { mcpServers: { 'bconnect-endpoints': { url: `${GATEWAY}/endpoints/mcp` }, 'bconnect-jobs': { url: `${GATEWAY}/jobs/mcp` } } },
  httpOpts,
  /must carry type="http"/,
);
mustReject(
  'an env value that is a number rather than a string',
  'claude-desktop',
  { mcpServers: { ...emit('claude-desktop', stdioOpts), 'bconnect-jobs': { command: NODE, args: [], env: { TIMEOUT: 30 } } } },
  stdioOpts,
  /must be a string/,
);
mustReject(
  'a bConnect credential smuggled into a host config file',
  'claude-desktop',
  { mcpServers: { ...emit('claude-desktop', stdioOpts), 'bconnect-jobs': { command: NODE, args: [], env: { BCONNECT_API_KEY: 'aaaa-bbbb' } } } },
  stdioOpts,
  /credential/,
);
mustReject(
  'a selected server silently missing from the emitted config',
  'claude-desktop',
  { mcpServers: { 'bconnect-endpoints': emit('claude-desktop', stdioOpts)['bconnect-endpoints'] } },
  stdioOpts,
  /missing from the emitted config/,
);
mustReject(
  'args that are not all strings',
  'claude-desktop',
  { mcpServers: { ...emit('claude-desktop', stdioOpts), 'bconnect-jobs': { command: NODE, args: ['ok', 7] } } },
  stdioOpts,
  /must be all strings/,
);
mustReject(
  'an entry carrying both a command and a url',
  'claude-code',
  { mcpServers: { ...emit('claude-code', stdioOpts), 'bconnect-jobs': { type: 'stdio', command: NODE, args: [], url: GATEWAY } } },
  stdioOpts,
  /both a url and a command/,
);
mustReject(
  'a Continue list entry with no name',
  'continue',
  { mcpServers: [{ type: 'stdio', command: NODE, args: [] }] },
  stdioOpts,
  /has no "name"/,
);
mustReject(
  'an http emission whose url is not a URL',
  'claude-code',
  { mcpServers: { 'bconnect-endpoints': { type: 'http', url: 'not a url' }, 'bconnect-jobs': { type: 'http', url: 'also not' } } },
  httpOpts,
  /needs an http\(s\) url/,
);

// And the builder itself must refuse an impossible request rather than inventing
// a shape: an http config for a target that has no documented http form.
{
  let threw = null;
  try {
    buildServers(registry, T('claude-desktop'), httpOpts);
  } catch (err) {
    threw = err.message;
  }
  check(/no http entry style/.test(threw || ''), 'rejected: asking Claude Desktop for an HTTP config', threw ?? 'did not throw');
}
{
  let threw = null;
  try {
    buildServers(registry, T('n8n'), stdioOpts);
  } catch (err) {
    threw = err.message;
  }
  check(/no stdio entry style/.test(threw || ''), 'rejected: asking n8n for a stdio config', threw ?? 'did not throw');
}
// ─── SEC-7 · every gateway-facing snippet tells the operator about the token ──
// A configuration handed to n8n or Open WebUI without the Authorization header
// now fails with a 401 the operator has no way to diagnose from the file they
// were given. That makes this documentation load-bearing, not decoration.
{
  const authedOpts = { ...httpOpts, gatewayAuthRequired: true };
  for (const id of ['n8n', 'open-webui', 'librechat', 'generic', 'copilot-studio']) {
    const text = renderSnippet(registry, T(id), authedOpts, emit(id, authedOpts));
    check(/Authorization: Bearer|Bearer <MCP_GATEWAY_AUTH_TOKEN>|bearer token/i.test(text),
          `${id}: snippet names the Authorization: Bearer header the gateway now requires`);
  }

  const n8nText = renderSnippet(registry, T('n8n'), authedOpts, null);
  check(/Header Auth/.test(n8nText) && /Name:\s+Authorization/.test(n8nText),
        'n8n snippet gives the exact Header Auth credential to create');
  check(/401/.test(n8nText), 'n8n snippet names the failure code so a 401 is self-diagnosing');

  // The token itself must never reach install\out -- these files are not
  // ACL-hardened and get pasted into tickets.
  const withSecret = { ...authedOpts, gatewayAuthToken: 'SUPERSECRETTOKENVALUE1234567' };
  for (const id of ['n8n', 'open-webui', 'librechat', 'generic']) {
    const text = renderSnippet(registry, T(id), withSecret, emit(id, withSecret));
    check(!text.includes('SUPERSECRETTOKENVALUE1234567'),
          `${id}: the token VALUE never appears in an emitted file`);
  }

  // And the honest negative: a gateway configured without a token says so.
  const openText = renderSnippet(registry, T('n8n'), { ...httpOpts, gatewayAuthRequired: false }, null);
  check(/none is configured/i.test(openText),
        'a token-less gateway is described as token-less rather than assumed secure');
}
{
  let threw = null;
  try {
    buildServers(registry, T('claude-code'), { servers: SERVERS, transport: 'http', gatewayUrl: null });
  } catch (err) {
    threw = err.message;
  }
  check(/needs a gateway url/.test(threw || ''), 'rejected: an HTTP config with no gateway configured', threw ?? 'did not throw');
}

// ─── Credential containment (Phase 4, finding F9) ────────────────────────────
//
// The leak guard used to be a blocklist of two names, BCONNECT_API_KEY and
// BCONNECT_PASSWORD. The Phase 4 installer audit probed validateShape()
// directly and found those two correctly rejected while BCONNECT_V11_PASSWORD,
// BCONNECT_V11_USERNAME and MCP_GATEWAY_AUTH_TOKEN were all ACCEPTED into a
// host config — including files written into the git working tree, and the
// v1.1 password is a domain account, the highest-value credential here.
//
// These cases are the audit's, turned into a guard. The first two are the
// controls: they passed before the fix, so if they ever stop passing the test
// itself is broken rather than the code.

section('Credential containment — a host config may carry capability gates and nothing else');
{
  const withEnv = (env) => ({
    servers: {
      'bconnect-endpoints': {
        command: NODE,
        args: [`--env-file=${ENVF}`, 'C:\\x\\build\\index.js'],
        env,
      },
    },
    transport: 'stdio',
    gatewayUrl: GATEWAY,
    gatewayPort: 3001,
  });
  const refuses = (env) => {
    const opts = withEnv(env);
    const coll = buildServers(registry, T('claude-desktop'), opts);
    return validateShape(registry, T('claude-desktop'), { mcpServers: coll }, opts).length > 0;
  };

  // Controls — these were already rejected, and must stay rejected.
  check(refuses({ BCONNECT_API_KEY: 'k' }), 'refuses BCONNECT_API_KEY (control)');
  check(refuses({ BCONNECT_PASSWORD: 'p' }), 'refuses BCONNECT_PASSWORD (control)');

  // The three the audit found accepted.
  check(refuses({ BCONNECT_V11_PASSWORD: 'p' }), 'refuses BCONNECT_V11_PASSWORD (F9)');
  check(refuses({ BCONNECT_V11_USERNAME: 'svc@corp.local' }), 'refuses BCONNECT_V11_USERNAME (F9)');
  check(refuses({ MCP_GATEWAY_AUTH_TOKEN: 't' }), 'refuses MCP_GATEWAY_AUTH_TOKEN (F9)');

  // A credential added tomorrow is refused by default — the point of moving
  // from a blocklist to an allowlist.
  check(refuses({ BCONNECT_FUTURE_CREDENTIAL: 'x' }), 'refuses an unknown key by default, not by name');

  // And the gates that legitimately belong there still get through.
  const gates = withEnv({
    ALLOW_WRITE_OPERATIONS: 'true',
    ALLOWED_WRITE_TOOLS: 'create_job_instance',
    BCONNECT_ENABLE_V11: 'true',
  });
  const gateColl = buildServers(registry, T('claude-desktop'), gates);
  check(
    validateShape(registry, T('claude-desktop'), { mcpServers: gateColl }, gates).length === 0,
    'still permits the three capability gates, including BCONNECT_ENABLE_V11'
  );
  check(
    gateColl['bconnect-endpoints'].env.BCONNECT_ENABLE_V11 === 'true',
    'the v1.1 gate survives into the emitted env block'
  );
}

// ─── SEC-3 · the allowlist covers targets with no serversKey too ─────────────
//
// validateShape's entry-level checks above only run for a target WITH a
// serversKey, because that is the only case with a built collection to walk.
// hosts.json has FOUR targets with serversKey: null (open-webui, n8n, openai,
// copilot-studio) -- not the two the original finding named -- and the audit
// demonstrated a plan carrying credentials emitting past validateShape for all
// four, because emit-host-config.mjs only called it inside
// `if (target.serversKey)`. This section is that repro, turned into a guard:
// MUTATE it back (re-add the `if (target.serversKey)` gate around the call in
// emit-host-config.mjs, or restore validateShape's un-prefixed early return)
// and every check below fails.

section('SEC-3 — a target with no serversKey is not exempt from the allowlist');
{
  const withV11 = {
    servers: {
      'bconnect-endpoints': {
        command: NODE,
        args: [`--env-file=${ENVF}`, 'C:\\x\\build\\index.js'],
        env: { BCONNECT_V11_PASSWORD: 'p', BCONNECT_API_KEY: 'k' },
      },
    },
    transport: 'http',
    gatewayUrl: GATEWAY,
    gatewayPort: 3001,
  };

  for (const id of ['open-webui', 'n8n', 'openai', 'copilot-studio']) {
    const t = T(id);
    check(t.serversKey === null, `${id}: still has no serversKey (sanity check on the fixture)`);
    const problems = validateShape(registry, t, null, withV11);
    check(
      problems.length > 0 && problems.some((p) => /credential|BCONNECT_V11_PASSWORD|BCONNECT_API_KEY/i.test(p)),
      `${id}: a credential-bearing plan is REFUSED even with no serversKey`,
      problems.length ? problems.join(' | ') : 'NOTHING WAS REJECTED',
    );
  }

  // The same plan with only capability gates must still pass for these targets
  // -- otherwise the fix is a blanket refusal rather than an allowlist.
  const gatesOnly = {
    servers: {
      'bconnect-endpoints': {
        command: NODE,
        args: [`--env-file=${ENVF}`, 'C:\\x\\build\\index.js'],
        env: { BCONNECT_ENABLE_V11: 'true' },
      },
    },
    transport: 'http',
    gatewayUrl: GATEWAY,
    gatewayPort: 3001,
  };
  for (const id of ['open-webui', 'n8n', 'openai', 'copilot-studio']) {
    check(
      validateShape(registry, T(id), null, gatesOnly).length === 0,
      `${id}: a plan carrying only capability gates still passes with no serversKey`,
    );
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('');
console.log(`  ${pass} passed, ${fail} failed, ${skip} skipped`);
if (fail) {
  console.log('');
  for (const f of failures) console.log(`    FAILED: ${f}`);
}
process.exit(fail ? 1 : 0);
