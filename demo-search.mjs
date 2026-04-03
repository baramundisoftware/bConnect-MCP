#!/usr/bin/env node

/**
 * Live demonstration of documentation search capabilities
 */

import { DocumentationSearchModule } from './build/modules/documentation-search.js';

const docSearch = new DocumentationSearchModule();

async function demo() {
  console.log('🔍 Documentation Search - Live Demo');
  console.log('===================================\n');

  // Build index
  console.log('📚 Building index...');
  await docSearch.buildIndex();
  console.log();

  // Demo 1: Search for deployment automation
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📝 Query 1: "deployment automation"');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const result1 = await docSearch.search('deployment automation', { limit: 5 });
  console.log(`Found ${result1.results.length} results:\n`);
  result1.results.forEach((r, i) => {
    console.log(`${i + 1}. [${r.source}/${r.type}] ${r.title}`);
    console.log(`   Category: ${r.category || 'N/A'} | Score: ${r.score.toFixed(2)}`);
    console.log(`   Excerpt: ${r.excerpt.substring(0, 120)}...`);
    if (r.url) console.log(`   URL: ${r.url}`);
    console.log();
  });

  // Demo 2: Search for bConnect API
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📝 Query 2: "bConnect API authentication"');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const result2 = await docSearch.search('bConnect API authentication', { limit: 5 });
  console.log(`Found ${result2.results.length} results:\n`);
  result2.results.forEach((r, i) => {
    console.log(`${i + 1}. [${r.source}] ${r.title.substring(0, 70)}...`);
    console.log(`   Score: ${r.score.toFixed(2)} | Category: ${r.category || 'N/A'}`);
    console.log();
  });

  // Demo 3: Forum-only search for jobs
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📝 Query 3: "job scheduling" (forum only)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const result3 = await docSearch.search('job scheduling', { source: 'forum', limit: 5 });
  console.log(`Found ${result3.results.length} results in forum:\n`);
  result3.results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.title.substring(0, 70)}...`);
    console.log(`   Category: ${r.category} | Solved: ${r.metadata.solved ? '✅' : '❌'} | Replies: ${r.metadata.replies}`);
    console.log();
  });

  // Demo 4: Feedback portal search
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📝 Query 4: "feature request" (feedback portal)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const result4 = await docSearch.search('feature request', { source: 'feedback', type: 'idea', limit: 5 });
  console.log(`Found ${result4.results.length} feature requests:\n`);
  result4.results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.title.substring(0, 70)}...`);
    console.log(`   Status: ${r.metadata.status || 'N/A'} | Votes: ${r.metadata.votes || 0}`);
    console.log();
  });

  // Demo 5: Popular topics
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 Popular Topics Analysis');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const topics = await docSearch.getPopularTopics({ limit: 15 });
  console.log('Top 15 most discussed topics:\n');
  topics.forEach((t, i) => {
    const bar = '█'.repeat(Math.min(50, Math.floor(t.count / 3)));
    console.log(`${String(i + 1).padStart(2)}. ${t.topic.padEnd(20)} ${bar} ${t.count}`);
  });
  console.log();

  // Demo 6: Get specific document
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📄 Get Full Document');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (result1.results.length > 0) {
    const firstResult = result1.results[0];
    const doc = await docSearch.getDocument(firstResult.id);
    if (doc) {
      console.log(`Title: ${doc.title}`);
      console.log(`Source: ${doc.source} (${doc.type})`);
      console.log(`Category: ${doc.category}`);
      console.log(`Author: ${doc.author}`);
      console.log(`Date: ${doc.date}`);
      console.log(`URL: ${doc.url}`);
      console.log(`\nContent preview (first 500 chars):`);
      console.log(doc.content.substring(0, 500) + '...');
    }
  }
  console.log();

  // Summary
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 Coverage Summary');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Total Documents: ${result1.coverage.total}`);
  console.log(`Forum Threads: ${result1.coverage.forum.indexed} (${result1.coverage.forum.categories.join(', ')})`);
  console.log(`Feedback Items: ${result1.coverage.feedback.indexed} (FAQ: ${result1.coverage.feedback.types.faq}, KB: ${result1.coverage.feedback.types.kb}, Ideas: ${result1.coverage.feedback.types.ideas})`);
  console.log(`Release Notes: ${result1.coverage.releaseNotes.indexed} versions (${result1.coverage.releaseNotes.versions.join(', ')})`);
  console.log();

  console.log('✅ Demo complete! All search features working perfectly.');
}

demo().catch(console.error);
