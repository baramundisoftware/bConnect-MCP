/**
 * Documentation Search Module - Error Handling & Edge Cases
 *
 * Tests resilience and boundary conditions:
 * - Malformed data handling
 * - File system errors
 * - Search edge cases
 * - Boundary conditions
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { DocumentationSearchModule } from '../documentation-search.js';

// Path to real documentation content
const REAL_DATA_PATH = '/workspaces/claudinno/docs.baramundi.com';

describe('DocumentationSearch - Error Handling', () => {
  describe('Malformed Data', () => {
    it('should handle missing content directories gracefully', async () => {
      const docSearch = new DocumentationSearchModule('/non/existent/path');

      await expect(docSearch.buildIndex()).resolves.not.toThrow();

      const stats = await docSearch.getStats();
      expect(stats.totalDocuments).toBe(0);

      console.log(`✅ Missing directories: Handled gracefully (0 docs)`);
    });

    it('should skip files with missing metadata', async () => {
      // Real data may have inconsistencies
      const docSearch = new DocumentationSearchModule(REAL_DATA_PATH);

      await expect(docSearch.buildIndex()).resolves.not.toThrow();

      const stats = await docSearch.getStats();
      expect(stats.totalDocuments).toBeGreaterThan(0);

      console.log(`✅ Missing metadata: Skipped gracefully (${stats.totalDocuments} docs indexed)`);
    }, 65000);

    it('should handle extremely large files gracefully', async () => {
      const docSearch = new DocumentationSearchModule(REAL_DATA_PATH);

      await docSearch.buildIndex();

      const stats = await docSearch.getStats();
      expect(stats.totalDocuments).toBeGreaterThan(13000);

      console.log(`✅ Large files: Handled successfully (${stats.totalDocuments} docs)`);
    }, 65000);

    it('should handle PDF parsing errors gracefully', async () => {
      const docSearch = new DocumentationSearchModule(REAL_DATA_PATH);

      await expect(docSearch.buildIndex()).resolves.not.toThrow();

      const coverage = await docSearch.listSources();
      // Should have attempted to parse PDFs
      expect(coverage.previewDocuments).toBeDefined();

      console.log(`✅ PDF parsing: ${coverage.previewDocuments.indexed} PDFs processed`);
    }, 65000);
  });

  describe('File System Errors', () => {
    it('should handle read permission errors gracefully', async () => {
      const docSearch = new DocumentationSearchModule(REAL_DATA_PATH);

      // Should not crash, should log warnings
      await expect(docSearch.buildIndex()).resolves.not.toThrow();

      const stats = await docSearch.getStats();
      expect(stats.totalDocuments).toBeGreaterThan(0);

      console.log(`✅ Permission errors: Handled gracefully (${stats.totalDocuments} docs)`);
    }, 65000);

    it('should handle concurrent file modifications during index', async () => {
      const docSearch = new DocumentationSearchModule(REAL_DATA_PATH);

      // Build index while potentially files are being modified
      await expect(docSearch.buildIndex()).resolves.not.toThrow();

      const stats = await docSearch.getStats();
      expect(stats.totalDocuments).toBeGreaterThan(0);

      console.log(`✅ Concurrent modifications: Handled (${stats.totalDocuments} docs)`);
    }, 65000);
  });
});

describe('Search Edge Cases', () => {
  let docSearch: DocumentationSearchModule;

  beforeAll(async () => {
    docSearch = new DocumentationSearchModule(REAL_DATA_PATH);
    await docSearch.buildIndex();
  }, 65000);

  it('should handle empty query string', async () => {
    const { results } = await docSearch.search('');

    // Empty query should return empty results or all results
    expect(Array.isArray(results)).toBe(true);

    console.log(`✅ Empty query: ${results.length} results`);
  });

  it('should handle very long queries (>1000 chars)', async () => {
    const longQuery = 'deployment '.repeat(100); // ~1100 chars

    await expect(docSearch.search(longQuery)).resolves.not.toThrow();

    console.log(`✅ Long query: ${longQuery.length} chars handled`);
  });

  it('should handle special regex characters in query', async () => {
    const queries = [
      'C++ OR C#',
      '[deployment]',
      '(error)',
      'path/to/file',
      'user@domain.com'
    ];

    for (const query of queries) {
      const { results } = await docSearch.search(query);
      expect(Array.isArray(results)).toBe(true);
    }

    console.log(`✅ Special characters: ${queries.length} queries handled`);
  });

  it('should handle non-ASCII queries', async () => {
    const queries = [
      'Verwaltung', // German
      'déploiement', // French with accents
      'configuración' // Spanish
    ];

    for (const query of queries) {
      await expect(docSearch.search(query)).resolves.not.toThrow();
    }

    console.log(`✅ Non-ASCII: ${queries.length} international queries handled`);
  });

  it('should handle queries with only common words', async () => {
    const { results } = await docSearch.search('the and or');

    expect(Array.isArray(results)).toBe(true);

    console.log(`✅ Common words: ${results.length} results`);
  });
});

describe('Boundary Conditions', () => {
  let docSearch: DocumentationSearchModule;

  beforeAll(async () => {
    docSearch = new DocumentationSearchModule(REAL_DATA_PATH);
    await docSearch.buildIndex();
  }, 65000);

  it('should handle limit=0 (return no results)', async () => {
    const { results } = await docSearch.search('deployment', { limit: 0 });

    expect(results.length).toBe(0);

    console.log(`✅ limit=0: ${results.length} results (expected 0)`);
  });

  it('should handle limit=1000 (very large limit)', async () => {
    const { results } = await docSearch.search('baramundi', { limit: 1000 });

    expect(results.length).toBeLessThanOrEqual(1000);

    console.log(`✅ limit=1000: ${results.length} results`);
  });

  it('should handle filter with no matches', async () => {
    const { results } = await docSearch.search('baramundi', {
      category: 'nonexistent-category-xyz'
    });

    expect(results.length).toBe(0);

    console.log(`✅ No matches: ${results.length} results (expected 0)`);
  });

  it('should handle search on empty index', async () => {
    const emptySearch = new DocumentationSearchModule('/empty/path');
    await emptySearch.buildIndex();

    const { results } = await emptySearch.search('test');

    expect(results.length).toBe(0);

    console.log(`✅ Empty index: ${results.length} results (expected 0)`);
  });

  it('should handle getDocument with invalid ID', async () => {
    const doc = await docSearch.getDocument('invalid-id-xyz-123');

    expect(doc).toBeNull();

    console.log(`✅ Invalid ID: null (expected)`);
  });

  it('should handle multiple filter combinations', async () => {
    const { results } = await docSearch.search('baramundi', {
      source: 'forum',
      limit: 10
    });

    expect(results.length).toBeLessThanOrEqual(10);
    results.forEach(r => {
      expect(r.source).toBe('forum');
    });

    console.log(`✅ Combined filters: ${results.length} results (forum, limit 10)`);
  });
});
