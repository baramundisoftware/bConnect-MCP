import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SoftwareModule } from '../software.js';
import type { AxiosInstance } from 'axios';

describe('SoftwareModule', () => {
  let softwareModule: SoftwareModule;
  let mockClient: AxiosInstance;

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
    } as any;
    softwareModule = new SoftwareModule(mockClient);
  });

  it('should list all installed Windows software', async () => {
    const mockResponse = {
      data: {
        currentPage: 1,
        pageSize: 20,
        totalItems: 50,
        data: [],
      },
    };
    mockClient.get = vi.fn().mockResolvedValue(mockResponse);

    const result = await softwareModule.getInstalledWindowsSoftware();

    expect(mockClient.get).toHaveBeenCalledWith(
      '/software/v2.0/InstalledWindowsSoftware',
      { params: {} }
    );
    expect(result.totalItems).toBe(50);
  });

  it('should get software by endpoint', async () => {
    const mockResponse = {
      data: {
        currentPage: 1,
        pageSize: 20,
        totalItems: 10,
        data: [],
      },
    };
    mockClient.get = vi.fn().mockResolvedValue(mockResponse);

    const result = await softwareModule.getInstalledSoftwareByEndpoint('endpoint-1');

    expect(mockClient.get).toHaveBeenCalledWith(
      '/software/v2.0/WindowsEndpoints/endpoint-1/InstalledWindowsSoftware',
      { params: {} }
    );
    expect(result.totalItems).toBe(10);
  });

  it('should get software by logical group', async () => {
    const mockResponse = {
      data: {
        currentPage: 1,
        pageSize: 20,
        totalItems: 25,
        data: [],
      },
    };
    mockClient.get = vi.fn().mockResolvedValue(mockResponse);

    const result = await softwareModule.getInstalledSoftwareByLogicalGroup('group-1');

    expect(mockClient.get).toHaveBeenCalledWith(
      '/software/v2.0/LogicalGroups/group-1/InstalledWindowsSoftware',
      { params: {} }
    );
    expect(result.totalItems).toBe(25);
  });

  it('should get software by universal dynamic group', async () => {
    const mockResponse = {
      data: {
        currentPage: 1,
        pageSize: 20,
        totalItems: 15,
        data: [],
      },
    };
    mockClient.get = vi.fn().mockResolvedValue(mockResponse);

    const result = await softwareModule.getInstalledSoftwareByUniversalDynamicGroup('dynamic-group-1');

    expect(mockClient.get).toHaveBeenCalledWith(
      '/software/v2.0/UniversalDynamicGroups/dynamic-group-1/InstalledWindowsSoftware',
      { params: {} }
    );
    expect(result.totalItems).toBe(15);
  });
});
