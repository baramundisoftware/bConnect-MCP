/**
 * bconnect-mcp-gateway — startup least-privilege assertion.
 *
 * ── What this answers, and why the obvious design was impossible ────────────
 * `MCP_GATEWAY_DOMAIN_CREDENTIALS` lets each domain carry its own bMS key, so
 * `/compliance/mcp` can run as an inventory-scoped credential while
 * `/jobs/mcp` runs as something that may assign jobs. Nothing, however, checks
 * that a deployer actually did that: point all thirteen at the same
 * administrator key and the feature is decoration. `GATEWAY-DOMAIN-CREDENTIALS
 * -SPEC.md` §6.1 proposed the natural check — read the key's own
 * `securityProfiles` and refuse if it carries `Administration`.
 *
 * **That check cannot be built, and it was measured rather than assumed.**
 * `GET /servermanagement/v2.0/ApiKeys` returns, for every key in the estate,
 * exactly: name, expirationDate, comment, isActive, isAvailableViaGateway,
 * securityProfiles. There is no id, no key material, no hash and no prefix —
 * verified live 2026-08-11 against four keys, whose union of fields is those
 * six and nothing else — and no `/me`-shaped route exists in any of the twelve
 * 26R1 specs. So a process holding a key VALUE cannot find its own row. The
 * gateway can read every key's privileges and can never know which is its own.
 *
 * ── What this does instead: ask bMS, empirically ────────────────────────────
 * Do not enumerate the credential's rights — OBSERVE them. At startup each
 * resolved credential makes one read-only request to the estate's own key
 * inventory, which is the sharpest privilege signal bConnect offers and which
 * no agent-scoped domain credential has any business reading:
 *
 *     200  the credential can read the security configuration -> OVER-PRIVILEGED
 *     403  bMS refused it                                     -> CONSTRAINED
 *     any other outcome                                       -> UNVERIFIED
 *
 * The inversion is the point. §6.1's fatal caveat was that a genuinely minimal
 * key may lack rights to read `/ApiKeys`, which would have made the
 * most-secure configuration the one that could not start. Here that same 403
 * is the evidence of constraint — the failure mode of the old design is the
 * primary signal of this one.
 *
 * ── What it is NOT ──────────────────────────────────────────────────────────
 * A proxy, not an enumeration. A credential can be refused `/ApiKeys` and
 * still hold `Full` on every endpoint, and this will call that CONSTRAINED. It
 * catches the realistic misconfiguration — an administrator key wired into a
 * domain that only needs to read — not every possible over-grant. The honest
 * summary line says so, so nobody reads a clean startup as an audit.
 *
 * Enforcement remains bMS RBAC, server-side. This only reports what bMS
 * already decided.
 *
 * Decisions are pure and the I/O is injected, matching startup-config.ts and
 * auth.ts: gateway.ts owns the process and calls process.exit(), which cannot
 * be exercised from a test without taking the runner with it.
 */

import type { StartupLine } from "./startup-config.js";
import type { DomainCredentials } from "./domain-credentials.js";

export const LEAST_PRIVILEGE_ENV = "MCP_GATEWAY_ASSERT_LEAST_PRIVILEGE";

export type LeastPrivilegeMode = "off" | "warn" | "strict";

/**
 * The route the probe reads, and the reason it is this one.
 *
 * The API-key inventory is the estate's own security configuration. An
 * inventory or help-desk agent profile has no legitimate reason to read it, so
 * a 200 here is the clearest available evidence that a credential is broader
 * than its domain needs. It is also a GET with no side effect, which a startup
 * check must be.
 */
export const PROBE_PATH = "/servermanagement/v2.0/ApiKeys";

export type PrivilegeVerdict = "over-privileged" | "constrained" | "unverified";

/** What one probe observed. Either a status came back, or something went wrong. */
export interface ProbeOutcome {
  domain: string;
  /** HTTP status, when the request completed. */
  status?: number;
  /** Why no status came back — transport, TLS, timeout, anything. */
  error?: string;
}

/**
 * A probe, injected. Returns what happened; it must never throw, because a
 * startup check that can throw turns an unreachable bMS into a crash rather
 * than into "could not verify".
 */
export type PrivilegeProbe = (
  domain: string,
  credentials: DomainCredentials | undefined,
) => Promise<ProbeOutcome>;

export function leastPrivilegeMode(env: NodeJS.ProcessEnv = process.env): LeastPrivilegeMode {
  const raw = (env[LEAST_PRIVILEGE_ENV] ?? "").trim().toLowerCase();
  if (raw === "strict") {return "strict";}
  if (raw === "warn") {return "warn";}
  return "off";
}

/**
 * One outcome -> one verdict.
 *
 * 401 is deliberately NOT "constrained". bConnect answers 401 for an unknown
 * module segment and for a credential it does not accept at all, so it means
 * "this probe proved nothing", not "this key is nicely scoped". Reading it as
 * constraint is how a broken credential would earn a clean bill of health.
 */
export function classifyProbe(outcome: ProbeOutcome): PrivilegeVerdict {
  if (outcome.status === undefined) {return "unverified";}
  if (outcome.status === 200) {return "over-privileged";}
  if (outcome.status === 403) {return "constrained";}
  return "unverified";
}

export interface LeastPrivilegeVerdict {
  /** May the gateway start? False only under `strict` with an over-privileged domain. */
  ok: boolean;
  lines: StartupLine[];
  /** Per-domain verdicts, for tests and for callers that want the detail. */
  verdicts: Array<{ domain: string; verdict: PrivilegeVerdict }>;
}

/**
 * Turn probe outcomes into the lines an operator reads and a start/refuse
 * decision.
 *
 * `strict` refuses ONLY on over-privileged — never on unverified. An estate
 * that is briefly unreachable, or a bConnect that answers something
 * unexpected, must not take the gateway down: that would trade a security
 * report for an availability outage, and the check is advisory by design.
 * Spelled out in the summary so the limit is visible at every startup.
 */
export function evaluateLeastPrivilege(
  mode: LeastPrivilegeMode,
  outcomes: readonly ProbeOutcome[],
): LeastPrivilegeVerdict {
  if (mode === "off") {
    return { ok: true, lines: [], verdicts: [] };
  }

  const verdicts = outcomes.map((o) => ({ domain: o.domain, verdict: classifyProbe(o) }));
  const over = verdicts.filter((v) => v.verdict === "over-privileged");
  const unverified = verdicts.filter((v) => v.verdict === "unverified");
  const lines: StartupLine[] = [];

  for (const { domain, verdict } of verdicts) {
    if (verdict === "constrained") {
      lines.push({
        level: "info",
        text: `least-privilege: ${domain} — bMS refused ${PROBE_PATH} (403). Credential is constrained.`,
      });
    } else if (verdict === "over-privileged") {
      lines.push({
        level: mode === "strict" ? "error" : "warn",
        text:
          `least-privilege: ${domain} — this credential CAN read ${PROBE_PATH}, the estate's own ` +
          `API-key inventory. It is broader than a domain-scoped agent needs. Bind its bMS key ` +
          `to an agent security profile (the estate ships Agent_Inventory, Agent_Updates and ` +
          `Agent_HelpDesk_MCP) instead of an administrative one.`,
      });
    } else {
      const o = outcomes.find((x) => x.domain === domain);
      lines.push({
        level: "warn",
        text:
          `least-privilege: ${domain} — COULD NOT VERIFY (` +
          `${o?.status !== undefined ? `HTTP ${o.status}` : o?.error ?? "no response"}). ` +
          `Privilege is unknown, not proven safe.`,
      });
    }
  }

  // The honest summary: what was checked, and what a clean result does not mean.
  lines.push({
    level: over.length > 0 ? "warn" : "info",
    text:
      `least-privilege (${mode}): ${verdicts.length} domain credential(s) probed — ` +
      `${verdicts.length - over.length - unverified.length} constrained, ${over.length} ` +
      `over-privileged, ${unverified.length} unverified. This probe reads ONE route; a ` +
      `credential refused there may still hold broad rights elsewhere. Enforcement is bMS ` +
      `RBAC, server-side — this only reports what bMS already decided.`,
  });

  if (mode === "strict" && over.length > 0) {
    lines.push({
      level: "error",
      text:
        `${LEAST_PRIVILEGE_ENV}=strict and ${over.length} domain credential(s) can read the ` +
        `estate's security configuration: ${over.map((v) => v.domain).join(", ")}. Refusing to ` +
        `start. Use ${LEAST_PRIVILEGE_ENV}=warn to report this without refusing.`,
    });
    return { ok: false, lines, verdicts };
  }

  return { ok: true, lines, verdicts };
}

/**
 * Probe every domain and evaluate. Sequential on purpose: this is startup, the
 * domain count is 13, and a burst of parallel auth failures against bMS is a
 * poor first impression for a gateway to make.
 */
export async function runLeastPrivilegeChecks(
  domainList: readonly string[],
  resolve: (domain: string) => DomainCredentials | undefined,
  probe: PrivilegeProbe,
  env: NodeJS.ProcessEnv = process.env,
): Promise<LeastPrivilegeVerdict> {
  const mode = leastPrivilegeMode(env);
  if (mode === "off") {
    return { ok: true, lines: [], verdicts: [] };
  }
  const outcomes: ProbeOutcome[] = [];
  for (const domain of domainList) {
    outcomes.push(await probe(domain, resolve(domain)));
  }
  return evaluateLeastPrivilege(mode, outcomes);
}
