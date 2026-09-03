/**
 * Every PATCH a module makes must send `application/json-patch+json`.
 *
 * ── Why this guard exists ───────────────────────────────────────────────────
 * Measured 2026-08-19 across every 26R1 OpenAPI spec: **25 PATCH operations, all
 * of them declaring `application/json-patch+json` and NOTHING else.** axios sends
 * `application/json` when no content type is given — measured against a capturing
 * adapter, not assumed — and the client sets that as an explicit instance default.
 *
 * TWENTY-ONE of the repository's TWENTY-FIVE PATCH call sites were bare, across
 * seven modules: endpoints (9), assets (3), servermanagement (3), variables (2),
 * operatingsystems (2), defensecontrol (1) and jobs (1).
 *
 * ── CORRECTED 2026-08-21: the bMS does NOT enforce this ─────────────────────
 * This header used to say "a PATCH sent with any other media type is a 415" and
 * "twenty-one shipped write tools that could not have worked". **Both are false,
 * and both were inferences from the specification that nobody had tested.**
 *
 * Measured live against 26.1.161.0, through the full MCP path, with the only
 * wire difference being the header:
 *
 *   PATCH /jobs/v2.0/Folders/{id}, NONEXISTENT id, bare application/json -> 404
 *   PATCH /jobs/v2.0/Folders/{id}, NONEXISTENT id, json-patch+json       -> 404
 *   PATCH /jobs/v2.0/Folders/{id}, folder that EXISTS, bare application/json
 *                                                     -> **200, patch APPLIED**
 *
 * The first pair was run first and was NOT decisive: a 404 on a nonexistent
 * object cannot separate "the media type is never validated" from "it is
 * validated after the existence check". Settling it took a third call against an
 * object that exists — a throwaway folder created and deleted for the purpose.
 * It renamed the folder. **The media type is not validated at all, and the
 * twenty-one bare call sites would have worked.**
 *
 * ── So why does this guard still stand? ─────────────────────────────────────
 * Because sending what the operation DECLARES is correct independently of what
 * this build happens to accept, and the cost of doing so is one constant per
 * module. What changed is the claim, not the code: this is conformance to a
 * published contract, NOT a fix for a demonstrated failure. Do not restore the
 * stronger wording — it was believed for two days, shipped in a handoff banner,
 * and was wrong.
 *
 * Scope of the measurement: one route, one bMS build, three calls. Other
 * modules were not tested; the reasonable inference is that a server which
 * ignores the media type here ignores it everywhere, but that is inference.
 *
 * An earlier version of this header said "five of nine". That count came from
 * the FIRST version of this guard, which matched only the literal `.patch(` and
 * never saw the sixteen call sites written `.patch<Folder>(` with a type
 * parameter. The guard reported 9 of 25 sites clean and its own canary asserted
 * `>= 9`, a floor taken from what the broken parser had found — so the blind
 * spot and the expectation moved together. Both are fixed; the canary now counts
 * the population a second way and fails if the two disagree.
 *
 * ── Why it does NOT grep for the string ─────────────────────────────────────
 * Three checks got this wrong in one session, all by counting occurrences of
 * `json-patch+json` in a file:
 *
 *   1. `grep -l` said eight modules "set" it. Four of those eight make no PATCH
 *      call at all — they only name the media type inside a generated TYPE:
 *      `operations['X']['requestBody']['content']['application/json-patch+json']`.
 *   2. Counting occurrences per file said `variables` was fine: two mentions,
 *      two `.patch(` calls. Both mentions were those type aliases. Both calls
 *      were bare.
 *   3. After the `assets` fix replaced three inline literals with one named
 *      constant, a string check reported all three as bare — the fix removed
 *      the very text it was looking for.
 *
 * So this guard reads the CALL SITE, not the file: it brace-matches each
 * `.patch(` argument list, and resolves a bare identifier in the third position
 * back to its `const` in the same module. A file-level mention proves nothing
 * and is deliberately not consulted.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA_TYPE = 'application/json-patch+json';

interface PatchCall {
  module: string;
  line: number;
  argCount: number;
  thirdArg: string;
  sendsMediaType: boolean;
}

/** Module source files, discovered — never a hand-written list. */
function moduleFiles(): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('bconnect-')) { continue; }
    const dir = join(ROOT, entry.name, 'src', 'modules');
    if (!existsSync(dir)) { continue; }
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.ts') && !f.endsWith('.d.ts')) { out.push(join(dir, f)); }
    }
  }
  return out.sort();
}

/**
 * Split one call's argument list by brace-matching. Template literals and their
 * `${...}` holes are skipped, because the URL argument is full of both and a
 * naive comma split lands inside them.
 */
function splitArgs(src: string, openParen: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = openParen + 1;
  let inTemplate = false;
  let inString: string | null = null;
  for (let i = openParen; i < src.length; i++) {
    const c = src[i];
    const prev = src[i - 1];
    if (inString) {
      if (c === inString && prev !== '\\') { inString = null; }
      continue;
    }
    if (inTemplate) {
      if (c === '`' && prev !== '\\') { inTemplate = false; }
      else if (c === '{' && prev === '$') { depth++; }
      else if (c === '}' && depth > 0) { depth--; }
      continue;
    }
    if (c === '`') { inTemplate = true; continue; }
    if (c === '"' || c === "'") { inString = c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; }
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) { args.push(src.slice(start, i)); return args.map((a) => a.trim()); }
    } else if (c === ',' && depth === 1) {
      args.push(src.slice(start, i));
      start = i + 1;
    }
  }
  return args.map((a) => a.trim());
}

/** Resolve `FOO` to the text of `const FOO = …;` in the same file, if present. */
function resolveIdentifier(source: string, expr: string): string {
  if (!/^[A-Za-z_$][\w$]*$/.test(expr)) { return expr; }
  const decl = new RegExp(`const\\s+${expr}\\s*=\\s*([\\s\\S]*?);`, 'm').exec(source);
  return decl ? decl[1] : expr;
}

function patchCalls(): PatchCall[] {
  const found: PatchCall[] = [];
  for (const file of moduleFiles()) {
    const source = readFileSync(file, 'utf8');
    // `.patch(` AND `.patch<Folder>(`. The first version of this guard matched
    // only the former and so examined 9 of 25 call sites, reporting them all
    // clean — 16 PATCHes in endpoints, servermanagement, operatingsystems, jobs
    // and defensecontrol are written with an explicit type parameter and were
    // invisible to it. The canary below now cross-checks the count against a
    // second, independent counter for exactly this reason.
    const callRe = /\.patch\s*(?:<[^>]*>)?\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = callRe.exec(source)) !== null) {
      const at = m.index;
      const open = at + m[0].length - 1;
      const args = splitArgs(source, open);
      const third = args[2] ?? '';
      found.push({
        module: relative(ROOT, file).split(sep).join('/'),
        line: source.slice(0, at).split('\n').length,
        argCount: args.length,
        thirdArg: third,
        sendsMediaType: resolveIdentifier(source, third).includes(MEDIA_TYPE),
      });
      callRe.lastIndex = open;
    }
  }
  return found;
}

const CALLS = patchCalls();

describe('every module PATCH sends the only media type its routes accept', () => {
  it('finds the PATCH call sites at all — the canary', () => {
    // A parser bug returning nothing would make the assertion below vacuously
    // true, which is this repository's most-repeated defect. Pin the shape:
    // modules are discovered, and PATCH calls exist among them.
    expect(moduleFiles().length).toBeGreaterThanOrEqual(13);

    // Counted a SECOND way, by a different method, and required to agree. The
    // first version of this guard asserted `>= 9` — a floor taken from what its
    // own broken parser had found, so the parser's blind spot and the canary's
    // expectation moved together and neither could reveal the other.
    const naive = moduleFiles().reduce(
      (n, f) => n + (readFileSync(f, 'utf8').match(/\.patch\b/g) ?? []).length,
      0
    );
    expect(
      CALLS.length,
      `the argument parser found ${CALLS.length} PATCH call sites but a plain scan finds ` +
        `${naive}. A parser that silently skips a call form reports every site it CAN see as ` +
        `clean, which is what this guard exists to prevent.`
    ).toBe(naive);
    expect(CALLS.length).toBeGreaterThanOrEqual(25);
  });

  it('parses argument lists rather than counting mentions of the media type', () => {
    // The distinguishing case, and the one three earlier checks failed on: a
    // module that NAMES the media type in a generated type alias while passing
    // no config to .patch(). Every call must be seen to take three arguments.
    const wrongArity = CALLS.filter((c) => c.argCount < 3).map((c) => `${c.module}:${c.line}`);
    expect(
      wrongArity,
      `${wrongArity.length} PATCH call(s) pass no config object at all, so axios sends ` +
        `application/json and the route answers 415:\n  ${wrongArity.join('\n  ')}`
    ).toEqual([]);
  });

  it('no PATCH call omits the json-patch content type', () => {
    const bare = CALLS.filter((c) => !c.sendsMediaType).map(
      (c) => `${c.module}:${c.line} passes ${c.thirdArg || '(nothing)'}`
    );
    expect(
      bare,
      `${bare.length} of ${CALLS.length} PATCH call(s) do not send ${MEDIA_TYPE}. ` +
        `All 25 PATCH operations in the 26R1 specs accept that and nothing else, so each ` +
        `of these is a 415 on a shipped write tool:\n  ${bare.join('\n  ')}`
    ).toEqual([]);
  });

  it('resolves a named constant, so the fix may be shared rather than repeated', () => {
    // `assets` and `variables` both pass one JSON_PATCH_REQUEST constant instead
    // of three and two copies of the literal. A checker that only understood
    // inline literals would call those bare — one did.
    const viaConstant = CALLS.filter((c) => /^[A-Za-z_$][\w$]*$/.test(c.thirdArg));
    expect(viaConstant.length).toBeGreaterThan(0);
    expect(viaConstant.every((c) => c.sendsMediaType)).toBe(true);
  });
});
