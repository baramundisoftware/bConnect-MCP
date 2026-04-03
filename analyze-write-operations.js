#!/usr/bin/env node

/**
 * Analyze OpenAPI specifications for write operations (POST, PATCH, DELETE)
 * Outputs a summary of available write operations per module
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SPECS_DIR = path.join(__dirname, 'openapi-specs');
const METHODS = ['post', 'patch', 'delete', 'put'];

function analyzeSpec(specPath) {
  const content = fs.readFileSync(specPath, 'utf8');
  const spec = JSON.parse(content);

  const moduleName = path.basename(specPath, '.json').replace('bConnect_', '');
  const operations = [];

  // Analyze paths
  for (const [pathKey, pathValue] of Object.entries(spec.paths || {})) {
    for (const method of METHODS) {
      if (pathValue[method]) {
        const operation = pathValue[method];
        operations.push({
          method: method.toUpperCase(),
          path: pathKey,
          operationId: operation.operationId || 'unknown',
          summary: operation.summary || '',
          description: operation.description || '',
          tags: operation.tags || []
        });
      }
    }
  }

  return {
    module: moduleName,
    totalWriteOps: operations.length,
    operations: operations
  };
}

// Main execution
const specFiles = fs.readdirSync(SPECS_DIR)
  .filter(f => f.endsWith('.json'))
  .map(f => path.join(SPECS_DIR, f));

const results = specFiles.map(analyzeSpec);

// Summary
console.log('='.repeat(80));
console.log('WRITE OPERATIONS ANALYSIS - bConnect API Modules');
console.log('='.repeat(80));
console.log();

let totalOps = 0;
const summary = [];

results.forEach(result => {
  totalOps += result.totalWriteOps;
  summary.push({
    module: result.module,
    count: result.totalWriteOps
  });
});

// Sort by count descending
summary.sort((a, b) => b.count - a.count);

console.log('SUMMARY BY MODULE:');
console.log('-'.repeat(80));
summary.forEach(item => {
  console.log(`${item.module.padEnd(25)} ${item.count.toString().padStart(3)} write operations`);
});
console.log('-'.repeat(80));
console.log(`${'TOTAL'.padEnd(25)} ${totalOps.toString().padStart(3)} write operations`);
console.log();
console.log();

// Detailed breakdown
console.log('='.repeat(80));
console.log('DETAILED BREAKDOWN BY MODULE');
console.log('='.repeat(80));
console.log();

results.forEach(result => {
  if (result.totalWriteOps === 0) {
    console.log(`\n## ${result.module} (Read-only - No write operations)`);
    console.log('-'.repeat(80));
    return;
  }

  console.log(`\n## ${result.module} (${result.totalWriteOps} operations)`);
  console.log('-'.repeat(80));

  // Group by method
  const byMethod = {};
  result.operations.forEach(op => {
    if (!byMethod[op.method]) {
      byMethod[op.method] = [];
    }
    byMethod[op.method].push(op);
  });

  ['POST', 'PATCH', 'PUT', 'DELETE'].forEach(method => {
    if (byMethod[method]) {
      console.log(`\n### ${method} Operations (${byMethod[method].length}):`);
      byMethod[method].forEach((op, idx) => {
        console.log(`${idx + 1}. ${op.operationId}`);
        console.log(`   Path: ${op.path}`);
        if (op.summary) console.log(`   Summary: ${op.summary}`);
        console.log();
      });
    }
  });
});

console.log('='.repeat(80));
console.log('END OF ANALYSIS');
console.log('='.repeat(80));
