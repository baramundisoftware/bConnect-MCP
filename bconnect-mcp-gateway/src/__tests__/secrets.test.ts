/**
 * bconnect-mcp-gateway — file-based secrets (audit M2).
 */

import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { resolveFileSecrets, SECRET_ENV_KEYS } from "../secrets.js";
import { resolveAuthConfig } from "../auth.js";

function tmp(name: string, content: string): string {
  const p = join(tmpdir(), name);
  writeFileSync(p, content, "utf8");
  return p;
}

describe("resolveFileSecrets", () => {
  const created: string[] = [];
  afterEach(() => {
    for (const p of created.splice(0)) { try { unlinkSync(p); } catch { /* ignore */ } }
  });

  it("reads <KEY>_FILE into <KEY> and trims whitespace", () => {
    const p = tmp("m2-pw.secret", "  s3cr3t\n");
    created.push(p);
    const env: NodeJS.ProcessEnv = { BCONNECT_PASSWORD_FILE: p };
    resolveFileSecrets(["BCONNECT_PASSWORD"], env);
    expect(env.BCONNECT_PASSWORD).toBe("s3cr3t");
  });

  it("does not overwrite an explicit env var (env wins over _FILE)", () => {
    const p = tmp("m2-pw2.secret", "from-file");
    created.push(p);
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

  // SEC-7 — the gateway's bearer token is a secret in the same sense as the bMS
  // password: passed as a variable it shows up in `docker inspect`. INSTALL.md
  // tells operators MCP_GATEWAY_AUTH_TOKEN_FILE works, so it has to.
  it("covers MCP_GATEWAY_AUTH_TOKEN by default", () => {
    expect(SECRET_ENV_KEYS).toContain("MCP_GATEWAY_AUTH_TOKEN");
  });

  it("hydrates MCP_GATEWAY_AUTH_TOKEN from a mounted Docker secret", () => {
    const value = "mounted-secret-token-of-sufficient-length";
    const p = tmp("sec7-token.secret", `${value}\n`);
    created.push(p);
    const env: NodeJS.ProcessEnv = { MCP_GATEWAY_AUTH_TOKEN_FILE: p };
    resolveFileSecrets(SECRET_ENV_KEYS, env);
    expect(env.MCP_GATEWAY_AUTH_TOKEN).toBe(value);
    // And the auth layer accepts what the secrets layer produced — the trailing
    // newline a `printf` or an editor leaves must not become part of the token.
    expect(resolveAuthConfig(env).tokens).toEqual([value]);
  });
});
