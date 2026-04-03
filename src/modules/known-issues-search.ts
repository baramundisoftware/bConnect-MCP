/**
 * Known Issues Search Module
 *
 * Searches known issues from baramundi release notes and shows linked forum solutions.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface KnownIssue {
  version: string;
  language: string;
  category: string;
  description: string;
  originalReferences: Array<{ type: string; url?: string; id?: string }>;
  relatedForumThreads: Array<{
    id: string;
    title: string;
    category: string;
    url: string;
    score: number;
  }>;
}

interface LinkedIssuesData {
  generatedAt: string;
  summary: {
    totalIssues: number;
    issuesWithSolutions: number;
    coveragePercent: string;
  };
  linkedIssues: KnownIssue[];
}

export class KnownIssuesSearch {
  private data: LinkedIssuesData | null = null;
  private dataPath: string;

  constructor() {
    // Path relative to build/ directory when compiled
    this.dataPath = path.join(__dirname, '..', '..', 'data', 'linked_known_issues.json');
  }

  /**
   * Load known issues data
   */
  private loadData(): void {
    if (this.data) return; // Already loaded

    if (!fs.existsSync(this.dataPath)) {
      throw new Error(`Known issues data not found at: ${this.dataPath}`);
    }

    const content = fs.readFileSync(this.dataPath, 'utf-8');
    this.data = JSON.parse(content);
  }

  /**
   * Search known issues by keywords
   */
  search(query: string, options: {
    version?: string;
    language?: string;
    limit?: number;
  } = {}): Array<{ issue: KnownIssue; score: number }> {
    this.loadData();

    if (!this.data) {
      throw new Error('Failed to load known issues data');
    }

    const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 2);

    if (keywords.length === 0) {
      throw new Error('Query must contain at least one keyword (3+ characters)');
    }

    const limit = options.limit || 10;

    // Filter and score issues
    const results = this.data.linkedIssues
      .filter(issue => {
        // Filter by version if specified
        if (options.version && issue.version !== options.version) return false;

        // Filter by language if specified
        if (options.language && issue.language !== options.language && issue.language !== 'BOTH') return false;

        return true;
      })
      .map(issue => {
        // Calculate relevance score based on keyword matches
        const searchText = `${issue.category} ${issue.description}`.toLowerCase();
        const score = keywords.reduce((acc, keyword) => {
          return acc + (searchText.includes(keyword) ? 1 : 0);
        }, 0);

        return { issue, score };
      })
      .filter(result => result.score > 0) // Only include issues with at least 1 keyword match
      .sort((a, b) => b.score - a.score) // Sort by relevance
      .slice(0, limit); // Limit results

    return results;
  }

  /**
   * Get summary statistics
   */
  getSummary() {
    this.loadData();
    return this.data?.summary;
  }
}
