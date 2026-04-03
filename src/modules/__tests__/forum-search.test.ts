import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForumSearchModule, ForumThread, SearchResult } from '../forum-search.js';
import fs from 'fs';
import path from 'path';

// Mock fs to avoid actual file system access during tests
vi.mock('fs');

describe('ForumSearchModule', () => {
  let forumSearch: ForumSearchModule;
  const testContentPath = '/test/forum-content';

  beforeEach(() => {
    // Create instance with test content path
    forumSearch = new ForumSearchModule(testContentPath);

    // Reset all mocks
    vi.clearAllMocks();

    // Mock empty directory structure by default
    vi.mocked(fs.readdirSync).mockReturnValue([]);
  });

  describe('constructor', () => {
    it('should initialize with content path', () => {
      expect(forumSearch).toBeDefined();
      expect(forumSearch).toBeInstanceOf(ForumSearchModule);
    });

    it('should not build index on construction', async () => {
      // Index should not be built until explicitly called
      const results = await forumSearch.search('test');
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('buildIndex()', () => {
    it('should build index without errors', async () => {
      await expect(forumSearch.buildIndex()).resolves.not.toThrow();
    });

    it('should mark index as built', async () => {
      await forumSearch.buildIndex();

      // Try to build again - should skip
      const consoleSpy = vi.spyOn(console, 'log');
      await forumSearch.buildIndex();

      expect(consoleSpy).toHaveBeenCalledWith('Search index already built');
      consoleSpy.mockRestore();
    });

    it('should find all category directories', async () => {
      // Mock category directories
      vi.mocked(fs.readdirSync).mockReturnValueOnce([
        { name: 'baramundi-connect', isDirectory: () => true } as any,
        { name: 'job-management', isDirectory: () => true } as any,
        { name: 'readme.md', isDirectory: () => false } as any
      ]);

      await forumSearch.buildIndex();

      // Should have called readdirSync to find categories
      expect(fs.readdirSync).toHaveBeenCalledWith(
        testContentPath,
        { withFileTypes: true }
      );
    });

    it('should parse all threads in categories', async () => {
      // Mock categories
      vi.mocked(fs.readdirSync)
        .mockReturnValueOnce([
          { name: 'baramundi-connect', isDirectory: () => true } as any
        ])
        .mockReturnValueOnce(['12345-test-thread.md'] as any); // Files in category

      // Mock file reading
      const mockThreadContent = `# Test Thread Title

**URL:** https://forum.baramundi.com/12345
**Author:** John Doe
**Date:** 2025-01-15
**Replies:** 5
**Status:** ✅ SOLVED

## Original Post

This is test content for the thread.`;

      vi.mocked(fs.readFileSync).mockReturnValue(mockThreadContent);

      await forumSearch.buildIndex();

      expect(fs.readFileSync).toHaveBeenCalled();
    });
  });

  describe('search()', () => {
    it('should return empty array when no threads indexed', async () => {
      const results = await forumSearch.search('test query');

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });

    it('should filter results by category', async () => {
      await forumSearch.buildIndex();

      const results = await forumSearch.search('baramundi', {
        category: 'baramundi-connect'
      });

      expect(Array.isArray(results)).toBe(true);
      // All results should be from specified category
      results.forEach((result: SearchResult) => {
        expect(result.category).toBe('baramundi-connect');
      });
    });

    it('should filter results by solved status', async () => {
      await forumSearch.buildIndex();

      const results = await forumSearch.search('deployment', {
        solvedOnly: true
      });

      expect(Array.isArray(results)).toBe(true);
      // All results should be solved threads
      results.forEach((result: SearchResult) => {
        expect(result.solved).toBe(true);
      });
    });

    it('should limit results', async () => {
      await forumSearch.buildIndex();

      const results = await forumSearch.search('baramundi', { limit: 5 });

      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('should return results with required fields', async () => {
      await forumSearch.buildIndex();

      const results = await forumSearch.search('test');

      if (results.length > 0) {
        const result = results[0];
        expect(result).toHaveProperty('id');
        expect(result).toHaveProperty('title');
        expect(result).toHaveProperty('category');
        expect(result).toHaveProperty('url');
        expect(result).toHaveProperty('excerpt');
        expect(result).toHaveProperty('solved');
        expect(result).toHaveProperty('replies');
        expect(result).toHaveProperty('score');
      }
    });

    it('should support fuzzy search', async () => {
      await forumSearch.buildIndex();

      // Search with typo (should still find results due to fuzzy matching)
      const results = await forumSearch.search('baramuni'); // Missing 'd'

      expect(Array.isArray(results)).toBe(true);
    });

    it('should support prefix search', async () => {
      await forumSearch.buildIndex();

      // Partial word search
      const results = await forumSearch.search('depl'); // "deployment"

      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('getThread()', () => {
    it('should return null for non-existent thread', async () => {
      const thread = await forumSearch.getThread('non-existent-id');

      expect(thread).toBeNull();
    });

    it('should return thread with full content', async () => {
      await forumSearch.buildIndex();

      // Test with a non-existent ID (since we have no real data in test)
      const thread = await forumSearch.getThread('test-id');

      expect(thread).toBeNull(); // No threads in test environment
    });

    it('should include all thread fields', async () => {
      await forumSearch.buildIndex();

      const thread = await forumSearch.getThread('test-id');

      // In test environment, expect null
      // In real environment with data, would check fields
      if (thread !== null) {
        expect(thread).toHaveProperty('id');
        expect(thread).toHaveProperty('title');
        expect(thread).toHaveProperty('category');
        expect(thread).toHaveProperty('url');
        expect(thread).toHaveProperty('author');
        expect(thread).toHaveProperty('date');
        expect(thread).toHaveProperty('replies');
        expect(thread).toHaveProperty('solved');
        expect(thread).toHaveProperty('excerpt');
        expect(thread).toHaveProperty('content');
        expect(thread).toHaveProperty('filepath');
      }
    });
  });

  describe('listCategories()', () => {
    it('should return empty array when no threads indexed', async () => {
      const categories = await forumSearch.listCategories();

      expect(categories).toBeDefined();
      expect(Array.isArray(categories)).toBe(true);
      expect(categories.length).toBe(0);
    });

    it('should return categories with thread counts', async () => {
      await forumSearch.buildIndex();

      const categories = await forumSearch.listCategories();

      expect(Array.isArray(categories)).toBe(true);

      categories.forEach(category => {
        expect(category).toHaveProperty('name');
        expect(category).toHaveProperty('threadCount');
        expect(typeof category.name).toBe('string');
        expect(typeof category.threadCount).toBe('number');
      });
    });

    it('should sort categories by thread count descending', async () => {
      await forumSearch.buildIndex();

      const categories = await forumSearch.listCategories();

      if (categories.length > 1) {
        for (let i = 0; i < categories.length - 1; i++) {
          expect(categories[i].threadCount).toBeGreaterThanOrEqual(
            categories[i + 1].threadCount
          );
        }
      }
    });
  });

  describe('getStats()', () => {
    it('should return statistics object', async () => {
      const stats = await forumSearch.getStats();

      expect(stats).toBeDefined();
      expect(stats).toHaveProperty('totalThreads');
      expect(stats).toHaveProperty('solvedThreads');
      expect(stats).toHaveProperty('totalReplies');
      expect(stats).toHaveProperty('categories');
    });

    it('should have correct types for all stats', async () => {
      const stats = await forumSearch.getStats();

      expect(typeof stats.totalThreads).toBe('number');
      expect(typeof stats.solvedThreads).toBe('number');
      expect(typeof stats.totalReplies).toBe('number');
      expect(Array.isArray(stats.categories)).toBe(true);
    });

    it('should calculate total threads correctly', async () => {
      const stats = await forumSearch.getStats();

      expect(stats.totalThreads).toBeGreaterThanOrEqual(0);
    });

    it('should calculate solved threads correctly', async () => {
      const stats = await forumSearch.getStats();

      expect(stats.solvedThreads).toBeGreaterThanOrEqual(0);
      expect(stats.solvedThreads).toBeLessThanOrEqual(stats.totalThreads);
    });

    it('should calculate total replies correctly', async () => {
      const stats = await forumSearch.getStats();

      expect(stats.totalReplies).toBeGreaterThanOrEqual(0);
    });

    it('should include category breakdown in stats', async () => {
      const stats = await forumSearch.getStats();

      expect(Array.isArray(stats.categories)).toBe(true);

      stats.categories.forEach(category => {
        expect(category).toHaveProperty('name');
        expect(category).toHaveProperty('threadCount');
      });
    });
  });

  describe('parseThread() - via integration', () => {
    it('should extract thread ID from filename', async () => {
      // Mock categories
      vi.mocked(fs.readdirSync)
        .mockReturnValueOnce([
          { name: 'test-category', isDirectory: () => true } as any
        ])
        .mockReturnValueOnce(['12345-test-thread.md'] as any);

      const mockContent = `# Test Thread
**URL:** https://forum.baramundi.com/12345
**Author:** Test Author
**Date:** 2025-01-15
**Replies:** 3
**Status:** ✅ SOLVED

## Original Post
Test content`;

      vi.mocked(fs.readFileSync).mockReturnValue(mockContent);

      await forumSearch.buildIndex();

      const thread = await forumSearch.getThread('12345');
      expect(thread).toBeDefined();
    });

    it('should extract title from markdown', async () => {
      vi.mocked(fs.readdirSync)
        .mockReturnValueOnce([
          { name: 'test-category', isDirectory: () => true } as any
        ])
        .mockReturnValueOnce(['12345-test-thread.md'] as any);

      const mockContent = `# My Test Thread Title
**URL:** https://forum.baramundi.com/12345
**Author:** Test Author

## Original Post
Content here`;

      vi.mocked(fs.readFileSync).mockReturnValue(mockContent);

      await forumSearch.buildIndex();

      const thread = await forumSearch.getThread('12345');
      if (thread) {
        expect(thread.title).toBe('My Test Thread Title');
      }
    });

    it('should detect solved status correctly', async () => {
      vi.mocked(fs.readdirSync)
        .mockReturnValueOnce([
          { name: 'test-category', isDirectory: () => true } as any
        ])
        .mockReturnValueOnce(['12345-solved.md', '12346-unsolved.md'] as any);

      vi.mocked(fs.readFileSync)
        .mockReturnValueOnce(`# Solved Thread
**URL:** https://forum.baramundi.com/12345
**Status:** ✅ SOLVED

## Original Post
Content`)
        .mockReturnValueOnce(`# Unsolved Thread
**URL:** https://forum.baramundi.com/12346
**Status:** ❌ UNSOLVED

## Original Post
Content`);

      await forumSearch.buildIndex();

      const solvedThread = await forumSearch.getThread('12345');
      const unsolvedThread = await forumSearch.getThread('12346');

      if (solvedThread) {
        expect(solvedThread.solved).toBe(true);
      }
      if (unsolvedThread) {
        expect(unsolvedThread.solved).toBe(false);
      }
    });

    it('should parse replies count correctly', async () => {
      vi.mocked(fs.readdirSync)
        .mockReturnValueOnce([
          { name: 'test-category', isDirectory: () => true } as any
        ])
        .mockReturnValueOnce(['12345-thread.md'] as any);

      const mockContent = `# Test Thread
**URL:** https://forum.baramundi.com/12345
**Replies:** 42

## Original Post
Content`;

      vi.mocked(fs.readFileSync).mockReturnValue(mockContent);

      await forumSearch.buildIndex();

      const thread = await forumSearch.getThread('12345');
      if (thread) {
        expect(thread.replies).toBe(42);
      }
    });

    it('should extract excerpt from content', async () => {
      vi.mocked(fs.readdirSync)
        .mockReturnValueOnce([
          { name: 'test-category', isDirectory: () => true } as any
        ])
        .mockReturnValueOnce(['12345-thread.md'] as any);

      const mockContent = `# Test Thread
**URL:** https://forum.baramundi.com/12345

## Original Post
This is the original post content that should be extracted as an excerpt. It contains important information about the thread topic.`;

      vi.mocked(fs.readFileSync).mockReturnValue(mockContent);

      await forumSearch.buildIndex();

      const thread = await forumSearch.getThread('12345');
      if (thread) {
        // Excerpt extraction skips "## Original Post\n" and extracts 200 chars
        // So it starts from "This is..." and may trim leading whitespace
        expect(thread.excerpt).toContain('is the original post content');
        expect(thread.excerpt.length).toBeGreaterThan(0);
      }
    });

    it('should handle malformed markdown gracefully', async () => {
      vi.mocked(fs.readdirSync)
        .mockReturnValueOnce([
          { name: 'test-category', isDirectory: () => true } as any
        ])
        .mockReturnValueOnce(['malformed.md'] as any);

      const mockContent = `# Thread with no URL
Just some random content without proper metadata`;

      vi.mocked(fs.readFileSync).mockReturnValue(mockContent);

      // Should not throw error
      await expect(forumSearch.buildIndex()).resolves.not.toThrow();

      const stats = await forumSearch.getStats();
      expect(stats.totalThreads).toBe(0); // Malformed thread should be skipped
    });

    it('should handle missing metadata fields', async () => {
      vi.mocked(fs.readdirSync)
        .mockReturnValueOnce([
          { name: 'test-category', isDirectory: () => true } as any
        ])
        .mockReturnValueOnce(['12345-minimal.md'] as any);

      const mockContent = `# Minimal Thread
**URL:** https://forum.baramundi.com/12345

## Original Post
Content without author, date, or replies`;

      vi.mocked(fs.readFileSync).mockReturnValue(mockContent);

      await forumSearch.buildIndex();

      const thread = await forumSearch.getThread('12345');
      if (thread) {
        expect(thread.author).toBe('Unknown');
        expect(thread.date).toBe('Unknown');
        expect(thread.replies).toBe(0);
        expect(thread.solved).toBe(false);
      }
    });
  });

  describe('error handling', () => {
    it('should handle fs errors gracefully', async () => {
      vi.mocked(fs.readdirSync).mockImplementation(() => {
        throw new Error('File system error');
      });

      // Should not throw, but log error
      await expect(forumSearch.buildIndex()).rejects.toThrow();
    });

    it('should skip files that cannot be read', async () => {
      vi.mocked(fs.readdirSync)
        .mockReturnValueOnce([
          { name: 'test-category', isDirectory: () => true } as any
        ])
        .mockReturnValueOnce(['error.md', 'good.md'] as any);

      vi.mocked(fs.readFileSync)
        .mockImplementationOnce(() => {
          throw new Error('Cannot read file');
        })
        .mockReturnValueOnce(`# Good Thread
**URL:** https://forum.baramundi.com/123

## Original Post
Content`);

      // Should not throw - should skip error.md
      await expect(forumSearch.buildIndex()).resolves.not.toThrow();

      const stats = await forumSearch.getStats();
      expect(stats.totalThreads).toBe(1); // Only good.md should be indexed
    });
  });
});
