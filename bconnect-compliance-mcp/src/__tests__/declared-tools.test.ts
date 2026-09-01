/**
 * bconnect-compliance-mcp — the declaration layer (findings OPT-31, codegen gap)
 *
 * Three things this file is for, in descending order of how much they cost if
 * they break:
 *
 *  1. THE COMPOSITES ARE UNTOUCHED. `get_unpatched_endpoints` and
 *     `get_vulnerability_exposure` are two of the thirteen protected demo tools.
 *     `composite()` passes them through by identity, and the schemas are
 *     asserted here against the exact property sets index.ts advertised before
 *     the move, so "derived the catalogue" cannot quietly mean "reshaped the
 *     two tools the demo depends on".
 *  2. THE DERIVED SCHEMAS MATCH THE SPEC. Not by re-deriving them (that would
 *     assert the layer against itself) but against the routes as written in
 *     openapi-specs/26R1/bConnect_Compliance.json, quoted here.
 *  3. THE GENERATED INDEX IS NOT HAND-EDITED. The drift check the survey asked
 *     for, and the gap CONTRIBUTING.md:33-34 already admits.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../index.js";
import { DECLARED } from "../declared-tools.js";
import { COMPLIANCE_OPERATIONS } from "../generated/compliance-operations.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, "..", "..");

interface Tool {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, { description?: string }>; required?: string[] };
}

async function listTools(): Promise<Tool[]> {
  const { server } = createServer({
    baseUrl: "https://declared.invalid/bconnect",
    username: "u",
    password: "p",
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" }, { capabilities: {} });
  await Promise.all([server.connect(st), client.connect(ct)]);
  const { tools } = await client.listTools();
  await client.close();
  await server.close();
  return tools as Tool[];
}

const props = (tool: Tool | undefined): string[] => Object.keys(tool?.inputSchema?.properties ?? {});

describe("declaration layer", () => {
  it("advertises the same ten tools, in the same order", async () => {
    expect((await listTools()).map((t) => t.name)).toEqual([
      "get_vulnerability_exposure",
      "get_unpatched_endpoints",
      "list_detected_rule_violations",
      "list_detected_rule_violations_by_endpoint",
      "list_detected_vulnerabilities",
      "list_detected_vulnerabilities_by_endpoint",
      "list_mobile_device_rules",
      "get_mobile_device_rule",
      "list_vulnerabilities",
      "get_vulnerability",
    ]);
  });

  it("declares no write tools: this server is GET-only", () => {
    expect(DECLARED.write).toEqual([]);
    // Every operation in the spec is a GET, so a write tool here would be a
    // mistake rather than a policy question.
    for (const op of Object.values(COMPLIANCE_OPERATIONS.operations)) {
      expect(op.method, op.operationId).toBe("get");
    }
  });

  describe("the two composites pass through untouched", () => {
    it("get_unpatched_endpoints keeps its exact parameter set", async () => {
      const tool = (await listTools()).find((t) => t.name === "get_unpatched_endpoints");
      expect(props(tool)).toEqual([
        "minCvss",
        "limit",
        "reachableWithinDays",
        "staleAfterDays",
        "onlyReachable",
        "includeIgnored",
        "refresh",
      ]);
      expect(tool?.inputSchema?.required ?? []).toEqual([]);
      // It answers no single route, so there is nothing to derive from.
      expect(DECLARED.routeFor("get_unpatched_endpoints")).toBeUndefined();
    });

    it("get_vulnerability_exposure keeps its exact parameter set", async () => {
      const tool = (await listTools()).find((t) => t.name === "get_vulnerability_exposure");
      expect(props(tool)).toEqual([
        "minCvss",
        "endpointName",
        "includeIgnored",
        "topEndpoints",
        "refreshLibrary",
        "includeScanAge",
        "staleAfterDays",
      ]);
      expect(DECLARED.routeFor("get_vulnerability_exposure")).toBeUndefined();
    });

    it("the composites still validate their own arguments", () => {
      // `composite()` takes hand-authored rules because there is no operation
      // behind it. Dropping them would silently disable validation on the two
      // tools that do the most work per call.
      expect(() => DECLARED.validate("get_unpatched_endpoints", { minCvss: 42 })).toThrow();
      expect(() => DECLARED.validate("get_unpatched_endpoints", { minCvss: 7 })).not.toThrow();
      expect(() =>
        DECLARED.validate("get_vulnerability_exposure", { topEndpoints: 0 })
      ).toThrow();
    });
  });

  describe("the derived schemas match the routes", () => {
    it.each([
      ["list_detected_rule_violations", "GET", "/v2.0/DetectedRuleViolations"],
      ["list_detected_rule_violations_by_endpoint", "GET", "/v2.0/Endpoints/{endpointId}/DetectedRuleViolations"],
      ["list_detected_vulnerabilities", "GET", "/v2.0/DetectedVulnerabilities"],
      ["list_detected_vulnerabilities_by_endpoint", "GET", "/v2.0/WindowsEndpoints/{endpointId}/DetectedVulnerabilities"],
      ["list_mobile_device_rules", "GET", "/v2.0/Rules"],
      ["get_mobile_device_rule", "GET", "/v2.0/Rules/{id}"],
      ["list_vulnerabilities", "GET", "/v2.0/Vulnerabilities"],
      ["get_vulnerability", "GET", "/v2.0/Vulnerabilities/{id}"],
    ])("%s -> %s %s", (tool, method, route) => {
      expect(DECLARED.routeFor(tool)).toEqual({ method: method.toLowerCase(), path: route });
    });

    it("a list tool advertises the four query parameters its route declares, and countOnly", async () => {
      const tool = (await listTools()).find((t) => t.name === "list_detected_rule_violations");
      expect(props(tool)).toEqual(["OrderBy", "SearchQuery", "Page", "PageSize", "countOnly"]);
    });

    it("a by-endpoint tool requires the path parameter and no more", async () => {
      const tool = (await listTools()).find(
        (t) => t.name === "list_detected_vulnerabilities_by_endpoint"
      );
      expect(tool?.inputSchema?.required).toEqual(["endpointId"]);
      expect(props(tool)).toContain("endpointId");
    });

    it("D6: no tool advertises a parameter its route does not declare", async () => {
      // The whole reason `expose` is checked at construction. bConnect answers
      // 200 and silently drops an unknown query parameter, so an over-advertised
      // filter returns an unfiltered result that looks filtered.
      const local = new Set(["countOnly", "detail", "fields", "includeSubfolders"]);
      for (const tool of await listTools()) {
        const route = DECLARED.routeFor(tool.name);
        if (!route) {continue;} // composite
        const declared = new Set(
          Object.values(COMPLIANCE_OPERATIONS.operations)
            .filter((op) => op.path === route.path && op.method === route.method)
            .flatMap((op) => op.parameters.map((p) => p.name))
        );
        for (const name of props(tool)) {
          if (local.has(name)) {continue;}
          expect(declared.has(name), `${tool.name} advertises "${name}", which ${route.path} does not declare`).toBe(true);
        }
      }
    });

    it("uses the canonical Page/PageSize wording rather than the vendor's 105-byte sentence", async () => {
      const tool = (await listTools()).find((t) => t.name === "list_vulnerabilities");
      const page = tool?.inputSchema?.properties?.Page?.description ?? "";
      expect(page.length).toBeLessThan(50);
      expect(page).toMatch(/0-based|zero-indexed/i);
      // The spec's own prose, which the layer refuses to copy.
      expect(page).not.toContain("the set of pages that are returned in the response");
    });
  });

  describe("the generated operation index", () => {
    it("is byte-identical to a fresh run against openapi-specs/26R1", async () => {
      // The codegen gap CONTRIBUTING.md:33-34 admits. Without this, a hand-edit
      // to src/generated/ survives forever and the spec stops being the source.
      const gen = await import(
        /* @vite-ignore */ path.join(PKG, "scripts", "generate-operation-index.mjs")
      );
      for (const target of gen.TARGETS) {
        const file = gen.outputPath(target);
        expect(fs.readFileSync(file, "utf8"), `${file} is stale — regenerate`).toBe(
          gen.render(target)
        );
      }
    });

    it("holds exactly the eight operations the compliance spec declares", () => {
      expect(Object.keys(COMPLIANCE_OPERATIONS.operations).sort()).toEqual([
        "GetAllDetectedVulnerabilities",
        "GetAllMobileDeviceRules",
        "GetAllVulnerabilities",
        "GetDetectedRuleViolations",
        "GetDetectedRuleViolationsForEndpoint",
        "GetDetectedVulnerabilitiesByEndpoint",
        "GetMobileDeviceRule",
        "GetVulnerability",
      ]);
    });
  });
});
