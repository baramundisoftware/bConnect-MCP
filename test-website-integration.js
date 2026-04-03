#!/usr/bin/env node

/**
 * Test script to verify website content integration into documentation search
 */

import { DocumentationSearchModule } from './build/modules/documentation-search.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testWebsiteIntegration() {
  console.log('🧪 Testing Website Content Integration\n');

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
  console.log(`Forum: ${coverage.forum.indexed} threads (${coverage.forum.categories.length} categories)`);
  console.log(`Feedback: ${coverage.feedback.indexed} items (FAQ: ${coverage.feedback.types.faq}, KB: ${coverage.feedback.types.kb}, Ideas: ${coverage.feedback.types.ideas})`);
  console.log(`Release Notes: ${coverage.releaseNotes.indexed} versions`);
  console.log(`Preview Documents: ${coverage.previewDocuments.indexed} versions`);
  console.log(`Website: ${coverage.website.indexed} pages (${coverage.website.categories.length} categories)`);
  console.log(`Total Documents: ${coverage.total}\n`);

  // Test search with website content
  console.log('🔍 Test Searches:\n');

  // Search 1: Find Unified Endpoint Management (should be in website)
  const search1 = await searchModule.search('Unified Endpoint Management', { source: 'website', limit: 3 });
  console.log(`1. "Unified Endpoint Management" (website only): ${search1.results.length} results`);
  if (search1.results.length > 0) {
    console.log(`   Top result: "${search1.results[0].title}" (${search1.results[0].source}/${search1.results[0].type})`);
  }

  // Search 2: Find Windows 11 content (should be in blog)
  const search2 = await searchModule.search('Windows 11', { source: 'website', limit: 3 });
  console.log(`2. "Windows 11" (website only): ${search2.results.length} results`);
  if (search2.results.length > 0) {
    console.log(`   Top result: "${search2.results[0].title}" (${search2.results[0].source}/${search2.results[0].type})`);
  }

  // Search 3: Unified search across all sources
  const search3 = await searchModule.search('baramundi Management Suite', { source: 'all', limit: 5 });
  console.log(`3. "baramundi Management Suite" (all sources): ${search3.results.length} results`);
  search3.results.slice(0, 3).forEach((r, i) => {
    console.log(`   ${i + 1}. "${r.title}" (${r.source}/${r.type})`);
  });

  console.log('\n✅ Website integration test complete!');
}

testWebsiteIntegration().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
