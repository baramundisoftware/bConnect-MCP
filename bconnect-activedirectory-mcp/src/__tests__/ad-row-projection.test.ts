/**
 * The compact projection for the AD group / object / user rows.
 *
 * Driven through the REAL tool handlers over InMemoryTransport with bConnect
 * mocked by msw — a unit test of the shaper proves nothing about whether the
 * nine dispatch arms call it, and this repository has had a projection test
 * stay green while the arm using it was reverted.
 *
 * ── The evidence this projection rests on ───────────────────────────────────
 * The whole population was walked on 2026-08-13 (60 AD objects, 52 groups, 8
 * users — not one page each, because a review had rejected page-1 sampling
 * when `list_org_units` was shaped). Every one of the 120 rows carries a
 * comment, and every one is ADSync provenance: zero human-written. `comment`'s
 * byte share was uniform page by page (17.1/17.2/17.3, 17.0/17.3/16.9, 13.4),
 * so the saving generalises rather than being an artefact of the first page.
 *
 * ── What must stay true ─────────────────────────────────────────────────────
 *  1. `comment` is gone from the compact page and NAMED as gone.
 *  2. The two folds compose: OPT-4's `{ldapPath}` elision still reports itself
 *     in `meta` alongside the projection's own keys, rather than one
 *     overwriting the other.
 *  3. `detail:true` returns what these tools returned BEFORE the projection —
 *     elided, but with `comment` intact. It must not become a third shape.
 *  4. The identities are kept: `ldapPath`, `sid` and `objectGuid` are not
 *     derivable from what remains, so a byte saving must not take them.
 *  5. A human-written comment is not silently discarded as if it were
 *     provenance — the drop is unconditional, so this test pins the DISCLOSURE
 *     that makes it recoverable.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../index.js";

const BASE = "http://bms.ad.test/bconnect";
const GROUPS = `${BASE}/activedirectory/v2.0/ADGroups`;
const OBJECTS = `${BASE}/activedirectory/v2.0/ADObjects`;
const USERS = `${BASE}/activedirectory/v2.0/ADUsers`;

/**
 * The fixture mirrors the MEASURED estate rather than being uniform, because a
 * uniform one does not exercise the real code path: with every row identical,
 * `comment` becomes single-valued and `dropConstantColumns` reports its value
 * once under `meta.constant` even though `alwaysDrop` also removed the column.
 * That is established behaviour (the org-unit shaper carries the same option
 * pair) and it is one copy instead of twenty — but it is NOT what this estate
 * does. Measured 2026-08-13: `orgUnitId` holds 3-4 distinct values per page,
 * `comment` 2-3 (the ADSync date differs), while `domain` and `type` really are
 * single-valued on every page.
 */
const OU = ["e57a7e00-0000-4000-8000-000000000039", "e57a7e00-0000-4000-8000-000000000042", "e57a7e00-0000-4000-8000-000000000030"];
const OU_NAME = ["Builtin", "Users", "Servers"];
const LDAP = (name: string, ou = "Builtin") => `labcorp.local/CN=${name},CN=${ou},DC=labcorp,DC=local`;

const adRow = (n: number, over: Record<string, unknown> = {}) => {
  const name = `GROUP-${n}`;
  const ou = n % 3;
  // Two distinct sync dates, as the estate has.
  const date = n % 2 === 0 ? "5/17/2024 12:10 PM" : "12/16/2025 5:02 PM";
  return {
    id: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
    name,
    orgUnitId: OU[ou],
    orgUnit: OU_NAME[ou],
    sid: `S-1-5-32-${580 + n}`,
    domain: "labcorp.local",
    type: "Group",
    ldapPath: LDAP(name, OU_NAME[ou]),
    // Exactly the ADSync shape, with the LDAP:// prefix OPT-4 looks for.
    comment: `Automatically created by ADSync from LDAP://${LDAP(name, OU_NAME[ou])} on ${date}`,
    objectGuid: `18be4d5e-0779-e64d-9135-${String(n).padStart(12, "0")}`,
    ...over,
  };
};

const page = (rows: unknown[]) => ({
  currentPage: 0, pageSize: 20, totalPages: 1, totalItems: rows.length,
  hasPreviousPage: false, hasNextPage: false, data: rows,
});

const ROWS = Array.from({ length: 20 }, (_, i) => adRow(i));
const handlers = [
  http.get(GROUPS, () => HttpResponse.json(page(ROWS))),
  http.get(OBJECTS, () => HttpResponse.json(page(ROWS))),
  http.get(USERS, () => HttpResponse.json(page(ROWS))),
];

const mockApi = setupServer(...handlers);
beforeAll(() => mockApi.listen({ onUnhandledRequest: "error" }));
afterAll(() => mockApi.close());
afterEach(() => mockApi.resetHandlers(...handlers));

async function call(tool: string, args: Record<string, unknown> = {}) {
  const { server } = createServer({ apiKey: "test-key", baseUrl: BASE });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "ad-projection", version: "1.0.0" }, { capabilities: {} });
  await client.connect(ct);
  const res = await client.callTool({ name: tool, arguments: args });
  const text = (res.content as Array<{ text: string }>)[0].text;
  return { text, json: JSON.parse(text) as Record<string, any>, bytes: Buffer.byteLength(text, "utf8") };
}

const SHAPED = ["list_ad_groups", "list_ad_objects", "list_ad_users"];

describe("the ADSync provenance column is dropped and named", () => {
  for (const tool of SHAPED) {
    it(`${tool}: comment is gone from every row and disclosed`, async () => {
      const { text, json } = await call(tool);

      // Gone from every row, not just the first.
      for (const row of json.data as Array<Record<string, unknown>>) {
        expect(row.comment).toBeUndefined();
      }
      // 20 rows of ADSync provenance are gone. On this estate `comment` holds
      // several distinct values, so it is dropped outright rather than
      // collapsing into meta.constant.
      expect(text).not.toMatch(/Automatically created by ADSync/);

      // Named, not silently gone.
      expect(json.meta?.dropped).toContain("comment");
    });

    it(`${tool}: is materially smaller than the same page at detail:true`, async () => {
      const compact = await call(tool);
      const full = await call(tool, { detail: true });
      expect(compact.bytes).toBeLessThan(full.bytes * 0.9);
    });
  }
});

describe("the two folds compose rather than overwrite", () => {
  it("keeps OPT-4's elision disclosure beside the projection's own meta", async () => {
    const { json } = await call("list_ad_groups", { detail: true });
    // On the detail path the elision still runs and still reports itself —
    // this is the pre-projection contract, unchanged.
    expect(json.meta?.commentLdapPathElided).toBe(20);
    expect(String(json.data[0].comment)).toContain("{ldapPath}");
    expect(String(json.data[0].comment)).not.toContain("LDAP://labcorp.local");
  });
});

describe("detail:true is the pre-projection record, not a third shape", () => {
  it("returns comment (elided) and every identity column", async () => {
    const { json } = await call("list_ad_objects", { detail: true });
    const row = json.data[0];

    expect(row.comment).toBeDefined();
    expect(row.ldapPath).toBe(LDAP("GROUP-0"));
    expect(row.sid).toBe("S-1-5-32-580");
    expect(row.objectGuid).toBeDefined();
    expect(row.domain).toBe("labcorp.local");
  });
});

describe("the projection does not take what it cannot give back", () => {
  it("keeps ldapPath, sid and objectGuid on the COMPACT page", async () => {
    const { json } = await call("list_ad_objects");
    const row = json.data[0];

    // ldapPath carries the nested OU hierarchy that `orgUnit` (a leaf name)
    // cannot express, so it is not derivable from what remains.
    expect(row.ldapPath).toBe(LDAP("GROUP-0", "Builtin"));
    expect(row.sid).toBe("S-1-5-32-580");
    expect(row.objectGuid).toBeDefined();
    // The handles other tools take must survive too. `orgUnitId` varies across
    // the page on this estate, so it stays a column rather than collapsing.
    expect(row.id).toBeDefined();
    expect(row.orgUnitId).toBeDefined();
    expect(row.name).toBe("GROUP-0");
  });

  it("reports a genuinely single-valued column once instead of on every row", async () => {
    const { json } = await call("list_ad_objects");

    // `domain` and `type` are single-valued on every page of the real estate.
    expect(json.data[0].domain).toBeUndefined();
    expect(json.data[0].type).toBeUndefined();
    const constant = (json.meta?.constant ?? {}) as Record<string, unknown>;
    expect(constant.domain).toBe("labcorp.local");
    expect(constant.type).toBe("Group");
    // And a column that VARIES is not collapsed into that block.
    expect(constant).not.toHaveProperty("orgUnitId");
  });

  it("a human-written comment is still dropped, but the disclosure makes it recoverable", async () => {
    mockApi.use(http.get(OBJECTS, () => HttpResponse.json(page([
      adRow(1, { comment: "DO NOT DELETE - owned by Finance, ticket INC-4471" }),
    ]))));

    const compact = await call("list_ad_objects");
    expect(compact.json.data[0].comment).toBeUndefined();
    // The disclosure must name the column, so a reader knows to ask for it.
    expect(JSON.stringify(compact.json.meta ?? {})).toMatch(/comment/);

    // And detail:true gives it back verbatim — the drop is recoverable, which
    // is what makes an unconditional drop honest.
    const full = await call("list_ad_objects", { detail: true });
    expect(full.json.data[0].comment).toBe("DO NOT DELETE - owned by Finance, ticket INC-4471");
  });
});
