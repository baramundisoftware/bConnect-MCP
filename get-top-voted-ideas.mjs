#!/usr/bin/env node

/**
 * Get top voted ideas from feedback portal
 */

import { DocumentationSearchModule } from './build/modules/documentation-search.js';
import fs from 'fs';
import path from 'path';

const docSearch = new DocumentationSearchModule();

async function getTopVotedIdeas() {
  console.log('🗳️  Top Voted Ideas from Feedback Portal');
  console.log('=========================================\n');

  // Build index
  console.log('📚 Building index...');
  await docSearch.buildIndex();
  console.log();

  // Get all ideas by reading feedback portal files directly
  const ideasPath = path.resolve(process.cwd(), '../docs.baramundi.com/feedback/content');
  const allIdeas = [];

  // Read ideas-en directory
  const ideasEnPath = path.join(ideasPath, 'ideas-en');
  if (fs.existsSync(ideasEnPath)) {
    const files = fs.readdirSync(ideasEnPath).filter(f => f.endsWith('.md') && !f.startsWith('_'));

    for (const file of files) {
      const filepath = path.join(ideasEnPath, file);
      const content = fs.readFileSync(filepath, 'utf-8');

      const titleMatch = content.match(/^# (.+)$/m);
      const urlMatch = content.match(/\*\*URL:\*\* (.+)$/m);
      const votesMatch = content.match(/\*\*Votes:\*\* (\d+)/m); // Match digits before emoji
      const statusMatch = content.match(/\*\*Status:\*\* (.+)$/m);
      const authorMatch = content.match(/\*\*Author:\*\* (.+)$/m);
      const dateMatch = content.match(/\*\*Created:\*\* (.+)$/m);

      if (titleMatch) {
        allIdeas.push({
          title: titleMatch[1],
          url: urlMatch ? urlMatch[1] : 'N/A',
          votes: votesMatch ? parseInt(votesMatch[1]) : 0,
          status: statusMatch ? statusMatch[1] : 'Unknown',
          author: authorMatch ? authorMatch[1] : 'Unknown',
          date: dateMatch ? dateMatch[1] : 'Unknown',
          language: 'EN',
          file: file
        });
      }
    }
  }

  // Read ideas-de directory
  const ideasDePath = path.join(ideasPath, 'ideas-de');
  if (fs.existsSync(ideasDePath)) {
    const files = fs.readdirSync(ideasDePath).filter(f => f.endsWith('.md') && !f.startsWith('_'));

    for (const file of files) {
      const filepath = path.join(ideasDePath, file);
      const content = fs.readFileSync(filepath, 'utf-8');

      const titleMatch = content.match(/^# (.+)$/m);
      const urlMatch = content.match(/\*\*URL:\*\* (.+)$/m);
      const votesMatch = content.match(/\*\*Votes:\*\* (\d+)/m); // Match digits before emoji
      const statusMatch = content.match(/\*\*Status:\*\* (.+)$/m);
      const authorMatch = content.match(/\*\*Author:\*\* (.+)$/m);
      const dateMatch = content.match(/\*\*Created:\*\* (.+)$/m);

      if (titleMatch) {
        allIdeas.push({
          title: titleMatch[1],
          url: urlMatch ? urlMatch[1] : 'N/A',
          votes: votesMatch ? parseInt(votesMatch[1]) : 0,
          status: statusMatch ? statusMatch[1] : 'Unknown',
          author: authorMatch ? authorMatch[1] : 'Unknown',
          date: dateMatch ? dateMatch[1] : 'Unknown',
          language: 'DE',
          file: file
        });
      }
    }
  }

  console.log(`📊 Total ideas found: ${allIdeas.length}`);
  console.log();

  // Sort by votes (descending)
  allIdeas.sort((a, b) => b.votes - a.votes);

  // Get top 10
  const top10 = allIdeas.slice(0, 10);

  console.log('🏆 Top 10 Most Voted Ideas:\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  top10.forEach((idea, i) => {
    console.log(`\n${i + 1}. 🗳️  ${idea.votes} votes | ${idea.language} | ${idea.status}`);
    console.log(`   ${idea.title}`);
    console.log(`   ${idea.url}`);
    console.log(`   Created: ${idea.date} by ${idea.author}`);
  });

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Statistics
  console.log('\n📊 Vote Statistics:');
  console.log(`   Total ideas: ${allIdeas.length}`);
  console.log(`   Ideas with votes: ${allIdeas.filter(i => i.votes > 0).length}`);
  console.log(`   Ideas with 0 votes: ${allIdeas.filter(i => i.votes === 0).length}`);
  console.log(`   Highest votes: ${allIdeas[0].votes}`);
  console.log(`   Average votes: ${(allIdeas.reduce((sum, i) => sum + i.votes, 0) / allIdeas.length).toFixed(2)}`);

  // Status breakdown
  console.log('\n📋 Status Breakdown:');
  const statusCounts = {};
  allIdeas.forEach(idea => {
    statusCounts[idea.status] = (statusCounts[idea.status] || 0) + 1;
  });
  Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).forEach(([status, count]) => {
    console.log(`   ${status}: ${count}`);
  });

  // Language breakdown
  console.log('\n🌐 Language Breakdown:');
  const langCounts = {};
  allIdeas.forEach(idea => {
    langCounts[idea.language] = (langCounts[idea.language] || 0) + 1;
  });
  Object.entries(langCounts).forEach(([lang, count]) => {
    console.log(`   ${lang}: ${count}`);
  });

  console.log();
}

getTopVotedIdeas().catch(console.error);
