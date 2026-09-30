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
    expect(tools).toHaveLength(8);
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

  it("each tool call receives the same injected credentials (stateless per-request)", async () => {
    const credentials = {
      baseUrl: "https://injected.example.com/bconnect",
      apiKey: "stateless-test-key",
    };

    const client = await connectClient(credentials);
    await client.callTool({ name: "list_detected_rule_violations", arguments: {} });
    await client.callTool({ name: "list_mobile_device_rules", arguments: {} });

    // BConnectClient constructed twice (once per tool call, lazy init)
    expect(vi.mocked(BConnectClient)).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(BConnectClient).mock.calls) {
      expect(call[0]).toMatchObject({ apiKey: "stateless-test-key" });
    }
  });
});
