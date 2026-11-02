/**
 * bconnect-mcp-gateway — MCP_GATEWAY_MAX_BODY units (#330).
 */

import { describe, expect, it } from "vitest";

import { maxBodyBytes } from "../body-limit.js";

describe("maxBodyBytes", () => {
  it.each([undefined, "", "  "])("gives 1mb for %j", (value) => {
    expect(maxBodyBytes(value)).toBe(1024 * 1024);
  });

  it.each([
    ["1024", 1024],
    ["2048b", 2048],
    ["512kb", 512 * 1024],
    ["512KB", 512 * 1024],
    ["2 mb", 2 * 1024 * 1024],
    [" 1mb ", 1024 * 1024],
    ["100mb", 100 * 1024 * 1024],
  ])("reads %j as %d bytes", (value, bytes) => {
    expect(maxBodyBytes(value)).toBe(bytes);
  });

  it.each(["1m", "10mib", "1k", "1gb", "1.5mb", "-1kb", "1  mb", "mb", "lots", "0", "1023", "101mb", "0x400"])(
    "refuses %j with the variable and what it accepts",
    (value) => {
      expect(() => maxBodyBytes(value)).toThrow(
        `MCP_GATEWAY_MAX_BODY=${JSON.stringify(value)} isn't valid. Use a whole number of bytes, kb or mb (for example 512kb or 2mb), from 1kb to 100mb.`,
      );
    },
  );

  it("reads a long value in linear time", () => {
    const started = performance.now();
    expect(() => maxBodyBytes("1".repeat(50_000) + "!")).toThrow(/isn't valid/);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
