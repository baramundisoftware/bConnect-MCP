/**
 * bconnect-jobs-mcp — the composite tools' descriptions, after the trim
 *
 * The composite tools are hand-authored by design: they are the only tools in
 * the suite whose description is a routing decision rather than a restatement
 * of an OpenAPI operation. Trimming them is therefore the one description edit
 * that can change behaviour, so the parts that must survive are pinned here
 * rather than left to review.
 *
 * Two kinds of assertion, and the distinction is the point:
 *
 *   - BUDGET. Each description must stay under a ceiling, so the prose cannot
 *     silently grow back. These fail against the pre-trim text.
 *   - GUIDANCE. Specific clauses must be present verbatim in substance. These
 *     fail against a trim that went too far — which is the failure mode that
 *     actually costs something, because it is invisible until a model assigns a
 *     job it should have previewed.
 *
 * Measured the same way the surface is measured elsewhere: bytes of the
 * description string as it appears in tools/list.
 */

import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../index.js";

const CREDS = { baseUrl: "https://desc.invalid/bconnect", username: "u", password: "p" };

let cached: Map<string, string> | undefined;

async function descriptions(): Promise<Map<string, string>> {
  if (cached) {return cached;}
  process.env.ALLOW_WRITE_OPERATIONS = "true"; // so the write composites are listed too
  const { server } = createServer(CREDS);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" }, { capabilities: {} });
  await Promise.all([server.connect(st), client.connect(ct)]);
  const { tools } = await client.listTools();
  await client.close();
  await server.close();
  cached = new Map(tools.map((t) => [t.name, t.description ?? ""]));
  return cached;
}

const bytes = (s: string): number => Buffer.byteLength(s, "utf8");

describe("composite tool descriptions", () => {
  /**
   * Before the trim: diagnose_job 1,122 B, explain_job_failure 786 B.
   * The ceilings sit just above the trimmed sizes — close enough that adding a
   * sentence fails, loose enough that rewording one does not.
   */
  it.each([
    ["diagnose_job", 700, 1122],
    ["explain_job_failure", 560, 786],
  ])("%s stays under %i B (was %i B)", async (name, ceiling, before) => {
    const description = (await descriptions()).get(name);
    expect(description, `${name} is not advertised`).toBeDefined();
    expect(bytes(description!)).toBeLessThan(ceiling);
    expect(bytes(description!)).toBeLessThan(before);
  });

  it("diagnose_job keeps the routing guidance that stops a model using get_job_definition", async () => {
    const d = (await descriptions()).get("diagnose_job")!;
    expect(d).toContain("PREFER THIS over get_job_definition");
    // The reason, not just the instruction. Without it the advice is arbitrary.
    expect(d).toContain("field-for-field identical to the list entry");
    // Degraded mode: a partial answer is a success, not a failed call.
    expect(d).toMatch(/v1\.1 is unreachable/);
    expect(d).toContain("Makes no changes.");
  });

  it("explain_job_failure keeps BOTH the prefer-this line and the state-filter trap", async () => {
    const d = (await descriptions()).get("explain_job_failure")!;
    expect(d).toContain("PREFER THIS over paging list_job_instances");
    // The trap. SearchQuery matches display text, so filtering on the literal
    // state value returns an empty list that reads as "nothing is failing".
    expect(d).toContain("Do NOT try to filter list_job_instances by state");
    expect(d).toContain("FinishedWithError");
    expect(d).toContain("Makes no changes.");
  });

  it("preview_assignment is NOT trimmed: it is the guard on an executing write", async () => {
    const d = (await descriptions()).get("preview_assignment")!;
    // Left alone deliberately. Every clause here is doing work: the ALWAYS
    // instruction, the reason assignment is dangerous (it executes), and the
    // reason a membership query is not a substitute (it hides descendants).
    expect(d).toContain("ALWAYS call this before");
    expect(d).toContain("assignment executes the job unless a schedule defers it");
    expect(d).toContain("descendant groups");
    expect(d).toContain("Destructive");
    expect(d).toContain("Makes no changes.");

    // It now guards all four assign_job_to_* tools, not just the logical one,
    // so it must name every group id a caller could pass — otherwise the three
    // added kinds are reachable but undiscoverable from tools/list.
    for (const option of [
      "logicalGroupId", "staticGroupId", "dynamicGroupId", "universalDynamicGroupId",
    ]) {
      expect(d, `${option} is not named in the description`).toContain(option);
    }
    // And it must say the ids are not interchangeable: passing a dynamic id
    // where a universal dynamic one belongs 404s exactly like a missing route.
    expect(d).toMatch(/NOT interchangeable|not interchangeable/);
    expect(d).toContain("exactly ONE");
  });

  it("every composite still declares it changes nothing", async () => {
    const all = await descriptions();
    for (const name of ["diagnose_job", "explain_job_failure", "preview_assignment"]) {
      expect(all.get(name), name).toMatch(/Makes no changes\.|Read-only/);
    }
  });
});
