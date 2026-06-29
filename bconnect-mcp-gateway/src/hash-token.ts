#!/usr/bin/env node
/**
 * hash-token — print the SHA-256 hex of a Bearer token (audit M1).
 *
 * Use the output as the KEY in a hashed tokens.json so raw tokens are never
 * stored at rest:
 *
 *   node build/hash-token.js tok_alice_<random>
 *   → 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
 *
 *   {
 *     "9f86d081…": { "apiKey": "…" }
 *   }
 */

import { hashToken } from "./auth.js";

const token = process.argv[2];
if (!token) {
  console.error("Usage: node build/hash-token.js <bearer-token>");
  process.exit(2);
}
process.stdout.write(hashToken(token) + "\n");
