# Test Fixtures

This directory contains sample data for testing the documentation search modules.

## Directory Structure

```
__fixtures__/
├── forum-content/
│   └── baramundi-connect/
│       ├── _summary.json                                  # Category metadata
│       ├── 12345-how-to-configure-bconnect-api.md        # SOLVED thread
│       ├── 12346-deployment-job-fails-with-error-code-5.md  # UNSOLVED thread
│       └── 12347-bitlocker-recovery-keys-via-bconnect.md # SOLVED thread
├── feedback-content/
│   ├── faq/
│   │   ├── what-is-baramundi-management-suite.md
│   │   └── how-to-license-baramundi.md
│   ├── knowledge-base/
│   │   ├── troubleshooting-agent-connection-issues.md
│   │   └── best-practices-for-software-deployment.md
│   └── ideas-en/
│       ├── idea-1234-add-python-scripting-support.md     # 47 votes, Under Review
│       └── idea-1235-improve-mobile-device-reporting.md  # 31 votes, Planned
└── release-notes/
    ├── 2024R1_EN.txt                                      # Release notes 2024 R1
    └── 2024R2_EN.txt                                      # Release notes 2024 R2
```

## Fixture Content Summary

### Forum Threads (3 threads)
- **Category:** baramundi Connect
- **Content:**
  - bConnect API configuration (SOLVED, 5 replies)
  - Deployment job error troubleshooting (UNSOLVED, 12 replies)
  - BitLocker recovery keys via bConnect (SOLVED, 8 replies)

### FAQ (2 articles)
- What is baramundi Management Suite?
- How do I license baramundi Management Suite?

### Knowledge Base (2 articles)
- Troubleshooting Agent Connection Issues (comprehensive guide)
- Best Practices for Software Deployment (extensive best practices)

### Ideas (2 ideas)
- Add Python scripting support (47 votes, Under Review)
- Improve Mobile Device Management Reporting (31 votes, Planned)

### Release Notes (2 versions)
- 2024 R1 (March 2024)
- 2024 R2 (September 2024)

## Usage in Tests

### Example: Load fixtures in tests

```typescript
import { DocumentationSearchModule } from '../src/documentation-search';
import path from 'path';

describe('DocumentationSearchModule', () => {
  let docSearch: DocumentationSearchModule;

  beforeEach(() => {
    const fixturesPath = path.resolve(__dirname, '../__fixtures__');
    docSearch = new DocumentationSearchModule(fixturesPath);
  });

  it('should index all fixture documents', async () => {
    await docSearch.buildIndex();

    const stats = await docSearch.getStats();

    expect(stats.totalDocuments).toBe(11); // 3 forum + 2 faq + 2 kb + 2 ideas + 2 release notes
    expect(stats.coverage.forum.indexed).toBe(3);
    expect(stats.coverage.feedback.types.faq).toBe(2);
    expect(stats.coverage.feedback.types.kb).toBe(2);
    expect(stats.coverage.feedback.types.ideas).toBe(2);
    expect(stats.coverage.releaseNotes.indexed).toBe(2);
  });

  it('should search and find relevant results', async () => {
    await docSearch.buildIndex();

    const { results } = await docSearch.search('BitLocker');

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toContain('BitLocker');
  });
});
```

## Fixture Characteristics

### Forum Threads
- All threads follow standard Markdown format with metadata
- Include title, URL, author, date, replies, status
- Mix of SOLVED and UNSOLVED threads
- Realistic content with code examples and troubleshooting steps

### Feedback Content
- FAQ: General information articles
- Knowledge Base: Detailed technical guides
- Ideas: Feature requests with votes and status

### Release Notes
- Multi-section format: New Features, Improvements, Bug Fixes, Known Issues
- Include version numbers, dates, and detailed changelogs
- Realistic content reflecting actual baramundi releases

## Maintenance

When adding new fixtures:
1. Follow existing file naming conventions
2. Include all required metadata fields
3. Use realistic content that mirrors production data
4. Update this README with new fixture counts
5. Run tests to verify fixtures load correctly

## File Size

Total fixture size: ~50 KB
- Forum threads: ~10 KB
- Feedback content: ~30 KB
- Release notes: ~10 KB

Fast to load, realistic enough for thorough testing.
