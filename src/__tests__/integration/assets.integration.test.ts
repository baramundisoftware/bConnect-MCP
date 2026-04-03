/**
 * Integration Tests for Assets Module
 *
 * These tests verify that the Assets module works correctly
 * with the bConnect API using MSW to mock HTTP responses.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BConnectClient } from '../../bconnect-client.js';
import '../setup/msw.js'; // Import MSW setup

describe('Assets Module - Integration Tests', () => {
  let client: BConnectClient;

  beforeEach(() => {
    // Create real client instance - HTTP requests will be intercepted by MSW
    client = new BConnectClient({
      baseUrl: 'https://bms-win22srv:444/bconnect',
      username: 'Administrator',
      password: 'baramundi-2008',
    });
  });

  describe('Asset Management', () => {
    it('should list all assets', async () => {
      // Act
      const result = await client.assets.getAssets({});

      // Assert
      expect(result).toBeDefined();
      expect(result.totalItems).toBe(3);
      expect(result.data).toBeDefined();
      expect(result.data).toHaveLength(3);
      expect(result.data![0].name).toBe('Dell Latitude 5520');
      expect(result.data![1].name).toBe('Microsoft Office 365 License');
      expect(result.data![2].name).toBe('Dell UltraSharp 27" Monitor');
    });

    it('should handle pagination parameters for assets', async () => {
      // Act
      const result = await client.assets.getAssets({
        PageSize: 10,
        Page: 0,
      });

      // Assert
      expect(result).toBeDefined();
      expect(result.data).toBeDefined();
      expect(result.totalItems).toBeGreaterThan(0);
    });

    it('should get specific asset by ID', async () => {
      // Arrange
      const assetId = 'asset-001';

      // Act
      const result = await client.assets.getAsset(assetId);

      // Assert
      expect(result).toBeDefined();
      expect(result.assetId).toBe(assetId);
      expect(result.name).toBe('Dell Latitude 5520');
      expect(result.assetTypeId).toBeDefined();
      expect(result.ownerId).toBeDefined();
    });

    it('should return 404 for non-existent asset', async () => {
      // Arrange
      const invalidAssetId = '00000000-0000-0000-0000-000000000000';

      // Act & Assert
      await expect(client.assets.getAsset(invalidAssetId))
        .rejects.toThrow();
    });
  });

  describe('Asset Types', () => {
    it('should list all asset types', async () => {
      // Act
      const result = await client.assets.getAssetTypes({});

      // Assert
      expect(result).toBeDefined();
      expect(result.totalItems).toBe(2);
      expect(result.data).toBeDefined();
      expect(result.data).toHaveLength(2);
      expect(result.data![0].name).toBe('Hardware');
      expect(result.data![1].name).toBe('Software');
    });
  });

  describe('Asset Workflows', () => {
    it('should perform complete asset discovery workflow', async () => {
      // Step 1: List all assets
      const assets = await client.assets.getAssets({});
      expect(assets.totalItems).toBeGreaterThan(0);
      expect(assets.data!.length).toBeGreaterThan(0);

      // Step 2: Get first asset details
      const firstAssetId = assets.data![0].assetId!;
      const assetDetails = await client.assets.getAsset(firstAssetId);
      expect(assetDetails.assetId).toBe(firstAssetId);
      expect(assetDetails.name).toBeDefined();

      // Step 3: List asset types
      const assetTypes = await client.assets.getAssetTypes({});
      expect(assetTypes).toBeDefined();
      expect(assetTypes.data).toBeInstanceOf(Array);
    });

    it('should filter assets by type', async () => {
      // Step 1: Get all asset types
      const assetTypes = await client.assets.getAssetTypes({});
      expect(assetTypes.data!.length).toBeGreaterThan(0);

      // Step 2: List all assets (filtering would be done by client-side logic)
      const assets = await client.assets.getAssets({});
      expect(assets.data).toBeDefined();

      // Client-side filtering example
      const hardwareAssets = assets.data!.filter(a => a.assetTypeName === 'Hardware');
      expect(hardwareAssets.length).toBeGreaterThan(0);
    });
  });

  describe('Data Validation', () => {
    it('should return assets with required properties', async () => {
      const result = await client.assets.getAssets({});

      result.data!.forEach(asset => {
        expect(asset).toHaveProperty('assetId');
        expect(asset).toHaveProperty('name');
        expect(asset).toHaveProperty('assetTypeName');
        expect(asset).toHaveProperty('ownerId');
        expect(asset).toHaveProperty('ownerName');
      });
    });

    it('should return asset details with all properties', async () => {
      const assetId = 'asset-001';
      const result = await client.assets.getAsset(assetId);

      expect(result).toHaveProperty('assetId');
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('assetTypeId');
      expect(result).toHaveProperty('ownerId');
      expect(result).toHaveProperty('purchaseDate');
      expect(result).toHaveProperty('purchasePrice');
    });

    it('should return asset types with required properties', async () => {
      const result = await client.assets.getAssetTypes({});

      result.data!.forEach(assetType => {
        expect(assetType).toHaveProperty('guid');
        expect(assetType).toHaveProperty('name');
        expect(assetType).toHaveProperty('comments');
        expect(assetType).toHaveProperty('guidParent');
      });
    });
  });
});
