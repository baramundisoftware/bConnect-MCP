/**
 * bconnect-mcp-gateway — file-based secrets (audit M2).
 */

import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { resolveFileSecrets } from "../secrets.js";

// A private directory per run (unique name, owner-only), not a fixed name in the shared temp dir.
const dir = mkdtempSync(join(tmpdir(), "gw-secrets-"));

function tmp(name: string, content: string): string {
  const p = join(dir, name);
  writeFileSync(p, content, { encoding: "utf8", mode: 0o600 });
  return p;
}

describe("resolveFileSecrets", () => {
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it("reads <KEY>_FILE into <KEY> and trims whitespace", () => {
    const p = tmp("m2-pw.secret", "  s3cr3t\n");
    const env: NodeJS.ProcessEnv = { BCONNECT_PASSWORD_FILE: p };
    resolveFileSecrets(["BCONNECT_PASSWORD"], env);
    expect(env.BCONNECT_PASSWORD).toBe("s3cr3t");
  });

  it("does not overwrite an explicit env var (env wins over _FILE)", () => {
    const p = tmp("m2-pw2.secret", "from-file");
    const env: NodeJS.ProcessEnv = { BCONNECT_PASSWORD: "from-env", BCONNECT_PASSWORD_FILE: p };
    resolveFileSecrets(["BCONNECT_PASSWORD"], env);
    expect(env.BCONNECT_PASSWORD).toBe("from-env");
  });

  it("is a no-op when neither var is set", () => {
    const env: NodeJS.ProcessEnv = {};
    resolveFileSecrets(["BCONNECT_API_KEY"], env);
    expect(env.BCONNECT_API_KEY).toBeUndefined();
  });

  it("throws if the referenced file is missing", () => {
    const env: NodeJS.ProcessEnv = { BCONNECT_API_KEY_FILE: "/nonexistent/__m2_missing" };
    expect(() => resolveFileSecrets(["BCONNECT_API_KEY"], env)).toThrow();
  });
});
