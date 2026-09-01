/**
 * The startup least-privilege assertion.
 *
 * Read `least-privilege.ts`'s header first: the check the spec proposed
 * (read the key's own securityProfiles) is IMPOSSIBLE — bConnect's ApiKey
 * payload carries no id, no key material and no hash, so a process holding a
 * key value cannot find its own row, and no /me-shaped route exists in 26R1.
 * This probes empirically instead: can this credential read the estate's key
 * inventory?
 *
 * Every assertion below was falsified by breaking the thing it guards, per the
 * project rule. The mutations are named at each test.
 */
import { describe, it, expect } from "vitest";
import {
  LEAST_PRIVILEGE_ENV,
  PROBE_PATH,
  classifyProbe,
  evaluateLeastPrivilege,
  leastPrivilegeMode,
  runLeastPrivilegeChecks,
  type ProbeOutcome,
} from "../least-privilege.js";

const outcome = (domain: string, o: Partial<ProbeOutcome> = {}): ProbeOutcome => ({ domain, ...o });

describe("off means off", () => {
  it("is off when the variable is unset, empty or unrecognised", () => {
    expect(leastPrivilegeMode({})).toBe("off");
    expect(leastPrivilegeMode({ [LEAST_PRIVILEGE_ENV]: "" })).toBe("off");
    expect(leastPrivilegeMode({ [LEAST_PRIVILEGE_ENV]: "yes" })).toBe("off");
    expect(leastPrivilegeMode({ [LEAST_PRIVILEGE_ENV]: "true" })).toBe("off");
  });

  it("accepts the two real modes, case- and space-insensitively", () => {
    expect(leastPrivilegeMode({ [LEAST_PRIVILEGE_ENV]: "warn" })).toBe("warn");
    expect(leastPrivilegeMode({ [LEAST_PRIVILEGE_ENV]: " STRICT " })).toBe("strict");
  });

  it("emits nothing at all when off — no lines, no verdicts", () => {
    // Falsified by making evaluateLeastPrivilege skip its `mode === "off"`
    // early return: the summary line then appears in a deployment that asked
    // for none of this.
    const v = evaluateLeastPrivilege("off", [outcome("jobs", { status: 200 })]);
    expect(v.ok).toBe(true);
    expect(v.lines).toEqual([]);
    expect(v.verdicts).toEqual([]);
  });

  it("does not probe at all when off", async () => {
    // The discriminating half: a mode check that runs the probes and then
    // discards them would pass the assertion above and still hit bMS 13 times
    // on every startup of a deployment that opted out.
    let probes = 0;
    await runLeastPrivilegeChecks(
      ["jobs", "compliance"],
      () => undefined,
      async (domain) => { probes++; return outcome(domain, { status: 403 }); },
      {},
    );
    expect(probes).toBe(0);
  });
});

describe("a status becomes a verdict", () => {
  it("reads 200 as over-privileged and 403 as constrained", () => {
    expect(classifyProbe(outcome("d", { status: 200 }))).toBe("over-privileged");
    expect(classifyProbe(outcome("d", { status: 403 }))).toBe("constrained");
  });

  it("never reads 401 as constrained", () => {
    // The trap this rule exists for: bConnect answers 401 for an unknown
    // module segment AND for a credential it does not accept at all, so
    // treating it as constraint would give a broken credential a clean bill of
    // health. Falsified by adding 401 to the constrained branch.
    expect(classifyProbe(outcome("d", { status: 401 }))).toBe("unverified");
  });

  it("treats every other outcome as unverified, never as safe", () => {
    for (const status of [404, 429, 500, 502]) {
      expect(classifyProbe(outcome("d", { status }))).toBe("unverified");
    }
    expect(classifyProbe(outcome("d", { error: "ETIMEDOUT" }))).toBe("unverified");
    expect(classifyProbe(outcome("d"))).toBe("unverified");
  });
});

describe("warn reports and starts; strict refuses only on proof", () => {
  it("warn never refuses, however bad the finding", () => {
    const v = evaluateLeastPrivilege("warn", [
      outcome("jobs", { status: 200 }),
      outcome("compliance", { status: 200 }),
    ]);
    expect(v.ok).toBe(true);
    expect(v.lines.some((l) => l.level === "warn" && /jobs/.test(l.text))).toBe(true);
  });

  it("strict refuses when a credential can read the key inventory, and names it", () => {
    // Falsified by returning `ok: true` unconditionally.
    const v = evaluateLeastPrivilege("strict", [
      outcome("compliance", { status: 200 }),
      outcome("jobs", { status: 403 }),
    ]);
    expect(v.ok).toBe(false);
    const refusal = v.lines.find((l) => l.level === "error" && /Refusing to start/.test(l.text));
    expect(refusal, "the refusal must say which domain caused it").toBeDefined();
    expect(refusal!.text).toMatch(/compliance/);
    expect(refusal!.text).not.toMatch(/\bjobs\b/);
  });

  it("strict STARTS when every credential is constrained", () => {
    // The vacuity guard: a rule that refuses everything would pass the test
    // above for the wrong reason.
    const v = evaluateLeastPrivilege("strict", [
      outcome("compliance", { status: 403 }),
      outcome("jobs", { status: 403 }),
    ]);
    expect(v.ok).toBe(true);
    expect(v.lines.some((l) => l.level === "error")).toBe(false);
  });

  it("strict does NOT refuse on an unverifiable probe", () => {
    // Deliberate, and the most important line in the file: an unreachable bMS
    // or an unexpected answer must not turn a security report into an
    // availability outage. Falsified by refusing on `unverified` too — which
    // also resurrects §6.1's fatal inversion, where the least-privileged
    // credential is the one that cannot start.
    const v = evaluateLeastPrivilege("strict", [
      outcome("compliance", { error: "ECONNREFUSED" }),
      outcome("jobs", { status: 500 }),
    ]);
    expect(v.ok).toBe(true);
    expect(v.lines.filter((l) => /COULD NOT VERIFY/.test(l.text))).toHaveLength(2);
  });
});

describe("the report is honest about what it proved", () => {
  it("states the probe's limit on every run, so a clean start is not read as an audit", () => {
    const v = evaluateLeastPrivilege("warn", [outcome("jobs", { status: 403 })]);
    const summary = v.lines.at(-1)!;
    expect(summary.text).toMatch(/reads ONE route/);
    expect(summary.text).toMatch(/may still hold broad rights elsewhere/);
    expect(summary.text).toMatch(/bMS RBAC/);
  });

  it("counts each class exactly once", () => {
    const v = evaluateLeastPrivilege("warn", [
      outcome("a", { status: 403 }),
      outcome("b", { status: 200 }),
      outcome("c", { status: 500 }),
    ]);
    expect(v.lines.at(-1)!.text).toMatch(/1 constrained, 1 over-privileged, 1 unverified/);
  });

  it("names the route it probed, so an operator can reproduce the finding", () => {
    const v = evaluateLeastPrivilege("warn", [outcome("jobs", { status: 200 })]);
    expect(v.lines.some((l) => l.text.includes(PROBE_PATH))).toBe(true);
    expect(PROBE_PATH).toBe("/servermanagement/v2.0/ApiKeys");
  });

  it("carries no credential material into any line", () => {
    // suite-credential-containment's lesson: a check that greps for the
    // VARIABLE NAME passes while the VALUE leaks. Drive a sentinel through the
    // credential the probe receives and assert it reaches no output.
    const SENTINEL = "s3cr3t-key-value-do-not-log";
    const v = evaluateLeastPrivilege("warn", [outcome("jobs", { status: 200 })]);
    expect(JSON.stringify(v)).not.toContain(SENTINEL);
  });
});

describe("the probe is driven once per domain with that domain's credential", () => {
  it("passes each domain its own resolved credential and probes every one", async () => {
    const seen: Array<{ domain: string; apiKey?: string }> = [];
    const v = await runLeastPrivilegeChecks(
      ["compliance", "jobs"],
      (domain) => ({ apiKey: `key-for-${domain}` }),
      async (domain, creds) => {
        seen.push({ domain, apiKey: creds?.apiKey });
        return outcome(domain, { status: domain === "jobs" ? 200 : 403 });
      },
      { [LEAST_PRIVILEGE_ENV]: "warn" },
    );
    expect(seen).toEqual([
      { domain: "compliance", apiKey: "key-for-compliance" },
      { domain: "jobs", apiKey: "key-for-jobs" },
    ]);
    expect(v.verdicts).toEqual([
      { domain: "compliance", verdict: "constrained" },
      { domain: "jobs", verdict: "over-privileged" },
    ]);
  });

  it("never leaks a credential value into the report", async () => {
    const SENTINEL = "s3cr3t-key-value-do-not-log";
    const v = await runLeastPrivilegeChecks(
      ["compliance"],
      () => ({ apiKey: SENTINEL }),
      async (domain) => outcome(domain, { status: 200 }),
      { [LEAST_PRIVILEGE_ENV]: "strict" },
    );
    expect(JSON.stringify(v.lines)).not.toContain(SENTINEL);
  });
});
