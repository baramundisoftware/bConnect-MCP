/**
 * bconnect-mcp-gateway — file-based secrets (audit M2).
 *
 * Supports the standard Docker/Compose `*_FILE` convention: instead of passing a
 * credential as an environment variable (visible in `docker inspect` and the
 * process env), mount it as a file (a Docker secret) and point `<VAR>_FILE` at
 * it. At startup the gateway reads each file into the corresponding env var.
 *
 *   BCONNECT_PASSWORD_FILE=/run/secrets/bms_password   →   BCONNECT_PASSWORD=<file contents>
 *
 * An explicit env var always wins over its `_FILE` counterpart.
 * (The token map is already file-mounted via MCP_AUTH_CONFIG — this covers the
 * single-credential fallback path.)
 */

import fs from "fs";

/** Credential env vars that may be supplied as `<VAR>_FILE` Docker secrets. */
export const SECRET_ENV_KEYS = ["BCONNECT_USERNAME", "BCONNECT_PASSWORD", "BCONNECT_API_KEY"];

/**
 * For each key, if `<key>_FILE` is set and `<key>` is not, read the file and
 * populate `<key>`. Throws if a referenced file cannot be read.
 */
export function resolveFileSecrets(keys: string[] = SECRET_ENV_KEYS, env: NodeJS.ProcessEnv = process.env): void {
  for (const key of keys) {
    const fileVar = `${key}_FILE`;
    const filePath = env[fileVar];
    if (filePath && !env[key]) {
      env[key] = fs.readFileSync(filePath, "utf8").trim();
    }
  }
}
