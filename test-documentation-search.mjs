#!/usr/bin/env node

/**
 * Test script for documentation search functionality
 */

import { DocumentationSearchModule } from './build/modules/documentation-search.js';

async function testDocumentationSearch() {
  console.log('🧪 Testing Documentation Search Module');
  console.log('=====================================\n');

  // Initialize the module
  const docSearch = new DocumentationSearchModule();

  try {
    // Test 1: Build index
    console.log('📚 Test 1: Building search index...');
    await docSearch.buildIndex();
    console.log('✅ Index built successfully\n');

    // Test 2: List sources
    console.log('📊 Test 2: Listing documentation sources...');
    const sources = await docSearch.listSources();
    console.log(JSON.stringify(sources, null, 2));
    console.log('✅ Sources listed successfully\n');

    // Test 3: Search for "deployment automation"
    console.log('🔍 Test 3: Searching for "deployment automation"...');
    const result1 = await docSearch.search('deployment automation', { limit: 5 });
    console.log(`Found ${result1.results.length} results:`);
    result1.results.forEach((r, i) => {
      console.log(`  ${i + 1}. [${r.source}/${r.type}] ${r.title.substring(0, 60)}...`);
    });
    console.log('✅ Search completed\n');

    // Test 4: Search for "bConnect API"
    console.log('🔍 Test 4: Searching for "bConnect API"...');
    const result2 = await docSearch.search('bConnect API', { limit: 5 });
    console.log(`Found ${result2.results.length} results:`);
    result2.results.forEach((r, i) => {
      console.log(`  ${i + 1}. [${r.source}/${r.type}] ${r.title.substring(0, 60)}...`);
    });
    console.log('✅ Search completed\n');

    // Test 5: Filter by forum source
    console.log('🔍 Test 5: Searching forum only for "job"...');
    const result3 = await docSearch.search('job', { source: 'forum', limit: 5 });
    console.log(`Found ${result3.results.length} results in forum:`);
    result3.results.forEach((r, i) => {
      console.log(`  ${i + 1}. [${r.category}] ${r.title.substring(0, 60)}...`);
    });
    console.log('✅ Search completed\n');

    // Test 6: Get popular topics
    console.log('📈 Test 6: Getting popular topics...');
    const topics = await docSearch.getPopularTopics({ limit: 10 });
    console.log('Top 10 topics:');
    topics.forEach((t, i) => {
      console.log(`  ${i + 1}. "${t.topic}" (${t.count} occurrences)`);
    });
    console.log('✅ Topics retrieved\n');

    console.log('🎉 All tests passed!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testDocumentationSearch();
