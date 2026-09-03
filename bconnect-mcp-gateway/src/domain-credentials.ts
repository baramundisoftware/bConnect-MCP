/**
 * bconnect-mcp-gateway — opt-in per-domain bMS credentials.
 *
 * ── The problem ─────────────────────────────────────────────────────────────
 * `app.ts` builds every domain's server with `factory(undefined)`, so all 13
 * fall back to one `BCONNECT_*` service credential. Every caller through the
 * gateway therefore acts with the full authority of that one account: the bearer
 * token proves "an allowed caller", never "this caller is Alice" (SECURITY.md).
 *
 * That is defensible on a trusted private network and is the central risk in a
 * DMZ — a standing credential in the least-trusted zone holding whatever that
 * account can do. Measured on the reference estate that is everything: all four
 * bMS security groups hold only the `Administration` profile, which resolves to
 * `Full` on every object.
 *
 * ── Why this is worth doing here rather than in the gateway's own logic ─────
 * A bMS API key is attached to a security profile and configured like a user,
 * granting only what is marked on that key. So pointing `/compliance/mcp` at a
 * key bound to `Agent_Inventory` and `/jobs/mcp` at one bound to
 * `Agent_Updates` puts enforcement in **bMS RBAC, server-side**, where a
 * compromised or misconfigured gateway cannot exceed it. Anything the gateway
 * polices itself is only as good as the gateway.
 *
 * The estate already carries `Agent_HelpDesk_MCP`, `Agent_Inventory` and
 * `Agent_Updates` profiles — assigned to no security group. The bMS half of
 * least privilege was designed and never wired; this is the plumbing that lets a
 * deployer use it.
 *
 * ── Opt-in by construction ──────────────────────────────────────────────────
 * With `MCP_GATEWAY_DOMAIN_CREDENTIALS` unset, `resolveDomainCredentials()`
 * returns `undefined` for every domain and `validateDomainCredentials()` does
 * nothing — the same object `app.ts` passed before this file existed. No startup
 * work, no log line, no behaviour change. That is what makes the feature free
 * for deployments that do not want it.
 *
 * ── Why `strict` fails closed ───────────────────────────────────────────────
 * Silently falling back to a MORE privileged credential is exactly backwards for
 * a security feature. A typo in `BCONNECT_API_KEY__COMPLAINCE` must not quietly
 * grant `/compliance/mcp` full administrator rights. Under `strict` the gateway
 * refuses to start and names both the domain and the variable it looked for;
 * `fallback` exists for incremental migration and says loudly which domains fell
 * back.
 *
 * ── What this does NOT do ───────────────────────────────────────────────────
 * It narrows what the gateway CAN DO, not who did it. Every caller of one domain
 * still shares that domain's credential, so per-caller attribution still belongs
 * to the fronting proxy and `MCP_GATEWAY_IDENTITY_HEADER`. ADR-0003 stands.
 */

// No import of `domains` from app.ts on purpose: app.ts imports this module, and
// a cycle between the route mounter and the credential resolver is a hazard that
// shows up as `undefined` at module-init time rather than as a compile error.
// Callers pass the domain list explicitly.

/** Env var that turns the whole feature on. Unset means unset — see the header. */
export const DOMAIN_CREDENTIALS_ENV = "MCP_GATEWAY_DOMAIN_CREDENTIALS";

export type DomainCredentialMode = "off" | "strict" | "fallback";

/**
 * The credential fields a server factory accepts. Mirrors `BConnectCredentials`
 * in every server package; kept structural rather than imported so the gateway
 * does not pick one of the thirteen packages arbitrarily to type against.
 */
export interface DomainCredentials {
  baseUrl?: string;
  username?: string;
  password?: string;
  apiKey?: string;
}

/**
 * The four per-domain variable names for one domain.
 *
 * `__` rather than `_` because domain names are already lower-case single words
 * (`compliance`, `universaldynamicgroups`) and a single underscore reads as part
 * of the base name. `BASE_URL` is included deliberately: it costs nothing and
 * allows one domain to be pointed at a different bMS, which is a real
 * multi-tenant shape.
 */
export function domainEnvKeys(domain: string): {
  baseUrl: string;
  username: string;
  password: string;
  apiKey: string;
} {
  const suffix = `__${domain.toUpperCase()}`;
  return {
    baseUrl: `BCONNECT_BASE_URL${suffix}`,
    username: `BCONNECT_USERNAME${suffix}`,
    password: `BCONNECT_PASSWORD${suffix}`,
    apiKey: `BCONNECT_API_KEY${suffix}`,
  };
}

/**
 * Every per-domain credential variable across every mounted domain.
 *
 * Generated from `domains`, never hand-listed: a hand-maintained parallel list
 * is this codebase's most repeated defect, and it would silently omit the
 * fourteenth server the day one is added.
 */
export function allDomainSecretKeys(domainList: readonly string[]): string[] {
  return domainList.flatMap((d) => {
    const k = domainEnvKeys(d);
    // BASE_URL is not a secret and needs no `_FILE` handling; the other three do.
    return [k.username, k.password, k.apiKey];
  });
}

export function domainCredentialMode(env: NodeJS.ProcessEnv = process.env): DomainCredentialMode {
  const raw = (env[DOMAIN_CREDENTIALS_ENV] ?? "").trim().toLowerCase();
  if (raw === "strict") {return "strict";}
  if (raw === "fallback") {return "fallback";}
  return "off";
}

/** True when any per-domain credential material is present for `domain`. */
function hasDomainCredential(domain: string, env: NodeJS.ProcessEnv): boolean {
  const k = domainEnvKeys(domain);
  // baseUrl alone is NOT a credential: a domain that sets only the URL has said
  // where to go, not who to be, and would otherwise silently inherit the global
  // identity while looking configured.
  return Boolean(env[k.apiKey] ?? (env[k.username] && env[k.password]));
}

/**
 * The credentials `app.ts` should hand this domain's factory, or `undefined` to
 * mean "fall back to the ambient BCONNECT_* environment" — which is precisely
 * what the gateway did before this file existed.
 */
export function resolveDomainCredentials(
  domain: string,
  env: NodeJS.ProcessEnv = process.env
): DomainCredentials | undefined {
  if (domainCredentialMode(env) === "off") {
    return undefined;
  }
  if (!hasDomainCredential(domain, env)) {
    // Under `strict` this domain never reaches here: validateDomainCredentials()
    // refused at startup. Under `fallback` this is the documented behaviour.
    return undefined;
  }
  const k = domainEnvKeys(domain);
  return {
    baseUrl: env[k.baseUrl] ?? env.BCONNECT_BASE_URL,
    username: env[k.username],
    password: env[k.password],
    apiKey: env[k.apiKey],
  };
}

export interface DomainCredentialReport {
  mode: DomainCredentialMode;
  /** Domains resolving their own credential, with the variable that supplied it. */
  scoped: Array<{ domain: string; via: string }>;
  /** Domains falling back to the global credential. Empty under `strict`. */
  fellBack: string[];
}

/**
 * Startup validation and the report an operator reads.
 *
 * Throws under `strict` when any mounted domain has no credential of its own,
 * naming the domain and the variables it looked for — a gateway that starts
 * half-scoped is worse than one that refuses, because the unscoped half is the
 * privileged half.
 *
 * The report names VARIABLES, never values. `credentialReport()` in
 * `install/lib` sets the same precedent, and `suite-credential-containment`
 * exists because a check that greps for the variable name passes while the value
 * leaks.
 */
export function validateDomainCredentials(
  domainList: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): DomainCredentialReport {
  const mode = domainCredentialMode(env);
  if (mode === "off") {
    return { mode, scoped: [], fellBack: [] };
  }

  const scoped: Array<{ domain: string; via: string }> = [];
  const fellBack: string[] = [];

  for (const domain of domainList) {
    const k = domainEnvKeys(domain);
    if (hasDomainCredential(domain, env)) {
      scoped.push({ domain, via: env[k.apiKey] ? k.apiKey : `${k.username}+${k.password}` });
    } else {
      fellBack.push(domain);
    }
  }

  if (mode === "strict" && fellBack.length > 0) {
    throw new Error(
      `${DOMAIN_CREDENTIALS_ENV}=strict, but ${fellBack.length} mounted domain(s) have no ` +
        `credential of their own and would inherit the global BCONNECT_* identity:\n` +
        fellBack
          .map((d) => {
            const k = domainEnvKeys(d);
            return `  ${d}: set ${k.apiKey}, or ${k.username} + ${k.password}`;
          })
          .join("\n") +
        `\nRefusing to start. A gateway that scopes only some domains leaves the ` +
        `unscoped ones holding the most privileged credential, which is the ` +
        `opposite of what this setting is for. Use ` +
        `${DOMAIN_CREDENTIALS_ENV}=fallback to allow it deliberately.`
    );
  }

  return { mode, scoped, fellBack };
}
