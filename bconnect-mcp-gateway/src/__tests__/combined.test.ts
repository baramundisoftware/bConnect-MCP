/**
 * bconnect-mcp-gateway — MCP_GATEWAY_COMBINED (#131).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { COMBINED_INFO, combinedDomains } from "../combined.js";

const KNOWN = ["assets", "compliance", "groups", "jobs"];
const ACCEPTS = "Use all, or domain names separated by commas: assets, compliance, groups, jobs.";

describe("combinedDomains", () => {
  it.each([undefined, "", "   "])("is off (undefined) for %j", (value) => {
    expect(combinedDomains(value, KNOWN)).toBeUndefined();
  });

  it.each(["all", " ALL ", "all,all", "all,"])("%j gives every domain, in the gateway's order", (value) => {
    expect(combinedDomains(value, KNOWN)).toEqual(KNOWN);
  });

  it.each([
    ["jobs,assets", ["assets", "jobs"]],
    [" Groups , compliance ", ["compliance", "groups"]],
    ["assets,,assets,", ["assets"]],
  ])("reads %j as %j", (value, expected) => {
    expect(combinedDomains(value, KNOWN)).toEqual(expected);
  });

  it.each([
    [",", "it names no domain"],
    [" , ,", "it names no domain"],
    ["all,assets", "all stands alone"],
    ["assets,nope", '"nope" is not a domain'],
    ["nope,false", '"nope", "false" are not a domain'],
    ["true", '"true" is not a domain'],
    ["constructor", '"constructor" is not a domain'],
  ])("refuses %j: %s", (value, reason) => {
    expect(() => combinedDomains(value, KNOWN)).toThrow(
      `MCP_GATEWAY_COMBINED=${JSON.stringify(value)} isn't valid: ${reason}. ${ACCEPTS}`,
    );
  });

  it("reads a long value in linear time", () => {
    const started = performance.now();
    expect(() => combinedDomains(" ,".repeat(50_000) + "x", KNOWN)).toThrow(/isn't valid/);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("COMBINED_INFO", () => {
  it("names the gateway with its package version", () => {
    const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
    expect(COMBINED_INFO).toEqual({ name: "bconnect-mcp-gateway", version });
  });
});
