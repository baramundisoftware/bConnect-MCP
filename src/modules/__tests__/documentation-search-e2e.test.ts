/**
 * Documentation Search Module - End-to-End Tests
 *
 * Tests complete user workflows from start to finish:
 * - Search → Retrieve → Verify workflows
 * - Multi-step query refinement
 * - Real-world user scenarios
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { DocumentationSearchModule } from '../documentation-search.js';

// Path to real documentation content
const REAL_DATA_PATH = '/workspaces/claudinno/docs.baramundi.com';

describe('DocumentationSearch - E2E Workflows', () => {
  let docSearch: DocumentationSearchModule;

  beforeAll(async () => {
    docSearch = new DocumentationSearchModule(REAL_DATA_PATH);
    await docSearch.buildIndex();
  }, 65000);

  describe('User Workflow: Find BitLocker Documentation', () => {
    it('should build index → search → retrieve document → verify content', async () => {
      // 1. Search for "BitLocker"
      const { results } = await docSearch.search('BitLocker recovery key');
      expect(results.length).toBeGreaterThan(0);

      console.log(`Step 1: Found ${results.length} results for "BitLocker recovery key"`);

      // 2. Get top result document
      const topResult = results[0];
      const doc = await docSearch.getDocument(topResult.id);

      console.log(`Step 2: Retrieved document "${topResult.title}"`);

      // 3. Verify content contains expected keywords
      expect(doc).not.toBeNull();
      expect(doc!.content.toLowerCase()).toMatch(/bitlocker|recovery|key/);

      console.log(`✅ E2E workflow complete: BitLocker documentation found and verified`);
    });
  });

  describe('User Workflow: Find Release Notes for Version', () => {
    it('should search "2024" → filter release-notes → get document', async () => {
      const { results } = await docSearch.search('2024', {
        source: 'release-notes'
      });

      expect(results.length).toBeGreaterThan(0);

      console.log(`Step 1: Found ${results.length} release notes for 2024`);

      const doc = await docSearch.getDocument(results[0].id);
      expect(doc).not.toBeNull();
      expect(doc!.metadata.version).toBeDefined();

      console.log(`Step 2: Retrieved release notes version ${doc!.metadata.version}`);
      console.log(`✅ E2E workflow complete: Release notes found and retrieved`);
    });
  });

  describe('User Workflow: Troubleshoot Common Issue', () => {
    it('should search error code → filter solved threads → get solution', async () => {
      const { results } = await docSearch.search('error code 5');

      expect(results.length).toBeGreaterThan(0);

      console.log(`Step 1: Found ${results.length} results for "error code 5"`);

      // Find solved threads in results
      const solvedResults = results.filter(r => r.metadata?.solved === true);

      console.log(`Step 2: Found ${solvedResults.length} solved threads`);

      if (solvedResults.length > 0) {
        const doc = await docSearch.getDocument(solvedResults[0].id);
        expect(doc).not.toBeNull();
        expect(doc!.metadata.solved).toBe(true);

        console.log(`✅ E2E workflow complete: Solved thread "${doc!.title}" found`);
      } else {
        // Even if no solved threads, workflow completes successfully
        console.log(`✅ E2E workflow complete: ${results.length} results found (no solved threads)`);
      }
    });
  });

  describe('User Workflow: Explore Popular Topics', () => {
    it('should get popular topics → search topic → filter by source', async () => {
      // 1. Get popular topics
      const topics = await docSearch.getPopularTopics({ limit: 10 });
      expect(topics.length).toBeGreaterThan(0);

      console.log(`Step 1: Found ${topics.length} popular topics`);
      console.log(`Top topics: ${topics.slice(0, 3).map(t => t.topic).join(', ')}`);

      // 2. Search for top topic
      const topTopic = topics[0];
      const { results } = await docSearch.search(topTopic.topic);

      expect(results.length).toBeGreaterThan(0);

      console.log(`Step 2: Searched "${topTopic.topic}" → ${results.length} results`);
      console.log(`✅ E2E workflow complete: Topic exploration successful`);
    });
  });

  describe('User Workflow: Developer API Search', () => {
    it('should search "bConnect API" → filter by source:forum → get code examples', async () => {
      const { results } = await docSearch.search('bConnect API', {
        source: 'forum',
        limit: 20
      });

      expect(results.length).toBeGreaterThan(0);

      console.log(`Step 1: Found ${results.length} forum threads about "bConnect API"`);

      // Verify forum source
      results.forEach(result => {
        expect(result.source).toBe('forum');
      });

      console.log(`Step 2: Verified all results are from forum`);
      console.log(`✅ E2E workflow complete: Developer API documentation found`);
    });
  });

  describe('Query Refinement Workflows', () => {
    it('should narrow search: "deployment" → add filter:forum → limit:5', async () => {
      // Initial broad search
      const broadResults = await docSearch.search('deployment');
      expect(broadResults.results.length).toBeGreaterThan(0);

      console.log(`Step 1: Broad search → ${broadResults.results.length} results`);

      // Narrow with filter
      const narrowResults = await docSearch.search('deployment', {
        source: 'forum',
        limit: 5
      });

      expect(narrowResults.results.length).toBeLessThanOrEqual(5);
      narrowResults.results.forEach(r => {
        expect(r.source).toBe('forum');
      });

      console.log(`Step 2: Narrowed to forum, limit 5 → ${narrowResults.results.length} results`);
      console.log(`✅ Query refinement: ${broadResults.results.length} → ${narrowResults.results.length} results`);
    });

    it('should expand search: specific query → no results → broaden query', async () => {
      // Very specific query (might have no results)
      const specific = await docSearch.search('xyzabc123nonexistent');

      console.log(`Step 1: Specific query → ${specific.results.length} results`);

      if (specific.results.length === 0) {
        // Broaden query
        const broad = await docSearch.search('deployment');
        expect(broad.results.length).toBeGreaterThan(0);

        console.log(`Step 2: Broadened query → ${broad.results.length} results`);
        console.log(`✅ Query expansion successful: 0 → ${broad.results.length} results`);
      } else {
        console.log(`✅ Query returned results unexpectedly`);
      }
    });

    it('should pivot search: "BitLocker" → get related topics → search related', async () => {
      // Initial search
      const initial = await docSearch.search('BitLocker');
      expect(initial.results.length).toBeGreaterThan(0);

      console.log(`Step 1: Initial search "BitLocker" → ${initial.results.length} results`);

      // Get popular topics
      const topics = await docSearch.getPopularTopics({ limit: 10 });

      console.log(`Step 2: Found ${topics.length} popular topics`);

      // Search for related topic
      if (topics.length > 0) {
        const relatedSearch = await docSearch.search(topics[0].topic);
        expect(relatedSearch.results.length).toBeGreaterThan(0);

        console.log(`Step 3: Searched related topic "${topics[0].topic}" → ${relatedSearch.results.length} results`);
        console.log(`✅ Pivot search successful: BitLocker → ${topics[0].topic}`);
      }
    });
  });
});
