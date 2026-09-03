// Back up, merge and verify %APPDATA%\Claude\claude_desktop_config.json.
//
// Why this is Node and not PowerShell: the file belongs to the user, not to us. It
// carries unrelated preferences, a coworkUserFilesPath, and possibly other people's
// MCP servers. PowerShell 5.1's ConvertFrom-Json/ConvertTo-Json round trip is lossy
// in ways that matter here (PSCustomObject coercion, \uXXXX escaping of anything
// non-ASCII, empty-collection handling), and "the installer quietly rewrote my
// config" is precisely the failure this step must not have. Node's JSON is faithful
// and preserves key insertion order.
//
// The merge is verified, not assumed: after writing, every key we did not manage is
// deep-compared against the pre-merge snapshot, and a mismatch restores the backup
// and exits non-zero.
//
// The credential allowlist that binds every other target binds this one too. The
// checks live in host-emitters.mjs because that is where the reasoning for them is;
// importing them here costs nothing on a clean plan and removes the asymmetry where
// the most-used writer was the only one running unchecked.
//
// Usage:
//   node merge-config.mjs --target <path> --plan <planFile> [--dry-run] [--json]
//
// Plan file shape (contains NO secrets -- credentials live in the env file that the
// generated --env-file argument points at, never in this config):
//   { "manage": { "<server>": { "command": "...", "args": [...], "env": {...} } },
//     "remove": ["<server>", ...] }

import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from './sdk.mjs';
import { checkServerEnvAllowlist, containsSecretShapedValue } from './host-emitters.mjs';

const args = parseArgs(process.argv.slice(2));
const target = args.target;
const planPath = args.plan;
const dryRun = !!args['dry-run'];

if (!target || !planPath) {
  console.error('merge-config: --target and --plan are required');
  process.exit(2);
}

// PowerShell 5.1 writes UTF-8 WITH a BOM, so strip it before parsing.
const plan = JSON.parse(readFileSync(planPath, 'utf8').replace(/^\uFEFF/, ''));
const manage = plan.manage || {};
const remove = plan.remove || [];

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── Credential allowlist, before anything is read or written ────────────────
// A host config may carry a PATH to the env file and capability gates; never a
// credential. Checked on the plan we were handed and again on the bytes we are
// about to write for the entries we own -- foreign servers already in the file
// are deliberately NOT scanned, because refusing to write over somebody else's
// pre-existing `x-api-key` header would break an installation this file has no
// business having an opinion about.
const envProblems = checkServerEnvAllowlist({ servers: manage }, { id: 'claude-desktop' });
for (const [name, entry] of Object.entries(manage)) {
  if (containsSecretShapedValue(JSON.stringify(entry))) {
    envProblems.push(`server "${name}" appears to carry a credential; a host config may only reference the env file`);
  }
}
if (envProblems.length) {
  console.error('merge-config: refusing to write -- the plan would put a credential in a host config:');
  for (const p of envProblems) console.error(`  - ${p}`);
  process.exit(1);
}

// ── Read the existing config ────────────────────────────────────────────────
let original = {};
let existed = existsSync(target);
if (existed) {
  const raw = readFileSync(target, 'utf8');
  try {
    // strip a UTF-8 BOM if the file has one; JSON.parse rejects it
    original = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch (err) {
    console.error(`merge-config: ${target} is not valid JSON (${err.message}).`);
    console.error('  Refusing to overwrite it. Fix or move the file, then re-run.');
    process.exit(1);
  }
}
const snapshot = JSON.parse(JSON.stringify(original));

// ── Merge ───────────────────────────────────────────────────────────────────
// Object spread preserves insertion order, so unrelated keys keep their position
// and the diff a human sees afterwards stays small.
const merged = { ...original };
const existingServers = merged.mcpServers && typeof merged.mcpServers === 'object' ? merged.mcpServers : {};
const servers = { ...existingServers };

const added = [];
const updated = [];
const removed = [];

for (const [name, entry] of Object.entries(manage)) {
  if (Object.prototype.hasOwnProperty.call(servers, name)) {
    if (!deepEqual(servers[name], entry)) updated.push(name);
  } else {
    added.push(name);
  }
  servers[name] = entry;
}
for (const name of remove) {
  if (Object.prototype.hasOwnProperty.call(servers, name)) {
    delete servers[name];
    removed.push(name);
  }
}

// If mcpServers did not exist, adding it here appends it last, which is fine.
merged.mcpServers = servers;

const foreignServers = Object.keys(existingServers).filter(
  (k) => !Object.prototype.hasOwnProperty.call(manage, k) && !remove.includes(k)
);
const otherTopLevel = Object.keys(snapshot).filter((k) => k !== 'mcpServers');

// ── Preservation check, done on the in-memory result before writing ─────────
const violations = [];
for (const k of otherTopLevel) {
  if (!deepEqual(snapshot[k], merged[k])) violations.push(`top-level key "${k}" changed`);
}
for (const k of foreignServers) {
  if (!deepEqual(snapshot.mcpServers[k], merged.mcpServers[k])) {
    violations.push(`unrelated MCP server "${k}" changed`);
  }
}
if (violations.length) {
  console.error('merge-config: refusing to write -- the merge would alter content it does not own:');
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}

const summary = {
  target,
  existed,
  dryRun,
  backup: null,
  added,
  updated,
  removed,
  preservedTopLevelKeys: otherTopLevel,
  preservedForeignServers: foreignServers,
};

const text = JSON.stringify(merged, null, 2) + '\n';

if (dryRun) {
  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    report(summary);
    console.log('\n  (dry run -- nothing written)');
  }
  process.exit(0);
}

// ── Back up, write, verify by re-reading ────────────────────────────────────
let backup = null;
if (existed) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  backup = `${target}.bak-${stamp}`;
  copyFileSync(target, backup);
  summary.backup = backup;
}

// The host's own configuration directory may not exist -- a machine that has never
// run the client has never had it created. Every other writer in the installer does
// this; without it the failure is an uncaught ENOENT from node:fs with no hint that
// the cause is a client that was never installed.
mkdirSync(dirname(target), { recursive: true });
// UTF-8 without BOM. Claude Desktop reads this file with a strict JSON parser.
writeFileSync(target, text, { encoding: 'utf8' });

let reread;
try {
  reread = JSON.parse(readFileSync(target, 'utf8').replace(/^\uFEFF/, ''));
} catch (err) {
  restore(backup, target);
  console.error(`merge-config: wrote a file that will not re-parse (${err.message}); backup restored.`);
  process.exit(1);
}

const postViolations = [];
for (const k of otherTopLevel) {
  if (!deepEqual(snapshot[k], reread[k])) postViolations.push(`top-level key "${k}"`);
}
for (const k of foreignServers) {
  if (!deepEqual(snapshot.mcpServers[k], reread.mcpServers?.[k])) postViolations.push(`server "${k}"`);
}
for (const [name, entry] of Object.entries(manage)) {
  if (!deepEqual(reread.mcpServers?.[name], entry)) postViolations.push(`managed server "${name}" did not round-trip`);
}
if (postViolations.length) {
  restore(backup, target);
  console.error('merge-config: post-write verification FAILED; backup restored:');
  for (const v of postViolations) console.error(`  - ${v}`);
  process.exit(1);
}

if (args.json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  report(summary);
}

function restore(bak, dst) {
  if (bak && existsSync(bak)) copyFileSync(bak, dst);
}

function report(s) {
  console.log(`  target      ${s.target}`);
  console.log(`  backup      ${s.backup || (s.existed ? '(dry run)' : '(no existing file)')}`);
  console.log(`  added       ${s.added.join(', ') || '(none)'}`);
  console.log(`  updated     ${s.updated.join(', ') || '(none)'}`);
  console.log(`  removed     ${s.removed.join(', ') || '(none)'}`);
  console.log(`  preserved   ${s.preservedTopLevelKeys.length} unrelated top-level key(s): ${s.preservedTopLevelKeys.join(', ') || '(none)'}`);
  console.log(`              ${s.preservedForeignServers.length} unrelated MCP server(s): ${s.preservedForeignServers.join(', ') || '(none)'}`);
}
