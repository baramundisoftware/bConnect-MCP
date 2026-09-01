/**
 * Emitted text must not cite internal identifiers or make claims about the
 * estate it was developed against.
 *
 * ── Why this is a test and not a review note ────────────────────────────────
 * Two different hazards share one shape, and both had shipped:
 *
 *  1. **Internal finding ids in tool output.** `libraryUnavailable` ended with
 *     "an API-side failure reported as success (finding B10)", and scan-recency
 *     notes cited "upstream D17". A customer has no document those resolve
 *     against. They read as leaked internal notes inside a vendor tool's answer
 *     about their own production estate, and they cost the reader confidence in
 *     every other sentence in the response.
 *  2. **Claims measured somewhere else, phrased as claims about here.** "on this
 *     estate" in emitted prose means the reader's estate to the reader. When the
 *     sentence actually records something measured on the development lab, the
 *     model relays a confident, specific and possibly wrong statement about a
 *     system nobody here has seen.
 *
 * Comments are exempt on purpose. That is where the finding ids belong and where
 * the measurements should be recorded; the rule is only that they must not cross
 * into anything a caller reads.
 *
 * The scan is over source rather than over captured responses because the
 * failure is per-branch: a string on the path this suite happens not to exercise
 * is exactly the one that reaches a customer during an outage.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");

/** Directories whose contents are never emitted to a caller. */
const SKIP_DIRS = new Set(["__tests__", "generated", "build", "node_modules"]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) {
        out.push(...sourceFiles(full));
      }
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every string and template literal in a TypeScript source, with comments
 * removed. Deliberately crude: it tracks quote state rather than parsing, which
 * is enough because the question is only "does this text reach a caller", and
 * over-collecting (interpolation bodies count as string content) fails safe.
 */
function stringLiterals(src: string): string[] {
  const out: string[] = [];
  let mode: "code" | "line" | "block" | "'" | '"' | "`" = "code";
  let buf = "";
  let i = 0;

  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];

    if (mode === "code") {
      if (c === "/" && next === "/") { mode = "line"; i += 2; continue; }
      if (c === "/" && next === "*") { mode = "block"; i += 2; continue; }
      if (c === "'" || c === '"' || c === "`") { mode = c; buf = ""; i++; continue; }
      i++;
      continue;
    }
    if (mode === "line") {
      if (c === "\n") { mode = "code"; }
      i++;
      continue;
    }
    if (mode === "block") {
      if (c === "*" && next === "/") { mode = "code"; i += 2; continue; }
      i++;
      continue;
    }
    // Inside a string or template literal.
    if (c === "\\") { buf += src.slice(i, i + 2); i += 2; continue; }
    if (c === mode) { out.push(buf); mode = "code"; i++; continue; }
    buf += c;
    i++;
  }
  return out;
}

/**
 * Internal identifiers used across this project's evaluation rounds. They are
 * legitimate in comments and meaningless — worse, alarming — in output.
 */
const FINDING_ID =
  /\b(?:[DBHMCR]\d{1,2}|P0-NEW|PER-\d+|TOK-\d+|SEC-\d+|INT4?-\d+|OPT-\d+|ARCH-\d+|AUD-[a-z]+-\d+)\b/;

/** Prose that turns a measurement made elsewhere into an assertion about here. */
const ESTATE_CLAIM = /\b(?:this|our)\s+estate\b|labcorp|\bWIN1[01]CLIENT|\bA-DC-01\b/i;

const FILES = sourceFiles(SRC);

describe("emitted text hygiene", () => {
  it("scans a non-trivial number of source files", () => {
    // A broken walk that finds nothing would make every assertion below vacuous.
    expect(FILES.length).toBeGreaterThan(3);
  });

  it("extracts string literals while ignoring comments", () => {
    const sample = `// "in a line comment"\n/* "in a block comment" */\nconst a = "kept"; const b = \`also \${x} kept\`;`;
    expect(stringLiterals(sample)).toEqual(["kept", "also ${x} kept"]);
  });

  it("cites no internal finding identifier in any emitted string", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      for (const literal of stringLiterals(readFileSync(file, "utf8"))) {
        const hit = FINDING_ID.exec(literal);
        if (hit) {
          offenders.push(`${path.relative(SRC, file)}: ${hit[0]} in ${JSON.stringify(literal.slice(0, 120))}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("asserts nothing about 'this estate' and names no development-lab host", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      for (const literal of stringLiterals(readFileSync(file, "utf8"))) {
        const hit = ESTATE_CLAIM.exec(literal);
        if (hit) {
          offenders.push(`${path.relative(SRC, file)}: ${hit[0]} in ${JSON.stringify(literal.slice(0, 120))}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
