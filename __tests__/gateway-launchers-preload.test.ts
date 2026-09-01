/**
 * Every shipped way of starting the gateway must load the preload.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `bconnect-mcp-gateway/src/preload.ts` sets `VITEST` before any server module
 * loads, so that importing fourteen servers does not also RUN their fourteen
 * stdio entrypoints (`shouldAutoStart()` is `env.VITEST === undefined`). It is
 * one line, it is load-bearing, and until 2026-08-22 nothing checked that the
 * things which actually launch the gateway used it.
 *
 * MEASURED, not imagined — this guard was written from a live mistake. The
 * gateway was started during the gateway review as:
 *
 *     node build/gateway.js            # no --import ./build/preload.js
 *
 * It LISTENED, answered /health, proxied a real bMS read, and looked entirely
 * healthy. It had also started fourteen stdio servers inside the same process,
 * each attaching handlers to stdin, which Node reported as:
 *
 *     MaxListenersExceededWarning: 11 data listeners added to [ReadStream]
 *     MaxListenersExceededWarning: 11 error listeners added to [ReadStream]
 *
 * and fourteen `… started on stdio` lines interleaved with the gateway's own
 * startup. Relaunched WITH the preload: zero stdio servers, zero warnings.
 *
 * That failure mode is the dangerous kind — it succeeds. A broken launcher does
 * not crash; it serves traffic while fourteen unwanted transports fight over
 * stdin in the background. No test would have caught it, because the tests
 * never launch a real process; the invariant lived only in three hand-written
 * strings that happened to be right.
 *
 * ── Why it discovers rather than lists ──────────────────────────────────────
 * A hand-written list of launchers is the same defect this suite already has a
 * guard for (`suite-no-hardcoded-server-lists`) — and this file would be the
 * next instance. So it asks git for every tracked file that names the gateway
 * entrypoint and judges each one, which means a launcher added in a new file
 * (a systemd unit, a helm chart, a second compose file) is covered on the day
 * it is written rather than the day someone remembers this test.
 *
 * ── What counts as a launcher ───────────────────────────────────────────────
 * A line that names the entrypoint AND invokes node on it. Two kinds of line
 * name the entrypoint WITHOUT launching it, and both must stay legal:
 *   - `"main": "build/gateway.js"` — a package.json field, not a command.
 *   - `Usage: node --import …` in preload.ts's own header — prose, and it
 *     carries the preload anyway.
 * The `node` requirement is what separates them, and the vacuity check below
 * pins that this file can still SEE the real launchers.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(__dirname, '..');

/**
 * A tracked file's path relative to the SUITE ROOT, POSIX, identical in every
 * layout this tree is checked out as.
 *
 * `install/` sits BESIDE the suite in the working repository and INSIDE it in
 * the publication cut, and git's toplevel is the repository — not the suite —
 * so a naive `file.slice(ROOT.length + 1)` yields an EMPTY name for every file
 * above the suite. That is not hypothetical: the first run of this guard
 * reported its real finding as `":445  …"`, with no filename, and the offender
 * had to be hunted by hand. `suite-no-hardcoded-server-lists` records the same
 * derivation costing it two separate failures; this is the third instance, so
 * it is spelled the same way here rather than re-invented.
 */
function suiteRelative(file: string): string {
  return relative(ROOT, file)
    .split(sep)
    .join('/')
    .replace(/^(?:\.\.\/)+/, '');
}

/** The compiled entrypoint every launcher names, and its preload. */
const ENTRY = 'gateway.js';
const PRELOAD = 'preload.js';

/**
 * Tracked files, from git rather than from a directory walk.
 *
 * Same reason `suite-no-hardcoded-server-lists` does it: a walk answers a
 * question about somebody's disk — a scratch launcher lying in the working
 * tree would fail this guard on one machine and pass on every clone.
 */
function trackedFiles(): string[] {
  let top: string;
  let list: string;
  try {
    top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    list = execFileSync('git', ['ls-files', '-z'], {
      cwd: top, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (err) {
    // Never a silent skip: without git this guard cannot tell a repository file
    // from local scratch, and guessing is the defect it exists to catch.
    throw new Error(
      'gateway-launchers-preload needs git to tell tracked files from untracked ' +
        'ones, and git is unavailable here: ' + String(err)
    );
  }
  const files = list.split(String.fromCharCode(0)).filter(Boolean);
  if (files.length === 0) {
    throw new Error('git ls-files returned nothing — refusing to scan an empty set');
  }
  return files.map((rel) => join(top, rel));
}

/** Text files that are plausibly launchers or docs. Binary and build output excluded. */
const SCANNABLE = /\.(json|ya?ml|sh|ps1|md|ts|mjs|js|cmd|bat)$|Dockerfile|Makefile/i;

/**
 * The lines of a file that could actually LAUNCH something.
 *
 * A command written in prose is not a launcher, and this guard learned that the
 * hard way: once it was committed it began scanning itself and HANDOFF.md, and
 * flagged its own explanatory comment plus a sentence describing the mistake
 * that produced it. Both "offenders" were text ABOUT the command.
 *
 * The distinction each format needs:
 *   .ts/.js/.mjs   strip comments — prose about the mechanism is not it
 *   .md            keep ONLY fenced code blocks; a command a reader is told to
 *                  run lives in a fence, a command being discussed does not
 *   shell-ish      drop whole-line # comments
 *   .json          no comment syntax; scan as-is
 *
 * This is the same lesson as the mock tier's honest-skip guard, which had to
 * learn that a `return` inside `beforeAll` is not the `return` it hunts. An
 * instrument that cannot tell its subject from a description of its subject
 * reports on the wrong thing.
 */
function launchableLines(file: string, source: string): { line: number; text: string }[] {
  const lines = source.split(/\r?\n/);

  if (/\.md$/i.test(file)) {
    const out: { line: number; text: string }[] = [];
    let inFence = false;
    lines.forEach((text, i) => {
      if (/^\s*```/.test(text)) { inFence = !inFence; return; }
      if (inFence) { out.push({ line: i + 1, text }); }
    });
    return out;
  }

  if (/\.(ts|mjs|js)$/i.test(file)) {
    // Block comments can span lines, so they are blanked in place to keep the
    // line numbers of everything else honest.
    const blanked = source
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .split(/\r?\n/)
      .map((text) => text.replace(/\/\/.*$/, ''));
    return blanked.map((text, i) => ({ line: i + 1, text }));
  }

  if (/\.(sh|ps1|ya?ml)$|Dockerfile|Makefile/i.test(file)) {
    return lines
      .map((text, i) => ({ line: i + 1, text }))
      .filter((l) => !/^\s*#/.test(l.text));
  }

  return lines.map((text, i) => ({ line: i + 1, text }));
}

/**
 * Source with comments removed, so PROSE about the mechanism is never mistaken
 * for the mechanism.
 *
 * Found by mutating: `preload.ts` was changed to set a different variable
 * entirely, and the third assertion below still PASSED — because the file's own
 * header comment contains `process.env.VITEST === undefined` while explaining
 * what the servers read. The guard was reading the explanation, not the code.
 * `suite-no-hardcoded-server-lists` strips comments for exactly this reason;
 * this file now does the same.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

interface LaunchLine {
  file: string;
  line: number;
  text: string;
  loadsPreload: boolean;
}

function launcherLines(): LaunchLine[] {
  const found: LaunchLine[] = [];
  for (const file of trackedFiles()) {
    if (!SCANNABLE.test(file)) {continue;}
    // The compiled output is not tracked, but be explicit anyway.
    if (file.includes(`${sep}build${sep}`)) {continue;}
    if (!existsSync(file)) {continue;}
    let source: string;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (!source.includes(ENTRY)) {continue;}

    for (const { line, text } of launchableLines(file, source)) {
      if (!text.includes(ENTRY)) {continue;}
      // A launcher INVOKES node on the entrypoint. A package.json "main" field
      // names it without running it, and must stay legal.
      if (!/\bnode\b/.test(text)) {continue;}
      found.push({
        file: suiteRelative(file),
        line,
        text: text.trim(),
        loadsPreload: text.includes(PRELOAD),
      });
    }
  }
  return found;
}

describe('every shipped way of starting the gateway loads the preload', () => {
  const lines = launcherLines();

  it('finds the launchers at all — the canary', () => {
    // Counted a SECOND way, and the two must agree. A guard whose only check is
    // "no offenders" passes just as happily when it found nothing to judge —
    // this project's own `CALLS.length >= 9` floor moved in lockstep with the
    // blind spot it was supposed to catch.
    expect(
      lines.length,
      'no gateway launch command was found — the scan is broken, and every ' +
        'assertion below would pass for the wrong reason'
    ).toBeGreaterThanOrEqual(4);

    // Every path a name must be derivable for. An empty or absolute name means
    // the derivation stopped matching this layout, which on the first run of
    // this guard turned a real finding into `":445"` with no file to open.
    const unnamed = lines.filter(
      (l) => l.file === '' || l.file.startsWith('/') || /^[A-Za-z]:/.test(l.file) || l.file.includes(sep === '/' ? '\\' : '\\')
    );
    expect(
      unnamed.map((l) => `${l.file}:${l.line}`),
      'these launch lines have no usable repo-relative name, so a failure ' +
        'below would not say which file to open'
    ).toEqual([]);

    // The four that must exist by name, because they are the shipped paths a
    // customer actually uses: the container, `npm start`, and BOTH installation
    // documents. If one is RENAMED this fails and asks a human to look — which
    // is correct: a launcher moving is exactly when to re-check it.
    const files = new Set(lines.map((l) => l.file));
    for (const expected of [
      'bconnect-mcp-gateway/Dockerfile',
      'bconnect-mcp-gateway/package.json',
      'docs/INSTALLATION.md',
      'install/INSTALL.md',
    ]) {
      expect(
        files.has(expected),
        `${expected} no longer contains a gateway launch command. If it moved, ` +
          `update this list; if it was deleted, say so here.`
      ).toBe(true);
    }
  });

  it('has no launcher that starts the gateway without the preload', () => {
    const offenders = lines
      .filter((l) => !l.loadsPreload)
      .map((l) => `${l.file}:${l.line}  ${l.text}`);

    expect(
      offenders,
      'a gateway launched without `--import ./build/preload.js` still LISTENS ' +
        'and still serves traffic — it just also starts fourteen stdio servers ' +
        'inside the same process, fighting over stdin ' +
        '(measured 2026-08-22: 14 "started on stdio" lines and two ' +
        'MaxListenersExceededWarnings for 11 stdin listeners). It fails by ' +
        'succeeding, which is why this is checked rather than remembered.'
    ).toEqual([]);
  });

  it('the preload still does the thing the launchers depend on', () => {
    // The other half of the invariant. Launchers loading a preload that no
    // longer suppresses the entrypoints would satisfy the check above and fix
    // nothing — the same "both halves must hold" shape as the estate-scrub
    // guard asserting its own hash list is non-empty.
    const preloadSrc = code(readFileSync(
      join(ROOT, 'bconnect-mcp-gateway', 'src', 'preload.ts'), 'utf8'
    ));
    expect(
      /process\.env\.VITEST\s*=[^=]/.test(preloadSrc),
      'preload.ts no longer sets VITEST, so loading it no longer stops the ' +
        'fourteen server entrypoints from running inside the gateway process.'
    ).toBe(true);

    // And that the mechanism it drives is still the one the servers read.
    const runServerSrc = code(readFileSync(
      join(ROOT, 'packages', 'mcp-core', 'src', 'run-server.ts'), 'utf8'
    ));
    expect(
      /env\.VITEST === undefined/.test(runServerSrc),
      'shouldAutoStart no longer keys on VITEST === undefined, so preload.ts ' +
        'sets a variable nothing reads.'
    ).toBe(true);
  });
});
