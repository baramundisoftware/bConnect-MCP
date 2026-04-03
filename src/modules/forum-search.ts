/**
 * Forum Search Module - Static Content Search
 *
 * Searches scraped forum threads stored as Markdown files.
 * Uses MiniSearch for fast full-text indexing.
 */

import MiniSearch from 'minisearch';
import fs from 'fs';
import path from 'path';

export interface ForumThread {
  id: string;
  title: string;
  category: string;
  url: string;
  author: string;
  date: string;
  replies: number;
  solved: boolean;
  excerpt: string;
  content: string;
  filepath: string;
}

export interface SearchResult {
  id: string;
  title: string;
  category: string;
  url: string;
  excerpt: string;
  solved: boolean;
  replies: number;
  score: number;
}

export class ForumSearchModule {
  private miniSearch: MiniSearch<ForumThread>;
  private threads: Map<string, ForumThread>;
  private contentPath: string;
  private indexBuilt: boolean = false;

  constructor(contentPath: string) {
    this.contentPath = contentPath;
    this.threads = new Map();

    // Initialize MiniSearch
    this.miniSearch = new MiniSearch({
      fields: ['title', 'content', 'category', 'author'],
      storeFields: ['id', 'title', 'category', 'url', 'excerpt', 'solved', 'replies'],
      searchOptions: {
        boost: { title: 3, content: 1 },
        fuzzy: 0.2,
        prefix: true
      }
    });
  }

  /**
   * Build search index from scraped Markdown files
   */
  async buildIndex(): Promise<void> {
    if (this.indexBuilt) {
      console.log('Search index already built');
      return;
    }

    console.log('Building forum search index...');
    const startTime = Date.now();

    // Find all category directories
    const categories = fs.readdirSync(this.contentPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    console.log(`Found ${categories.length} categories`);

    let totalThreads = 0;

    for (const category of categories) {
      const categoryPath = path.join(this.contentPath, category);
      const files = fs.readdirSync(categoryPath)
        .filter(f => f.endsWith('.md') && !f.startsWith('_'));

      console.log(`  ${category}: ${files.length} threads`);

      for (const file of files) {
        const filepath = path.join(categoryPath, file);
        const thread = this.parseThread(filepath, category);

        if (thread) {
          this.threads.set(thread.id, thread);
          totalThreads++;
        }
      }
    }

    // Add all threads to MiniSearch index
    const threadsArray = Array.from(this.threads.values());
    this.miniSearch.addAll(threadsArray);

    this.indexBuilt = true;
    const duration = Date.now() - startTime;
    console.log(`✅ Index built: ${totalThreads} threads in ${duration}ms`);
  }

  /**
   * Parse a Markdown thread file
   */
  private parseThread(filepath: string, category: string): ForumThread | null {
    try {
      const content = fs.readFileSync(filepath, 'utf-8');

      // Extract metadata from Markdown
      const titleMatch = content.match(/^# (.+)$/m);
      const urlMatch = content.match(/\*\*URL:\*\* (.+)$/m);
      const authorMatch = content.match(/\*\*Author:\*\* (.+)$/m);
      const dateMatch = content.match(/\*\*Date:\*\* (.+)$/m);
      const repliesMatch = content.match(/\*\*Replies:\*\* (\d+)$/m);
      const solvedMatch = content.match(/\*\*Status:\*\* ✅ SOLVED/);

      // Extract ID from URL or filename
      const filename = path.basename(filepath, '.md');
      const idMatch = filename.match(/^(\d+)-/);
      const id = idMatch ? idMatch[1] : filename;

      // Extract first 200 characters as excerpt
      const contentStart = content.indexOf('## Original Post');
      const excerpt = contentStart > 0
        ? content.substring(contentStart + 20, contentStart + 220).trim() + '...'
        : content.substring(0, 200).trim() + '...';

      if (!titleMatch || !urlMatch) {
        console.warn(`Skipping malformed thread: ${filepath}`);
        return null;
      }

      return {
        id,
        title: titleMatch[1],
        category,
        url: urlMatch[1],
        author: authorMatch ? authorMatch[1] : 'Unknown',
        date: dateMatch ? dateMatch[1] : 'Unknown',
        replies: repliesMatch ? parseInt(repliesMatch[1]) : 0,
        solved: solvedMatch !== null,
        excerpt: excerpt.replace(/\n/g, ' '),
        content: content,
        filepath
      };
    } catch (error) {
      console.error(`Error parsing thread ${filepath}:`, error);
      return null;
    }
  }

  /**
   * Search forum threads
   */
  async search(
    query: string,
    options: {
      category?: string;
      solvedOnly?: boolean;
      limit?: number;
    } = {}
  ): Promise<SearchResult[]> {
    if (!this.indexBuilt) {
      await this.buildIndex();
    }

    const { category, solvedOnly, limit = 10 } = options;

    // Perform search
    let results = this.miniSearch.search(query, {
      fuzzy: 0.2,
      prefix: true
    });

    // Filter by category
    if (category) {
      results = results.filter(r => {
        const thread = this.threads.get(r.id);
        return thread?.category === category;
      });
    }

    // Filter by solved status
    if (solvedOnly) {
      results = results.filter(r => {
        const thread = this.threads.get(r.id);
        return thread?.solved === true;
      });
    }

    // Map to SearchResult format
    const searchResults: SearchResult[] = results.slice(0, limit).map(r => ({
      id: r.id,
      title: r.title,
      category: r.category,
      url: r.url,
      excerpt: r.excerpt,
      solved: r.solved,
      replies: r.replies,
      score: r.score
    }));

    return searchResults;
  }

  /**
   * Get full thread content by ID
   */
  async getThread(threadId: string): Promise<ForumThread | null> {
    if (!this.indexBuilt) {
      await this.buildIndex();
    }

    return this.threads.get(threadId) || null;
  }

  /**
   * List all available categories
   */
  async listCategories(): Promise<Array<{ name: string; threadCount: number }>> {
    if (!this.indexBuilt) {
      await this.buildIndex();
    }

    const categoryCounts = new Map<string, number>();

    for (const thread of this.threads.values()) {
      const count = categoryCounts.get(thread.category) || 0;
      categoryCounts.set(thread.category, count + 1);
    }

    return Array.from(categoryCounts.entries())
      .map(([name, threadCount]) => ({ name, threadCount }))
      .sort((a, b) => b.threadCount - a.threadCount);
  }

  /**
   * Get statistics
   */
  async getStats() {
    if (!this.indexBuilt) {
      await this.buildIndex();
    }

    const threads = Array.from(this.threads.values());

    return {
      totalThreads: threads.length,
      solvedThreads: threads.filter(t => t.solved).length,
      totalReplies: threads.reduce((sum, t) => sum + t.replies, 0),
      categories: await this.listCategories()
    };
  }
}
