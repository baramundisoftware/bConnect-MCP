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
 * An explicit env var always wins over its `_FILE` counterpart. This supplies
 * the gateway's single BCONNECT_* service credential from mounted secrets, and
 * (SEC-7) the shared bearer token callers authenticate with.
 */

import fs from "fs";

/**
 * Credential env vars that may be supplied as `<VAR>_FILE` Docker secrets.
 *
 * MCP_GATEWAY_AUTH_TOKEN is here because it is a secret in exactly the same
 * sense as the bMS password: it appears in `docker inspect` and in the process
 * environment when passed as a variable, and an operator who has gone to the
 * trouble of using Docker secrets for one should not have to special-case the
 * other.
 */
export const SECRET_ENV_KEYS = [
  "BCONNECT_USERNAME",
  "BCONNECT_PASSWORD",
  "BCONNECT_API_KEY",
  "MCP_GATEWAY_AUTH_TOKEN",
];

/**
 * The same convention for the opt-in per-domain credentials.
 *
 * Generated from the caller's domain list rather than hand-listed, because a
 * parallel list is what drifts the day a fourteenth server is added — and the
 * deployment that most needs this feature is a container in a DMZ, where a
 * credential visible in `docker inspect` is exactly what a Docker secret exists
 * to avoid. Without the expansion the feature is unusable there.
 */
export function secretEnvKeysWithDomains(perDomainKeys: readonly string[]): string[] {
  return [...SECRET_ENV_KEYS, ...perDomainKeys];
}

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
