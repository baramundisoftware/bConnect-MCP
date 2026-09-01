// Emit bConnect-MCP configuration for every host target except Claude Desktop.
//
// Claude Desktop keeps its own writer, lib\merge-config.mjs. That path is verified,
// it is what this estate runs on today, and the point of this work is to add
// targets without touching it. The two files share no code, only a discipline:
// back up first, deep-compare everything we do not own, restore on mismatch.
//
// The shapes live in lib\hosts.json and the logic in lib\host-emitters.mjs, which
// this file is a thin command-line and filesystem wrapper around. That split is
// what lets lib\test-host-emitters.mjs exercise every emitter with no filesystem,
// no bMS, and none of these host applications installed.
//
// Usage:
//   node emit-host-config.mjs --plan <planFile> [--dry-run] [--json] [--registry <path>]
//
// Plan shape (contains NO secrets -- credentials live in the env file that the
// generated --env-file argument points at, exactly as for Claude Desktop):
//
//   {
//     "outDir":  "<dir for snippets and companion notes>",
//     "servers": { "bconnect-endpoints": { "command": "...", "args": [...], "env": {...} } },
//     "remove":  ["bconnect-oldserver"],
//     "gateway": { "url": "http://127.0.0.1:3001", "port": 3001, "authRequired": true },
//     "targets": [ { "id": "claude-code", "path": "C:\\proj\\.mcp.json", "transport": "stdio" } ]
//   }

import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './sdk.mjs';
import {
  loadRegistry,
  buildServers,
  validateShape,
  renderSnippet,
  renderContinueBlockFile,
  containsSecretShapedValue,
  mergeTomlText,
  parseToml,
  splitTomlSections,
} from './host-emitters.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const dryRun = !!args['dry-run'];

if (!args.plan) {
  console.error('emit-host-config: --plan <file> is required');
  process.exit(2);
}

const registry = loadRegistry(args.registry);
// PowerShell 5.1 writes UTF-8 WITH a BOM; strip it before parsing.
const plan = JSON.parse(readFileSync(args.plan, 'utf8').replace(/^\uFEFF/, ''));
const servers = plan.servers || {};
const removeNames = plan.remove || [];
// A removal-only plan: uninstall, and `bconnect servers remove`. An empty `servers`
// is normally a caller bug worth failing on ("no servers selected"), so removal has
// to say that it meant it. Only merge-json targets can be edited this way; a snippet
// or a block file was emitted whole and is deleted whole, by the caller.
const removeOnly = !!plan.removeOnly;
const gateway = plan.gateway || null;
const outDir = plan.outDir || resolve(HERE, '..', 'out');
const gatewayUrl = gateway ? String(gateway.url).replace(/\/+$/, '') : null;

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const stamp = () =>
  new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');

// ─── Writers ─────────────────────────────────────────────────────────────────

function mergeJsonFile(target, targetPath, collection, report) {
  let original = {};
  const existed = existsSync(targetPath);
  if (existed) {
    try {
      original = JSON.parse(readFileSync(targetPath, 'utf8').replace(/^\uFEFF/, ''));
    } catch (err) {
      throw new Error(`${targetPath} is not valid JSON (${err.message}); refusing to overwrite it`);
    }
    if (original === null || typeof original !== 'object' || Array.isArray(original)) {
      throw new Error(`${targetPath} is JSON but not an object; refusing to overwrite it`);
    }
  }
  const snapshot = JSON.parse(JSON.stringify(original));
  const key = target.serversKey;
  const merged = { ...original };

  const isList = target.collection === 'list';
  const existingRaw = merged[key];
  const existingColl = isList
    ? Array.isArray(existingRaw) ? existingRaw : []
    : existingRaw && typeof existingRaw === 'object' && !Array.isArray(existingRaw) ? existingRaw : {};

  const added = [];
  const updated = [];
  const removed = [];
  let resultColl;

  if (isList) {
    const nf = target.nameField || 'name';
    const byName = new Map(existingColl.map((e) => [e?.[nf], e]));
    for (const entry of collection) {
      if (byName.has(entry[nf])) {
        if (!deepEqual(byName.get(entry[nf]), entry)) updated.push(entry[nf]);
      } else added.push(entry[nf]);
      byName.set(entry[nf], entry);
    }
    for (const n of removeNames) if (byName.delete(n)) removed.push(n);
    resultColl = [...byName.values()];
  } else {
    resultColl = { ...existingColl };
    for (const [name, entry] of Object.entries(collection)) {
      if (Object.prototype.hasOwnProperty.call(resultColl, name)) {
        if (!deepEqual(resultColl[name], entry)) updated.push(name);
      } else added.push(name);
      resultColl[name] = entry;
    }
    for (const n of removeNames) {
      if (Object.prototype.hasOwnProperty.call(resultColl, n)) {
        delete resultColl[n];
        removed.push(n);
      }
    }
  }
  merged[key] = resultColl;

  // Everything we do not own, named explicitly, so the check below is a check
  // rather than a hope. This is the discipline merge-config.mjs established for
  // Claude Desktop; every JSON target inherits it.
  const otherTopLevel = Object.keys(snapshot).filter((k) => k !== key);
  const foreign = isList
    ? []
    : Object.keys(existingColl).filter(
        (k) => !Object.prototype.hasOwnProperty.call(collection, k) && !removeNames.includes(k),
      );

  const violations = [];
  for (const k of otherTopLevel) if (!deepEqual(snapshot[k], merged[k])) violations.push(`top-level key "${k}" changed`);
  for (const k of foreign) if (!deepEqual(snapshot[key][k], merged[key][k])) violations.push(`unrelated server "${k}" changed`);
  if (violations.length) {
    throw new Error(`refusing to write ${targetPath} — it would alter content it does not own: ${violations.join('; ')}`);
  }

  Object.assign(report, {
    existed,
    added,
    updated,
    removed,
    preservedTopLevelKeys: otherTopLevel,
    preservedForeignServers: foreign,
  });

  if (dryRun) return;

  let backup = null;
  if (existed) {
    backup = `${targetPath}.bak-${stamp()}`;
    copyFileSync(targetPath, backup);
    report.backup = backup;
  }
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, JSON.stringify(merged, null, 2) + '\n', { encoding: 'utf8' });

  // Re-read and verify. A merge checked only in memory has not been checked:
  // this is the step that catches an encoding or serialiser surprise.
  let reread;
  try {
    reread = JSON.parse(readFileSync(targetPath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (err) {
    if (backup) copyFileSync(backup, targetPath);
    throw new Error(`wrote ${targetPath} but it will not re-parse (${err.message}); backup restored`);
  }
  const post = [];
  for (const k of otherTopLevel) if (!deepEqual(snapshot[k], reread[k])) post.push(`top-level key "${k}"`);
  for (const k of foreign) if (!deepEqual(snapshot[key][k], reread[key]?.[k])) post.push(`server "${k}"`);
  if (!deepEqual(reread[key], resultColl)) post.push(`the "${key}" collection did not round-trip`);
  if (post.length) {
    if (backup) copyFileSync(backup, targetPath);
    throw new Error(`post-write verification FAILED for ${targetPath} (${post.join('; ')}); backup restored`);
  }
}

// The same discipline as mergeJsonFile, over a file format that has no
// canonical serialiser and a user who owns most of the file. The difference is
// that nothing outside our own tables is ever re-rendered: mergeTomlText carries
// the other sections across as the identical lines, and this function proves it
// by comparing them before the write and again after it.
function mergeTomlFile(target, targetPath, collection, report) {
  const existed = existsSync(targetPath);
  const original = existed ? readFileSync(targetPath, 'utf8') : '';

  let merged;
  try {
    merged = mergeTomlText(original, target, collection, removeNames);
  } catch (err) {
    throw new Error(`${targetPath}: ${err.message}`);
  }

  // The foreign half, named explicitly so the check below is a check rather than
  // a hope: every table that is not ours, and the preamble above the first table.
  const before = existed ? sliceForeign(original, target) : { preamble: '', sections: new Map() };
  const after = sliceForeign(merged.text, target);
  // Trailing newlines are normalised on both sides. A file that arrived without
  // one leaves with one, which is a change to whitespace at the very end of the
  // file and not a change to anybody's settings.
  const body = (t) => String(t).replace(/[\r\n]+$/, '');
  const violations = [];
  if (body(before.preamble) !== body(after.preamble)) violations.push('the settings above the first table changed');
  for (const [name, text] of before.sections) {
    if (!after.sections.has(name)) violations.push(`table "${name}" disappeared`);
    else if (body(after.sections.get(name)) !== body(text)) violations.push(`table "${name}" changed`);
  }
  if ([...before.sections.keys()].join(' ') !== [...after.sections.keys()].join(' ')) {
    violations.push('the order of the tables this installer does not own changed');
  }
  if (violations.length) {
    throw new Error(`refusing to write ${targetPath} — it would alter content it does not own: ${violations.join('; ')}`);
  }

  // SEC-3, on the rendered bytes, before any of them reach the disk. The JSON
  // paths do this in writeTextFile; a TOML path that skipped it would be a new
  // emitter with the backstop missing, which is the finding this re-opens.
  if (containsSecretShapedValue(merged.text)) {
    throw new Error(`refusing to write ${targetPath}: the rendered configuration appears to carry a credential`);
  }

  // Reported the same way the JSON merge reports it, and counted the same way:
  // a table under mcp_servers is somebody's SERVER, anything else is one of
  // their settings. `[tui]` counted as a preserved server would be a summary
  // line that reads correct and is not.
  const prefix = `${target.serversKey}.`;
  const uniq = (xs) => [...new Set(xs)];
  Object.assign(report, {
    existed,
    added: merged.added,
    updated: merged.updated,
    removed: merged.removed,
    preservedTopLevelKeys: uniq([
      ...merged.preambleKeys,
      ...[...before.sections.keys()].filter((p) => !p.startsWith(prefix)).map((p) => p.split('.')[0]),
    ]),
    preservedForeignServers: uniq(
      [...before.sections.keys()].filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length).split('.')[0]),
    ),
  });

  if (dryRun) return;

  let backup = null;
  if (existed) {
    backup = `${targetPath}.bak-${stamp()}`;
    copyFileSync(targetPath, backup);
    report.backup = backup;
  }
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, merged.text, { encoding: 'utf8' });

  // Re-read and verify. Twice over, because a TOML merge has two ways to be
  // wrong: the foreign text can have moved, and our own tables can have been
  // rendered into something that does not read back as what we meant.
  const reread = readFileSync(targetPath, 'utf8');
  const post = [];
  if (reread !== merged.text) post.push('the file on disk is not the text that was rendered');
  let parsed = null;
  try {
    parsed = parseToml(reread);
  } catch (err) {
    post.push(`it will not re-parse as TOML (${err.message})`);
  }
  if (parsed) {
    const coll = parsed[target.serversKey];
    for (const [name, entry] of Object.entries(collection)) {
      const got = coll?.[name];
      if (!got) post.push(`server "${name}" is not in the file that was written`);
      else if (JSON.stringify(got) !== JSON.stringify(entry)) {
        post.push(`server "${name}" did not round-trip (${JSON.stringify(got)})`);
      }
    }
    for (const n of removeNames) if (coll && Object.prototype.hasOwnProperty.call(coll, n)) post.push(`server "${n}" was not removed`);
  }
  if (post.length) {
    if (backup) copyFileSync(backup, targetPath);
    else writeFileSync(targetPath, original, { encoding: 'utf8' });
    throw new Error(`post-write verification FAILED for ${targetPath} (${post.join('; ')}); ${backup ? 'backup restored' : 'the file was put back'}`);
  }
}

/** Everything in a TOML file that is NOT one of our server tables, as raw text. */
function sliceForeign(text, target) {
  const doc = splitTomlSections(text);
  const managed = new Set(Object.keys(servers).concat(removeNames));
  const sections = new Map();
  for (const s of doc.sections) {
    if (s.path[0] === target.serversKey && s.path.length >= 2 && managed.has(s.path[1])) continue;
    sections.set(s.path.join('.'), doc.lines.slice(s.start, s.end).join('\n'));
  }
  return { preamble: doc.lines.slice(0, doc.preambleEnd).join('\n'), sections };
}

// The destination check, as opposed to the context check.
//
// WHO this process is, and therefore whether it may write per-user state at all, is
// decided in exactly one place: Get-PerUserWriteRefusal in lib\UserContext.psm1. This
// is not a second copy of that rule and must not become one. It is the same shape of
// defence as containsSecretShapedValue below — the last check before bytes land,
// stated as an invariant about the DESTINATION rather than about the caller:
//
//     nothing this suite writes belongs under a config\systemprofile directory.
//
// No MCP client reads C:\Windows\System32\config\systemprofile. A file written there
// is invisible, and the run that wrote it reports success — which is the whole failure
// this refusal exists to close. The installer stops long before reaching here; this
// covers the route it cannot, which is a plan handed to this file by anything else,
// with paths some other code resolved.
//
// Both System32 and SysWOW64 carry one, and which a process sees depends on its
// bitness rather than on anything an operator chose, so the tail is matched.
const SYSTEMPROFILE_PATTERN = /[\\/]config[\\/]systemprofile([\\/]|$)/i;

function assertWritableDestination(id, targetPath) {
  if (SYSTEMPROFILE_PATTERN.test(targetPath)) {
    throw new Error(
      `refusing to write ${targetPath}: that is under the system profile, which no MCP client reads. ` +
        `A per-user configuration cannot be emitted from a SYSTEM or service context — run the machine ` +
        `stage there (Install-BConnectMcp.ps1 -Stage Machine) and the user stage in the administrator's ` +
        `own login (-Stage User). Target: ${id}`,
    );
  }
}

function writeTextFile(targetPath, text, report) {
  // SEC-3 defence in depth: the LAST check before anything reaches install\out,
  // over the actual bytes rather than the structured data that produced them —
  // catches a leak by any route validateShape's opts.servers walk did not.
  if (containsSecretShapedValue(text)) {
    throw new Error(`refusing to write ${targetPath}: the rendered text appears to carry a credential`);
  }
  if (report) report.bytes = Buffer.byteLength(text, 'utf8');
  if (dryRun) return;
  mkdirSync(dirname(targetPath), { recursive: true });
  if (existsSync(targetPath)) {
    const backup = `${targetPath}.bak-${stamp()}`;
    copyFileSync(targetPath, backup);
    if (report) report.backup = backup;
  }
  writeFileSync(targetPath, text, { encoding: 'utf8' });
}

// ─── Main ────────────────────────────────────────────────────────────────────

const reports = [];
let failed = false;

for (const req of plan.targets || []) {
  const target = registry.byId.get(req.id);
  const report = { id: req.id, ok: false, mode: null, path: null, transport: null, problems: [] };
  reports.push(report);

  if (!target) {
    report.problems.push(`unknown host target "${req.id}" — see lib\\hosts.json for the list`);
    failed = true;
    continue;
  }
  Object.assign(report, {
    label: target.label,
    mode: target.mode,
    verification: target.verification,
    impractical: !!target.impractical,
  });

  // Transport: what the caller asked for, bounded by what the host can consume.
  // A host that cannot spawn a process does not get a stdio config no matter what
  // was requested, and vice versa.
  let transport = req.transport || (target.transport === 'http' ? 'http' : 'stdio');
  if (target.transport === 'http') transport = 'http';
  if (target.transport === 'stdio') transport = 'stdio';
  report.transport = transport;

  if (!Object.keys(servers).length && !removeOnly) {
    report.problems.push('no servers selected');
    failed = true;
    continue;
  }
  if (removeOnly && target.mode !== 'merge-json') {
    report.problems.push(
      `${target.id} is emitted whole (${target.mode}), so it cannot be edited to remove entries; ` +
        `delete ${req.path || target.defaultPath} instead`,
    );
    failed = true;
    continue;
  }
  if (!removeOnly && (transport === 'http' || target.requiresGateway) && !gatewayUrl) {
    report.problems.push(
      `${target.id} can only be reached over HTTP, and no gateway was configured in this run ` +
        `(pass -Gateway to the installer)`,
    );
    failed = true;
    continue;
  }

  const targetPath = req.path || target.defaultPath.replace('{OUT}', outDir);
  report.path = targetPath;

  try {
    // Before the shape check and before any backup is taken, because a refused
    // destination must leave nothing at all behind — not even a .bak-* beside it.
    assertWritableDestination(req.id, targetPath);
    const opts = {
      servers,
      transport,
      gatewayUrl,
      gatewayPort: gateway?.port,
      // SEC-7. The plan carries the FACT that a token is required, never the
      // token: these files go to install\out, which is not ACL-hardened.
      gatewayAuthRequired: gateway ? gateway.authRequired !== false : false,
      outPath: targetPath,
    };
    let collection = null;
    if (target.serversKey) {
      collection = removeOnly
        ? (target.collection === 'list' ? [] : {})
        : buildServers(registry, target, opts);
    }
    // SEC-3. Run unconditionally, not just "if (target.serversKey)" — four
    // targets (open-webui, n8n, openai, copilot-studio) have none, and a target
    // without a serversKey is not thereby exempt from the credential allowlist.
    // validateShape itself now checks opts.servers before it ever looks at key.
    const problems = validateShape(
      registry,
      target,
      target.serversKey ? { [target.serversKey]: collection } : null,
      opts,
    );
    if (problems.length) {
      report.problems.push(...problems);
      failed = true;
      continue;
    }

    if (target.mode === 'merge-json') {
      // The MERGE STRATEGY is the mode; the SYNTAX is `format`. See the note in
      // hosts.json for why the mode is not called merge-toml -- four PowerShell
      // front ends branch on that field and the other branch deletes the file.
      if (target.format === 'toml') mergeTomlFile(target, targetPath, collection, report);
      else mergeJsonFile(target, targetPath, collection, report);
    } else if (target.mode === 'write-file') {
      writeTextFile(targetPath, renderContinueBlockFile(registry, target, opts, collection), report);
      // The explainer goes beside the snippets, never over the block file itself.
      const companion = resolve(outDir, `${target.id}.md`);
      writeTextFile(companion, renderSnippet(registry, target, opts, collection), null);
      report.companion = companion;
    } else {
      writeTextFile(targetPath, renderSnippet(registry, target, opts, collection), report);
    }
    report.ok = true;
  } catch (err) {
    report.problems.push(err.message);
    failed = true;
  }
}

if (args.json) {
  console.log(JSON.stringify({ dryRun, outDir, reports }, null, 2));
} else {
  for (const r of reports) {
    console.log(
      `  [${r.ok ? 'ok  ' : 'FAIL'}] ${(r.label || r.id).padEnd(32)} ${String(r.transport || '-').padEnd(6)} ${r.mode || ''}`,
    );
    if (r.path) console.log(`         ${r.path}`);
    if (r.backup) console.log(`         backup:  ${r.backup}`);
    if (r.companion) console.log(`         notes:   ${r.companion}`);
    if (r.added?.length || r.updated?.length || r.removed?.length) {
      console.log(
        `         added ${r.added.join(', ') || '(none)'} | updated ${r.updated.join(', ') || '(none)'} | removed ${r.removed.join(', ') || '(none)'}`,
      );
    }
    if (r.preservedTopLevelKeys) {
      console.log(
        `         preserved ${r.preservedTopLevelKeys.length} unrelated top-level key(s), ${r.preservedForeignServers.length} unrelated server(s)`,
      );
    }
    if (r.ok && r.verification === 'schema-only') {
      console.log('         verified: SHAPE ONLY — this host is not installed here, nothing was executed');
    }
    if (r.ok && r.impractical) {
      console.log('         NOTE: needs an internet-reachable endpoint — read the emitted file before planning on it');
    }
    for (const p of r.problems) console.log(`         ! ${p}`);
  }
  if (dryRun) console.log('\n  (dry run — nothing written)');
}

process.exit(failed ? 1 : 0);
