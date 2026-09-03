/**
 * The sub-resource 404 declaration and the scan that finds undeclared ones
 * (ARCH-1, ARCH-9).
 *
 * The defect: the M5 policy was opt-in per route — correctly, a blanket rule
 * would report a Linux endpoint as having no vulnerabilities — but there was no
 * way to tell a route that had been CONSIDERED from one nobody had looked at.
 * One of 34 sub-resource reads had opted in, and its own sibling
 * (/compliance/v2.0/Endpoints/{id}/DetectedRuleViolations) answers 404 for
 * valid endpoint ids while telling the caller the id is wrong or the route is
 * absent.
 *
 * `__tests__/suite-absent-empty-zero.test.ts` runs this scan over the shipped
 * server sources. Here it is exercised against fixtures, so the rule itself is
 * pinned independently of whatever the servers currently look like.
 */

import { describe, it, expect } from "vitest";
import {
  findSubResourceCalls,
  isSubResourceTemplate,
  notOverloaded404,
  isHonestNotFound,
  readSubResource,
  readSubResourceWhereEmptyIsAmbiguous,
  isDataUnavailable,
  BConnectApiError,
} from "../src/index.js";

const MODULE = (body: string): string => `export class Module {
  private basePath = '/compliance/v2.0';
${body}
}
`;

describe("what counts as a sub-resource read", () => {
  it("is an id followed by another path segment, not a get-by-id", () => {
    // A get-by-id's 404 is honest by construction — there is no second thing
    // the server could be reporting — so it is not in scope.
    expect(isSubResourceTemplate("${this.basePath}/Endpoints/${id}/VariableInstances")).toBe(true);
    expect(isSubResourceTemplate("${this.basePath}/Endpoints/${id}")).toBe(false);
    expect(isSubResourceTemplate("${this.basePath}/Endpoints")).toBe(false);
    // The leading base path is a module prefix, not an id.
    expect(isSubResourceTemplate("${this.basePath}/AssetStock/Folders")).toBe(false);
    // A literal base path still resolves correctly.
    expect(isSubResourceTemplate("/endpoints/v2.0/${segment}/${id}/Endpoints")).toBe(true);
  });
});

describe("a path template is not a sentence", () => {
  it("rejects prose that happens to contain ${x}/word", () => {
    // Verbatim from endpoint-reach.ts, where it is part of a note explaining a
    // bounded walk. It matched the interpolation-then-segment rule exactly and
    // spent a session on the 404 backlog as a route to go and measure.
    expect(
      isSubResourceTemplate(
        "or past maxGroupsChecked=${o.maxGroupsChecked}/budgetMs=${o.budgetMs}). The endpoint may be in "
      )
    ).toBe(false);
  });

  it("still accepts every real path shape the suite uses", () => {
    // The narrowing must not cost a single real read — that is the direction
    // that manufactures clean bills nobody issued.
    expect(isSubResourceTemplate("${this.basePath}/Endpoints/${id}/VariableInstances")).toBe(true);
    expect(isSubResourceTemplate("/endpoints/v2.0/${segment}/${id}/Endpoints")).toBe(true);
    expect(isSubResourceTemplate("/compliance/v2.0/WindowsEndpoints/${id}/DetectedVulnerabilities")).toBe(true);
    expect(isSubResourceTemplate("${this.basePath}/Bundles/${bundleId}/BundleApplications/${id}")).toBe(true);
  });
});

describe("read and write are told apart, and doubt resolves to read", () => {
  const call = (body: string): { kind: string } => findSubResourceCalls(MODULE(body))[0];

  it("labels a GET a read", () => {
    expect(
      call(`  async get(id: string) {
    return (await this.httpClient.get(\`\${this.basePath}/A/\${id}/Sub\`)).data;
  }`).kind
    ).toBe("read");
  });

  it("labels a GET with a type argument a read", () => {
    // `.get<T>(` is the spelling that made 51 reads invisible once already.
    expect(
      call(`  async get(id: string) {
    return (await this.httpClient.get<Thing>(\`\${this.basePath}/A/\${id}/Sub\`)).data;
  }`).kind
    ).toBe("read");
  });

  it("labels POST, PATCH and DELETE writes", () => {
    for (const verb of ["post", "patch", "delete"]) {
      expect(
        call(`  async act(id: string) {
    await this.httpClient.${verb}(\`\${this.basePath}/JobInstances/\${id}/Start\`);
  }`).kind,
        `${verb} should be a write`
      ).toBe("write");
    }
  });

  it("reads the verb through a multi-line call and a leading argument", () => {
    // `.post(\n  \`…\`,` and `readRows(http, \`…\`)` are both live shapes.
    expect(
      call(`  async act(id: string, data: unknown) {
    await this.httpClient.post(
      \`\${this.basePath}/LogicalGroups/\${id}/AssignJobDefinition\`,
      data
    );
  }`).kind
    ).toBe("write");
    expect(
      call(`  async act(http: unknown, id: string) {
    return readRows(http, \`/jobs/v2.0/Endpoints/\${id}/JobInstances\`, 100);
  }`).kind
    ).toBe("read");
  });

  it("does not let a distant write capture a read", () => {
    // The dangerous direction: a read labelled "write" leaves the read backlog,
    // and absence from that list is how a read declares itself fine. A `.post(`
    // earlier in the same method must not claim this template.
    //
    // THIS test is the only thing that discriminates it. Mutating GAP to accept
    // anything was killed here and NOT by the suite guard, because no module in
    // the tree currently puts a write and a read close enough together for the
    // tree-level count to change. So the property is pinned on a fixture on
    // purpose — the suite would go on passing while the classifier silently
    // ate reads.
    const found = findSubResourceCalls(
      MODULE(`  async mixed(id: string, data: unknown) {
    await this.httpClient.post(\`\${this.basePath}/Other/\${id}/Thing\`, data);
    const check = compute(id);
    return \`\${this.basePath}/A/\${id}/Sub\`;
  }`)
    );
    // Selected by template, not by index: the method holds two sub-resource
    // paths and the write is the first of them.
    const bare = found.find((c) => c.template.endsWith("/A/${id}/Sub"));
    expect(bare, "the trailing template was not found at all").toBeDefined();
    expect(bare!.kind).toBe("read");
    // Vacuity: the fixture really does contain a write for it to be captured
    // BY, so "read" above is the gap test working and not an empty scan.
    expect(found.find((c) => c.template.endsWith("/Other/${id}/Thing"))!.kind).toBe("write");
  });

  it("defaults to read when no verb governs the template at all", () => {
    expect(
      call(`  async bare(id: string) {
    const path = \`\${this.basePath}/A/\${id}/Sub\`;
    return path;
  }`).kind
    ).toBe("read");
  });

  it("still reports writes rather than dropping them", () => {
    // Filtering them out here would make 18 routes vanish from every
    // enumeration at once, and a thing absent from the scan is
    // indistinguishable from a thing that was checked.
    const found = findSubResourceCalls(
      MODULE(`  async act(id: string) {
    await this.httpClient.post(\`\${this.basePath}/JobInstances/\${id}/Start\`);
  }`)
    );
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("write");
  });
});

describe("findSubResourceCalls", () => {
  it("reports an undeclared read", () => {
    const found = findSubResourceCalls(
      MODULE(`  async getViolations(endpointId: string) {
    const response = await this.httpClient.get(\`\${this.basePath}/Endpoints/\${endpointId}/DetectedRuleViolations\`);
    return response.data;
  }`)
    );
    expect(found).toHaveLength(1);
    expect(found[0].declared).toBe(false);
    expect(found[0].template).toContain("/DetectedRuleViolations");
    expect(found[0].line).toBe(4);
  });

  it("accepts a ParentNotFoundPolicy as the declaration", () => {
    const found = findSubResourceCalls(
      MODULE(`  async getVulnerabilities(endpointId: string) {
    return readSubResource(
      async () => {
        const response = await this.httpClient.get(\`\${this.basePath}/WindowsEndpoints/\${endpointId}/DetectedVulnerabilities\`);
        return response.data;
      },
      endpointId,
      { subject: 'detected vulnerabilities', servesPlatform: 'Windows', howToDisambiguate: 'Call get_endpoint.' }
    );
  }`)
    );
    expect(found).toHaveLength(1);
    expect(found[0].declared).toBe(true);
  });

  it("accepts notOverloaded404 as the declaration too — a checked route is a declared route", () => {
    const found = findSubResourceCalls(
      MODULE(`  async getBundleApplications(bundleId: string) {
    return readSubResource(
      async () => (await this.httpClient.get(\`\${this.basePath}/Bundles/\${bundleId}/BundleApplications\`)).data,
      bundleId,
      notOverloaded404('Measured: an empty bundle answers 200 with totalItems 0.')
    );
  }`)
    );
    expect(found).toHaveLength(1);
    expect(found[0].declared).toBe(true);
  });

  it("does not let one declared method vouch for the next one", () => {
    // The failure that would make this scan useless: attributing a declaration
    // to a read in a different method.
    const found = findSubResourceCalls(
      MODULE(`  async declared(id: string) {
    return readSubResource(
      async () => (await this.httpClient.get(\`\${this.basePath}/A/\${id}/Sub\`)).data,
      id,
      notOverloaded404('checked')
    );
  }

  async undeclared(id: string) {
    const response = await this.httpClient.get(\`\${this.basePath}/B/\${id}/Sub\`);
    return response.data;
  }`)
    );
    expect(found.map((read) => read.declared)).toEqual([true, false]);
  });

  it("accepts a declaration passed as an ARGUMENT beside the path", () => {
    // How bconnect-insights-mcp declares: its reads live in top-level functions
    // that no class-method attribution can reach.
    const found = findSubResourceCalls(
      `export async function brief(http: HttpLike, id: string) {
  const rows = await readRows(http, \`/jobs/v2.0/Endpoints/\${id}/JobInstances\`, 100, notOverloaded404("Measured 2026-08-14."));
  return rows;
}
`
    );
    expect(found).toHaveLength(1);
    expect(found[0].declared).toBe(true);
  });

  it("does not let a SIBLING read in the same statement borrow the declaration", () => {
    // The failure that makes this whole approach worth its complexity, and the
    // reason attribution was NOT widened to top-level functions instead.
    // deployment-coverage.ts puts three of these in one Promise.all([...]), so
    // a statement-scoped scan would hand one declaration to all three.
    const found = findSubResourceCalls(
      `export async function coverage(http: HttpLike, o: Options) {
  const [a, b] = await Promise.all([
    readRows(http, \`/software/v2.0/Bundles/\${o.bundleId}/BundleApplications\`, 200),
    readRows(http, \`/endpoints/v2.0/LogicalGroups/\${o.groupId}/Endpoints\`, 200, notOverloaded404("Measured.")),
  ]);
  return [a, b];
}
`
    );
    expect(found).toHaveLength(2);
    // Order is source order: the undeclared one comes first.
    expect(found[0].template).toContain("/BundleApplications");
    expect(found[0].declared, "an undeclared sibling borrowed the declaration").toBe(false);
    // Vacuity: the declared one really is declared, so `false` above is the
    // paren-depth scan working and not the argument check being dead.
    expect(found[1].template).toContain("/Endpoints");
    expect(found[1].declared).toBe(true);
  });

  it("does not let a declaration BEFORE the template in the same statement count", () => {
    // Paren depth only looks forward from the path. A declaration built for an
    // earlier argument must not cover a later read.
    const found = findSubResourceCalls(
      `export async function two(http: HttpLike, id: string) {
  const out = await Promise.all([
    readRows(http, \`/a/v2.0/A/\${id}/Sub\`, 100, notOverloaded404("Measured.")),
    readRows(http, \`/a/v2.0/B/\${id}/Sub\`, 100),
  ]);
  return out;
}
`
    );
    expect(found.map((c) => c.declared)).toEqual([true, false]);
  });

  it("accepts an inline ParentNotFoundPolicy argument too", () => {
    const found = findSubResourceCalls(
      `export async function vulns(http: HttpLike, id: string) {
  return readRows(http, \`/compliance/v2.0/WindowsEndpoints/\${id}/DetectedVulnerabilities\`, 100, {
    subject: "detected vulnerabilities",
    servesPlatform: "Windows",
    howToDisambiguate: "Call get_endpoint.",
  });
}
`
    );
    expect(found).toHaveLength(1);
    expect(found[0].declared).toBe(true);
  });

  it("finds nothing in a module that reads no sub-resources", () => {
    expect(
      findSubResourceCalls(
        MODULE(`  async list() {
    return (await this.httpClient.get(\`\${this.basePath}/Vulnerabilities\`)).data;
  }`)
      )
    ).toEqual([]);
  });
});

describe("an empty page that might not be empty (the 200 is overloaded)", () => {
  // Measured live 2026-08-14: /jobs/v2.0/JobDefinitions/{id}/KioskReleases
  // answers 200 with totalItems 0 for a job definition that does not exist,
  // while its JobInstances sibling 404s for the same ids.
  const POLICY = {
    subject: "kiosk releases",
    parentKind: "job definition",
    reason: "Measured 2026-08-14.",
  };
  const notFound = (): Promise<never> =>
    Promise.reject(new BConnectApiError(404, "Resource not found.", { method: "GET", path: "/x" }));
  const exists = (): Promise<{ id: string }> => Promise.resolve({ id: "j-1" });

  it("refuses to report zero when the parent does not exist", async () => {
    // The whole defect. Without this the caller is told the job has no kiosk
    // releases, with no error and nothing to notice.
    //
    // THIS is the assertion that discriminates it. Two of the six mutations
    // that restore the defect are killed by `tsc` instead (an early `return`
    // makes the rest unreachable), and a build failure proves nothing about
    // what the tests constrain. The mutation that reaches runtime — detecting
    // empty on the wrong count, so an empty page is never recognised — is
    // caught here and only here.
    await expect(
      readSubResourceWhereEmptyIsAmbiguous(
        () => Promise.resolve({ data: [], totalItems: 0 }),
        "j-missing",
        notFound,
        POLICY
      )
    ).rejects.toThrow(/does not exist, so this is NOT "no kiosk releases"/);
  });

  it("returns a genuine zero when the parent is real", async () => {
    // A real job definition with zero kiosk releases EXISTS on the reference
    // estate, so this is the reachable benign case, not a hypothetical.
    const page = { data: [], totalItems: 0 };
    await expect(
      readSubResourceWhereEmptyIsAmbiguous(() => Promise.resolve(page), "j-1", exists, POLICY)
    ).resolves.toBe(page);
  });

  it("does not spend a request confirming a parent that returned rows", async () => {
    // A non-empty page is its own proof the parent exists. If this ever costs a
    // second call, the common path has been made more expensive for nothing.
    let confirmed = 0;
    const page = { data: [{ id: "k-1" }], totalItems: 1 };
    const out = await readSubResourceWhereEmptyIsAmbiguous(
      () => Promise.resolve(page),
      "j-1",
      () => {
        confirmed++;
        return exists();
      },
      POLICY
    );
    expect(out).toBe(page);
    expect(confirmed).toBe(0);
  });

  it("treats totalItems 0 with rows present as the rows, not as empty", async () => {
    // Defensive: only a page that really reports nothing is ambiguous.
    let confirmed = 0;
    await readSubResourceWhereEmptyIsAmbiguous(
      () => Promise.resolve({ data: [{ id: "k-1" }], totalItems: 3 }),
      "j-1",
      () => {
        confirmed++;
        return exists();
      },
      POLICY
    );
    expect(confirmed).toBe(0);
  });

  it("lets a 403 while confirming through, rather than calling it a bad id", async () => {
    // A credential scoped away from the parent means we STILL do not know. It
    // must not be reported as either a zero or a wrong id.
    await expect(
      readSubResourceWhereEmptyIsAmbiguous(
        () => Promise.resolve({ data: [], totalItems: 0 }),
        "j-1",
        () => Promise.reject(new BConnectApiError(403, "Forbidden", { method: "GET", path: "/x" })),
        POLICY
      )
    ).rejects.toThrow(/Forbidden/);
  });

  it("lets the sub-resource read's own failure through untouched", async () => {
    await expect(
      readSubResourceWhereEmptyIsAmbiguous(
        () => Promise.reject(new BConnectApiError(500, "Server error", { method: "GET", path: "/x" })),
        "j-1",
        exists,
        POLICY
      )
    ).rejects.toThrow(/Server error/);
  });

  it("names the parent id, so the caller can see WHICH id was wrong", async () => {
    await expect(
      readSubResourceWhereEmptyIsAmbiguous(
        () => Promise.resolve({ data: [], totalItems: 0 }),
        "j-typo-42",
        notFound,
        POLICY
      )
    ).rejects.toThrow(/j-typo-42/);
  });
});

describe("notOverloaded404 declares without changing behaviour", () => {
  it("is recognisable as the honest half", () => {
    expect(isHonestNotFound(notOverloaded404("checked 2026-08-04"))).toBe(true);
    expect(
      isHonestNotFound({ subject: "s", servesPlatform: "Windows", howToDisambiguate: "h" })
    ).toBe(false);
    expect(notOverloaded404("checked 2026-08-04").reason).toBe("checked 2026-08-04");
  });

  it("lets a 404 through as the error it is, rather than the envelope", async () => {
    // The whole point: a route whose 404 is honest must keep saying 404. Turning
    // it into "we do not know" would be the M5 defect pointed the other way.
    await expect(
      readSubResource(
        () => Promise.reject(new BConnectApiError(404, "Resource not found.", { method: "GET", path: "/x" })),
        "b-1",
        notOverloaded404("Measured: a missing bundle is the only 404 here.")
      )
    ).rejects.toThrow(/Resource not found/);
  });

  it("passes a successful read through untouched", async () => {
    const payload = { data: [], totalItems: 0 };
    const out = await readSubResource(
      () => Promise.resolve(payload),
      "b-1",
      notOverloaded404("checked")
    );
    expect(out).toBe(payload);
    expect(isDataUnavailable(out)).toBe(false);
  });
});
