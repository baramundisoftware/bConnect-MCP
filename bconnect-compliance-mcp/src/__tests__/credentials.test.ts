/**
 * bconnect-compliance-mcp — credential injection tests
 *
 * Verifies that createServer(credentials) passes the injected credentials
 * to BConnectClient instead of reading from environment variables.
 * BConnectClient is mocked so no real bConnect connection is made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// vi.mock is hoisted — must appear before imports that reference the mocked module.
vi.mock("../bconnect-client.js", () => ({
  BConnectClient: vi.fn(),
}));

// Import AFTER vi.mock so we get the mocked version.
import { BConnectClient } from "../bconnect-client.js";
import { createServer } from "../index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function connectClient(credentials?: Parameters<typeof createServer>[0]) {
  const { server } = createServer(credentials);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createServer credential injection", () => {
  beforeEach(() => {
    // Reset mock state before each test
    vi.mocked(BConnectClient).mockReset();

    // Provide a minimal compliance stub so tool calls resolve instead of throwing
    vi.mocked(BConnectClient).mockImplementation(() => ({
      compliance: {
        getDetectedRuleViolations: vi.fn().mockResolvedValue({ data: [], totalItems: 0 }),
        getAllDetectedVulnerabilities: vi.fn().mockResolvedValue({ data: [], totalItems: 0 }),
        getAllMobileDeviceRules: vi.fn().mockResolvedValue({ data: [], totalItems: 0 }),
        getAllVulnerabilities: vi.fn().mockResolvedValue({ data: [], totalItems: 0 }),
        getDetectedRuleViolationsForEndpoint: vi.fn().mockResolvedValue({ data: [], totalItems: 0 }),
        getDetectedVulnerabilitiesByEndpoint: vi.fn().mockResolvedValue({ data: [], totalItems: 0 }),
        getMobileDeviceRule: vi.fn().mockResolvedValue({}),
        getVulnerability: vi.fn().mockResolvedValue({}),
      },
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("createServer() still works without credentials (env-var mode)", async () => {
    // Just verify initialization and tool listing work with no credentials parameter
    const client = await connectClient();
    const { tools } = await client.listTools();
    // 8 upstream + get_vulnerability_exposure and get_unpatched_endpoints
    // (LOCAL ADDITIONS, not upstream).
    expect(tools).toHaveLength(10);
  });

  it("passes injected apiKey credentials to BConnectClient", async () => {
    const credentials = {
      baseUrl: "https://injected.example.com/bconnect",
      apiKey: "injected-api-key",
    };

    const client = await connectClient(credentials);
    await client.callTool({ name: "list_detected_rule_violations", arguments: {} });

    expect(vi.mocked(BConnectClient)).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: credentials.baseUrl,
        apiKey: credentials.apiKey,
      })
    );
  });

  it("passes injected username/password credentials to BConnectClient", async () => {
    const credentials = {
      baseUrl: "https://injected.example.com/bconnect",
      username: "injected-user",
      password: "injected-pass",
    };

    const client = await connectClient(credentials);
    await client.callTool({ name: "list_detected_rule_violations", arguments: {} });

    expect(vi.mocked(BConnectClient)).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: credentials.baseUrl,
        username: credentials.username,
        password: credentials.password,
      })
    );
  });

  it("prefers injected credentials over environment variables", async () => {
    const savedEnv = {
      BCONNECT_BASE_URL: process.env.BCONNECT_BASE_URL,
      BCONNECT_API_KEY: process.env.BCONNECT_API_KEY,
    };

    process.env.BCONNECT_BASE_URL = "https://env-var.example.com/bconnect";
    process.env.BCONNECT_API_KEY = "env-var-api-key";

    try {
      const client = await connectClient({
        baseUrl: "https://injected.example.com/bconnect",
        apiKey: "injected-api-key",
      });
      await client.callTool({ name: "list_detected_rule_violations", arguments: {} });

      // Must use injected values, not env vars
      expect(vi.mocked(BConnectClient)).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: "injected-api-key" })
      );
      expect(vi.mocked(BConnectClient)).not.toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: "env-var-api-key" })
      );
    } finally {
      if (savedEnv.BCONNECT_BASE_URL !== undefined) {
        process.env.BCONNECT_BASE_URL = savedEnv.BCONNECT_BASE_URL;
      } else {
        delete process.env.BCONNECT_BASE_URL;
      }
      if (savedEnv.BCONNECT_API_KEY !== undefined) {
        process.env.BCONNECT_API_KEY = savedEnv.BCONNECT_API_KEY;
      } else {
        delete process.env.BCONNECT_API_KEY;
      }
    }
  });

  it("falls back to environment variables when no credentials are injected", async () => {
    const savedEnv = {
      BCONNECT_BASE_URL: process.env.BCONNECT_BASE_URL,
      BCONNECT_API_KEY: process.env.BCONNECT_API_KEY,
    };

    process.env.BCONNECT_BASE_URL = "https://env-only.example.com/bconnect";
    process.env.BCONNECT_API_KEY = "env-only-api-key";

    try {
      const client = await connectClient(); // no credentials
      await client.callTool({ name: "list_detected_rule_violations", arguments: {} });

      expect(vi.mocked(BConnectClient)).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: "env-only-api-key" })
      );
    } finally {
      if (savedEnv.BCONNECT_BASE_URL !== undefined) {
        process.env.BCONNECT_BASE_URL = savedEnv.BCONNECT_BASE_URL;
      } else {
        delete process.env.BCONNECT_BASE_URL;
      }
      if (savedEnv.BCONNECT_API_KEY !== undefined) {
        process.env.BCONNECT_API_KEY = savedEnv.BCONNECT_API_KEY;
      } else {
        delete process.env.BCONNECT_API_KEY;
      }
    }
  });

  // ── R3 — client lifetime ────────────────────────────────────────────────────
  //
  // This block previously asserted the opposite: "BConnectClient constructed
  // twice (once per tool call, lazy init)". That was the defect, written down
  // as the expectation — a client rebuilt per call cannot hold a rate-limit
  // window or a response cache, which is why B7 and B8 could never work. The
  // assertions below are what R3's fix looks like from the outside.

  it("reuses one client across tool calls in a session (R3)", async () => {
    const credentials = {
      baseUrl: "https://injected.example.com/bconnect",
      apiKey: "stateless-test-key",
    };

    const client = await connectClient(credentials);
    await client.callTool({ name: "list_detected_rule_violations", arguments: {} });
    await client.callTool({ name: "list_mobile_device_rules", arguments: {} });

    // One construction, not one per call — so anything stateful the client
    // owns survives between tool calls.
    expect(vi.mocked(BConnectClient)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(BConnectClient).mock.calls[0][0]).toMatchObject({
      apiKey: "stateless-test-key",
    });
  });

  it("never shares a client between differently-credentialed sessions", async () => {
    const a = await connectClient({
      baseUrl: "https://a.example.com/bconnect",
      apiKey: "session-a-key",
    });
    const b = await connectClient({
      baseUrl: "https://b.example.com/bconnect",
      apiKey: "session-b-key",
    });

    await a.callTool({ name: "list_detected_rule_violations", arguments: {} });
    await b.callTool({ name: "list_detected_rule_violations", arguments: {} });

    // Two sessions, two clients, each with only its own key.
    expect(vi.mocked(BConnectClient)).toHaveBeenCalledTimes(2);
    const keys = vi.mocked(BConnectClient).mock.calls.map((c) => (c[0] as { apiKey?: string }).apiKey);
    expect(keys).toEqual(["session-a-key", "session-b-key"]);
  });

  it("rebuilds the client when the resolved credentials change mid-session", async () => {
    const savedEnv = {
      BCONNECT_BASE_URL: process.env.BCONNECT_BASE_URL,
      BCONNECT_API_KEY: process.env.BCONNECT_API_KEY,
    };

    process.env.BCONNECT_BASE_URL = "https://rotating.example.com/bconnect";
    process.env.BCONNECT_API_KEY = "key-before-rotation";

    try {
      const client = await connectClient(); // env-var mode
      await client.callTool({ name: "list_detected_rule_violations", arguments: {} });

      process.env.BCONNECT_API_KEY = "key-after-rotation";
      await client.callTool({ name: "list_detected_rule_violations", arguments: {} });

      // The memo is keyed on the resolved config, so a rotated key is picked
      // up rather than a stale client being handed out.
      expect(vi.mocked(BConnectClient)).toHaveBeenCalledTimes(2);
      const keys = vi.mocked(BConnectClient).mock.calls.map((c) => (c[0] as { apiKey?: string }).apiKey);
      expect(keys).toEqual(["key-before-rotation", "key-after-rotation"]);
    } finally {
      if (savedEnv.BCONNECT_BASE_URL !== undefined) {
        process.env.BCONNECT_BASE_URL = savedEnv.BCONNECT_BASE_URL;
      } else {
        delete process.env.BCONNECT_BASE_URL;
      }
      if (savedEnv.BCONNECT_API_KEY !== undefined) {
        process.env.BCONNECT_API_KEY = savedEnv.BCONNECT_API_KEY;
      } else {
        delete process.env.BCONNECT_API_KEY;
      }
    }
  });
});
