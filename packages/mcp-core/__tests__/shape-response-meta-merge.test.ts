/**
 * A projection must not destroy a disclosure the payload already carried.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * `shapeListResponse` ended with:
 *
 *     return { ...envelope, data: shaped, meta };
 *
 * `envelope` is a copy of every payload key except `data`, so a payload that
 * already had a `meta` contributed it — and the trailing `meta` then silently
 * replaced it.
 *
 * Live consequence, which is what makes this worth a guard rather than a note:
 * `bconnect-activedirectory-mcp` strips the redundant `LDAP://<ldapPath>`
 * substring out of `comment`, leaves a `{ldapPath}` marker behind, and
 * discloses that as `meta.commentLdapPathElided` + `meta.hint`. NINE AD tool
 * descriptions end with "see meta". Shape any of those responses and the
 * marker survives in the data while the sentence explaining it is gone — the
 * exact failure both transforms were written to prevent.
 *
 * It was latent when found: the AD list tools are not yet shaped. It goes live
 * on the first AD projection that ships, which is item 2, 3, 5 and 9 of the
 * response-shaping backlog. So the guard lands before the work that trips it.
 *
 * ── Falsified ───────────────────────────────────────────────────────────────
 * Restore `meta` in place of `meta: mergeShapeMeta(envelope.meta, meta)` in
 * shape-response.ts, rebuild mcp-core (the tests import build/, NOT src/ — a
 * mutation without the rebuild proves nothing here), and the first four tests
 * below fail. The last two pass either way and are deliberate controls.
 */

import { describe, it, expect } from "vitest";
import { shapeListResponse, type ShapeMeta } from "../src/shape-response.js";

/** The shape bconnect-activedirectory-mcp's shapeAdComments actually emits. */
function adPayloadWithMeta(): Record<string, unknown> {
  return {
    currentPage: 0,
    pageSize: 20,
    totalItems: 2,
    totalPages: 1,
    data: [
      { id: "a", name: "Group A", domain: "labcorp.local", comment: "{ldapPath}", ldapPath: "OU=A" },
      { id: "b", name: "Group B", domain: "labcorp.local", comment: "{ldapPath}", ldapPath: "OU=B" },
    ],
    meta: {
      commentLdapPathElided: 2,
      hint: "comment had 'LDAP://' + this row's own ldapPath replaced with '{ldapPath}' on 2 row(s).",
    },
  };
}

const metaOf = (result: unknown): ShapeMeta =>
  (result as { meta: ShapeMeta }).meta;

describe("shapeListResponse preserves a meta the payload already carried", () => {
  it("keeps the upstream disclosure key", () => {
    const out = shapeListResponse(adPayloadWithMeta(), { compactFields: ["id", "name"] });
    // Without the merge this is undefined: the projection's meta replaced it.
    expect(metaOf(out).commentLdapPathElided).toBe(2);
  });

  it("keeps the upstream hint AND the projection's own hint", () => {
    const out = shapeListResponse(adPayloadWithMeta(), { compactFields: ["id", "name"] });
    const hint = metaOf(out).hint as string;
    // Both are prose disclosures about the same payload and both stay true of
    // it, so neither may be dropped. A plain {...prior, ...next} spread would
    // silently keep only one - which is the same bug one level down.
    expect(hint).toContain("{ldapPath}");
    expect(hint.length).toBeGreaterThan(0);
    const projectionHint = metaOf(
      shapeListResponse({ ...adPayloadWithMeta(), meta: undefined }, { compactFields: ["id", "name"] }),
    ).hint as string;
    expect(hint).toContain(projectionHint);
  });

  it("still reports its own projection result", () => {
    const out = shapeListResponse(adPayloadWithMeta(), { compactFields: ["id", "name"] });
    // The merge must not cost the projection its own disclosure either.
    expect(metaOf(out).projection).toBe("compact");
    expect(metaOf(out).projectedAway ?? metaOf(out).dropped ?? metaOf(out).constant).toBeDefined();
  });

  it("preserves an upstream value under `upstream` when a non-hint key genuinely collides", () => {
    const payload = { ...adPayloadWithMeta(), meta: { projection: "elided-by-upstream" } };
    const out = shapeListResponse(payload, { compactFields: ["id", "name"] });
    // The projection's own value wins the key...
    expect(metaOf(out).projection).toBe("compact");
    // ...but the overwritten one is kept rather than dropped.
    expect((metaOf(out).upstream as Record<string, unknown>).projection).toBe("elided-by-upstream");
  });
});

describe("the ordinary case is untouched - controls", () => {
  it("adds no `upstream` key and costs nothing when there was no prior meta", () => {
    const payload = adPayloadWithMeta();
    delete payload.meta;
    const out = shapeListResponse(payload, { compactFields: ["id", "name"] });
    expect("upstream" in metaOf(out)).toBe(false);
    expect(metaOf(out).commentLdapPathElided).toBeUndefined();
    expect(metaOf(out).projection).toBe("compact");
  });

  it("returns the payload untouched under detail:true, prior meta included", () => {
    const payload = adPayloadWithMeta();
    const out = shapeListResponse(payload, { compactFields: ["id", "name"] }, { full: true });
    // full:true is documented to return the same object reference, so the
    // upstream meta survives for the reason it always did.
    expect(out).toBe(payload);
    expect(metaOf(out).commentLdapPathElided).toBe(2);
  });
});
