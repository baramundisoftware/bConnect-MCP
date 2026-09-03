/**
 * Minimal bConnect v1.1 reader.
 *
 * LOCAL ADDITION (not upstream). v1.1 exposes job configuration that v2.0 does
 * not — `JobExecutionTimeout`, `AbortOnError`, `RepeatedExecution`, `Steps` and
 * `Destructive` (upstream findings D5 and D11) — and diagnosing a job failure
 * needs those fields.
 *
 * The HTTP hop is mcp-core's shared `V11Client`, never a local axios call. That
 * client refuses to follow redirects — the request carries Basic auth for a
 * DOMAIN account, and a redirect target must never be offered it — encodes the
 * credentials ISO-8859-1 as v1.1 requires, reuses the v2.0 httpsAgent so an
 * internal CA validates (a bare `fetch` fails with
 * UNABLE_TO_VERIFY_LEAF_SIGNATURE), and addresses a controller by NAME so
 * nothing here can express a v2.0 path. This module only turns its throws into
 * the `reason` string the job tools report.
 *
 * Failure is always reported as a `reason` string, never a silent null: an
 * unreadable job must not be indistinguishable from a healthy one.
 */

import type { AxiosInstance } from "axios";
import { BConnectApiError, ENABLE_V11_ENV, V11Client, v11Enabled } from "@bconnect/mcp-core";

export interface V11Result {
  job: Record<string, unknown> | null;
  reason: string | null;
}

/**
 * This server's v1.1 client.
 *
 * A named subclass rather than a bare alias, for the same reason the update and
 * inventory slices use one: tests stub `prototype.transport`, and a distinct
 * prototype keeps that stub from reaching another server's v1.1 calls in a
 * shared test process.
 */
export class JobsV11Client extends V11Client {}

/**
 * Is the v1.1 surface usable here?
 *
 * Delegates to mcp-core's `v11Enabled`, which wants BCONNECT_ENABLE_V11=true
 * AND both credentials. The jobs server reads v1.1 from inside ordinary read
 * tools rather than from v1.1-only tools, so it has no `tools/list` gate — but
 * the opt-in is the same control either way: every one of these calls puts a
 * domain password on the wire, and the deployer says when that is acceptable.
 * One spelling suite-wide, read per call, never cached.
 */
export function v11Configured(env: NodeJS.ProcessEnv = process.env): boolean {
  return v11Enabled(env);
}

/**
 * Why v1.1 cannot be read, or `null` when it can.
 *
 * The two shut states are reported apart on purpose: "you never configured
 * this" and "you configured it but did not turn it on" need different actions,
 * and the second is easy to reach by accident.
 */
function v11Unavailable(env: NodeJS.ProcessEnv): string | null {
  if (!env.BCONNECT_V11_USERNAME || !env.BCONNECT_V11_PASSWORD) {
    return "BCONNECT_V11_USERNAME / BCONNECT_V11_PASSWORD are not set";
  }
  if (!v11Enabled(env)) {
    return (
      `${ENABLE_V11_ENV} is not set to true — the v1.1 credentials are present but the v1.1 ` +
      `surface is opt-in, so nothing was sent to it`
    );
  }
  return null;
}

/** Env var that permits assigning a job flagged Destructive. Off by default. */
export const ALLOW_DESTRUCTIVE_ENV = "ALLOW_DESTRUCTIVE_JOB_ASSIGNMENT";

/**
 * The refusal for assigning a job the bMS itself flags `Destructive`.
 *
 * `preview_assignment` already computes a "REFUSE" verdict for these, and that
 * verdict was ADVISORY ONLY: nothing checked it before the assignment ran, and
 * `preview_assignment` accepted only a logical group id — so the two
 * dynamic-group assignment tools had no preview at all, and dynamic-group
 * membership is server-computed, meaning the blast radius is not even
 * enumerable before the call.
 *
 * The concrete path that closes: injected text in an estate string leads a
 * model to `assign_job_to_dynamic_group` with a job carrying a wipe or
 * OS-deploy step, against a broad dynamic group; every matching endpoint gets
 * an instance and runs it on next check-in. No preview, no check, no
 * confirmation.
 *
 * So this is a second gate INSIDE the write gate: a deployer who has already
 * accepted writes has not thereby accepted unattended wipes.
 */
export function destructiveRefusalMessage(toolName: string, jobDefinitionId: string): string {
  return (
    `Refusing ${toolName}: job definition ${jobDefinitionId} is flagged Destructive by the bMS ` +
    `— it contains a wipe or OS-deployment step, and assigning it to a group runs it on every ` +
    `member at next check-in. Group membership for a dynamic group is computed server-side, so ` +
    `the set of machines affected cannot be enumerated before the call. ` +
    `Run preview_assignment first and show the operator what it reports. ` +
    `If this is genuinely intended, an operator (not a model) must set ` +
    `${ALLOW_DESTRUCTIVE_ENV}=true on the server and restart it.`
  );
}

/**
 * What the caller is told when the assignment ran WITHOUT the Destructive check.
 *
 * The gate refuses a job known to be destructive. It cannot refuse a job whose
 * flag it could not read: v1.1 is optional and LAN-only, so a suite that
 * refused every assignment whenever v1.1 was unreadable would be unusable in
 * the majority deployment — the assignment proceeds. What must not happen is
 * that it proceeds looking identical to a checked one, which is what this says.
 */
export function destructiveUncheckedNote(
  toolName: string,
  jobDefinitionId: string,
  reason: string
): string {
  return (
    `NOT CHECKED — the bMS Destructive flag for job definition ${jobDefinitionId} could not be ` +
    `read (${reason}), so ${toolName} was NOT checked against it. A job carrying a wipe or ` +
    `OS-deployment step would not have been refused. Do not report this assignment as having ` +
    `passed the destructive-job check. To enable the check, set ${ENABLE_V11_ENV}=true with ` +
    `BCONNECT_V11_USERNAME (UPN form) and BCONNECT_V11_PASSWORD on the server; v1.1 is ` +
    `reachable on the management LAN only.`
  );
}

/** Is the destructive-assignment gate open? Read per call, never cached. */
export function destructiveAssignmentAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[ALLOW_DESTRUCTIVE_ENV] === "true";
}

/** The answer to "does the bMS flag this job Destructive?", including "unknown". */
export interface DestructiveCheck {
  /** `true`/`false` when v1.1 answered; `null` when the flag could not be read. */
  destructive: boolean | null;
  /** Why it could not be read. `null` exactly when `destructive` is not null. */
  reason: string | null;
}

/**
 * Whether the bMS flags this job definition Destructive.
 *
 * `destructive: null` means v1.1 could not answer — not enabled, no
 * credentials, unreachable, or the read failed — and `reason` always says
 * which. The caller decides what to do with an unknown; the decision made at
 * the assignment sites is to PROCEED AND DISCLOSE, never to proceed silently.
 */
export async function isDestructiveJob(
  client: AxiosInstance,
  jobDefinitionId: string
): Promise<DestructiveCheck> {
  const { job, reason } = await fetchV11Job(client, jobDefinitionId);
  if (!job) {
    return { destructive: null, reason: reason ?? "v1.1 gave no reason" };
  }
  return { destructive: job.Destructive === true, reason: null };
}

export async function fetchV11Job(client: AxiosInstance, jobId: string): Promise<V11Result> {
  const unavailable = v11Unavailable(process.env);
  if (unavailable) {
    return { job: null, reason: unavailable };
  }

  try {
    const body = await new JobsV11Client({ httpClient: client }).request("jobs", {
      id: jobId,
      Steps: true,
    });
    const job = (Array.isArray(body) ? body[0] : body) as Record<string, unknown> | undefined;
    return job ? { job, reason: null } : { job: null, reason: "v1.1 returned no job for that id" };
  } catch (err) {
    // The shared client throws its diagnoses (401 UPN/group, 400 parameter
    // name, unreachable-means-LAN-only); they are more useful than the bare
    // status this module used to report, so they are passed through intact.
    if (err instanceof BConnectApiError) {
      return { job: null, reason: `v1.1 lookup returned HTTP ${err.status} — ${err.message}` };
    }
    const e = err as { message?: string; code?: string };
    return { job: null, reason: `v1.1 request failed: ${e.code ?? e.message ?? "unknown error"}` };
  }
}
