/**
 * Integration Tests for Active Directory Module
 *
 * These tests verify that the Active Directory module works correctly
 * with the bConnect API using MSW to mock HTTP responses.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BConnectClient } from '../../bconnect-client.js';
import '../setup/msw.js'; // Import MSW setup

describe('Active Directory Module - Integration Tests', () => {
  let client: BConnectClient;

  beforeEach(() => {
    // Create real client instance - HTTP requests will be intercepted by MSW
    client = new BConnectClient({
      baseUrl: 'https://bms-win22srv:444/bconnect',
      username: 'Administrator',
      password: 'baramundi-2008',
    });
  });

  describe('User Management', () => {
    it('should list all Active Directory users', async () => {
      // Act
      const result = await client.activedirectory.getADUsers({});

      // Assert
      expect(result).toBeDefined();
      expect(result.totalItems).toBe(3);
      expect(result.data).toBeDefined();
      expect(result.data).toHaveLength(3);
      expect(result.data![0].principalName).toBe('jdoe');
      expect(result.data![1].principalName).toBe('jsmith');
      expect(result.data![2].principalName).toBe('mbrown');
    });

    it('should handle pagination parameters for users', async () => {
      // Act
      const result = await client.activedirectory.getADUsers({
        PageSize: 10,
        Page: 0,
      });

      // Assert
      expect(result).toBeDefined();
      expect(result.data).toBeDefined();
      expect(result.totalItems).toBeGreaterThan(0);
    });

    it('should get specific user by ID', async () => {
      // Arrange
      const userId = 'user-001';

      // Act
      const result = await client.activedirectory.getADUser(userId);

      // Assert
      expect(result).toBeDefined();
      expect(result.id).toBe(userId);
      expect(result.principalName).toBe('jdoe');
      expect(result.name).toBe('John Doe');
      expect(result.mail).toBe('john.doe@company.com');
    });

    it('should return 404 for non-existent user', async () => {
      // Arrange
      const invalidUserId = '00000000-0000-0000-0000-000000000000';

      // Act & Assert
      await expect(client.activedirectory.getADUser(invalidUserId))
        .rejects.toThrow();
    });
  });

  describe('Group Management', () => {
    it('should list all Active Directory groups', async () => {
      // Act
      const result = await client.activedirectory.getADGroups({});

      // Assert
      expect(result).toBeDefined();
      expect(result.totalItems).toBe(2);
      expect(result.data).toBeDefined();
      expect(result.data).toHaveLength(2);
      expect(result.data![0].name).toBe('IT-Admins');
      expect(result.data![1].name).toBe('All-Users');
    });

    it('should handle pagination for groups', async () => {
      // Act
      const result = await client.activedirectory.getADGroups({
        PageSize: 10,
        Page: 0,
      });

      // Assert
      expect(result).toBeDefined();
      expect(result.data).toBeDefined();
      expect(result.totalItems).toBeGreaterThan(0);
    });
  });

  describe('AD Workflows', () => {
    it('should perform complete user discovery workflow', async () => {
      // Step 1: List all users
      const users = await client.activedirectory.getADUsers({});
      expect(users.totalItems).toBeGreaterThan(0);
      expect(users.data!.length).toBeGreaterThan(0);

      // Step 2: Get first user details
      const firstUserId = users.data![0].id!;
      const userDetails = await client.activedirectory.getADUser(firstUserId);
      expect(userDetails.id).toBe(firstUserId);
      expect(userDetails.principalName).toBeDefined();

      // Step 3: List all groups
      const groups = await client.activedirectory.getADGroups({});
      expect(groups).toBeDefined();
      expect(groups.data).toBeInstanceOf(Array);
    });

    it('should filter users by domain', async () => {
      // Step 1: List all users
      const users = await client.activedirectory.getADUsers({});
      expect(users.data).toBeDefined();

      // Client-side filtering example
      const domainUsers = users.data!.filter(u => u.domain === 'company.com');
      expect(domainUsers.length).toBeGreaterThan(0);
      expect(domainUsers[0].domain).toBe('company.com');
    });
  });

  describe('Data Validation', () => {
    it('should return users with required properties', async () => {
      const result = await client.activedirectory.getADUsers({});

      result.data!.forEach(user => {
        expect(user).toHaveProperty('id');
        expect(user).toHaveProperty('principalName');
        expect(user).toHaveProperty('name');
        expect(user).toHaveProperty('mail');
        expect(user).toHaveProperty('enabled');
      });
    });

    it('should return user details with all properties', async () => {
      const userId = 'user-001';
      const result = await client.activedirectory.getADUser(userId);

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('principalName');
      expect(result).toHaveProperty('firstName');
      expect(result).toHaveProperty('lastName');
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('mail');
      expect(result).toHaveProperty('title');
      expect(result).toHaveProperty('domain');
    });

    it('should return groups with required properties', async () => {
      const result = await client.activedirectory.getADGroups({});

      result.data!.forEach(group => {
        expect(group).toHaveProperty('id');
        expect(group).toHaveProperty('name');
        expect(group).toHaveProperty('description');
        expect(group).toHaveProperty('memberCount');
      });
    });
  });
});
