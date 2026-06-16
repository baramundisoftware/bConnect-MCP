/**
 * bconnect-mcp-gateway — auth middleware unit tests
 *
 * Tests loadTokenMap() and createAuthMiddleware() in isolation.
 * No MCP server packages are imported — only auth.ts, fs, and os builtins.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadTokenMap, createAuthMiddleware, type TokenMap } from "../auth.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Minimal req stub — only the fields the middleware reads. */
function makeReq(path: string, headers: Record<string, string> = {}) {
  return { path, headers } as never;
}

/** Minimal res stub — captures status + json calls. */
function makeRes() {
  const stub = {
    locals: {} as Record<string, unknown>,
    _status: 0,
    _body: null as unknown,
    status(code: number) {
      stub._status = code;
      return stub;
    },
    json(body: unknown) {
      stub._body = body;
      return stub;
    },
  };
  return stub;
}

function writeTmp(name: string, content: string): string {
  const p = join(tmpdir(), name);
  writeFileSync(p, content, "utf8");
  return p;
}

// ─── loadTokenMap ─────────────────────────────────────────────────────────────

describe("loadTokenMap", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns {} when configPath is undefined", () => {
    expect(loadTokenMap(undefined)).toEqual({});
  });

  it("returns {} when configPath is empty string", () => {
    expect(loadTokenMap("")).toEqual({});
  });

  it("parses a valid token map file", () => {
    const tokens = {
      "tok-alice": { baseUrl: "https://bms.example.com/bconnect", apiKey: "key-a" },
      "tok-bob": { username: "svc-readonly", password: "secret" },
    };
    const p = writeTmp("valid-tokens.json", JSON.stringify(tokens));
    try {
      const map = loadTokenMap(p);
      expect(map["tok-alice"]).toEqual(tokens["tok-alice"]);
      expect(map["tok-bob"]).toEqual(tokens["tok-bob"]);
      expect(Object.keys(map)).toHaveLength(2);
    } finally {
      unlinkSync(p);
    }
  });

  it("multiple tokens can share the same credentials (n:m mapping)", () => {
    const shared = { apiKey: "shared-key", baseUrl: "https://bms.example.com/bconnect" };
    const tokens = { "tok-1": shared, "tok-2": shared, "tok-3": shared };
    const p = writeTmp("shared-tokens.json", JSON.stringify(tokens));
    try {
      const map = loadTokenMap(p);
      expect(map["tok-1"]).toEqual(shared);
      expect(map["tok-2"]).toEqual(shared);
      expect(map["tok-3"]).toEqual(shared);
    } finally {
      unlinkSync(p);
    }
  });

  it("calls process.exit(1) when file does not exist", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => loadTokenMap("/nonexistent/__mcp_test_tokens.json")).toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("calls process.exit(1) for invalid JSON", () => {
    const p = writeTmp("bad-tokens.json", "not { valid json }}}");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      expect(() => loadTokenMap(p)).toThrow("process.exit called");
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      unlinkSync(p);
    }
  });

  it("calls process.exit(1) when JSON root is an array", () => {
    const p = writeTmp("array-tokens.json", "[1, 2, 3]");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      expect(() => loadTokenMap(p)).toThrow("process.exit called");
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      unlinkSync(p);
    }
  });

  it("calls process.exit(1) when JSON root is a string", () => {
    const p = writeTmp("string-tokens.json", '"just a string"');
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      expect(() => loadTokenMap(p)).toThrow("process.exit called");
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      unlinkSync(p);
    }
  });
});

// ─── createAuthMiddleware ─────────────────────────────────────────────────────

describe("createAuthMiddleware", () => {
  // ── auth disabled (empty token map) ──────────────────────────────────────

  describe("auth disabled (empty token map)", () => {
    const middleware = createAuthMiddleware({} as TokenMap);

    it("passes /health through without any header", () => {
      const next = vi.fn();
      middleware(makeReq("/health"), makeRes(), next);
      expect(next).toHaveBeenCalledOnce();
    });

    it("passes /endpoints/mcp through without any header", () => {
      const next = vi.fn();
      middleware(makeReq("/endpoints/mcp"), makeRes(), next);
      expect(next).toHaveBeenCalledOnce();
    });

    it("does not set bconnectCredentials on res.locals", () => {
      const next = vi.fn();
      const res = makeRes();
      middleware(makeReq("/endpoints/mcp"), res, next);
      expect(res.locals["bconnectCredentials"]).toBeUndefined();
    });

    it("never returns 401 even with no Authorization header", () => {
      const res = makeRes();
      middleware(makeReq("/compliance/mcp"), res, vi.fn());
      expect(res._status).toBe(0); // status() was never called
    });
  });

  // ── auth enabled (non-empty token map) ───────────────────────────────────

  describe("auth enabled (non-empty token map)", () => {
    const tokenMap: TokenMap = {
      "valid-token-a": { baseUrl: "https://bms.example.com/bconnect", apiKey: "key-a" },
      "valid-token-b": { username: "svc-readonly", password: "secret" },
    };
    const middleware = createAuthMiddleware(tokenMap);

    it("passes /health without Authorization header", () => {
      const next = vi.fn();
      middleware(makeReq("/health"), makeRes(), next);
      expect(next).toHaveBeenCalledOnce();
    });

    it("returns 401 when Authorization header is absent", () => {
      const next = vi.fn();
      const res = makeRes();
      middleware(makeReq("/endpoints/mcp"), res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res._status).toBe(401);
    });

    it("returns 401 when Authorization is Basic (not Bearer)", () => {
      const next = vi.fn();
      const res = makeRes();
      middleware(makeReq("/endpoints/mcp", { authorization: "Basic dXNlcjpwYXNz" }), res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res._status).toBe(401);
    });

    it("returns 401 for an unknown token", () => {
      const next = vi.fn();
      const res = makeRes();
      middleware(makeReq("/endpoints/mcp", { authorization: "Bearer completely-unknown-token" }), res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res._status).toBe(401);
    });

    it("returns 401 when Bearer value is empty", () => {
      const next = vi.fn();
      const res = makeRes();
      middleware(makeReq("/endpoints/mcp", { authorization: "Bearer " }), res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res._status).toBe(401);
    });

    it("passes a valid apiKey token and sets credentials on res.locals", () => {
      const next = vi.fn();
      const res = makeRes();
      middleware(makeReq("/endpoints/mcp", { authorization: "Bearer valid-token-a" }), res, next);
      expect(next).toHaveBeenCalledOnce();
      expect(res.locals["bconnectCredentials"]).toEqual(tokenMap["valid-token-a"]);
    });

    it("passes a valid username/password token and sets correct credentials", () => {
      const next = vi.fn();
      const res = makeRes();
      middleware(makeReq("/compliance/mcp", { authorization: "Bearer valid-token-b" }), res, next);
      expect(next).toHaveBeenCalledOnce();
      expect(res.locals["bconnectCredentials"]).toEqual(tokenMap["valid-token-b"]);
    });

    it("sets credentials for all domain paths (not just /endpoints)", () => {
      for (const domain of ["assets", "jobs", "software", "variables"]) {
        const next = vi.fn();
        const res = makeRes();
        middleware(makeReq(`/${domain}/mcp`, { authorization: "Bearer valid-token-a" }), res, next);
        expect(next).toHaveBeenCalledOnce();
        expect(res.locals["bconnectCredentials"]).toEqual(tokenMap["valid-token-a"]);
      }
    });

    it("does not leak credentials between requests (separate res.locals)", () => {
      const resA = makeRes();
      const resB = makeRes();
      middleware(makeReq("/endpoints/mcp", { authorization: "Bearer valid-token-a" }), resA, vi.fn());
      middleware(makeReq("/endpoints/mcp", { authorization: "Bearer valid-token-b" }), resB, vi.fn());
      expect(resA.locals["bconnectCredentials"]).toEqual(tokenMap["valid-token-a"]);
      expect(resB.locals["bconnectCredentials"]).toEqual(tokenMap["valid-token-b"]);
    });
  });

  // ── n:m credential sharing ───────────────────────────────────────────────

  describe("n:m credential sharing", () => {
    const shared = { apiKey: "shared-bconnect-key", baseUrl: "https://bms.example.com/bconnect" };
    const tokenMap: TokenMap = {
      "tok-alice": shared,
      "tok-carol": shared,
      "tok-bob": { username: "bob", password: "bobs-password" },
    };
    const middleware = createAuthMiddleware(tokenMap);

    it("alice and carol resolve to the same bConnect credentials", () => {
      const resAlice = makeRes();
      const resCarol = makeRes();
      middleware(makeReq("/endpoints/mcp", { authorization: "Bearer tok-alice" }), resAlice, vi.fn());
      middleware(makeReq("/endpoints/mcp", { authorization: "Bearer tok-carol" }), resCarol, vi.fn());
      expect(resAlice.locals["bconnectCredentials"]).toEqual(shared);
      expect(resCarol.locals["bconnectCredentials"]).toEqual(shared);
    });

    it("bob resolves to different credentials from alice", () => {
      const res = makeRes();
      middleware(makeReq("/endpoints/mcp", { authorization: "Bearer tok-bob" }), res, vi.fn());
      expect(res.locals["bconnectCredentials"]).toEqual(tokenMap["tok-bob"]);
      expect(res.locals["bconnectCredentials"]).not.toEqual(shared);
    });
  });
});
