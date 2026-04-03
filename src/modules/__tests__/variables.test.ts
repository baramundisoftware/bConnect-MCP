import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VariablesModule } from '../variables.js';
import type { AxiosInstance } from 'axios';

describe('VariablesModule', () => {
  let variablesModule: VariablesModule;
  let mockClient: AxiosInstance;

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    } as any;
    variablesModule = new VariablesModule(mockClient);
  });

  describe('Variable Definitions', () => {
    it('should list all variable definitions', async () => {
      const mockResponse = {
        data: {
          currentPage: 1,
          pageSize: 20,
          totalItems: 5,
          data: [{ id: '1', name: 'Var1' }],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await variablesModule.getVariableDefinitions();

      expect(mockClient.get).toHaveBeenCalledWith('/variables/v2.0/VariableDefinitions', {
        params: {},
      });
      expect(result.totalItems).toBe(5);
    });

    it('should get specific variable definition', async () => {
      const mockResponse = {
        data: { id: 'var-1', name: 'Var1', type: 'String' },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await variablesModule.getVariableDefinition('var-1');

      expect(mockClient.get).toHaveBeenCalledWith('/variables/v2.0/VariableDefinitions/var-1');
      expect(result.id).toBe('var-1');
    });
  });

  describe('Variable Instances', () => {
    it('should list all variable instances', async () => {
      const mockResponse = {
        data: {
          currentPage: 1,
          pageSize: 20,
          totalItems: 10,
          data: [],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await variablesModule.getVariableInstances();

      expect(mockClient.get).toHaveBeenCalledWith('/variables/v2.0/VariableInstances', {
        params: {},
      });
      expect(result.totalItems).toBe(10);
    });

    it('should get specific variable instance', async () => {
      const mockResponse = {
        data: { id: 'inst-1', value: 'test value' },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await variablesModule.getVariableInstance('inst-1');

      expect(mockClient.get).toHaveBeenCalledWith('/variables/v2.0/VariableInstances/inst-1');
      expect(result.id).toBe('inst-1');
    });
  });

  describe('Variable Instances by Entity', () => {
    it('should get variable instances by endpoint', async () => {
      const mockResponse = {
        data: {
          currentPage: 1,
          pageSize: 20,
          totalItems: 3,
          data: [],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await variablesModule.getVariableInstancesByEndpoint('endpoint-1');

      expect(mockClient.get).toHaveBeenCalledWith(
        '/variables/v2.0/Endpoints/endpoint-1/VariableInstances',
        { params: {} }
      );
      expect(result.totalItems).toBe(3);
    });

    it('should get variable instances by logical group', async () => {
      const mockResponse = {
        data: {
          currentPage: 1,
          pageSize: 20,
          totalItems: 5,
          data: [],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await variablesModule.getVariableInstancesByLogicalGroup('group-1');

      expect(mockClient.get).toHaveBeenCalledWith(
        '/variables/v2.0/LogicalGroups/group-1/VariableInstances',
        { params: {} }
      );
      expect(result.totalItems).toBe(5);
    });

    it('should get variable instances by AD object', async () => {
      const mockResponse = {
        data: {
          currentPage: 1,
          pageSize: 20,
          totalItems: 2,
          data: [],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await variablesModule.getVariableInstancesByADObject('ad-obj-1');

      expect(mockClient.get).toHaveBeenCalledWith(
        '/variables/v2.0/ADObjects/ad-obj-1/VariableInstances',
        { params: {} }
      );
      expect(result.totalItems).toBe(2);
    });

    it('should get variable instances by Windows application', async () => {
      const mockResponse = {
        data: {
          currentPage: 1,
          pageSize: 20,
          totalItems: 1,
          data: [],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await variablesModule.getVariableInstancesByWindowsApplication('app-1');

      expect(mockClient.get).toHaveBeenCalledWith(
        '/variables/v2.0/WindowsApplications/app-1/VariableInstances',
        { params: {} }
      );
      expect(result.totalItems).toBe(1);
    });

    it('should get variable instances by Windows job definition', async () => {
      const mockResponse = {
        data: {
          currentPage: 1,
          pageSize: 20,
          totalItems: 4,
          data: [],
        },
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      const result = await variablesModule.getVariableInstancesByWindowsJobDefinition('job-1');

      expect(mockClient.get).toHaveBeenCalledWith(
        '/variables/v2.0/WindowsJobDefinitions/job-1/VariableInstances',
        { params: {} }
      );
      expect(result.totalItems).toBe(4);
    });
  });

  // ============================================================================
  // VARIABLES WRITE OPERATIONS - Phase 3
  // ============================================================================

  describe('createVariableDefinition', () => {
    it('should create a new variable definition', async () => {
      const varDefData = { name: 'BuildNumber', type: 'String', description: 'Current build number' };
      const mockResponse = { data: { id: 'vardef-new', name: 'BuildNumber', type: 'String' } };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      const result = await variablesModule.createVariableDefinition(varDefData as any);

      expect(mockClient.post).toHaveBeenCalledWith('/variables/v2.0/VariableDefinitions', varDefData);
      expect(result.id).toBe('vardef-new');
      expect(result.name).toBe('BuildNumber');
    });
  });

  describe('updateVariableDefinition', () => {
    it('should update a variable definition', async () => {
      const updateData = [{ op: 'replace', path: '/comment', value: 'Updated comment' }];
      const mockResponse = { data: { id: 'vardef-123', name: 'BuildNumber', comment: 'Updated comment' } };
      mockClient.patch = vi.fn().mockResolvedValue(mockResponse);

      const result = await variablesModule.updateVariableDefinition('vardef-123', updateData as any);

      expect(mockClient.patch).toHaveBeenCalledWith('/variables/v2.0/VariableDefinitions/vardef-123', updateData);
      expect(result.id).toBe('vardef-123');
    });
  });

  describe('deleteVariableDefinition', () => {
    it('should delete a variable definition', async () => {
      const mockResponse = { data: null, status: 204 };
      mockClient.delete = vi.fn().mockResolvedValue(mockResponse);

      await variablesModule.deleteVariableDefinition('vardef-456');

      expect(mockClient.delete).toHaveBeenCalledWith('/variables/v2.0/VariableDefinitions/vardef-456');
    });
  });

  describe('updateVariableInstance', () => {
    it('should update a variable instance value', async () => {
      const updateData = [{ op: 'replace', path: '/value', value: '2025.10.20.1' }];
      const mockResponse = { data: { id: 'varinst-789', value: '2025.10.20.1' } };
      mockClient.patch = vi.fn().mockResolvedValue(mockResponse);

      const result = await variablesModule.updateVariableInstance('varinst-789', updateData as any);

      expect(mockClient.patch).toHaveBeenCalledWith('/variables/v2.0/VariableInstances/varinst-789', updateData);
      expect(result.value).toBe('2025.10.20.1');
    });
  });
});
