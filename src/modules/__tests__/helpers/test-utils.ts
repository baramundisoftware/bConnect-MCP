/**
 * Test Utilities
 *
 * Shared helpers and utilities for testing documentation search modules
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Get path to test fixtures directory
 */
export function getFixturesPath(): string {
  return path.resolve(__dirname, '../../__fixtures__');
}

/**
 * Get path to specific fixture subdirectory
 */
export function getFixtureSubPath(subPath: string): string {
  return path.join(getFixturesPath(), subPath);
}

/**
 * Test data: Expected document counts for fixtures
 */
export const FIXTURE_COUNTS = {
  forum: {
    threads: 3,
    categories: 1,
    category: 'baramundi-connect',
  },
  feedback: {
    faq: 2,
    kb: 2,
    ideas: 2,
    total: 6,
  },
  releaseNotes: {
    versions: 2,
  },
  total: 11, // 3 forum + 6 feedback + 2 release notes
};

/**
 * Test data: Expected search results for specific queries
 */
export const TEST_QUERIES = {
  bitlocker: {
    query: 'BitLocker',
    expectedMinResults: 1,
    expectedSources: ['forum', 'release-notes'],
  },
  deployment: {
    query: 'deployment',
    expectedMinResults: 2,
    expectedSources: ['forum', 'feedback'],
  },
  api: {
    query: 'bConnect API',
    expectedMinResults: 2,
    expectedSources: ['forum', 'release-notes'],
  },
  python: {
    query: 'Python',
    expectedMinResults: 1,
    expectedSources: ['feedback'],
  },
  licensing: {
    query: 'license',
    expectedMinResults: 1,
    expectedSources: ['feedback'],
  },
};

/**
 * Test data: Sample forum thread metadata
 */
export const SAMPLE_FORUM_THREAD = {
  id: 'forum-baramundi-connect-12345',
  title: 'How to configure bConnect API?',
  category: 'baramundi-connect',
  author: 'TestUser1',
  replies: 5,
  solved: true,
};

/**
 * Test data: Sample feedback item metadata
 */
export const SAMPLE_FEEDBACK_ITEM = {
  faq: {
    id: 'feedback-faq-what-is-baramundi-management-suite',
    title: 'What is baramundi Management Suite?',
    type: 'faq',
    source: 'feedback',
  },
  kb: {
    id: 'feedback-kb-troubleshooting-agent-connection-issues',
    title: 'Troubleshooting Agent Connection Issues',
    type: 'kb',
    source: 'feedback',
  },
  idea: {
    id: 'feedback-idea-idea-1234-add-python-scripting-support',
    title: 'Add Python scripting support to baramundi Automate',
    type: 'idea',
    source: 'feedback',
    votes: 47,
    status: 'Under Review',
  },
};

/**
 * Test data: Sample release notes metadata
 */
export const SAMPLE_RELEASE_NOTE = {
  id: 'release-notes-2024R1-EN',
  version: '2024R1',
  language: 'EN',
  source: 'release-notes',
  type: 'release-note',
};

/**
 * Helper: Wait for specified milliseconds
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Helper: Measure execution time of async function
 */
export async function measureTime<T>(
  fn: () => Promise<T>
): Promise<{ result: T; duration: number }> {
  const start = Date.now();
  const result = await fn();
  const duration = Date.now() - start;
  return { result, duration };
}

/**
 * Helper: Verify search result structure
 */
export function isValidSearchResult(result: any): boolean {
  return (
    typeof result === 'object' &&
    typeof result.id === 'string' &&
    typeof result.title === 'string' &&
    typeof result.source === 'string' &&
    typeof result.type === 'string' &&
    typeof result.excerpt === 'string' &&
    typeof result.score === 'number'
  );
}

/**
 * Helper: Verify document structure
 */
export function isValidDocument(doc: any): boolean {
  return (
    typeof doc === 'object' &&
    typeof doc.id === 'string' &&
    typeof doc.title === 'string' &&
    typeof doc.source === 'string' &&
    typeof doc.type === 'string' &&
    typeof doc.content === 'string' &&
    typeof doc.excerpt === 'string' &&
    typeof doc.filepath === 'string' &&
    typeof doc.metadata === 'object'
  );
}

/**
 * Helper: Verify coverage structure
 */
export function isValidCoverage(coverage: any): boolean {
  return (
    typeof coverage === 'object' &&
    typeof coverage.forum === 'object' &&
    typeof coverage.forum.indexed === 'number' &&
    Array.isArray(coverage.forum.categories) &&
    typeof coverage.feedback === 'object' &&
    typeof coverage.feedback.indexed === 'number' &&
    typeof coverage.feedback.types === 'object' &&
    typeof coverage.releaseNotes === 'object' &&
    typeof coverage.releaseNotes.indexed === 'number' &&
    typeof coverage.total === 'number'
  );
}

/**
 * Helper: Generate random search query
 */
export function generateRandomQuery(): string {
  const words = [
    'deployment',
    'BitLocker',
    'agent',
    'API',
    'endpoint',
    'software',
    'license',
    'security',
    'mobile',
    'Python',
  ];
  const numWords = Math.floor(Math.random() * 3) + 1;
  const selectedWords = [];

  for (let i = 0; i < numWords; i++) {
    const word = words[Math.floor(Math.random() * words.length)];
    selectedWords.push(word);
  }

  return selectedWords.join(' ');
}

/**
 * Helper: Create mock console logger that captures output
 */
export function createMockLogger() {
  const logs: string[] = [];

  const mockConsole = {
    log: (...args: any[]) => logs.push(args.join(' ')),
    warn: (...args: any[]) => logs.push('[WARN] ' + args.join(' ')),
    error: (...args: any[]) => logs.push('[ERROR] ' + args.join(' ')),
    getLogs: () => logs,
    clear: () => (logs.length = 0),
  };

  return mockConsole;
}

/**
 * Helper: Performance benchmark runner
 */
export interface BenchmarkResult {
  name: string;
  duration: number;
  iterations: number;
  avgDuration: number;
}

export async function benchmark(
  name: string,
  fn: () => Promise<void>,
  iterations: number = 100
): Promise<BenchmarkResult> {
  const start = Date.now();

  for (let i = 0; i < iterations; i++) {
    await fn();
  }

  const duration = Date.now() - start;
  const avgDuration = duration / iterations;

  return {
    name,
    duration,
    iterations,
    avgDuration,
  };
}

/**
 * Helper: Assert performance meets threshold
 */
export function assertPerformance(
  result: BenchmarkResult,
  maxAvgDuration: number
): void {
  if (result.avgDuration > maxAvgDuration) {
    throw new Error(
      `Performance test failed: ${result.name} took ${result.avgDuration}ms (expected < ${maxAvgDuration}ms)`
    );
  }
}

/**
 * Helper: Generate unique test ID
 */
let testIdCounter = 0;
export function generateTestId(prefix: string = 'test'): string {
  return `${prefix}-${Date.now()}-${++testIdCounter}`;
}

/**
 * Helper: Clean up test artifacts (if needed in the future)
 */
export async function cleanupTestArtifacts(): Promise<void> {
  // Currently no cleanup needed for in-memory tests
  // This is a placeholder for future cleanup tasks
  return Promise.resolve();
}

/**
 * Helper: Verify MiniSearch index integrity
 */
export function verifyIndexIntegrity(miniSearch: any): boolean {
  try {
    // Check if MiniSearch instance has required properties
    return (
      typeof miniSearch === 'object' &&
      typeof miniSearch.documentCount === 'number' &&
      typeof miniSearch.search === 'function' &&
      typeof miniSearch.addAll === 'function'
    );
  } catch (error) {
    return false;
  }
}

/**
 * Helper: Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Helper: Get memory usage
 */
export function getMemoryUsage(): {
  heapUsed: number;
  heapTotal: number;
  external: number;
  formatted: {
    heapUsed: string;
    heapTotal: string;
    external: string;
  };
} {
  const usage = process.memoryUsage();

  return {
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    external: usage.external,
    formatted: {
      heapUsed: formatBytes(usage.heapUsed),
      heapTotal: formatBytes(usage.heapTotal),
      external: formatBytes(usage.external),
    },
  };
}
