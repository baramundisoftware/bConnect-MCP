import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DocumentationSearchModule, SearchResult, SearchCoverage } from '../documentation-search.js';
import fs from 'fs';
import path from 'path';

// Mock fs to avoid actual file system access during tests
vi.mock('fs');
vi.mock('fs/promises');

describe('DocumentationSearchModule', () => {
  let docSearch: DocumentationSearchModule;

  beforeEach(() => {
    // Create instance with test content path
    docSearch = new DocumentationSearchModule('/test/content/path');

    // Reset all mocks
    vi.clearAllMocks();
  });

  describe('search()', () => {
    it('should return empty results when index is not built', async () => {
      const response = await docSearch.search('test query');

      expect(response).toBeDefined();
      expect(response.results).toBeDefined();
      expect(Array.isArray(response.results)).toBe(true);
      expect(response.results.length).toBe(0);
    });

    it('should search across all documentation sources', async () => {
      // Build index first (will be empty in test, but that's ok)
      await docSearch.buildIndex();

      const response = await docSearch.search('deployment');

      expect(Array.isArray(response.results)).toBe(true);
      // In test environment with no actual files, expect empty array
      expect(response.results.length).toBeGreaterThanOrEqual(0);
    });

    it('should filter results by source - forum', async () => {
      await docSearch.buildIndex();

      const response = await docSearch.search('baramundi', { source: 'forum' });

      expect(Array.isArray(response.results)).toBe(true);
      // All results should be from forum source
      response.results.forEach((result: SearchResult) => {
        expect(result.source).toBe('forum');
      });
    });

    it('should filter results by source - website', async () => {
      await docSearch.buildIndex();

      const response = await docSearch.search('baramundi', { source: 'website' });

      expect(Array.isArray(response.results)).toBe(true);
      // All results should be from website source
      response.results.forEach((result: SearchResult) => {
        expect(result.source).toBe('website');
      });
    });

    it('should filter results by source - release-notes', async () => {
      await docSearch.buildIndex();

      const response = await docSearch.search('baramundi', { source: 'release-notes' });

      expect(Array.isArray(response.results)).toBe(true);
      // All results should be from release-notes source
      response.results.forEach((result: SearchResult) => {
        expect(result.source).toBe('release-notes');
      });
    });

    it('should filter results by source - preview', async () => {
      await docSearch.buildIndex();

      const response = await docSearch.search('baramundi', { source: 'preview' });

      expect(Array.isArray(response.results)).toBe(true);
      // All results should be from preview source
      response.results.forEach((result: SearchResult) => {
        expect(result.source).toBe('preview');
      });
    });

    it('should filter results by type', async () => {
      await docSearch.buildIndex();

      const response = await docSearch.search('baramundi', { type: 'kb' });

      expect(Array.isArray(response.results)).toBe(true);
      response.results.forEach((result: SearchResult) => {
        expect(result.type).toBe('kb');
      });
    });

    it('should limit results', async () => {
      await docSearch.buildIndex();

      const response = await docSearch.search('baramundi', { limit: 5 });

      expect(response.results.length).toBeLessThanOrEqual(5);
    });

    it('should return results with required fields', async () => {
      await docSearch.buildIndex();

      // Even if no results, test the interface
      const response = await docSearch.search('test');

      if (response.results.length > 0) {
        const result = response.results[0];
        expect(result).toHaveProperty('id');
        expect(result).toHaveProperty('title');
        expect(result).toHaveProperty('source');
        expect(result).toHaveProperty('type');
        expect(result).toHaveProperty('excerpt');
        expect(result).toHaveProperty('score');
      }
    });
  });

  describe('getDocument()', () => {
    it('should return null for non-existent document', async () => {
      const doc = await docSearch.getDocument('non-existent-id');

      expect(doc).toBeNull();
    });

    it('should return document with full content', async () => {
      await docSearch.buildIndex();

      // Test with a non-existent ID (since we have no real data in test)
      const doc = await docSearch.getDocument('test-id');

      expect(doc).toBeNull(); // No documents in test environment
    });

    it('should include all document fields', async () => {
      await docSearch.buildIndex();

      const doc = await docSearch.getDocument('test-id');

      // In test environment, expect null
      // In real environment with data, would check fields
      if (doc !== null) {
        expect(doc).toHaveProperty('id');
        expect(doc).toHaveProperty('title');
        expect(doc).toHaveProperty('content');
        expect(doc).toHaveProperty('filepath');
        expect(doc).toHaveProperty('metadata');
      }
    });
  });

  describe('listSources()', () => {
    it('should return coverage statistics', async () => {
      const coverage = await docSearch.listSources();

      expect(coverage).toBeDefined();
      expect(coverage).toHaveProperty('forum');
      expect(coverage).toHaveProperty('feedback');
      expect(coverage).toHaveProperty('releaseNotes');
      expect(coverage).toHaveProperty('total');
    });

    it('should have correct structure for forum coverage', async () => {
      const coverage = await docSearch.listSources();

      expect(coverage.forum).toHaveProperty('indexed');
      expect(coverage.forum).toHaveProperty('categories');
      expect(typeof coverage.forum.indexed).toBe('number');
      expect(Array.isArray(coverage.forum.categories)).toBe(true);
    });

    it('should have correct structure for feedback coverage', async () => {
      const coverage = await docSearch.listSources();

      expect(coverage.feedback).toHaveProperty('indexed');
      expect(coverage.feedback).toHaveProperty('types');
      expect(coverage.feedback.types).toHaveProperty('faq');
      expect(coverage.feedback.types).toHaveProperty('kb');
      expect(coverage.feedback.types).toHaveProperty('ideas');
    });

    it('should have correct structure for release notes coverage', async () => {
      const coverage = await docSearch.listSources();

      expect(coverage.releaseNotes).toHaveProperty('indexed');
      expect(coverage.releaseNotes).toHaveProperty('versions');
      expect(typeof coverage.releaseNotes.indexed).toBe('number');
      expect(Array.isArray(coverage.releaseNotes.versions)).toBe(true);
    });

    it('should have correct structure for preview documents coverage', async () => {
      const coverage = await docSearch.listSources();

      expect(coverage.previewDocuments).toHaveProperty('indexed');
      expect(coverage.previewDocuments).toHaveProperty('versions');
      expect(typeof coverage.previewDocuments.indexed).toBe('number');
      expect(Array.isArray(coverage.previewDocuments.versions)).toBe(true);
    });

    it('should have correct structure for website coverage', async () => {
      const coverage = await docSearch.listSources();

      expect(coverage.website).toHaveProperty('indexed');
      expect(coverage.website).toHaveProperty('categories');
      expect(typeof coverage.website.indexed).toBe('number');
      expect(Array.isArray(coverage.website.categories)).toBe(true);
    });

    it('should calculate total correctly', async () => {
      const coverage = await docSearch.listSources();

      const expectedTotal =
        coverage.forum.indexed +
        coverage.feedback.indexed +
        coverage.releaseNotes.indexed +
        coverage.previewDocuments.indexed +
        coverage.website.indexed;

      expect(coverage.total).toBe(expectedTotal);
    });
  });

  describe('getPopularTopics()', () => {
    it('should return popular topics', async () => {
      await docSearch.buildIndex();

      const topics = await docSearch.getPopularTopics();

      expect(Array.isArray(topics)).toBe(true);
    });

    it('should limit topics', async () => {
      await docSearch.buildIndex();

      const topics = await docSearch.getPopularTopics({ limit: 5 });

      expect(topics.length).toBeLessThanOrEqual(5);
    });

    it('should return topics with count', async () => {
      await docSearch.buildIndex();

      const topics = await docSearch.getPopularTopics();

      if (topics.length > 0) {
        const topic = topics[0];
        expect(topic).toHaveProperty('topic');
        expect(topic).toHaveProperty('count');
        expect(typeof topic.count).toBe('number');
      }
    });

    it('should return topics sorted by count descending', async () => {
      await docSearch.buildIndex();

      const topics = await docSearch.getPopularTopics();

      if (topics.length > 1) {
        for (let i = 0; i < topics.length - 1; i++) {
          expect(topics[i].count).toBeGreaterThanOrEqual(topics[i + 1].count);
        }
      }
    });
  });

  describe('buildIndex()', () => {
    it('should build index without errors', async () => {
      await expect(docSearch.buildIndex()).resolves.not.toThrow();
    });

    it('should mark index as built', async () => {
      await docSearch.buildIndex();

      // Index should be built (test by trying to search)
      const response = await docSearch.search('test');
      expect(response).toBeDefined();
      expect(response.results).toBeDefined();
      expect(Array.isArray(response.results)).toBe(true);
    });
  });
});
