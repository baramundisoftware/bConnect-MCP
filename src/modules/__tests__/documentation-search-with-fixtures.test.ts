/**
 * Documentation Search Module - Unit Tests with Real Fixtures
 *
 * Comprehensive tests using real test data (not mocked fs)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DocumentationSearchModule } from '../documentation-search.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to test fixtures
const FIXTURES_PATH = path.resolve(__dirname, '../../../__fixtures__');

describe('DocumentationSearchModule - With Real Fixtures', () => {
  let docSearch: DocumentationSearchModule;

  beforeEach(() => {
    // Use real fixtures path
    docSearch = new DocumentationSearchModule(FIXTURES_PATH);
  });

  afterEach(async () => {
    // Cleanup if needed
  });

  describe('2.1 - Index Building', () => {
    it('should build index and count documents correctly', async () => {
      await docSearch.buildIndex();

      const stats = await docSearch.getStats();

      // Expected: 3 forum + 2 faq + 2 kb + 2 ideas + 2 release notes = 11 total
      expect(stats.totalDocuments).toBe(11);
      expect(stats.coverage.forum.indexed).toBe(3);
      expect(stats.coverage.feedback.types.faq).toBe(2);
      expect(stats.coverage.feedback.types.kb).toBe(2);
      expect(stats.coverage.feedback.types.ideas).toBe(2);
      expect(stats.coverage.releaseNotes.indexed).toBe(2);
    });

    it('should handle missing directories gracefully', async () => {
      const invalidDocSearch = new DocumentationSearchModule('/non-existent-path');

      // Should not throw, should just log warnings
      await expect(invalidDocSearch.buildIndex()).resolves.not.toThrow();

      const stats = await invalidDocSearch.getStats();
      expect(stats.totalDocuments).toBe(0);
    });

    it('should measure performance (< 1000ms for 11 docs)', async () => {
      const start = Date.now();
      await docSearch.buildIndex();
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000); // Should be fast for 11 docs
    });

    it('should be idempotent (multiple builds produce same result)', async () => {
      await docSearch.buildIndex();
      const stats1 = await docSearch.getStats();

      await docSearch.buildIndex();
      const stats2 = await docSearch.getStats();

      expect(stats1.totalDocuments).toBe(stats2.totalDocuments);
    });
  });

  describe('2.2 - Forum Content Parsing', () => {
    beforeEach(async () => {
      await docSearch.buildIndex();
    });

    it('should parse forum thread title, URL, author, date', async () => {
      const doc = await docSearch.getDocument('forum-baramundi-connect-12345');

      expect(doc).not.toBeNull();
      expect(doc!.title).toBe('How to configure bConnect API?');
      expect(doc!.url).toContain('forum.baramundi.com');
      expect(doc!.author).toBe('TestUser1');
      expect(doc!.date).toBeDefined();
    });

    it('should handle solved status correctly', async () => {
      const solvedDoc = await docSearch.getDocument('forum-baramundi-connect-12345');
      const unsolvedDoc = await docSearch.getDocument('forum-baramundi-connect-12346');

      expect(solvedDoc!.metadata.solved).toBe(true);
      expect(unsolvedDoc!.metadata.solved).toBe(false);
    });

    it('should extract excerpt (first 200 chars)', async () => {
      const doc = await docSearch.getDocument('forum-baramundi-connect-12345');

      expect(doc!.excerpt).toBeDefined();
      expect(doc!.excerpt.length).toBeGreaterThan(50);
      expect(doc!.excerpt.length).toBeLessThan(250); // Approximately 200 + "..."
    });

    it('should handle reply count', async () => {
      const doc = await docSearch.getDocument('forum-baramundi-connect-12345');

      expect(doc!.metadata.replies).toBe(5);
    });

    it('should index all forum categories', async () => {
      const coverage = await docSearch.listSources();

      expect(coverage.forum.categories).toContain('baramundi-connect');
      expect(coverage.forum.categories.length).toBe(1);
    });
  });

  describe('2.3 - Feedback Content Parsing', () => {
    beforeEach(async () => {
      await docSearch.buildIndex();
    });

    it('should parse FAQ items correctly', async () => {
      const faqDoc = await docSearch.getDocument('feedback-faq-what-is-baramundi-management-suite');

      expect(faqDoc).not.toBeNull();
      expect(faqDoc!.type).toBe('faq');
      expect(faqDoc!.source).toBe('feedback');
      expect(faqDoc!.title).toContain('baramundi Management Suite');
    });

    it('should parse Knowledge Base items correctly', async () => {
      const kbDoc = await docSearch.getDocument('feedback-kb-troubleshooting-agent-connection-issues');

      expect(kbDoc).not.toBeNull();
      expect(kbDoc!.type).toBe('kb');
      expect(kbDoc!.source).toBe('feedback');
      expect(kbDoc!.title).toContain('Troubleshooting');
    });

    it('should parse Ideas with votes and status', async () => {
      const ideaDoc = await docSearch.getDocument('feedback-idea-idea-1234-add-python-scripting-support');

      expect(ideaDoc).not.toBeNull();
      expect(ideaDoc!.type).toBe('idea');
      expect(ideaDoc!.source).toBe('feedback');
      expect(ideaDoc!.metadata.votes).toBe(47);
      expect(ideaDoc!.metadata.status).toBe('Under Review');
    });

    it('should extract author and date from feedback items', async () => {
      const doc = await docSearch.getDocument('feedback-idea-idea-1234-add-python-scripting-support');

      expect(doc!.author).toBe('PowerUser123');
      expect(doc!.date).toBe('2024-03-15');
    });
  });

  describe('2.4 - Release Notes Parsing', () => {
    beforeEach(async () => {
      await docSearch.buildIndex();
    });

    it('should extract version and language from filename', async () => {
      const doc = await docSearch.getDocument('release-notes-2024R1-EN');

      expect(doc).not.toBeNull();
      expect(doc!.metadata.version).toBe('2024R1');
      expect(doc!.metadata.language).toBe('EN');
    });

    it('should handle both .txt and .md files', async () => {
      const txtDoc = await docSearch.getDocument('release-notes-2024R1-EN');
      const txtDoc2 = await docSearch.getDocument('release-notes-2024R2-EN');

      expect(txtDoc).not.toBeNull();
      expect(txtDoc2).not.toBeNull();
    });

    it('should index all release note versions', async () => {
      const coverage = await docSearch.listSources();

      expect(coverage.releaseNotes.versions).toContain('2024R1');
      expect(coverage.releaseNotes.versions).toContain('2024R2');
      expect(coverage.releaseNotes.versions.length).toBe(2);
    });

    it('should track coverage counters correctly', async () => {
      const coverage = await docSearch.listSources();

      expect(coverage.forum.indexed).toBe(3);
      expect(coverage.feedback.indexed).toBe(6); // 2 faq + 2 kb + 2 ideas
      expect(coverage.releaseNotes.indexed).toBe(2);
      expect(coverage.total).toBe(11);
    });
  });

  describe('2.5 - Search Functionality', () => {
    beforeEach(async () => {
      await docSearch.buildIndex();
    });

    it('should return results for simple query', async () => {
      const { results } = await docSearch.search('BitLocker');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toContain('BitLocker');
    });

    it('should handle fuzzy matching (typos)', async () => {
      const { results } = await docSearch.search('Bitlokcer'); // Typo

      // Should still find "BitLocker" with fuzzy matching
      expect(results.length).toBeGreaterThan(0);
    });

    it('should handle prefix matching', async () => {
      const { results } = await docSearch.search('deploy'); // Prefix of "deployment"

      expect(results.length).toBeGreaterThan(0);
      const titles = results.map(r => r.title.toLowerCase());
      expect(titles.some(t => t.includes('deploy'))).toBe(true);
    });

    it('should filter by source: forum', async () => {
      const { results } = await docSearch.search('baramundi', { source: 'forum' });

      expect(results.length).toBeGreaterThan(0);
      results.forEach(result => {
        expect(result.source).toBe('forum');
      });
    });

    it('should filter by source: feedback', async () => {
      const { results } = await docSearch.search('baramundi', { source: 'feedback' });

      expect(results.length).toBeGreaterThan(0);
      results.forEach(result => {
        expect(result.source).toBe('feedback');
      });
    });

    it('should filter by source: release-notes', async () => {
      const { results } = await docSearch.search('2024', { source: 'release-notes' });

      expect(results.length).toBeGreaterThan(0);
      results.forEach(result => {
        expect(result.source).toBe('release-notes');
      });
    });

    it('should filter by type: faq', async () => {
      const { results } = await docSearch.search('baramundi', { type: 'faq' });

      results.forEach(result => {
        expect(result.type).toBe('faq');
      });
    });

    it('should filter by type: kb', async () => {
      const { results } = await docSearch.search('agent', { type: 'kb' });

      expect(results.length).toBeGreaterThan(0);
      results.forEach(result => {
        expect(result.type).toBe('kb');
      });
    });

    it('should filter by type: idea', async () => {
      const { results } = await docSearch.search('Python', { type: 'idea' });

      expect(results.length).toBeGreaterThan(0);
      results.forEach(result => {
        expect(result.type).toBe('idea');
      });
    });

    it('should filter by category', async () => {
      const { results } = await docSearch.search('API', { category: 'baramundi-connect' });

      results.forEach(result => {
        if (result.category) {
          expect(result.category).toBe('baramundi-connect');
        }
      });
    });

    it('should respect limit parameter', async () => {
      const { results } = await docSearch.search('baramundi', { limit: 3 });

      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('should return results sorted by score (descending)', async () => {
      const { results } = await docSearch.search('baramundi');

      if (results.length > 1) {
        for (let i = 0; i < results.length - 1; i++) {
          expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
        }
      }
    });

    it('should return empty array when no matches', async () => {
      const { results } = await docSearch.search('xyzabc123nonexistent');

      expect(results).toEqual([]);
    });
  });

  describe('2.6 - Document Retrieval', () => {
    beforeEach(async () => {
      await docSearch.buildIndex();
    });

    it('should return full document with content', async () => {
      const doc = await docSearch.getDocument('forum-baramundi-connect-12345');

      expect(doc).not.toBeNull();
      expect(doc!.content).toBeDefined();
      expect(doc!.content.length).toBeGreaterThan(100);
      expect(doc!.content).toContain('bConnect API'); // From content
    });

    it('should return null for invalid ID', async () => {
      const doc = await docSearch.getDocument('invalid-id-12345');

      expect(doc).toBeNull();
    });

    it('should include all metadata fields', async () => {
      const doc = await docSearch.getDocument('forum-baramundi-connect-12345');

      expect(doc).not.toBeNull();
      expect(doc!.id).toBeDefined();
      expect(doc!.title).toBeDefined();
      expect(doc!.source).toBeDefined();
      expect(doc!.type).toBeDefined();
      expect(doc!.excerpt).toBeDefined();
      expect(doc!.content).toBeDefined();
      expect(doc!.filepath).toBeDefined();
      expect(doc!.metadata).toBeDefined();
      expect(typeof doc!.metadata).toBe('object');
    });
  });

  describe('2.7 - Statistics and Coverage', () => {
    beforeEach(async () => {
      await docSearch.buildIndex();
    });

    it('should return correct coverage stats via listSources()', async () => {
      const coverage = await docSearch.listSources();

      expect(coverage.forum.indexed).toBe(3);
      expect(coverage.forum.categories).toContain('baramundi-connect');
      expect(coverage.feedback.indexed).toBe(6);
      expect(coverage.feedback.types.faq).toBe(2);
      expect(coverage.feedback.types.kb).toBe(2);
      expect(coverage.feedback.types.ideas).toBe(2);
      expect(coverage.releaseNotes.indexed).toBe(2);
      expect(coverage.total).toBe(11);
    });

    it('should return popular topics sorted by count', async () => {
      const topics = await docSearch.getPopularTopics({ limit: 5 });

      expect(Array.isArray(topics)).toBe(true);
      expect(topics.length).toBeGreaterThan(0);
      expect(topics.length).toBeLessThanOrEqual(5);

      // Verify sorted by count descending
      if (topics.length > 1) {
        for (let i = 0; i < topics.length - 1; i++) {
          expect(topics[i].count).toBeGreaterThanOrEqual(topics[i + 1].count);
        }
      }

      // Verify topic structure
      topics.forEach(topic => {
        expect(topic).toHaveProperty('topic');
        expect(topic).toHaveProperty('count');
        expect(topic).toHaveProperty('source');
        expect(typeof topic.topic).toBe('string');
        expect(typeof topic.count).toBe('number');
      });
    });

    it('should filter popular topics by source', async () => {
      const forumTopics = await docSearch.getPopularTopics({ source: 'forum', limit: 5 });

      forumTopics.forEach(topic => {
        expect(topic.source).toBe('forum');
      });
    });

    it('should respect limit in getPopularTopics', async () => {
      const topics = await docSearch.getPopularTopics({ limit: 3 });

      expect(topics.length).toBeLessThanOrEqual(3);
    });

    it('should return stats with totalDocuments, coverage, indexSize', async () => {
      const stats = await docSearch.getStats();

      expect(stats).toHaveProperty('totalDocuments');
      expect(stats).toHaveProperty('coverage');
      expect(stats).toHaveProperty('indexSize');

      expect(stats.totalDocuments).toBe(11);
      expect(stats.indexSize).toBe(11);

      expect(stats.coverage.forum.indexed).toBe(3);
      expect(stats.coverage.feedback.indexed).toBe(6);
      expect(stats.coverage.releaseNotes.indexed).toBe(2);
    });
  });
});
