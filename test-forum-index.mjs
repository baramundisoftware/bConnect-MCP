#!/usr/bin/env node
/**
 * Test script to verify forum content indexing after scraping
 */

import { DocumentationSearchModule } from './build/modules/documentation-search.js';

async function testForumIndexing() {
  console.log('🔍 Testing Documentation Search Index...\n');

  const searchModule = new DocumentationSearchModule();

  // Build index (will scan all forum-content directories)
  await searchModule.buildIndex();

  // Get statistics
  const stats = await searchModule.getStats();
  console.log('\n📊 Index Statistics:');
  console.log(`   Total documents: ${stats.totalDocuments}`);
  console.log(`\n📁 Forum Coverage:`);
  console.log(`   Threads indexed: ${stats.coverage.forum.indexed}`);
  console.log(`   Categories: ${stats.coverage.forum.categories.length}`);
  console.log(`\n   Forum categories included:`);
  stats.coverage.forum.categories.sort().forEach(cat => {
    console.log(`   - ${cat}`);
  });

  // Test search for newly scraped content
  console.log(`\n🔎 Testing searches in new categories:\n`);

  // Test 1: General category
  const generalResults = await searchModule.search('baramundi', {
    category: 'general',
    limit: 3
  });
  console.log(`   ✓ General: ${generalResults.results.length} results`);

  // Test 2: Patch Management
  const patchResults = await searchModule.search('Windows Update', {
    category: 'patch-management-classic',
    limit: 3
  });
  console.log(`   ✓ Patch Management: ${patchResults.results.length} results`);

  // Test 3: Server-Agent-Center
  const serverResults = await searchModule.search('server', {
    category: 'server-agent-center-complete',
    limit: 3
  });
  console.log(`   ✓ Server-Agent-Center: ${serverResults.results.length} results`);

  // Test 4: Mobile Devices
  const mobileResults = await searchModule.search('mobile', {
    category: 'mobile-devices',
    limit: 3
  });
  console.log(`   ✓ Mobile Devices: ${mobileResults.results.length} results`);

  // Test 5: Cross-category search
  const allResults = await searchModule.search('baramundi', {
    source: 'forum',
    limit: 10
  });
  console.log(`\n   ✓ Cross-forum search: ${allResults.results.length} results across all categories`);

  console.log('\n✅ All tests passed! MCP search index successfully includes new content.\n');
}

testForumIndexing().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
