// Single source of truth for where the bConnect credentials live.
//
// The file is kept OUTSIDE the suite's working tree. File-level ACLs could not
// hold: editors save by writing a temp file and renaming over the original, so
// the recreated file re-inherited BUILTIN\Users:(RX) from the repo directory
// every single time (finding F10). Hardening the *directory* fixes it — new
// files there inherit the restrictive ACL, and it survives an atomic save
// (verified).
//
// ── Why the path is derived rather than written down ────────────────────────
// It used to be an absolute path to one development machine, and that string
// was the DEFAULT — so the published tree shipped a credential path that
// disclosed that machine's layout and existed for nobody who cloned it.
//
// `secrets/` sits BESIDE the suite in the working repository and INSIDE the tree
// in a publication cut, whose root IS the suite. Both are tried, and the
// in-tree path is the fallback because that is where someone cloning this would
// put it. Same two-layout question as `install/`, `ci.yml`, and three guards.
//
// Set BCONNECT_ENV_FILE to point anywhere else; that override is unchanged and
// is the documented way to keep credentials outside the tree entirely.

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * The suite root, for locating server build output.
 *
 * Named REPO_ROOT for its callers' sake and kept that way deliberately: in a
 * publication cut the suite root IS the repository root, and in the working
 * repository it is one level down. What every caller actually wants is the
 * directory holding the `bconnect-*-mcp` workspaces, which is this either way.
 */
export const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

// IN-TREE FIRST, and the order is the point. The other candidate is a SIBLING
// directory, so it matches anything named `secrets/` that happens to sit beside
// wherever the tree was cloned — measured here, where an unrelated
// `C:\secrets\bconnect.env` on the machine was picked up by a cut sitting at
// `C:\bconnect-publication`. Someone who puts credentials in the tree, at the
// path .gitignore covers and this file documents, should not be quietly
// overridden by a directory they may not know exists.
//
// This changes nothing for the working repository, where the in-tree path does
// not exist and the sibling is found exactly as before.
const CANDIDATES = [
  // A publication cut, and anyone who clones it: secrets/ inside the tree.
  resolve(REPO_ROOT, 'secrets', 'bconnect.env'),
  // Working repository: secrets/ beside the suite.
  resolve(REPO_ROOT, '..', 'secrets', 'bconnect.env'),
];

/** Absolute path to the env file holding bConnect credentials. */
export const ENV_FILE =
  process.env.BCONNECT_ENV_FILE ??
  CANDIDATES.find(existsSync) ??
  resolve(REPO_ROOT, 'secrets', 'bconnect.env');
