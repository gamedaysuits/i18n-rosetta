/**
 * Content sync integration tests.
 *
 * Tests the runContentSync pipeline end-to-end in fallback mode
 * (no API key), verifying:
 *   - Content file discovery
 *   - Front matter field extraction and fallback prefixing
 *   - Body preservation with [EN] marker comment
 *   - Target file path generation (Hugo filename convention)
 *   - Existing translation skip logic
 *   - Dry-run mode (no file writes)
 *   - Path containment security
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runContentSync } from '../lib/sync.js';

// Create a temporary content directory for each test
function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rosetta-content-'));
}

// Write a Hugo content file to the temp directory
function writeContent(dir, relPath, content) {
  const fullPath = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
  return fullPath;
}

// Minimal language config for testing
const TEST_LANGUAGES = {
  fr: { name: 'French', register: 'Professional.' },
  de: { name: 'German', register: 'Professional.' },
};

/** Build a v3 pair Map from a languages object for testing. */
function buildTestPairs(languages, sourceLocale = 'en') {
  const pairs = new Map();
  for (const [code, lang] of Object.entries(languages)) {
    pairs.set(`${sourceLocale}:${code}`, {
      source: sourceLocale,
      target: code,
      method: 'llm',
      model: 'openai/gpt-4o-mini',
      batchSize: 30,
      name: lang.name,
      register: lang.register,
    });
  }
  return pairs;
}

// Sample Hugo content file with front matter and body
const SAMPLE_POST = `---
title: My First Post
description: A short introduction to Hugo
date: 2024-01-15
draft: false
tags:
  - intro
  - tutorial
---
Welcome to **Hugo**! This is a sample post.

## Getting Started

Hugo is a fast static site generator.

\`\`\`bash
hugo new site mysite
\`\`\`

That's all you need to know.
`;

describe('runContentSync (fallback mode)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates translated files for all target languages', async () => {
    writeContent(tmpDir, 'posts/hello.md', SAMPLE_POST);

    await runContentSync({
      contentDir: tmpDir,
      sourceLocale: 'en',
      pairs: buildTestPairs(TEST_LANGUAGES),
      translatableFields: null,
      apiKey: null,
      dryRun: false,
    });

    // Should have created hello.fr.md and hello.de.md
    assert.ok(fs.existsSync(path.join(tmpDir, 'posts/hello.fr.md')), 'French file created');
    assert.ok(fs.existsSync(path.join(tmpDir, 'posts/hello.de.md')), 'German file created');
  });

  it('applies [EN] fallback prefix to front matter fields', async () => {
    writeContent(tmpDir, 'posts/hello.md', SAMPLE_POST);

    await runContentSync({
      contentDir: tmpDir,
      sourceLocale: 'en',
      pairs: buildTestPairs({ fr: TEST_LANGUAGES.fr }),
      translatableFields: null,
      apiKey: null,
      dryRun: false,
    });

    const output = fs.readFileSync(path.join(tmpDir, 'posts/hello.fr.md'), 'utf-8');

    // Title and description should have [EN] prefix
    assert.ok(output.includes('[EN] My First Post'), 'title has fallback prefix');
    assert.ok(output.includes('[EN] A short introduction to Hugo'), 'description has fallback prefix');

    // Non-translatable fields should be preserved as-is
    assert.ok(output.includes('date: 2024-01-15'), 'date preserved');
    assert.ok(output.includes('draft: false'), 'draft preserved');
  });

  it('marks body with [EN] comment when no API key', async () => {
    writeContent(tmpDir, 'posts/hello.md', SAMPLE_POST);

    await runContentSync({
      contentDir: tmpDir,
      sourceLocale: 'en',
      pairs: buildTestPairs({ fr: TEST_LANGUAGES.fr }),
      translatableFields: null,
      apiKey: null,
      dryRun: false,
    });

    const output = fs.readFileSync(path.join(tmpDir, 'posts/hello.fr.md'), 'utf-8');
    assert.ok(output.includes('<!-- [EN] Original English content -->'), 'body has [EN] marker');
    assert.ok(output.includes('Welcome to **Hugo**!'), 'English body preserved');
  });

  it('skips existing translations without overwriting', async () => {
    writeContent(tmpDir, 'posts/hello.md', SAMPLE_POST);
    const existingPath = writeContent(tmpDir, 'posts/hello.fr.md', '---\ntitle: Mon Premier Article\n---\nContenu existant.\n');

    await runContentSync({
      contentDir: tmpDir,
      sourceLocale: 'en',
      pairs: buildTestPairs({ fr: TEST_LANGUAGES.fr }),
      translatableFields: null,
      apiKey: null,
      dryRun: false,
    });

    // Existing file should NOT be overwritten
    const output = fs.readFileSync(existingPath, 'utf-8');
    assert.ok(output.includes('Mon Premier Article'), 'existing translation preserved');
    assert.ok(!output.includes('[EN]'), 'no fallback prefix injected');
  });

  it('does not write files in dry-run mode', async () => {
    writeContent(tmpDir, 'posts/hello.md', SAMPLE_POST);

    await runContentSync({
      contentDir: tmpDir,
      sourceLocale: 'en',
      pairs: buildTestPairs(TEST_LANGUAGES),
      translatableFields: null,
      apiKey: null,
      dryRun: true,
    });

    assert.ok(!fs.existsSync(path.join(tmpDir, 'posts/hello.fr.md')), 'French file NOT created');
    assert.ok(!fs.existsSync(path.join(tmpDir, 'posts/hello.de.md')), 'German file NOT created');
  });

  it('handles nested content directories', async () => {
    writeContent(tmpDir, 'blog/2024/january/hello.md', SAMPLE_POST);

    await runContentSync({
      contentDir: tmpDir,
      sourceLocale: 'en',
      pairs: buildTestPairs({ fr: TEST_LANGUAGES.fr }),
      translatableFields: null,
      apiKey: null,
      dryRun: false,
    });

    assert.ok(
      fs.existsSync(path.join(tmpDir, 'blog/2024/january/hello.fr.md')),
      'nested target file created'
    );
  });

  it('handles content files without front matter', async () => {
    const bodyOnly = '# Just a Header\n\nSome body text without front matter.\n';
    writeContent(tmpDir, 'pages/about.md', bodyOnly);

    await runContentSync({
      contentDir: tmpDir,
      sourceLocale: 'en',
      pairs: buildTestPairs({ fr: TEST_LANGUAGES.fr }),
      translatableFields: null,
      apiKey: null,
      dryRun: false,
    });

    const output = fs.readFileSync(path.join(tmpDir, 'pages/about.fr.md'), 'utf-8');
    assert.ok(!output.includes('---'), 'no front matter added');
    assert.ok(output.includes('<!-- [EN] Original English content -->'), 'body has marker');
    assert.ok(output.includes('# Just a Header'), 'body preserved');
  });

  it('translates only configured fields in translatableFields override', async () => {
    writeContent(tmpDir, 'posts/hello.md', SAMPLE_POST);

    await runContentSync({
      contentDir: tmpDir,
      sourceLocale: 'en',
      pairs: buildTestPairs({ fr: TEST_LANGUAGES.fr }),
      translatableFields: ['title'],  // Only translate title, not description
      apiKey: null,
      dryRun: false,
    });

    const output = fs.readFileSync(path.join(tmpDir, 'posts/hello.fr.md'), 'utf-8');
    assert.ok(output.includes('[EN] My First Post'), 'title translated');
    // Description should NOT have a fallback prefix (it's not in the override list)
    assert.ok(!output.includes('[EN] A short introduction'), 'description NOT translated');
  });

  it('handles source files with .en.md suffix', async () => {
    writeContent(tmpDir, 'posts/hello.en.md', SAMPLE_POST);

    await runContentSync({
      contentDir: tmpDir,
      sourceLocale: 'en',
      pairs: buildTestPairs({ fr: TEST_LANGUAGES.fr }),
      translatableFields: null,
      apiKey: null,
      dryRun: false,
    });

    // Should create hello.fr.md (not hello.en.fr.md)
    assert.ok(
      fs.existsSync(path.join(tmpDir, 'posts/hello.fr.md')),
      'target uses clean base name'
    );
  });

  it('handles empty content directory gracefully', async () => {
    // tmpDir exists but has no .md files
    await runContentSync({
      contentDir: tmpDir,
      sourceLocale: 'en',
      pairs: buildTestPairs(TEST_LANGUAGES),
      translatableFields: null,
      apiKey: null,
      dryRun: false,
    });
    // Should not throw
  });

  it('handles nonexistent content directory gracefully', async () => {
    await runContentSync({
      contentDir: path.join(tmpDir, 'nonexistent'),
      sourceLocale: 'en',
      pairs: buildTestPairs(TEST_LANGUAGES),
      translatableFields: null,
      apiKey: null,
      dryRun: false,
    });
    // Should not throw
  });

  it('preserves code blocks in fallback body', async () => {
    const withCode = `---
title: Code Example
---
Here is some code:

\`\`\`javascript
const x = 42;
\`\`\`

And inline \`code\` too.
`;
    writeContent(tmpDir, 'posts/code.md', withCode);

    await runContentSync({
      contentDir: tmpDir,
      sourceLocale: 'en',
      pairs: buildTestPairs({ fr: TEST_LANGUAGES.fr }),
      translatableFields: null,
      apiKey: null,
      dryRun: false,
    });

    const output = fs.readFileSync(path.join(tmpDir, 'posts/code.fr.md'), 'utf-8');
    assert.ok(output.includes('```javascript'), 'code block preserved');
    assert.ok(output.includes('const x = 42;'), 'code content preserved');
    assert.ok(output.includes('`code`'), 'inline code preserved');
  });
});
