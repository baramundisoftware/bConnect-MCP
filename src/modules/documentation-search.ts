/**
 * Documentation Search Module - Unified Search Across All Content
 *
 * Searches across:
 * - Forum threads (baramundi Connect, Job Management, etc.)
 * - Feedback Portal (FAQ, Knowledge Base, Ideas)
 * - Release Notes (2024 R1, R2, 2025 R1, R2, etc.)
 *
 * Uses MiniSearch for fast full-text indexing.
 */

import MiniSearch from 'minisearch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
// @ts-ignore - pdf-parse is a CommonJS module
const pdfParse = require('pdf-parse');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface Document {
  id: string;
  title: string;
  source: 'forum' | 'feedback' | 'release-notes' | 'preview' | 'website';
  type: string; // 'thread' | 'faq' | 'kb' | 'idea' | 'release-note' | 'preview-doc' | 'blog' | 'product' | 'solution' | 'case-study' | 'resource' | 'company' | 'event' | 'news'
  category?: string;
  url?: string;
  author?: string;
  date?: string;
  metadata: Record<string, any>;
  excerpt: string;
  content: string;
  filepath: string;
}

export interface SearchResult {
  id: string;
  title: string;
  source: string;
  type: string;
  category?: string;
  url?: string;
  excerpt: string;
  score: number;
  metadata: Record<string, any>;
}

export interface SearchCoverage {
  forum: {
    indexed: number;
    categories: string[];
  };
  feedback: {
    indexed: number;
    types: { faq: number; kb: number; ideas: number };
  };
  releaseNotes: {
    indexed: number;
    versions: string[];
  };
  previewDocuments: {
    indexed: number;
    versions: string[];
  };
  website: {
    indexed: number;
    categories: string[];
  };
  total: number;
}

export class DocumentationSearchModule {
  private miniSearch: MiniSearch<Document>;
  private documents: Map<string, Document>;
  private contentBasePath: string;
  private indexBuilt: boolean = false;
  private coverage: SearchCoverage;

  constructor(contentBasePath?: string) {
    // Default to docs.baramundi.com directory
    this.contentBasePath = contentBasePath ||
      path.resolve(__dirname, '../../../docs.baramundi.com');

    this.documents = new Map();
    this.coverage = {
      forum: { indexed: 0, categories: [] },
      feedback: { indexed: 0, types: { faq: 0, kb: 0, ideas: 0 } },
      releaseNotes: { indexed: 0, versions: [] },
      previewDocuments: { indexed: 0, versions: [] },
      website: { indexed: 0, categories: [] },
      total: 0
    };

    // Initialize MiniSearch with boosted fields
    this.miniSearch = new MiniSearch({
      fields: ['title', 'content', 'category', 'author', 'type'],
      storeFields: ['id', 'title', 'source', 'type', 'category', 'url', 'excerpt', 'metadata'],
      searchOptions: {
        boost: { title: 4, category: 2, type: 1.5, content: 1 },
        fuzzy: 0.2,
        prefix: true,
        combineWith: 'AND'
      }
    });
  }

  /**
   * Build complete search index from all content sources
   */
  async buildIndex(): Promise<void> {
    if (this.indexBuilt) {
      console.log('📚 Search index already built');
      return;
    }

    console.log('🔨 Building documentation search index...');
    const startTime = Date.now();

    // Load content from all sources
    await this.loadForumContent();
    await this.loadFeedbackContent();
    await this.loadReleaseNotes();
    await this.loadPreviewDocuments();
    await this.loadWebsiteContent();

    // Add all documents to MiniSearch index
    const docsArray = Array.from(this.documents.values());
    this.miniSearch.addAll(docsArray);

    this.coverage.total = this.documents.size;
    this.indexBuilt = true;

    const duration = Date.now() - startTime;
    console.log(`✅ Index built: ${this.coverage.total} documents in ${duration}ms`);
    console.log(`   📁 Forum: ${this.coverage.forum.indexed} threads (${this.coverage.forum.categories.length} categories)`);
    console.log(`   💡 Feedback: ${this.coverage.feedback.indexed} items (FAQ: ${this.coverage.feedback.types.faq}, KB: ${this.coverage.feedback.types.kb}, Ideas: ${this.coverage.feedback.types.ideas})`);
    console.log(`   📋 Release Notes: ${this.coverage.releaseNotes.indexed} versions`);
    console.log(`   📄 Preview Documents: ${this.coverage.previewDocuments.indexed} documents`);
    console.log(`   🌐 Website: ${this.coverage.website.indexed} pages (${this.coverage.website.categories.length} categories)`);
  }

  /**
   * Load forum threads from scraped Markdown files
   */
  private async loadForumContent(): Promise<void> {
    const forumPath = path.join(this.contentBasePath, 'forum-content');

    if (!fs.existsSync(forumPath)) {
      console.warn(`⚠️  Forum content not found at ${forumPath}`);
      return;
    }

    const categories = fs.readdirSync(forumPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    for (const category of categories) {
      const categoryPath = path.join(forumPath, category);
      const summaryPath = path.join(categoryPath, '_summary.json');

      if (!fs.existsSync(summaryPath)) {
        continue; // Skip directories without summary
      }

      const files = fs.readdirSync(categoryPath)
        .filter(f => f.endsWith('.md') && !f.startsWith('_'));

      for (const file of files) {
        const filepath = path.join(categoryPath, file);
        const doc = this.parseForumThread(filepath, category);

        if (doc) {
          this.documents.set(doc.id, doc);
          this.coverage.forum.indexed++;
        }
      }

      this.coverage.forum.categories.push(category);
    }
  }

  /**
   * Parse a forum thread Markdown file
   */
  private parseForumThread(filepath: string, category: string): Document | null {
    try {
      const content = fs.readFileSync(filepath, 'utf-8');

      // Extract metadata from Markdown
      const titleMatch = content.match(/^# (.+)$/m);
      const urlMatch = content.match(/\*\*URL:\*\* (.+)$/m);
      const authorMatch = content.match(/\*\*Author:\*\* (.+)$/m);
      const dateMatch = content.match(/\*\*Date:\*\* (.+)$/m);
      const repliesMatch = content.match(/\*\*Replies:\*\* (\d+)$/m);
      const solvedMatch = content.match(/\*\*Status:\*\* ✅ SOLVED/);

      // Extract ID from filename
      const filename = path.basename(filepath, '.md');
      const idMatch = filename.match(/^(\d+)-/);
      const id = `forum-${category}-${idMatch ? idMatch[1] : filename}`;

      // Extract first 200 characters as excerpt
      const contentStart = content.indexOf('## Original Post');
      const excerpt = contentStart > 0
        ? content.substring(contentStart + 20, contentStart + 220).trim()
        : content.substring(0, 200).trim();

      if (!titleMatch || !urlMatch) {
        return null;
      }

      return {
        id,
        title: titleMatch[1],
        source: 'forum',
        type: 'thread',
        category,
        url: urlMatch[1],
        author: authorMatch ? authorMatch[1] : 'Unknown',
        date: dateMatch ? dateMatch[1] : undefined,
        metadata: {
          replies: repliesMatch ? parseInt(repliesMatch[1]) : 0,
          solved: solvedMatch !== null
        },
        excerpt: excerpt.replace(/\n/g, ' ') + '...',
        content,
        filepath
      };
    } catch (error) {
      console.error(`Error parsing forum thread ${filepath}:`, error);
      return null;
    }
  }

  /**
   * Load feedback portal content (FAQ, Knowledge Base, Ideas)
   */
  private async loadFeedbackContent(): Promise<void> {
    const feedbackPath = path.join(this.contentBasePath, 'feedback/content');

    if (!fs.existsSync(feedbackPath)) {
      console.warn(`⚠️  Feedback content not found at ${feedbackPath}`);
      return;
    }

    // Load FAQ
    await this.loadFeedbackType(path.join(feedbackPath, 'faq'), 'faq');

    // Load Knowledge Base
    await this.loadFeedbackType(path.join(feedbackPath, 'knowledge-base'), 'kb');

    // Load Ideas (English and German)
    await this.loadFeedbackType(path.join(feedbackPath, 'ideas-en'), 'idea');
    await this.loadFeedbackType(path.join(feedbackPath, 'ideas-de'), 'idea');
  }

  /**
   * Load a specific feedback content type
   */
  private async loadFeedbackType(dirPath: string, type: 'faq' | 'kb' | 'idea'): Promise<void> {
    if (!fs.existsSync(dirPath)) {
      return;
    }

    const files = fs.readdirSync(dirPath)
      .filter(f => f.endsWith('.md') && !f.startsWith('_'));

    for (const file of files) {
      const filepath = path.join(dirPath, file);
      const doc = this.parseFeedbackItem(filepath, type);

      if (doc) {
        this.documents.set(doc.id, doc);
        this.coverage.feedback.indexed++;
        // Map 'idea' to 'ideas' for coverage tracking
        const coverageKey = type === 'idea' ? 'ideas' : type;
        this.coverage.feedback.types[coverageKey as 'faq' | 'kb' | 'ideas']++;
      }
    }
  }

  /**
   * Parse a feedback portal Markdown file
   */
  private parseFeedbackItem(filepath: string, type: 'faq' | 'kb' | 'idea'): Document | null {
    try {
      const content = fs.readFileSync(filepath, 'utf-8');
      const filename = path.basename(filepath, '.md');

      // Extract metadata
      const titleMatch = content.match(/^# (.+)$/m);
      const urlMatch = content.match(/\*\*URL:\*\* (.+)$/m);
      const authorMatch = content.match(/\*\*Author:\*\* (.+)$/m);
      const dateMatch = content.match(/\*\*Published:\*\* (.+)$/m);
      const votesMatch = content.match(/\*\*Votes:\*\* (\d+)$/m);
      const statusMatch = content.match(/\*\*Status:\*\* (.+)$/m);

      if (!titleMatch) {
        return null;
      }

      const id = `feedback-${type}-${filename}`;

      // Extract excerpt (first 200 chars after metadata)
      const contentStart = content.indexOf('---\n\n') + 5;
      const excerpt = contentStart > 5
        ? content.substring(contentStart, contentStart + 200).trim()
        : content.substring(0, 200).trim();

      return {
        id,
        title: titleMatch[1],
        source: 'feedback',
        type,
        url: urlMatch ? urlMatch[1] : undefined,
        author: authorMatch ? authorMatch[1] : undefined,
        date: dateMatch ? dateMatch[1] : undefined,
        metadata: {
          votes: votesMatch ? parseInt(votesMatch[1]) : 0,
          status: statusMatch ? statusMatch[1] : undefined
        },
        excerpt: excerpt.replace(/\n/g, ' ') + '...',
        content,
        filepath
      };
    } catch (error) {
      console.error(`Error parsing feedback item ${filepath}:`, error);
      return null;
    }
  }

  /**
   * Load release notes
   */
  private async loadReleaseNotes(): Promise<void> {
    const releaseNotesPath = path.join(this.contentBasePath, 'release-notes');

    if (!fs.existsSync(releaseNotesPath)) {
      console.warn(`⚠️  Release notes not found at ${releaseNotesPath}`);
      return;
    }

    const files = fs.readdirSync(releaseNotesPath)
      .filter(f => f.endsWith('.txt') || f.endsWith('.md'));

    for (const file of files) {
      const filepath = path.join(releaseNotesPath, file);
      const doc = this.parseReleaseNote(filepath);

      if (doc) {
        this.documents.set(doc.id, doc);
        this.coverage.releaseNotes.indexed++;

        // Extract version from filename
        const versionMatch = file.match(/^([\d\w]+R\d+)/i);
        if (versionMatch && !this.coverage.releaseNotes.versions.includes(versionMatch[1])) {
          this.coverage.releaseNotes.versions.push(versionMatch[1]);
        }
      }
    }
  }

  /**
   * Parse a release notes file
   */
  private parseReleaseNote(filepath: string): Document | null {
    try {
      const content = fs.readFileSync(filepath, 'utf-8');
      const filename = path.basename(filepath);

      // Extract version and language from filename
      const match = filename.match(/^([\d\w]+R\d+).*_(DE|EN)\.(txt|md)$/i);
      if (!match) {
        return null;
      }

      const version = match[1];
      const language = match[2];
      const id = `release-notes-${version}-${language}`;

      return {
        id,
        title: `Release Notes ${version} (${language})`,
        source: 'release-notes',
        type: 'release-note',
        category: version,
        metadata: {
          version,
          language
        },
        excerpt: content.substring(0, 200).trim() + '...',
        content,
        filepath
      };
    } catch (error) {
      console.error(`Error parsing release notes ${filepath}:`, error);
      return null;
    }
  }

  /**
   * Load preview documents (PDF files)
   */
  private async loadPreviewDocuments(): Promise<void> {
    const previewDocsPath = path.join(this.contentBasePath, 'preview_documents');

    if (!fs.existsSync(previewDocsPath)) {
      console.warn(`⚠️  Preview documents not found at ${previewDocsPath}`);
      return;
    }

    const files = fs.readdirSync(previewDocsPath)
      .filter(f => f.toLowerCase().endsWith('.pdf'));

    for (const file of files) {
      const filepath = path.join(previewDocsPath, file);
      const doc = await this.parsePreviewDocument(filepath);

      if (doc) {
        this.documents.set(doc.id, doc);
        this.coverage.previewDocuments.indexed++;

        // Extract version from filename
        const versionMatch = file.match(/bMS_([\d]+_R\d+)/i);
        if (versionMatch && !this.coverage.previewDocuments.versions.includes(versionMatch[1])) {
          this.coverage.previewDocuments.versions.push(versionMatch[1]);
        }
      }
    }
  }

  /**
   * Parse a preview document PDF file
   */
  private async parsePreviewDocument(filepath: string): Promise<Document | null> {
    try {
      const dataBuffer = fs.readFileSync(filepath);
      const pdfData = await pdfParse(dataBuffer);
      const filename = path.basename(filepath);

      // Extract version and language from filename
      // Pattern: Preview_bMS_2024_R1_EN.pdf or Preview Dokument - Preview_bMS_2025_R1_EN.pdf
      const match = filename.match(/bMS_([\d]+)_(R\d+)_(DE|EN)\.pdf/i);
      if (!match) {
        console.warn(`⚠️  Could not extract metadata from filename: ${filename}`);
        return null;
      }

      const year = match[1];
      const release = match[2];
      const language = match[3];
      const version = `${year}_${release}`;
      const id = `preview-${version}-${language}`;

      // Extract excerpt from beginning of content
      const content = pdfData.text;
      const excerpt = content.substring(0, 300).replace(/\s+/g, ' ').trim() + '...';

      return {
        id,
        title: `Preview Document bMS ${year} ${release} (${language})`,
        source: 'preview',
        type: 'preview-doc',
        category: version,
        metadata: {
          version,
          language,
          year,
          release,
          pageCount: pdfData.numpages,
          fileSize: fs.statSync(filepath).size
        },
        excerpt,
        content,
        filepath
      };
    } catch (error) {
      console.error(`Error parsing preview document ${filepath}:`, error);
      return null;
    }
  }

  /**
   * Load website content from scraped Markdown files
   */
  private async loadWebsiteContent(): Promise<void> {
    const websitePath = path.join(this.contentBasePath, 'website-de-content');

    if (!fs.existsSync(websitePath)) {
      console.warn(`⚠️  Website content not found at ${websitePath}`);
      return;
    }

    const categories = fs.readdirSync(websitePath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    for (const category of categories) {
      const categoryPath = path.join(websitePath, category);
      const files = fs.readdirSync(categoryPath)
        .filter(f => f.endsWith('.md'));

      for (const file of files) {
        const filepath = path.join(categoryPath, file);
        const doc = this.parseWebsitePage(filepath, category);

        if (doc) {
          this.documents.set(doc.id, doc);
          this.coverage.website.indexed++;
        }
      }

      this.coverage.website.categories.push(category);
    }
  }

  /**
   * Parse a website Markdown file with YAML frontmatter
   */
  private parseWebsitePage(filepath: string, category: string): Document | null {
    try {
      const content = fs.readFileSync(filepath, 'utf-8');

      // Extract YAML frontmatter
      const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
      if (!frontmatterMatch) {
        return null;
      }

      const frontmatter = frontmatterMatch[1];
      const markdownContent = frontmatterMatch[2];

      // Parse YAML frontmatter manually (simple key: "value" extraction)
      const titleMatch = frontmatter.match(/title:\s*"([^"]+)"/);
      const urlMatch = frontmatter.match(/url:\s*"([^"]+)"/);
      const contentTypeMatch = frontmatter.match(/content_type:\s*"([^"]+)"/);
      const descriptionMatch = frontmatter.match(/description:\s*"([^"]+)"/);
      const scrapedDateMatch = frontmatter.match(/scraped_date:\s*"([^"]+)"/);
      const authorMatch = frontmatter.match(/author:\s*"([^"]+)"/);
      const publishedDateMatch = frontmatter.match(/published_date:\s*"([^"]+)"/);

      if (!titleMatch || !urlMatch) {
        return null;
      }

      // Generate ID from filename
      const filename = path.basename(filepath, '.md');
      const id = `website-${category}-${filename}`;

      // Extract first 200 characters as excerpt from markdown content
      const excerpt = markdownContent
        .substring(0, 300)
        .replace(/!\[.*?\]\(.*?\)/g, '') // Remove images
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Convert links to text
        .replace(/[#*_]/g, '') // Remove markdown formatting
        .replace(/\s+/g, ' ')
        .trim() + '...';

      const contentType = contentTypeMatch ? contentTypeMatch[1] : category;

      return {
        id,
        title: titleMatch[1],
        source: 'website',
        type: contentType,
        category,
        url: urlMatch[1],
        author: authorMatch ? authorMatch[1] : undefined,
        date: publishedDateMatch ? publishedDateMatch[1] : scrapedDateMatch ? scrapedDateMatch[1] : undefined,
        metadata: {
          description: descriptionMatch ? descriptionMatch[1] : '',
          language: 'de-DE',
          scrapedDate: scrapedDateMatch ? scrapedDateMatch[1] : undefined
        },
        excerpt,
        content: markdownContent,
        filepath
      };
    } catch (error) {
      console.error(`Error parsing website page ${filepath}:`, error);
      return null;
    }
  }

  /**
   * Search across all documentation
   */
  async search(
    query: string,
    options: {
      source?: 'forum' | 'feedback' | 'release-notes' | 'preview' | 'website' | 'all';
      type?: string;
      category?: string;
      limit?: number;
    } = {}
  ): Promise<{ results: SearchResult[]; coverage: SearchCoverage }> {
    if (!this.indexBuilt) {
      await this.buildIndex();
    }

    const { source = 'all', type, category, limit = 20 } = options;

    // Perform search
    let results = this.miniSearch.search(query, {
      fuzzy: 0.2,
      prefix: true
    });

    // Filter by source
    if (source !== 'all') {
      results = results.filter(r => {
        const doc = this.documents.get(r.id);
        return doc?.source === source;
      });
    }

    // Filter by type
    if (type) {
      results = results.filter(r => {
        const doc = this.documents.get(r.id);
        return doc?.type === type;
      });
    }

    // Filter by category
    if (category) {
      results = results.filter(r => {
        const doc = this.documents.get(r.id);
        return doc?.category === category;
      });
    }

    // Map to SearchResult format
    const searchResults: SearchResult[] = results.slice(0, limit).map(r => {
      const doc = this.documents.get(r.id)!;
      return {
        id: r.id,
        title: r.title,
        source: r.source,
        type: r.type,
        category: r.category,
        url: r.url,
        excerpt: r.excerpt,
        score: r.score,
        metadata: r.metadata
      };
    });

    return {
      results: searchResults,
      coverage: this.coverage
    };
  }

  /**
   * Get full document by ID
   */
  async getDocument(docId: string): Promise<Document | null> {
    if (!this.indexBuilt) {
      await this.buildIndex();
    }

    return this.documents.get(docId) || null;
  }

  /**
   * List all available sources with statistics
   */
  async listSources(): Promise<SearchCoverage> {
    if (!this.indexBuilt) {
      await this.buildIndex();
    }

    return this.coverage;
  }

  /**
   * Get popular topics (most referenced terms)
   */
  async getPopularTopics(options: {
    source?: 'forum' | 'feedback' | 'release-notes' | 'preview' | 'all';
    limit?: number;
  } = {}): Promise<Array<{ topic: string; count: number; source: string }>> {
    if (!this.indexBuilt) {
      await this.buildIndex();
    }

    const { source = 'all', limit = 10 } = options;

    // Filter documents by source
    let docs = Array.from(this.documents.values());
    if (source !== 'all') {
      docs = docs.filter(d => d.source === source);
    }

    // Extract keywords from titles
    const topicCounts = new Map<string, { count: number; source: string }>();

    for (const doc of docs) {
      const words = doc.title.toLowerCase()
        .replace(/[^\w\s-]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 4); // Only words > 4 chars

      for (const word of words) {
        const existing = topicCounts.get(word);
        if (existing) {
          existing.count++;
        } else {
          topicCounts.set(word, { count: 1, source: doc.source });
        }
      }
    }

    // Sort by count and return top results
    return Array.from(topicCounts.entries())
      .map(([topic, data]) => ({ topic, count: data.count, source: data.source }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /**
   * Get statistics
   */
  async getStats() {
    if (!this.indexBuilt) {
      await this.buildIndex();
    }

    return {
      totalDocuments: this.coverage.total,
      coverage: this.coverage,
      indexSize: this.miniSearch.documentCount
    };
  }
}
