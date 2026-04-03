#!/usr/bin/env node

/**
 * Test script to verify feedback content search
 */

import { DocumentationSearchModule } from './build/modules/documentation-search.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testFeedbackSearch() {
  console.log('🧪 Testing Feedback Content Search\n');

  // Initialize search module
  const contentBasePath = path.join(__dirname, '..', 'docs.baramundi.com');
  const searchModule = new DocumentationSearchModule(contentBasePath);

  console.log('📚 Building search index...\n');
  const startTime = Date.now();
  await searchModule.buildIndex();
  const buildTime = Date.now() - startTime;

  console.log(`\n✅ Index built in ${buildTime}ms\n`);

  // Get coverage statistics
  const stats = await searchModule.getStats();
  const coverage = stats.coverage;

  console.log('📊 Coverage Statistics:');
  console.log('========================');
  console.log(`Total Documents: ${coverage.total}\n`);
  console.log(`Feedback: ${coverage.feedback.indexed} items total`);
  console.log(`  - FAQ: ${coverage.feedback.types.faq}`);
  console.log(`  - Knowledge Base: ${coverage.feedback.types.kb}`);
  console.log(`  - Ideas: ${coverage.feedback.types.ideas}\n`);

  // Test searches specifically in feedback
  console.log('🔍 Test Searches in Feedback:\n');

  // Search 1: Find BitLocker content in feedback
  const search1 = await searchModule.search('BitLocker', { source: 'feedback', limit: 3 });
  console.log(`1. "BitLocker" (feedback only): ${search1.results.length} results`);
  if (search1.results.length > 0) {
    search1.results.forEach((r, i) => {
      console.log(`   ${i + 1}. "${r.title}" (${r.type})`);
    });
  }
  console.log();

  // Search 2: Find FAQ items
  const search2 = await searchModule.search('installation files', { source: 'feedback', type: 'faq', limit: 3 });
  console.log(`2. "installation files" (FAQ only): ${search2.results.length} results`);
  if (search2.results.length > 0) {
    search2.results.forEach((r, i) => {
      console.log(`   ${i + 1}. "${r.title}"`);
    });
  }
  console.log();

  // Search 3: Find Knowledge Base articles
  const search3 = await searchModule.search('Windows', { source: 'feedback', type: 'kb', limit: 3 });
  console.log(`3. "Windows" (KB only): ${search3.results.length} results`);
  if (search3.results.length > 0) {
    search3.results.forEach((r, i) => {
      console.log(`   ${i + 1}. "${r.title}"`);
    });
  }
  console.log();

  // Search 4: Find Ideas (feature requests)
  const search4 = await searchModule.search('Android', { source: 'feedback', type: 'idea', limit: 3 });
  console.log(`4. "Android" (Ideas only): ${search4.results.length} results`);
  if (search4.results.length > 0) {
    search4.results.forEach((r, i) => {
      const votes = r.metadata.votes || 0;
      console.log(`   ${i + 1}. "${r.title}" (${votes} votes)`);
    });
  }
  console.log();

  // Search 5: Unified search across all sources
  const search5 = await searchModule.search('baramundi Agent', { source: 'all', limit: 5 });
  console.log(`5. "baramundi Agent" (all sources): ${search5.results.length} results`);
  const sourceCounts = {};
  search5.results.forEach(r => {
    sourceCounts[r.source] = (sourceCounts[r.source] || 0) + 1;
  });
  console.log(`   Sources found: ${Object.keys(sourceCounts).map(s => `${s}(${sourceCounts[s]})`).join(', ')}`);
  search5.results.slice(0, 3).forEach((r, i) => {
    console.log(`   ${i + 1}. "${r.title}" (${r.source}/${r.type})`);
  });

  console.log('\n✅ Feedback integration test complete!');
}

testFeedbackSearch().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
