#!/usr/bin/env node
/**
 * Build the publication tree from THIS repository, reproducibly.
 *
 * ── Why a script and not a procedure document ───────────────────────────────
 * The last cut was made by hand: the layout move, twelve path derivations and
 * an estate scrub across 84 files, "verified by an independent sweep". It went
 * stale at 215 commits and could not be refreshed, only regenerated — and
 * regenerating meant redoing the hand work. A cut you cannot re-run is a cut
 * that will be stale the day after it is made.
 *
 * ── What it does ────────────────────────────────────────────────────────────
 *   1. Exports TRACKED files only, via `git archive`. Never copies the working
 *      tree: build/, node_modules/ and local scratch files cannot leak in,
 *      because git is asked what the repository contains rather than the disk.
 *   2. Moves the layout — the suite subtree becomes the ROOT, so GitHub renders
 *      the seven health files it currently cannot see, and `install/` moves
 *      INSIDE the tree.
 *   3. Removes the paths declared in publication-omit.json, which the guards
 *      read too, so "not in this cut" and "exemption gone stale" stay
 *      distinguishable.
 *
 * The estate scrub is a SEPARATE step (scrub-estate.mjs) with its own guard, so
 * that a cut which forgot to scrub fails loudly rather than shipping.
 *
 * Usage: node scripts/make-publication-cut.mjs <destination>
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SUITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = process.argv[2];

if (!dest) {
  console.error("usage: node scripts/make-publication-cut.mjs <destination>");
  process.exit(1);
}

const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: SUITE,
  encoding: "utf8",
}).trim();

// The suite's directory name inside the repository, derived rather than written
// down — the exact assumption that broke the guard this cut had to fix.
const suiteRel = execFileSync("git", ["rev-parse", "--show-prefix"], {
  cwd: SUITE,
  encoding: "utf8",
}).trim().replace(/\/$/, "");

if (!suiteRel) {
  console.error("refusing to cut: the suite appears to BE the repository root already");
  process.exit(2);
}

const status = execFileSync("git", ["status", "--porcelain"], { cwd: top, encoding: "utf8" });
if (status.trim()) {
  console.error("refusing to cut: the working tree is dirty. A cut must be reproducible");
  console.error("from a commit, or nobody can say which sources it came from.");
  process.exit(2);
}

const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: top, encoding: "utf8" }).trim();

if (existsSync(dest) && readdirSync(dest).length > 0) {
  console.error("refusing to cut: " + dest + " exists and is not empty");
  process.exit(2);
}
mkdirSync(dest, { recursive: true });

function exportPath(prefix, stripComponents) {
  const tar = execFileSync(
    "git",
    ["archive", "--format=tar", head, prefix],
    { cwd: top, maxBuffer: 1 << 30, encoding: "buffer" }
  );
  const args = ["-x", "-C", dest];
  if (stripComponents) args.push("--strip-components=" + stripComponents);
  execFileSync("tar", args, { input: tar, maxBuffer: 1 << 30 });
}

console.log("cutting from " + head.slice(0, 12) + " (" + suiteRel + " -> root)");
exportPath(suiteRel, 1);
if (existsSync(join(top, "install"))) {
  exportPath("install", 0);
  console.log("  install/ moved inside the tree");
}

// ── Apply the declared omissions ────────────────────────────────────────────
const declPath = join(dest, "publication-omit.json");
if (!existsSync(declPath)) {
  console.error("refusing to cut: publication-omit.json is not in the exported tree.");
  console.error("The guards read it to tell 'not in this cut' from 'exemption stale'.");
  process.exit(2);
}
const declaration = JSON.parse(readFileSync(declPath, "utf8"));
const omit = declaration.omit;

// ── Bring in what the flat layout needs from OUTSIDE the subtree ────────────
for (const entry of declaration.includeFromRoot ?? []) {
  if (!existsSync(join(top, entry))) {
    console.error("refusing to cut: declared includeFromRoot path is missing: " + entry);
    process.exit(2);
  }
  exportPath(entry, 0);
  console.log("  included from repository root: " + entry);
}

// The workflow was written for the working repository, where the suite is one
// level down. Here the suite IS the root, so those two paths have to change or
// CI runs `npm ci` in a directory that does not exist. Derived from `suiteRel`
// rather than written down, for the same reason the guard now derives its own.
const workflow = join(dest, ".github", "workflows", "ci.yml");
if (existsSync(workflow)) {
  const before = readFileSync(workflow, "utf8");
  const after = before
    .replaceAll("working-directory: " + suiteRel, "working-directory: .")
    .replaceAll("cache-dependency-path: " + suiteRel + "/", "cache-dependency-path: ");
  if (after !== before) {
    writeFileSync(workflow, after, "utf8");
    console.log("  ci.yml re-pathed for the flat layout");
  }
}

let removed = 0;
for (const entry of omit) {
  const target = join(dest, entry);
  if (!existsSync(target)) {
    console.log("  (already absent) " + entry);
    continue;
  }
  rmSync(target, { recursive: true, force: true });
  console.log("  removed " + entry);
  removed++;
}

// ── Provenance marker ───────────────────────────────────────────────────────
// Records which commit this came from, and tells suite-no-estate-identifiers
// that it is looking at a cut and must therefore ENFORCE. Without it that guard
// cannot distinguish a cut from the working repository, where the estate
// identifiers legitimately exist.
writeFileSync(
  join(dest, ".publication-cut"),
  ["source-commit: " + head, "suite-subtree: " + suiteRel, ""].join("\n"),
  "utf8"
);
console.log("  .publication-cut written (source commit recorded)");

console.log("");
console.log("cut complete: " + dest);
console.log("  omissions applied: " + removed + " of " + omit.length + " declared");
console.log("");
console.log("NEXT: node scripts/scrub-estate.mjs " + dest);
console.log("      then git init + commit, then the gate.");
