/**
 * Optional per-server bMS credentials for the stdio deployment.
 *
 * ── The shape this fixes ────────────────────────────────────────────────────
 * A local install runs thirteen servers that all read one ambient
 * `BCONNECT_*` credential, so the server that only answers "how many endpoints
 * are there" holds exactly the rights of the server that assigns jobs.
 * Measured on the reference deployment 2026-08-11: 13 servers, one credential,
 * and that credential can read the estate's entire security configuration.
 * That is the same single-credential shape `MCP_GATEWAY_DOMAIN_CREDENTIALS`
 * addresses for the gateway — it is a deployment-shape problem, not a gateway
 * problem, and it deserves the same answer in both places.
 *
 * ── Why an environment variable and not a config file entry ─────────────────
 * `install/lib/host-emitters.mjs` defines HOST_CONFIG_ENV_ALLOWLIST, a CLOSED
 * allowlist of what may be written into a client's configuration file:
 * ALLOW_WRITE_OPERATIONS, ALLOWED_WRITE_TOOLS, BCONNECT_ENABLE_V11.
 * Credentials are excluded on purpose — client configs are plaintext JSON in
 * roaming profiles. So a per-server key lives in the ENVIRONMENT, where the
 * shared one already lives, and nothing about that guard changes.
 *
 * ── One convention, both deployments ────────────────────────────────────────
 * The gateway already names these `BCONNECT_API_KEY__COMPLIANCE`
 * (domain-credentials.ts). This is the same spelling for the stdio side, so a
 * deployer learns the rule once:
 *
 *     BCONNECT_API_KEY            the one key — all most deployments ever set
 *     BCONNECT_API_KEY__JOBS      optional, and only for the servers that need
 *                                 different rights
 *
 * ── Opt-in by construction ──────────────────────────────────────────────────
 * With no `__<SERVER>` variable set, `resolveServerScopedCredentials` returns
 * undefined and the caller resolves exactly as it did before this file
 * existed. A deployment that wants one key sets one key and never meets any of
 * this — which is the point: a security option nobody can understand is a
 * security option nobody enables.
 *
 * ── Precedence, and why it is this way round ────────────────────────────────
 *     credentials passed to createServer()   (the gateway injects these)
 *   > BCONNECT_*__<SERVER>                   (this file)
 *   > BCONNECT_*                             (the shared key)
 *
 * Injected credentials win because the gateway has already decided per domain
 * and must not be second-guessed by the ambient environment of the box it runs
 * on. Everything else is "most specific wins", which is the only ordering a
 * reader guesses correctly.
 */

/** A credential set, structurally identical to BConnectCredentialOverrides. */
export interface ServerScopedCredentials {
  baseUrl?: string;
  username?: string;
  password?: string;
  apiKey?: string;
}

/**
 * `bconnect-jobs-mcp` -> `JOBS`; `bconnect-universaldynamicgroups-mcp` ->
 * `UNIVERSALDYNAMICGROUPS`. Matches the gateway's domain names exactly, which
 * is what lets one convention cover both deployments.
 *
 * Accepts a bare domain too (`jobs`), so a caller that already knows its
 * domain need not fabricate a package name to ask.
 */
export function serverScope(serverName: string): string {
  return serverName
    .replace(/^bconnect-/i, "")
    .replace(/-mcp$/i, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
}

/** The four per-server variable names for one server. */
export function serverScopedEnvKeys(serverName: string): {
  baseUrl: string;
  username: string;
  password: string;
  apiKey: string;
} {
  const suffix = `__${serverScope(serverName)}`;
  return {
    baseUrl: `BCONNECT_BASE_URL${suffix}`,
    username: `BCONNECT_USERNAME${suffix}`,
    password: `BCONNECT_PASSWORD${suffix}`,
    apiKey: `BCONNECT_API_KEY${suffix}`,
  };
}

/**
 * This server's own credentials, or undefined to mean "use the shared ones".
 *
 * A base URL alone is NOT a credential: a server given only a URL has been told
 * where to go, not who to be. Returning a credential-less object there would
 * silently pin it to the shared identity while looking configured — the same
 * trap `hasDomainCredential` avoids on the gateway side.
 */
export function resolveServerScopedCredentials(
  serverName: string,
  env: NodeJS.ProcessEnv = process.env,
): ServerScopedCredentials | undefined {
  const k = serverScopedEnvKeys(serverName);
  const apiKey = env[k.apiKey];
  const username = env[k.username];
  const password = env[k.password];

  const hasCredential = Boolean(apiKey ?? (username && password));
  if (!hasCredential) {
    return undefined;
  }

  return {
    // Falls back to the shared base URL: pointing one server at a different bMS
    // is a real multi-tenant shape, but it is not what most callers of this
    // mean, and requiring both variables to be repeated invites a mismatch.
    baseUrl: env[k.baseUrl] ?? env.BCONNECT_BASE_URL,
    username,
    password,
    apiKey,
  };
}

/**
 * A one-line, value-free description of where a server's credential came from,
 * for startup diagnostics.
 *
 * Names VARIABLES, never values — `suite-credential-containment` exists
 * because a check that greps for the variable name passes while the value
 * leaks.
 */
export function describeCredentialSource(
  serverName: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const k = serverScopedEnvKeys(serverName);
  if (env[k.apiKey]) { return `${k.apiKey} (per-server)`; }
  if (env[k.username] && env[k.password]) { return `${k.username}+${k.password} (per-server)`; }
  if (env.BCONNECT_API_KEY) { return "BCONNECT_API_KEY (shared)"; }
  if (env.BCONNECT_USERNAME && env.BCONNECT_PASSWORD) { return "BCONNECT_USERNAME+BCONNECT_PASSWORD (shared)"; }
  return "none";
}
