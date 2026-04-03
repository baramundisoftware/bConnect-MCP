/**
 * Unit tests for JobsModule
 *
 * Phase 1: Unit tests with in-memory mocks (TDD Workflow)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JobsModule } from '../jobs.js';
import type { AxiosInstance } from 'axios';

describe('JobsModule', () => {
  let module: JobsModule;
  let mockClient: AxiosInstance;

  beforeEach(() => {
    // Create fresh mock for each test
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    } as any;

    module = new JobsModule(mockClient);
  });

  describe('getJobDefinitions', () => {
    it('should fetch all job definitions with pagination params', async () => {
      // Arrange
      const mockResponse = {
        data: {
          totalItems: 5,
          currentPage: 0,
          pageSize: 10,
          data: [
            { id: 'job-1', name: 'Install Software' },
            { id: 'job-2', name: 'Update OS' }
          ]
        }
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      // Act
      const result = await module.getJobDefinitions({ PageSize: 10, Page: 0 });

      // Assert
      expect(mockClient.get).toHaveBeenCalledWith(
        '/jobs/v2.0/JobDefinitions',
        { params: { PageSize: 10, Page: 0 } }
      );
      expect(result).toEqual(mockResponse.data);
      expect(result.totalItems).toBe(5);
    });

    it('should fetch all job definitions without params', async () => {
      // Arrange
      const mockResponse = {
        data: {
          totalItems: 10,
          data: []
        }
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      // Act
      await module.getJobDefinitions();

      // Assert
      expect(mockClient.get).toHaveBeenCalledWith(
        '/jobs/v2.0/JobDefinitions',
        { params: undefined }
      );
    });
  });

  describe('getJobDefinition', () => {
    it('should fetch specific job definition by id', async () => {
      // Arrange
      const mockResponse = {
        data: {
          id: 'job-123',
          name: 'Deploy Application',
          description: 'Deploy application to production'
        }
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      // Act
      const result = await module.getJobDefinition('job-123');

      // Assert
      expect(mockClient.get).toHaveBeenCalledWith('/jobs/v2.0/JobDefinitions/job-123');
      expect(result.id).toBe('job-123');
      expect(result.name).toBe('Deploy Application');
    });
  });

  describe('getJobInstances', () => {
    it('should fetch all job instances with pagination params', async () => {
      // Arrange
      const mockResponse = {
        data: {
          totalItems: 15,
          currentPage: 0,
          pageSize: 20,
          data: [
            { id: 'instance-1', jobDefinitionId: 'job-1' },
            { id: 'instance-2', jobDefinitionId: 'job-2' }
          ]
        }
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      // Act
      const result = await module.getJobInstances({ PageSize: 20, Page: 0 });

      // Assert
      expect(mockClient.get).toHaveBeenCalledWith(
        '/jobs/v2.0/JobInstances',
        { params: { PageSize: 20, Page: 0 } }
      );
      expect(result).toEqual(mockResponse.data);
      expect(result.totalItems).toBe(15);
    });

    it('should fetch all job instances without params', async () => {
      // Arrange
      const mockResponse = {
        data: {
          totalItems: 25,
          data: []
        }
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      // Act
      await module.getJobInstances();

      // Assert
      expect(mockClient.get).toHaveBeenCalledWith(
        '/jobs/v2.0/JobInstances',
        { params: undefined }
      );
    });
  });

  describe('getJobInstance', () => {
    it('should fetch specific job instance by id', async () => {
      // Arrange
      const mockResponse = {
        data: {
          id: 'instance-456',
          jobDefinitionId: 'job-789',
          startTime: '2025-10-16T10:00:00Z',
          endTime: '2025-10-16T10:05:00Z'
        }
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      // Act
      const result = await module.getJobInstance('instance-456');

      // Assert
      expect(mockClient.get).toHaveBeenCalledWith('/jobs/v2.0/JobInstances/instance-456');
      expect(result.id).toBe('instance-456');
      expect(result.jobDefinitionId).toBe('job-789');
    });
  });

  describe('getEndpointJobInstances', () => {
    it('should fetch job instances for specific endpoint', async () => {
      // Arrange
      const mockResponse = {
        data: {
          totalItems: 8,
          data: [
            { id: 'instance-1', jobDefinitionId: 'job-1' },
            { id: 'instance-2', jobDefinitionId: 'job-2' }
          ]
        }
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      // Act
      const result = await module.getEndpointJobInstances('endpoint-123');

      // Assert
      expect(mockClient.get).toHaveBeenCalledWith(
        '/jobs/v2.0/Endpoints/endpoint-123/JobInstances',
        { params: undefined }
      );
      expect(result).toEqual(mockResponse.data);
    });

    it('should fetch endpoint job instances with pagination params', async () => {
      // Arrange
      const mockResponse = {
        data: {
          totalItems: 12,
          data: []
        }
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      // Act
      await module.getEndpointJobInstances('endpoint-456', { PageSize: 10 });

      // Assert
      expect(mockClient.get).toHaveBeenCalledWith(
        '/jobs/v2.0/Endpoints/endpoint-456/JobInstances',
        { params: { PageSize: 10 } }
      );
    });
  });

  // ============================================================================
  // WRITE OPERATIONS - Phase 1 Implementation
  // ============================================================================

  describe('createJobInstance', () => {
    it('should create a job instance by assigning job to endpoint', async () => {
      // Arrange
      const createData = {
        jobDefinitionId: 'job-123',
        endpointId: 'endpoint-456',
        scheduledStartTime: '2025-10-20T10:00:00Z'
      };
      const mockResponse = {
        data: {
          id: 'instance-new',
          jobDefinitionId: 'job-123',
          endpointId: 'endpoint-456',
          state: 'Scheduled'
        }
      };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      // Act
      const result = await module.createJobInstance(createData);

      // Assert
      expect(mockClient.post).toHaveBeenCalledWith(
        '/jobs/v2.0/JobInstances',
        createData
      );
      expect(result.id).toBe('instance-new');
      expect(result.state).toBe('Scheduled');
    });
  });

  describe('startJobInstance', () => {
    it('should start a job instance by id', async () => {
      // Arrange
      const mockResponse = { data: null, status: 200 };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      // Act
      await module.startJobInstance('instance-123');

      // Assert
      expect(mockClient.post).toHaveBeenCalledWith(
        '/jobs/v2.0/JobInstances/instance-123/Start'
      );
    });
  });

  describe('stopJobInstance', () => {
    it('should stop a job instance by id', async () => {
      // Arrange
      const mockResponse = { data: null, status: 200 };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      // Act
      await module.stopJobInstance('instance-456');

      // Assert
      expect(mockClient.post).toHaveBeenCalledWith(
        '/jobs/v2.0/JobInstances/instance-456/Stop'
      );
    });
  });

  describe('resumeJobInstance', () => {
    it('should resume a job instance by id', async () => {
      // Arrange
      const mockResponse = { data: null, status: 200 };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      // Act
      await module.resumeJobInstance('instance-789');

      // Assert
      expect(mockClient.post).toHaveBeenCalledWith(
        '/jobs/v2.0/JobInstances/instance-789/Resume'
      );
    });
  });

  describe('deleteJobInstance', () => {
    it('should delete a job instance by id', async () => {
      // Arrange
      const mockResponse = { data: null, status: 204 };
      mockClient.delete = vi.fn().mockResolvedValue(mockResponse);

      // Act
      await module.deleteJobInstance('instance-999');

      // Assert
      expect(mockClient.delete).toHaveBeenCalledWith(
        '/jobs/v2.0/JobInstances/instance-999'
      );
    });
  });

  // Folder Operations
  describe('createFolder', () => {
    it('should create a job folder', async () => {
      // Arrange
      const folderData = {
        name: 'My Jobs',
        parentId: 'parent-folder-123'
      };
      const mockResponse = {
        data: {
          id: 'folder-new',
          name: 'My Jobs',
          parentId: 'parent-folder-123'
        }
      };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      // Act
      const result = await module.createFolder(folderData);

      // Assert
      expect(mockClient.post).toHaveBeenCalledWith(
        '/jobs/v2.0/Folders',
        folderData
      );
      expect(result.id).toBe('folder-new');
      expect(result.name).toBe('My Jobs');
    });
  });

  describe('updateFolder', () => {
    it('should update a job folder by id', async () => {
      // Arrange
      const updateData = { name: 'Updated Folder Name' };
      const mockResponse = {
        data: {
          id: 'folder-123',
          name: 'Updated Folder Name'
        }
      };
      mockClient.patch = vi.fn().mockResolvedValue(mockResponse);

      // Act
      const result = await module.updateFolder('folder-123', updateData);

      // Assert
      expect(mockClient.patch).toHaveBeenCalledWith(
        '/jobs/v2.0/Folders/folder-123',
        updateData
      );
      expect(result.name).toBe('Updated Folder Name');
    });
  });

  describe('deleteFolder', () => {
    it('should delete a job folder by id', async () => {
      // Arrange
      const mockResponse = { data: null, status: 204 };
      mockClient.delete = vi.fn().mockResolvedValue(mockResponse);

      // Act
      await module.deleteFolder('folder-456');

      // Assert
      expect(mockClient.delete).toHaveBeenCalledWith(
        '/jobs/v2.0/Folders/folder-456'
      );
    });
  });

  // Group Assignment Operations
  describe('assignJobDefinitionToLogicalGroup', () => {
    it('should assign job definition to logical group', async () => {
      // Arrange
      const assignmentData = { jobDefinitionId: 'job-123' };
      const mockResponse = { data: [{ id: 'instance-1' }, { id: 'instance-2' }] };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      // Act
      const result = await module.assignJobDefinitionToLogicalGroup('group-123', assignmentData);

      // Assert
      expect(mockClient.post).toHaveBeenCalledWith(
        '/jobs/v2.0/LogicalGroups/group-123/AssignJobDefinition',
        assignmentData
      );
      expect(result).toHaveLength(2);
    });
  });

  describe('assignJobDefinitionToStaticGroup', () => {
    it('should assign job definition to static group', async () => {
      // Arrange
      const assignmentData = { jobDefinitionId: 'job-456' };
      const mockResponse = { data: [{ id: 'instance-3' }] };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      // Act
      const result = await module.assignJobDefinitionToStaticGroup('static-group-456', assignmentData);

      // Assert
      expect(mockClient.post).toHaveBeenCalledWith(
        '/jobs/v2.0/StaticGroups/static-group-456/AssignJobDefinition',
        assignmentData
      );
      expect(result).toHaveLength(1);
    });
  });

  describe('assignJobDefinitionToWindowsDynamicGroup', () => {
    it('should assign job definition to Windows dynamic group', async () => {
      // Arrange
      const assignmentData = { jobDefinitionId: 'job-789' };
      const mockResponse = { data: [{ id: 'instance-4' }, { id: 'instance-5' }] };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      // Act
      const result = await module.assignJobDefinitionToWindowsDynamicGroup('dynamic-group-789', assignmentData);

      // Assert
      expect(mockClient.post).toHaveBeenCalledWith(
        '/jobs/v2.0/DynamicGroups/dynamic-group-789/AssignJobDefinition',
        assignmentData
      );
      expect(result).toHaveLength(2);
    });
  });

  describe('assignJobDefinitionToUniversalDynamicGroup', () => {
    it('should assign job definition to universal dynamic group', async () => {
      // Arrange
      const assignmentData = { jobDefinitionId: 'job-999' };
      const mockResponse = { data: [{ id: 'instance-6' }] };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      // Act
      const result = await module.assignJobDefinitionToUniversalDynamicGroup('universal-group-999', assignmentData);

      // Assert
      expect(mockClient.post).toHaveBeenCalledWith(
        '/jobs/v2.0/UniversalDynamicGroups/universal-group-999/AssignJobDefinition',
        assignmentData
      );
      expect(result).toHaveLength(1);
    });
  });

  // Kiosk Release Operations
  describe('createKioskRelease', () => {
    it('should create a kiosk release', async () => {
      // Arrange
      const kioskData = { jobDefinitionId: 'job-123', targetId: 'target-456' };
      const mockResponse = { data: { id: 'kiosk-release-new', jobDefinitionId: 'job-123' } };
      mockClient.post = vi.fn().mockResolvedValue(mockResponse);

      // Act
      const result = await module.createKioskRelease(kioskData);

      // Assert
      expect(mockClient.post).toHaveBeenCalledWith(
        '/jobs/v2.0/KioskReleases',
        kioskData
      );
      expect(result.id).toBe('kiosk-release-new');
    });
  });

  describe('withdrawKioskRelease', () => {
    it('should withdraw a kiosk release by id', async () => {
      // Arrange
      const mockResponse = { data: null, status: 204 };
      mockClient.delete = vi.fn().mockResolvedValue(mockResponse);

      // Act
      await module.withdrawKioskRelease('kiosk-release-123');

      // Assert
      expect(mockClient.delete).toHaveBeenCalledWith(
        '/jobs/v2.0/KioskReleases/kiosk-release-123'
      );
    });
  });

  describe('getKioskReleases', () => {
    it('should fetch all kiosk releases with pagination params', async () => {
      // Arrange
      const mockResponse = {
        data: {
          currentPage: 1,
          pageSize: 20,
          totalPages: 1,
          totalItems: 2,
          hasPreviousPage: false,
          hasNextPage: false,
          data: [
            {
              id: 'kiosk-release-1',
              assignmentTargetId: 'logical-group-1',
              assignmentTargetName: 'Windows',
              assignmentTargetType: 'LogicalGroup',
              jobDefinitionId: 'job-def-1',
              jobDefinitionName: 'Install Software',
              jobDefinitionDisplayName: 'Install Software',
              jobDefinitionCategory: 'Software',
              jobDefinitionSupportedPlatforms: ['Windows']
            },
            {
              id: 'kiosk-release-2',
              assignmentTargetId: 'endpoint-1',
              assignmentTargetName: 'WIN10-PC01',
              assignmentTargetType: 'Endpoint',
              jobDefinitionId: 'job-def-2',
              jobDefinitionName: 'Update OS',
              jobDefinitionDisplayName: 'Update Operating System',
              jobDefinitionCategory: 'Updates',
              jobDefinitionSupportedPlatforms: ['Windows']
            }
          ]
        }
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      // Act
      const result = await module.getKioskReleases({ PageSize: 20, Page: 1 });

      // Assert
      expect(mockClient.get).toHaveBeenCalledWith(
        '/jobs/v2.0/KioskReleases',
        { params: { PageSize: 20, Page: 1 } }
      );
      expect(result).toEqual(mockResponse.data);
      expect(result.totalItems).toBe(2);
      expect(result.data).toHaveLength(2);
      expect(result.data![0].id).toBe('kiosk-release-1');
    });

    it('should fetch all kiosk releases without params', async () => {
      // Arrange
      const mockResponse = {
        data: {
          totalItems: 0,
          data: []
        }
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      // Act
      await module.getKioskReleases();

      // Assert
      expect(mockClient.get).toHaveBeenCalledWith(
        '/jobs/v2.0/KioskReleases',
        { params: undefined }
      );
    });
  });

  describe('getKioskRelease', () => {
    it('should fetch specific kiosk release by id', async () => {
      // Arrange
      const mockResponse = {
        data: {
          id: 'kiosk-release-123',
          assignmentTargetId: 'logical-group-456',
          assignmentTargetName: 'Production Servers',
          assignmentTargetType: 'LogicalGroup',
          jobDefinitionId: 'job-def-789',
          jobDefinitionName: 'Deploy Application v2.0',
          jobDefinitionDisplayName: 'Deploy Application v2.0',
          jobDefinitionCategory: 'Deployment',
          jobDefinitionSupportedPlatforms: ['Windows', 'Linux']
        }
      };
      mockClient.get = vi.fn().mockResolvedValue(mockResponse);

      // Act
      const result = await module.getKioskRelease('kiosk-release-123');

      // Assert
      expect(mockClient.get).toHaveBeenCalledWith('/jobs/v2.0/KioskReleases/kiosk-release-123');
      expect(result.id).toBe('kiosk-release-123');
      expect(result.assignmentTargetName).toBe('Production Servers');
      expect(result.jobDefinitionName).toBe('Deploy Application v2.0');
      expect(result.jobDefinitionSupportedPlatforms).toEqual(['Windows', 'Linux']);
    });
  });
});
