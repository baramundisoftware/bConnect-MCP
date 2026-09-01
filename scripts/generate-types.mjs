#!/usr/bin/env node
/**
 * Regenerate every `bconnect-*-mcp/src/generated/*-types.ts` from the shipped
 * OpenAPI specifications.  Run it as `npm run generate`.
 *
 * WHY THIS EXISTS
 * ---------------
 * Until this script landed there was no wrapper around `openapi-typescript` —
 * CONTRIBUTING.md said so in as many words — so the generated types were
 * refreshed by hand, one `npx` invocation at a time, whenever someone
 * remembered.  They stopped being refreshed: two servers were still typed
 * against 25R2 while the suite targeted 26R1, and one file
 * (`bconnect-assets-mcp/src/generated/assets-types.ts`) had been *hand-written*
 * in the emitter's style and was never codegen output at all.  A generator that
 * nobody can run is a generator that drifts.
 *
 * WHAT IT GUARANTEES
 * ------------------
 *  1. Deterministic. Same specs in, byte-identical files out, on any platform —
 *     LF line endings, no timestamps, no machine paths.  That is what makes
 *     `__tests__/generated-types-are-fresh.test.ts` possible: the test simply
 *     runs this module in-process and compares bytes.
 *  2. The MANIFEST below is the single statement of which spec each generated
 *     file comes from.  The freshness test also asserts that the files on disk
 *     are *exactly* the manifest's targets, so a generated file that no spec
 *     produces cannot sit in the tree unnoticed.
 *
 * PARITY WITH THE CLI
 * -------------------
 * `npx openapi-typescript <spec> -o <out>` emits a five-line banner and then
 * `astToString(ast)`.  This script reproduces the banner verbatim and is
 * verified byte-identical to the CLI output for the specs that were already
 * fresh.  Using the programmatic API instead of spawning the CLI 22 times keeps
 * a full regeneration under a second, which is what lets the freshness test run
 * on every `vitest` invocation.
 */

import openapiTS, { astToString } from 'openapi-typescript';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The one supported bConnect release.  25R2 support was withdrawn: several
 * tools depend on routes that only exist from 26R1, and shipping a build that
 * half-works against an older bMS publishes inaccurate data.  There is no
 * second release directory to fall back to and no `BCONNECT_RELEASE` switch.
 */
export const RELEASE = '26R1';

export const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

/**
 * spec file (under `openapi-specs/26R1/`) -> the generated files it produces.
 *
 * Several servers vendor a copy of a sibling module's types because their
 * composite tools read that module's routes.  The duplication is deliberate and
 * pre-existing; listing it here is what stops the copies drifting apart, which
 * is exactly what had happened (`bconnect-jobs-mcp`'s vendored `software` copy
 * was 389 lines against the real 1,679).
 *
 * `aliases: true` additionally emits a flat `export type X = components[...]`
 * line for every schema, in the spec's own order.  Only `bconnect-assets-mcp`
 * needs it, because its module imports the schema names directly rather than
 * through `components['schemas']`.  See the note in `emitAliases()`.
 */
export const MANIFEST = [
  { spec: 'bConnect_Activedirectory.json', targets: [
      'bconnect-activedirectory-mcp/src/generated/activedirectory-types.ts',
      'bconnect-jobs-mcp/src/generated/activedirectory-types.ts',
    ] },
  { spec: 'bConnect_Assets.json', aliases: true, targets: [
      'bconnect-assets-mcp/src/generated/assets-types.ts',
    ] },
  { spec: 'bConnect_Assets.json', targets: [
      'bconnect-jobs-mcp/src/generated/assets-types.ts',
    ] },
  { spec: 'bConnect_Compliance.json', targets: [
      'bconnect-compliance-mcp/src/generated/compliance-types.ts',
    ] },
  { spec: 'bConnect_Defensecontrol.json', targets: [
      'bconnect-defensecontrol-mcp/src/generated/defensecontrol-types.ts',
      'bconnect-jobs-mcp/src/generated/defensecontrol-types.ts',
    ] },
  { spec: 'bConnect_Endpoints.json', targets: [
      'bconnect-endpoints-mcp/src/generated/endpoints-types.ts',
      'bconnect-groups-mcp/src/generated/endpoints-types.ts',
      'bconnect-jobs-mcp/src/generated/endpoints-types.ts',
    ] },
  { spec: 'bConnect_Jobs.json', targets: [
      'bconnect-jobs-mcp/src/generated/jobs-types.ts',
    ] },
  { spec: 'bConnect_Operatingsystems.json', targets: [
      'bconnect-operatingsystems-mcp/src/generated/operatingsystems-types.ts',
      'bconnect-jobs-mcp/src/generated/operatingsystems-types.ts',
    ] },
  { spec: 'bConnect_Servermanagement.json', targets: [
      'bconnect-servermanagement-mcp/src/generated/servermanagement-types.ts',
      'bconnect-jobs-mcp/src/generated/servermanagement-types.ts',
    ] },
  { spec: 'bConnect_Software.json', targets: [
      'bconnect-software-mcp/src/generated/software-types.ts',
      'bconnect-jobs-mcp/src/generated/software-types.ts',
    ] },
  { spec: 'bConnect_Universaldynamicgroups.json', targets: [
      'bconnect-universaldynamicgroups-mcp/src/generated/universaldynamicgroups-types.ts',
    ] },
  { spec: 'bConnect_Updatemanagement.json', targets: [
      'bconnect-updatemanagement-mcp/src/generated/updatemanagement-types.ts',
      'bconnect-jobs-mcp/src/generated/updatemanagement-types.ts',
    ] },
  { spec: 'bConnect_Variables.json', targets: [
      'bconnect-variables-mcp/src/generated/variables-types.ts',
      'bconnect-jobs-mcp/src/generated/variables-types.ts',
    ] },
];

/** Byte-for-byte the banner `openapi-typescript`'s CLI writes ahead of the AST. */
const BANNER =
  '/**\n' +
  ' * This file was auto-generated by openapi-typescript.\n' +
  ' * Do not make direct changes to the file.\n' +
  ' */\n\n';

/**
 * `bconnect-assets-mcp/src/modules/assets.ts` imports thirteen schema names as
 * top-level types (`import type { Asset, AssetPagedList, … }`).  The emitter
 * never produces those; the file that satisfied them was hand-written, which is
 * why it carried no `paths` and no `operations` and left every assets tool with
 * no machine-checkable contract.
 *
 * Rather than hand-maintain a second file, the aliases are DERIVED: every name
 * under `components.schemas`, in the spec's declaration order.  Nothing is
 * invented, so a schema the vendor renames changes the alias set on the next
 * regeneration instead of rotting silently.
 *
 * This block is a bridge, not an intended feature.  Once the assets module
 * imports through `components['schemas'][…]` like the other twelve servers,
 * drop `aliases: true` from the MANIFEST and the file becomes pure emitter
 * output.
 */
function emitAliases(specJson) {
  const names = Object.keys(specJson?.components?.schemas ?? {});
  if (names.length === 0) return '';
  return (
    '\n' +
    '/* ── Flat aliases ───────────────────────────────────────────────────────────\n' +
    ' * Emitted by scripts/generate-types.mjs for every name in `components.schemas`,\n' +
    ' * in the spec\'s own order. Do not edit; do not add names the spec does not have.\n' +
    ' */\n' +
    names.map((n) => `export type ${n} = components['schemas']['${n}'];\n`).join('')
  );
}

/**
 * Produce the exact text of every generated file.
 *
 * Returns a Map of repo-relative target path -> file contents.  Nothing is
 * written, which is what lets the freshness test compare against the tree
 * without touching it.
 */
export async function renderAll({ repoRoot = REPO_ROOT, release = RELEASE } = {}) {
  const specsDir = resolve(repoRoot, 'openapi-specs', release);
  if (!existsSync(specsDir)) {
    throw new Error(
      `No specs at ${specsDir}. This product is ${release}-only; ` +
        `run scripts/download-openapi-specs.sh against a ${release} bMS.`
    );
  }

  const rendered = new Map();
  const cache = new Map(); // spec file -> emitter output, so a spec parses once

  for (const entry of MANIFEST) {
    const specPath = resolve(specsDir, entry.spec);
    if (!existsSync(specPath)) throw new Error(`Missing spec: ${specPath}`);

    if (!cache.has(entry.spec)) {
      const ast = await openapiTS(pathToFileURL(specPath));
      cache.set(entry.spec, {
        body: BANNER + astToString(ast),
        json: JSON.parse(readFileSync(specPath, 'utf8')),
      });
    }
    const { body, json } = cache.get(entry.spec);
    const text = entry.aliases ? body + emitAliases(json) : body;

    for (const target of entry.targets) {
      if (rendered.has(target)) throw new Error(`MANIFEST names ${target} twice`);
      rendered.set(target, text);
    }
  }
  return rendered;
}

/** Every generated file the MANIFEST claims, repo-relative, sorted. */
export function manifestTargets() {
  return MANIFEST.flatMap((e) => e.targets).sort();
}

export async function generate({ repoRoot = REPO_ROOT, release = RELEASE, check = false } = {}) {
  const rendered = await renderAll({ repoRoot, release });
  const changed = [];
  for (const [target, text] of rendered) {
    const abs = resolve(repoRoot, target);
    const current = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    if (current === text) continue;
    changed.push(target);
    if (!check) {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, text, 'utf8'); // LF only — the emitter never writes CRLF
    }
  }
  return { total: rendered.size, changed };
}

// ── CLI ────────────────────────────────────────────────────────────────────
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const check = process.argv.includes('--check');
  const { total, changed } = await generate({ check });
  if (check) {
    if (changed.length) {
      console.error(`${changed.length}/${total} generated file(s) are stale:`);
      for (const c of changed) console.error(`  ${c}`);
      console.error(`\nRun: npm run generate`);
      process.exit(1);
    }
    console.log(`All ${total} generated files are up to date with openapi-specs/${RELEASE}.`);
  } else {
    console.log(`Generated ${total} file(s) from openapi-specs/${RELEASE}; ${changed.length} changed.`);
    for (const c of changed) console.log(`  updated ${c}`);
  }
}
