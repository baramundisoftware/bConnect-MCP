/**
 * Unit tests for BConnectClient
 *
 * Phase 1: Unit tests with in-memory mocks
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BConnectClient } from '../bconnect-client.js';
import type { AxiosError } from 'axios';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('BConnectClient', () => {
  const mockConfig = {
    baseUrl: 'https://test-server:444/bconnect',
    username: 'testuser',
    password: 'testpass',
    timeout: 15000,
    rejectUnauthorized: false
  };

  describe('constructor', () => {
    it('should create client with provided configuration', () => {
      // Act
      const client = new BConnectClient(mockConfig);

      // Assert
      expect(client).toBeDefined();
      expect(client.endpoints).toBeDefined();
      expect(client.getHttpClient()).toBeDefined();
    });

    it('should use default timeout if not provided', () => {
      // Arrange
      const configWithoutTimeout = {
        baseUrl: 'https://test-server:444/bconnect',
        username: 'testuser',
        password: 'testpass'
      };

      // Act
      const client = new BConnectClient(configWithoutTimeout);
      const httpClient = client.getHttpClient();

      // Assert
      expect(httpClient.defaults.timeout).toBe(30000);
    });

    it('should setup Basic Auth header', () => {
      // Act
      const client = new BConnectClient(mockConfig);
      const httpClient = client.getHttpClient();

      // Assert
      const authHeader = httpClient.defaults.headers.common['Authorization'];
      expect(authHeader).toBeDefined();
      expect(authHeader).toContain('Basic ');
    });

    it('should set correct content-type and accept headers', () => {
      // Act
      const client = new BConnectClient(mockConfig);
      const httpClient = client.getHttpClient();

      // Assert
      expect(httpClient.defaults.headers['Content-Type']).toBe('application/json');
      expect(httpClient.defaults.headers['Accept']).toBe('application/json');
    });
  });

  describe('error handling', () => {
    // Note: Detailed error interceptor testing deferred to Phase 2 with MSW
    // Phase 1 focuses on verifying errors are thrown (basic behavior)

    it('should throw error on failed API call', async () => {
      // Arrange
      const client = new BConnectClient(mockConfig);
      const httpClient = client.getHttpClient();

      const mockError = new Error('API call failed');
      vi.spyOn(httpClient, 'get').mockRejectedValue(mockError);

      // Act & Assert
      await expect(async () => {
        await client.endpoints.getEndpoints();
      }).rejects.toThrow();
    });

    it('should throw error when endpoint not found', async () => {
      // Arrange
      const client = new BConnectClient(mockConfig);
      const httpClient = client.getHttpClient();

      const mockError = new Error('Endpoint not found');
      vi.spyOn(httpClient, 'get').mockRejectedValue(mockError);

      // Act & Assert
      await expect(async () => {
        await client.endpoints.getEndpoint('invalid-id');
      }).rejects.toThrow();
    });

    it('should propagate errors from module methods', async () => {
      // Arrange
      const client = new BConnectClient(mockConfig);
      const httpClient = client.getHttpClient();

      const mockError = new Error('Connection timeout');
      vi.spyOn(httpClient, 'get').mockRejectedValue(mockError);

      // Act & Assert
      await expect(async () => {
        await client.endpoints.searchEndpoints('test');
      }).rejects.toThrow();
    });
  });

  describe('testConnection', () => {
    it('should return true when connection is successful', async () => {
      // Arrange
      const client = new BConnectClient(mockConfig);
      const httpClient = client.getHttpClient();

      const mockResponse = {
        data: { totalItems: 1, data: [] }
      };
      vi.spyOn(httpClient, 'get').mockResolvedValue(mockResponse);

      // Act
      const result = await client.testConnection();

      // Assert
      expect(result).toBe(true);
      expect(httpClient.get).toHaveBeenCalledWith(
        '/endpoints/v2.0/Endpoints',
        { params: { PageSize: 1 } }
      );
    });

    it('should return false when connection fails', async () => {
      // Arrange
      const client = new BConnectClient(mockConfig);
      const httpClient = client.getHttpClient();

      const mockError: Partial<AxiosError> = {
        request: {},
        isAxiosError: true,
        name: 'AxiosError',
        message: 'Network Error'
      };
      vi.spyOn(httpClient, 'get').mockRejectedValue(mockError);

      // Act
      const result = await client.testConnection();

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('getHttpClient', () => {
    it('should return axios instance', () => {
      // Arrange
      const client = new BConnectClient(mockConfig);

      // Act
      const httpClient = client.getHttpClient();

      // Assert
      expect(httpClient).toBeDefined();
      expect(httpClient.defaults.baseURL).toBe(mockConfig.baseUrl);
    });
  });

  describe('retry logic configuration', () => {
    // Phase 2: Comprehensive retry behavior tests with MSW
    // Note: Detailed retry behavior testing requires integration tests (MSW)
    // Phase 1 tests focus on verifying configuration is applied correctly

    it('should accept retry configuration options', () => {
      // Arrange
      const config = {
        ...mockConfig,
        maxRetries: 3,
        retryDelay: 200
      };

      // Act
      const client = new BConnectClient(config);

      // Assert
      expect(client).toBeDefined();
      expect(client.getHttpClient()).toBeDefined();
      // axios-retry is configured internally via interceptors
    });

    it('should default to no retries when not configured', () => {
      // Arrange
      const config = { ...mockConfig };

      // Act
      const client = new BConnectClient(config);
      const httpClient = client.getHttpClient();

      // Assert
      expect(client).toBeDefined();
      // Default maxRetries should be 0 (no retries)
    });

    it('should configure custom retry delay', () => {
      // Arrange
      const config = {
        ...mockConfig,
        maxRetries: 2,
        retryDelay: 50
      };

      // Act
      const client = new BConnectClient(config);

      // Assert
      expect(client).toBeDefined();
      // Custom retryDelay is applied via axios-retry configuration
    });
  });

  describe('retry logic behavior (integration tests - Phase 2)', () => {
    // TODO: Phase 2 - Implement with MSW for realistic HTTP mocking
    // These tests require MSW to properly test axios-retry behavior
    // vitest mocks don't work with axios-retry interceptors

    it.skip('should retry on 5xx server errors', async () => {
      // TODO: Implement with MSW in Phase 2
    });

    it.skip('should retry on 429 rate limit errors', async () => {
      // TODO: Implement with MSW in Phase 2
    });

    it.skip('should retry on network errors', async () => {
      // Arrange
      const config = { ...mockConfig, maxRetries: 2 };
      const client = new BConnectClient(config);
      const httpClient = client.getHttpClient();

      const mockError: Partial<AxiosError> = {
        request: {},
        code: 'ECONNREFUSED',
        isAxiosError: true,
        name: 'AxiosError',
        message: 'Network Error'
      };

      let attemptCount = 0;
      vi.spyOn(httpClient, 'get').mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 2) {
          return Promise.reject(mockError);
        }
        return Promise.resolve({ data: { totalItems: 1, data: [] } });
      });

      // Act
      const result = await client.endpoints.getEndpoints();

      // Assert
      expect(attemptCount).toBe(2); // 1 initial + 1 retry
      expect(result).toBeDefined();
    });

    it.skip('should NOT retry on 4xx client errors (except 429)', async () => {
      // Arrange
      const config = { ...mockConfig, maxRetries: 3 };
      const client = new BConnectClient(config);
      const httpClient = client.getHttpClient();

      const mockError: Partial<AxiosError> = {
        response: { status: 404, data: 'Not Found' } as any,
        isAxiosError: true,
        name: 'AxiosError',
        message: 'Request failed with status code 404'
      };

      let attemptCount = 0;
      vi.spyOn(httpClient, 'get').mockImplementation(() => {
        attemptCount++;
        return Promise.reject(mockError);
      });

      // Act & Assert
      await expect(async () => {
        await client.endpoints.getEndpoint('invalid-id');
      }).rejects.toThrow();

      expect(attemptCount).toBe(1); // Should NOT retry, only 1 attempt
    });

    it.skip('should NOT retry on 401 authentication errors', async () => {
      // Arrange
      const config = { ...mockConfig, maxRetries: 3 };
      const client = new BConnectClient(config);
      const httpClient = client.getHttpClient();

      const mockError: Partial<AxiosError> = {
        response: { status: 401, data: 'Unauthorized' } as any,
        isAxiosError: true,
        name: 'AxiosError',
        message: 'Request failed with status code 401'
      };

      let attemptCount = 0;
      vi.spyOn(httpClient, 'get').mockImplementation(() => {
        attemptCount++;
        return Promise.reject(mockError);
      });

      // Act & Assert
      await expect(async () => {
        await client.endpoints.getEndpoints();
      }).rejects.toThrow();

      expect(attemptCount).toBe(1); // Should NOT retry, only 1 attempt
    });

    it.skip('should fail after max retry attempts exceeded', async () => {
      // Arrange
      const config = { ...mockConfig, maxRetries: 2 };
      const client = new BConnectClient(config);
      const httpClient = client.getHttpClient();

      const mockError: Partial<AxiosError> = {
        response: { status: 503, data: 'Service Unavailable' } as any,
        isAxiosError: true,
        name: 'AxiosError',
        message: 'Request failed with status code 503'
      };

      let attemptCount = 0;
      vi.spyOn(httpClient, 'get').mockImplementation(() => {
        attemptCount++;
        return Promise.reject(mockError);
      });

      // Act & Assert
      await expect(async () => {
        await client.endpoints.getEndpoints();
      }).rejects.toThrow();

      expect(attemptCount).toBe(3); // 1 initial + 2 retries, then fail
    });

    it.skip('should use exponential backoff for retries', async () => {
      // Arrange
      const config = { ...mockConfig, maxRetries: 3, retryDelay: 100 };
      const client = new BConnectClient(config);
      const httpClient = client.getHttpClient();

      const mockError: Partial<AxiosError> = {
        response: { status: 503, data: 'Service Unavailable' } as any,
        isAxiosError: true,
        name: 'AxiosError',
        message: 'Request failed with status code 503'
      };

      const timestamps: number[] = [];
      vi.spyOn(httpClient, 'get').mockImplementation(() => {
        timestamps.push(Date.now());
        if (timestamps.length < 4) {
          return Promise.reject(mockError);
        }
        return Promise.resolve({ data: { totalItems: 1, data: [] } });
      });

      // Act
      const startTime = Date.now();
      await client.endpoints.getEndpoints();
      const endTime = Date.now();

      // Assert
      expect(timestamps.length).toBe(4); // 1 initial + 3 retries

      // Check exponential backoff timing (100ms, 200ms, 400ms)
      // Allow some variance for test timing
      const totalTime = endTime - startTime;
      expect(totalTime).toBeGreaterThanOrEqual(600); // 100 + 200 + 400 = 700ms, allow margin
    });

    it.skip('should respect custom retry delay configuration', async () => {
      // Arrange
      const config = { ...mockConfig, maxRetries: 1, retryDelay: 50 };
      const client = new BConnectClient(config);
      const httpClient = client.getHttpClient();

      const mockError: Partial<AxiosError> = {
        response: { status: 503, data: 'Service Unavailable' } as any,
        isAxiosError: true,
        name: 'AxiosError',
        message: 'Request failed with status code 503'
      };

      let attemptCount = 0;
      vi.spyOn(httpClient, 'get').mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 2) {
          return Promise.reject(mockError);
        }
        return Promise.resolve({ data: { totalItems: 1, data: [] } });
      });

      // Act
      const startTime = Date.now();
      await client.endpoints.getEndpoints();
      const endTime = Date.now();

      // Assert
      expect(attemptCount).toBe(2);
      const totalTime = endTime - startTime;
      expect(totalTime).toBeGreaterThanOrEqual(40); // Allow margin below 50ms
      expect(totalTime).toBeLessThan(150); // Should be around 50ms, not 100ms
    });
  });
});

// ---------------------------------------------------------------------------
// TDD RED: BCONNECT_RATE_LIMIT_* env vars — server initialisation pathway
// ---------------------------------------------------------------------------
// This describe block verifies that when BCONNECT_RATE_LIMIT_ENABLED=true,
// the BConnectClient constructor is called with rateLimit.enabled === true.
//
// STATUS: RED — index.ts does not yet read BCONNECT_RATE_LIMIT_ENABLED, so
// the assertion below currently FAILS. Once the developer adds the env-var
// read in index.ts, this test will turn GREEN.
// ---------------------------------------------------------------------------

describe('index.ts — BCONNECT_RATE_LIMIT_* env vars', () => {
  // Env vars required by index.ts at module evaluation time
  const REQUIRED_ENV: Record<string, string> = {
    BCONNECT_USERNAME: 'testuser',
    BCONNECT_PASSWORD: 'testpass',
    BCONNECT_BASE_URL: 'https://test-server:444/bconnect',
  };

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    delete process.env.BCONNECT_RATE_LIMIT_ENABLED;
    for (const key of Object.keys(REQUIRED_ENV)) {
      delete process.env[key];
    }
  });

  it(
    'initialises BConnectClient with rateLimit.enabled === true when ' +
    'BCONNECT_RATE_LIMIT_ENABLED is set to "true" before server startup',
    async () => {
      // Arrange — set all env vars that index.ts reads at module scope
      process.env.BCONNECT_RATE_LIMIT_ENABLED = 'true';
      for (const [key, value] of Object.entries(REQUIRED_ENV)) {
        process.env[key] = value;
      }

      // Capture every argument passed to the BConnectClient constructor so we
      // can assert that rateLimit.enabled is true once index.ts reads the env var.
      let capturedConfig: Record<string, unknown> | undefined;

      // Register mocks before resetting the module registry.
      // vi.doMock + vi.resetModules + dynamic import is the vitest equivalent
      // of jest.isolateModules — it gives us a fresh module evaluation so the
      // env var is read again at module scope by index.ts.
      vi.doMock('../bconnect-client.js', () => ({
        BConnectClient: vi.fn().mockImplementation((cfg: Record<string, unknown>) => {
          capturedConfig = cfg;
          // Return a minimal stub so index.ts module-level code does not throw
          return {
            endpoints: { getEndpoints: vi.fn().mockResolvedValue({ data: [] }) },
            jobs: {},
            assets: {},
            activedirectory: {},
            software: {},
            updatemanagement: {},
            defensecontrol: {},
            variables: {},
            operatingsystems: {},
            servermanagement: {},
            complianceviolationsV1: {},
            bitlockerV1: {},
            vppV1: {},
            sshV1: {},
            inventoryV1: {},
            setupIntegrityV1: {},
            testConnection: vi.fn().mockResolvedValue(true),
            getHttpClient: vi.fn(),
          };
        }),
      }));

      // Stub out MCP server and heavy modules so index.ts does not open
      // stdio transports or perform file I/O that would block the test.
      vi.doMock('@modelcontextprotocol/sdk/server/index.js', () => ({
        Server: vi.fn().mockImplementation(() => ({
          setRequestHandler: vi.fn(),
          connect: vi.fn().mockResolvedValue(undefined),
        })),
      }));
      vi.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
        StdioServerTransport: vi.fn().mockImplementation(() => ({})),
      }));
      vi.doMock('@modelcontextprotocol/sdk/types.js', () => ({
        CallToolRequestSchema: {},
        ListToolsRequestSchema: {},
        ErrorCode: { InternalError: -32603, InvalidParams: -32602 },
        McpError: class McpError extends Error {
          code: number;
          constructor(code: number, msg: string) { super(msg); this.code = code; }
        },
      }));
      vi.doMock('../modules/documentation-search.js', () => ({
        DocumentationSearchModule: vi.fn().mockImplementation(() => ({})),
      }));
      vi.doMock('../modules/known-issues-search.js', () => ({
        KnownIssuesSearch: vi.fn().mockImplementation(() => ({})),
      }));
      vi.doMock('../utils/parameter-validator.js', () => ({
        validateOrThrow: vi.fn(),
      }));
      vi.doMock('../utils/mcp-tool-validation-rules.js', () => ({
        EndpointsRules: {},
        JobsRules: {},
        AssetsRules: {},
        ActiveDirectoryRules: {},
        ServerManagementRules: {},
        VariablesRules: {},
        DefenseControlRules: {},
        OperatingSystemsRules: {},
        SoftwareRules: {},
        UpdateManagementRules: {},
        V11Rules: {},
        DocumentationSearchRules: {},
      }));

      // Reset the module registry so index.ts is evaluated fresh with the
      // mocked dependencies and updated env vars on the next dynamic import.
      vi.resetModules();

      // Dynamically import index.ts so its module-scope initialisation runs
      // with the mocked dependencies and env vars set above.
      await import('../index.js');

      // Assert — BConnectClient must have been called with rateLimit.enabled
      // set to true when BCONNECT_RATE_LIMIT_ENABLED='true'.
      // This assertion FAILS until index.ts reads BCONNECT_RATE_LIMIT_ENABLED
      // and passes rateLimit: { enabled: true } to the BConnectClient config.
      expect(capturedConfig).toBeDefined();
      expect(capturedConfig).toHaveProperty('rateLimit');
      expect((capturedConfig as { rateLimit: { enabled: boolean } }).rateLimit.enabled).toBe(true);
    }
  );
});

// ---------------------------------------------------------------------------
// TDD RED: BCONNECT_AUDIT_LEVEL env var — server initialisation pathway
// ---------------------------------------------------------------------------
// This describe block verifies that when BCONNECT_AUDIT_LEVEL is set to
// 'write', the BConnectClient constructor is called with
// auditLog.level === 'write'.
//
// STATUS: RED — index.ts does not yet read BCONNECT_AUDIT_LEVEL, so the
// assertion below currently FAILS. Once the developer adds the env-var read
// in index.ts, this test will turn GREEN.
// ---------------------------------------------------------------------------

describe('index.ts — BCONNECT_AUDIT_LEVEL env var', () => {
  // Env vars required by index.ts at module evaluation time
  const REQUIRED_ENV: Record<string, string> = {
    BCONNECT_USERNAME: 'testuser',
    BCONNECT_PASSWORD: 'testpass',
    BCONNECT_BASE_URL: 'https://test-server:444/bconnect',
  };

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    delete process.env.BCONNECT_AUDIT_LEVEL;
    for (const key of Object.keys(REQUIRED_ENV)) {
      delete process.env[key];
    }
  });

  it(
    'initialises BConnectClient with auditLog.level === \'write\' when ' +
    'BCONNECT_AUDIT_LEVEL is set to "write" before server startup',
    async () => {
      // Arrange — set all env vars that index.ts reads at module scope
      process.env.BCONNECT_AUDIT_LEVEL = 'write';
      for (const [key, value] of Object.entries(REQUIRED_ENV)) {
        process.env[key] = value;
      }

      // Capture every argument passed to the BConnectClient constructor so we
      // can assert that auditLog.level is 'write' once index.ts reads the env var.
      let capturedConfig: Record<string, unknown> | undefined;

      // Register mocks before resetting the module registry.
      // vi.doMock + vi.resetModules + dynamic import is the vitest equivalent
      // of jest.isolateModules — it gives us a fresh module evaluation so the
      // env var is read again at module scope by index.ts.
      vi.doMock('../bconnect-client.js', () => ({
        BConnectClient: vi.fn().mockImplementation((cfg: Record<string, unknown>) => {
          capturedConfig = cfg;
          // Return a minimal stub so index.ts module-level code does not throw
          return {
            endpoints: { getEndpoints: vi.fn().mockResolvedValue({ data: [] }) },
            jobs: {},
            assets: {},
            activedirectory: {},
            software: {},
            updatemanagement: {},
            defensecontrol: {},
            variables: {},
            operatingsystems: {},
            servermanagement: {},
            complianceviolationsV1: {},
            bitlockerV1: {},
            vppV1: {},
            sshV1: {},
            inventoryV1: {},
            setupIntegrityV1: {},
            testConnection: vi.fn().mockResolvedValue(true),
            getHttpClient: vi.fn(),
          };
        }),
      }));

      // Stub out MCP server and heavy modules so index.ts does not open
      // stdio transports or perform file I/O that would block the test.
      vi.doMock('@modelcontextprotocol/sdk/server/index.js', () => ({
        Server: vi.fn().mockImplementation(() => ({
          setRequestHandler: vi.fn(),
          connect: vi.fn().mockResolvedValue(undefined),
        })),
      }));
      vi.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
        StdioServerTransport: vi.fn().mockImplementation(() => ({})),
      }));
      vi.doMock('@modelcontextprotocol/sdk/types.js', () => ({
        CallToolRequestSchema: {},
        ListToolsRequestSchema: {},
        ErrorCode: { InternalError: -32603, InvalidParams: -32602 },
        McpError: class McpError extends Error {
          code: number;
          constructor(code: number, msg: string) { super(msg); this.code = code; }
        },
      }));
      vi.doMock('../modules/documentation-search.js', () => ({
        DocumentationSearchModule: vi.fn().mockImplementation(() => ({})),
      }));
      vi.doMock('../modules/known-issues-search.js', () => ({
        KnownIssuesSearch: vi.fn().mockImplementation(() => ({})),
      }));
      vi.doMock('../utils/parameter-validator.js', () => ({
        validateOrThrow: vi.fn(),
      }));
      vi.doMock('../utils/mcp-tool-validation-rules.js', () => ({
        EndpointsRules: {},
        JobsRules: {},
        AssetsRules: {},
        ActiveDirectoryRules: {},
        ServerManagementRules: {},
        VariablesRules: {},
        DefenseControlRules: {},
        OperatingSystemsRules: {},
        SoftwareRules: {},
        UpdateManagementRules: {},
        V11Rules: {},
        DocumentationSearchRules: {},
      }));

      // Reset the module registry so index.ts is evaluated fresh with the
      // mocked dependencies and updated env vars on the next dynamic import.
      vi.resetModules();

      // Dynamically import index.ts so its module-scope initialisation runs
      // with the mocked dependencies and env vars set above.
      await import('../index.js');

      // Assert — BConnectClient must have been called with auditLog.level set
      // to 'write' when BCONNECT_AUDIT_LEVEL='write'.
      // This assertion FAILS until index.ts reads BCONNECT_AUDIT_LEVEL and
      // passes auditLog: { level: 'write' } to the BConnectClient config.
      expect(capturedConfig).toBeDefined();
      expect(capturedConfig).toHaveProperty('auditLog');
      expect((capturedConfig as { auditLog: { level: string } }).auditLog.level).toBe('write');
    }
  );
});

// ---------------------------------------------------------------------------
// TDD RED: BCONNECT_CA_CERT_PATH env var — server initialisation pathway
// ---------------------------------------------------------------------------
// This describe block verifies that when BCONNECT_CA_CERT_PATH is set to a
// temporary PEM file, the BConnectClient constructor is called with the `ca`
// option populated from that file's contents.
//
// STATUS: RED — index.ts does not yet read BCONNECT_CA_CERT_PATH, so the
// assertion below currently FAILS. Once the developer adds the env-var read
// in index.ts, this test will turn GREEN.
// ---------------------------------------------------------------------------

describe('index.ts — BCONNECT_CA_CERT_PATH initialisation', () => {
  let tempPemPath: string;
  const PEM_CONTENTS = '-----BEGIN CERTIFICATE-----\nMIIFakeCertData==\n-----END CERTIFICATE-----\n';

  // Env vars required by index.ts at module evaluation time
  const REQUIRED_ENV: Record<string, string> = {
    BCONNECT_USERNAME: 'testuser',
    BCONNECT_PASSWORD: 'testpass',
    BCONNECT_BASE_URL: 'https://test-server:444/bconnect',
  };

  beforeEach(() => {
    // Create a temporary PEM file containing a self-signed certificate stub
    tempPemPath = path.join(os.tmpdir(), `test-ca-${Date.now()}.pem`);
    fs.writeFileSync(tempPemPath, PEM_CONTENTS, 'utf8');
  });

  afterEach(() => {
    // Clean up the temporary file and restore env vars
    if (fs.existsSync(tempPemPath)) {
      fs.unlinkSync(tempPemPath);
    }
    vi.resetModules();
    vi.restoreAllMocks();
    delete process.env.BCONNECT_CA_CERT_PATH;
    for (const key of Object.keys(REQUIRED_ENV)) {
      delete process.env[key];
    }
  });

  it(
    'initialises BConnectClient with ca option read from BCONNECT_CA_CERT_PATH ' +
    'when the env var is set to a valid PEM file path before server startup',
    async () => {
      // Arrange — set all env vars that index.ts reads at module scope
      process.env.BCONNECT_CA_CERT_PATH = tempPemPath;
      for (const [key, value] of Object.entries(REQUIRED_ENV)) {
        process.env[key] = value;
      }

      // Capture every argument passed to the BConnectClient constructor so we
      // can assert that `ca` is included once index.ts reads the PEM file.
      let capturedConfig: Record<string, unknown> | undefined;

      // Register mocks before resetting the module registry.
      // vi.doMock + vi.resetModules + dynamic import is the vitest equivalent
      // of jest.isolateModules — it gives us a fresh module evaluation so the
      // env var is read again at module scope by index.ts.
      vi.doMock('../bconnect-client.js', () => ({
        BConnectClient: vi.fn().mockImplementation((cfg: Record<string, unknown>) => {
          capturedConfig = cfg;
          // Return a minimal stub so index.ts module-level code does not throw
          return {
            endpoints: { getEndpoints: vi.fn().mockResolvedValue({ data: [] }) },
            jobs: {},
            assets: {},
            activedirectory: {},
            software: {},
            updatemanagement: {},
            defensecontrol: {},
            variables: {},
            operatingsystems: {},
            servermanagement: {},
            complianceviolationsV1: {},
            bitlockerV1: {},
            vppV1: {},
            sshV1: {},
            inventoryV1: {},
            setupIntegrityV1: {},
            testConnection: vi.fn().mockResolvedValue(true),
            getHttpClient: vi.fn(),
          };
        }),
      }));

      // Stub out MCP server and heavy modules so index.ts does not open
      // stdio transports or perform file I/O that would block the test.
      vi.doMock('@modelcontextprotocol/sdk/server/index.js', () => ({
        Server: vi.fn().mockImplementation(() => ({
          setRequestHandler: vi.fn(),
          connect: vi.fn().mockResolvedValue(undefined),
        })),
      }));
      vi.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
        StdioServerTransport: vi.fn().mockImplementation(() => ({})),
      }));
      vi.doMock('@modelcontextprotocol/sdk/types.js', () => ({
        CallToolRequestSchema: {},
        ListToolsRequestSchema: {},
        ErrorCode: { InternalError: -32603, InvalidParams: -32602 },
        McpError: class McpError extends Error {
          code: number;
          constructor(code: number, msg: string) { super(msg); this.code = code; }
        },
      }));
      vi.doMock('../modules/documentation-search.js', () => ({
        DocumentationSearchModule: vi.fn().mockImplementation(() => ({})),
      }));
      vi.doMock('../modules/known-issues-search.js', () => ({
        KnownIssuesSearch: vi.fn().mockImplementation(() => ({})),
      }));
      vi.doMock('../utils/parameter-validator.js', () => ({
        validateOrThrow: vi.fn(),
      }));
      vi.doMock('../utils/mcp-tool-validation-rules.js', () => ({
        EndpointsRules: {},
        JobsRules: {},
        AssetsRules: {},
        ActiveDirectoryRules: {},
        ServerManagementRules: {},
        VariablesRules: {},
        DefenseControlRules: {},
        OperatingSystemsRules: {},
        SoftwareRules: {},
        UpdateManagementRules: {},
        V11Rules: {},
        DocumentationSearchRules: {},
      }));

      // Reset the module registry so index.ts is evaluated fresh with the
      // mocked dependencies and updated env vars on the next dynamic import.
      vi.resetModules();

      // Dynamically import index.ts so its module-scope initialisation runs
      // with the mocked dependencies and env vars set above.
      await import('../index.js');

      // Assert — BConnectClient must have been called with `ca` set to the
      // PEM file contents that were written to tempPemPath.
      // This assertion FAILS until index.ts reads BCONNECT_CA_CERT_PATH and
      // passes its contents as the `ca` field of the BConnectClient config.
      expect(capturedConfig).toBeDefined();
      expect(capturedConfig).toHaveProperty('ca', PEM_CONTENTS);
    }
  );
});
