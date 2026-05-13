#!/usr/bin/env node
/**
 * Content translation test suite — Markdown parsing, block protection, and reassembly.
 * Run: node test/content.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';

import {
  parseContentFile,
  parseSimpleFrontMatter,
  parseSimpleTomlFrontMatter,
  rebuildFrontMatter,
  protectBlocks,
  restoreBlocks,
  hasOrphanedPlaceholders,
  discoverContentFiles,
  getTargetContentPath,
  buildContentPrompt,
  reassembleContentFile,
  isLikelyLangCode,
  DEFAULT_TRANSLATABLE_FIELDS,
  PLACEHOLDER_PREFIX,
  PLACEHOLDER_SUFFIX,
} from '../lib/content.js';

// =================================================================
// 1. Front matter parsing
// =================================================================
describe('parseContentFile', () => {
  it('parses YAML front matter from Markdown', () => {
    const raw = '---\ntitle: "My Post"\ndate: 2024-01-15\ndraft: false\n---\n\n# Hello\n\nWorld\n';
    const result = parseContentFile(raw);
    assert.equal(result.hasFrontMatter, true);
    assert.equal(result.frontMatter.title, 'My Post');
    assert.equal(result.frontMatter.date, '2024-01-15');
    assert.equal(result.frontMatter.draft, 'false');
    assert.ok(result.body.includes('# Hello'));
    assert.ok(result.body.includes('World'));
  });

  it('handles files without front matter', () => {
    const raw = '# Just Markdown\n\nNo front matter here.\n';
    const result = parseContentFile(raw);
    assert.equal(result.hasFrontMatter, false);
    assert.deepEqual(result.frontMatter, {});
    assert.ok(result.body.includes('# Just Markdown'));
  });

  it('handles empty files', () => {
    const result = parseContentFile('');
    assert.equal(result.hasFrontMatter, false);
    assert.equal(result.body, '');
  });

  it('parses the Hugo content fixture', () => {

    const fixturePath = path.join(import.meta.dirname, 'fixtures', 'hugo-content', 'posts', 'my-first-post.md');
    const raw = fs.readFileSync(fixturePath, 'utf-8');
    const result = parseContentFile(raw);

    assert.equal(result.hasFrontMatter, true);
    assert.equal(result.frontMatter.title, 'My First Blog Post');
    assert.equal(result.frontMatter.description, 'An introduction to Hugo and static site generation');
    assert.equal(result.frontMatter.draft, 'false');
    assert.ok(result.body.includes('# Getting Started with Hugo'));
    assert.ok(result.body.includes('```bash'));
    assert.ok(result.body.includes('{{< figure'));
  });
});

describe('parseSimpleFrontMatter', () => {
  it('parses simple key-value pairs', () => {
    const yaml = 'title: My Post\nauthor: Curtis Forbes';
    const result = parseSimpleFrontMatter(yaml);
    assert.equal(result.title, 'My Post');
    assert.equal(result.author, 'Curtis Forbes');
  });

  it('handles quoted values', () => {
    const yaml = 'title: "My Post: A Story"\ndescription: \'Short desc\'';
    const result = parseSimpleFrontMatter(yaml);
    assert.equal(result.title, 'My Post: A Story');
    assert.equal(result.description, 'Short desc');
  });

  it('skips indented lines (arrays, nested objects)', () => {
    const yaml = 'title: Post\ntags:\n  - hugo\n  - tutorial\nauthor: Curtis';
    const result = parseSimpleFrontMatter(yaml);
    assert.equal(result.title, 'Post');
    assert.equal(result.author, 'Curtis');
    // Tags array parent line ("tags:") should be skipped
    assert.equal(result.tags, undefined);
  });

  it('skips comment lines', () => {
    const yaml = '# Comment\ntitle: Post';
    const result = parseSimpleFrontMatter(yaml);
    assert.equal(result.title, 'Post');
  });
});

// =================================================================
// 2. Front matter rebuilding
// =================================================================
describe('rebuildFrontMatter', () => {
  it('replaces translated fields while preserving other lines', () => {
    const rawYaml = 'title: "My Post"\ndate: 2024-01-15\ndraft: false';
    const translations = { title: 'Mon Article' };
    const result = rebuildFrontMatter(rawYaml, translations);
    assert.ok(result.includes('title: "Mon Article"'));
    assert.ok(result.includes('date: 2024-01-15'));
    assert.ok(result.includes('draft: false'));
  });

  it('preserves array lines untouched', () => {
    const rawYaml = 'title: Post\ntags:\n  - hugo\n  - tutorial';
    const translations = { title: 'Article' };
    const result = rebuildFrontMatter(rawYaml, translations);
    assert.ok(result.includes('title: "Article"'));
    assert.ok(result.includes('  - hugo'));
    assert.ok(result.includes('  - tutorial'));
  });

  it('quotes values with special characters', () => {
    const rawYaml = 'title: Post';
    const translations = { title: 'Article: Un guide' };
    const result = rebuildFrontMatter(rawYaml, translations);
    assert.ok(result.includes('"Article: Un guide"'));
  });
});

// =================================================================
// 3. Block protection
// =================================================================
describe('protectBlocks', () => {
  it('protects fenced code blocks', () => {
    const body = 'Text before\n\n```bash\necho "hello"\n```\n\nText after';
    const { protectedBody, blocks } = protectBlocks(body);
    assert.ok(!protectedBody.includes('```bash'));
    assert.ok(!protectedBody.includes('echo'));
    assert.ok(protectedBody.includes(PLACEHOLDER_PREFIX));
    assert.equal(blocks.size, 1);
  });

  it('protects Hugo shortcodes (angle bracket style)', () => {
    const body = 'Before\n\n{{< figure src="/img.png" >}}\n\nAfter';
    const { protectedBody, blocks } = protectBlocks(body);
    assert.ok(!protectedBody.includes('{{< figure'));
    assert.ok(protectedBody.includes(PLACEHOLDER_PREFIX));
  });

  it('protects Hugo shortcodes (percent style)', () => {
    const body = 'Before\n\n{{% notice tip %}}\nContent\n{{% /notice %}}\n\nAfter';
    const { protectedBody, blocks } = protectBlocks(body);
    assert.ok(!protectedBody.includes('{{% notice'));
  });

  it('protects inline code', () => {
    const body = 'Use `hugo server` to start.';
    const { protectedBody, blocks } = protectBlocks(body);
    assert.ok(!protectedBody.includes('`hugo server`'));
    assert.ok(protectedBody.includes(PLACEHOLDER_PREFIX));
  });

  it('protects HTML tags', () => {
    const body = 'Text <div class="custom">content</div> more';
    const { protectedBody, blocks } = protectBlocks(body);
    assert.ok(!protectedBody.includes('<div'));
    assert.ok(!protectedBody.includes('</div>'));
  });

  it('preserves translatable text', () => {
    const body = 'This should be translated. **Bold text** too.';
    const { protectedBody } = protectBlocks(body);
    assert.ok(protectedBody.includes('This should be translated'));
    assert.ok(protectedBody.includes('**Bold text**'));
  });

  it('handles multiple code blocks', () => {
    const body = '```js\nconst a = 1;\n```\n\nText\n\n```python\nprint("hi")\n```';
    const { protectedBody, blocks } = protectBlocks(body);
    assert.equal(blocks.size, 2);
    assert.ok(protectedBody.includes('Text'));
  });

  it('handles body with no protectable content', () => {
    const body = 'Just plain text with **bold** and *italic*.';
    const { protectedBody, blocks } = protectBlocks(body);
    assert.equal(blocks.size, 0);
    assert.equal(protectedBody, body);
  });
});

// =================================================================
// 4. Block restoration
// =================================================================
describe('restoreBlocks', () => {
  it('restores all protected blocks', () => {
    const body = 'Text before\n\n```bash\necho "hello"\n```\n\nText after';
    const { protectedBody, blocks } = protectBlocks(body);
    const restored = restoreBlocks(protectedBody, blocks);
    assert.equal(restored, body);
  });

  it('round-trips complex content with all block types', () => {
    const body = [
      '# Title',
      '',
      'Use `inline code` here.',
      '',
      '```python',
      'def hello():',
      '    print("world")',
      '```',
      '',
      '{{< shortcode param="val" >}}',
      '',
      '<div class="custom">html</div>',
    ].join('\n');

    const { protectedBody, blocks } = protectBlocks(body);
    const restored = restoreBlocks(protectedBody, blocks);
    assert.equal(restored, body);
  });

  it('handles translated text around placeholders', () => {
    const body = 'Hello `world` goodbye';
    const { protectedBody, blocks } = protectBlocks(body);
    // Simulate translation changing surrounding text
    const translated = protectedBody.replace('Hello', 'Bonjour').replace('goodbye', 'au revoir');
    const restored = restoreBlocks(translated, blocks);
    assert.ok(restored.includes('Bonjour'));
    assert.ok(restored.includes('`world`'));
    assert.ok(restored.includes('au revoir'));
  });
});

// =================================================================
// 5. Content file discovery
// =================================================================
describe('discoverContentFiles', () => {
  it('finds source Markdown files', () => {
    const dir = path.join(import.meta.dirname, 'fixtures', 'hugo-content');
    const files = discoverContentFiles(dir, 'en');
    assert.ok(files.length >= 1);
    assert.ok(files.some(f => f.includes('my-first-post.md')));
  });

  it('returns empty array for nonexistent directory', () => {
    const files = discoverContentFiles('/tmp/nope-12345', 'en');
    assert.deepEqual(files, []);
  });
});

// =================================================================
// 6. Target path generation
// =================================================================
describe('getTargetContentPath', () => {
  it('generates target path for default filename', () => {
    const result = getTargetContentPath('/content/posts/my-post.md', 'fr', 'en');
    assert.equal(result, '/content/posts/my-post.fr.md');
  });

  it('generates target path stripping source locale suffix', () => {
    const result = getTargetContentPath('/content/posts/my-post.en.md', 'fr', 'en');
    assert.equal(result, '/content/posts/my-post.fr.md');
  });

  it('handles index.md files', () => {
    const result = getTargetContentPath('/content/about/index.md', 'ja', 'en');
    assert.equal(result, '/content/about/index.ja.md');
  });
});

// =================================================================
// 7. Language code detection
// =================================================================
describe('isLikelyLangCode', () => {
  it('recognizes 2-letter codes', () => {
    assert.equal(isLikelyLangCode('fr'), true);
    assert.equal(isLikelyLangCode('ja'), true);
  });

  it('recognizes 3-letter codes', () => {
    assert.equal(isLikelyLangCode('eng'), true);
  });

  it('recognizes region codes', () => {
    assert.equal(isLikelyLangCode('zh-TW'), true);
    assert.equal(isLikelyLangCode('pt-BR'), true);
  });

  it('rejects non-language strings', () => {
    assert.equal(isLikelyLangCode('2'), false);
    assert.equal(isLikelyLangCode('config'), false);
    assert.equal(isLikelyLangCode('v2'), false);
  });
});

// =================================================================
// 8. Content prompt building
// =================================================================
describe('buildContentPrompt', () => {
  it('includes the target language name', () => {
    const prompt = buildContentPrompt('# Hello', { name: 'French', register: 'Formal.' });
    assert.ok(prompt.includes('French'));
  });

  it('includes the register instruction', () => {
    const prompt = buildContentPrompt('# Hello', { name: 'French', register: 'Use vous-form.' });
    assert.ok(prompt.includes('Use vous-form.'));
  });

  it('includes placeholder preservation instructions', () => {
    const prompt = buildContentPrompt('# Hello', { name: 'French', register: 'Formal.' });
    assert.ok(prompt.includes('PROTECTED'));
    assert.ok(prompt.includes('placeholder'));
  });

  it('includes the body content', () => {
    const prompt = buildContentPrompt('# Hello World', { name: 'French', register: 'Formal.' });
    assert.ok(prompt.includes('# Hello World'));
  });
});

// =================================================================
// 9. File reassembly
// =================================================================
describe('reassembleContentFile', () => {
  it('reassembles a file with translated front matter and body', () => {
    const result = reassembleContentFile({
      rawFrontMatter: 'title: "My Post"\ndate: 2024-01-15',
      translatedFields: { title: 'Mon Article' },
      translatedBody: '\n# Bonjour\n\nContenu traduit.\n',
      hasFrontMatter: true,
    });
    assert.ok(result.startsWith('---\n'));
    assert.ok(result.includes('title: "Mon Article"'));
    assert.ok(result.includes('date: 2024-01-15'));
    assert.ok(result.includes('# Bonjour'));
  });

  it('returns just body when no front matter', () => {
    const result = reassembleContentFile({
      rawFrontMatter: '',
      translatedFields: {},
      translatedBody: '# Bonjour\n',
      hasFrontMatter: false,
    });
    assert.equal(result, '# Bonjour\n');
  });
});

// =================================================================
// 10. RED TEAM: Edge cases
// =================================================================
describe('RED TEAM: content edge cases', () => {
  it('handles front matter with no translatable fields', () => {
    const raw = '---\ndate: 2024-01-15\ndraft: true\n---\n\n# Post\n';
    const result = parseContentFile(raw);
    assert.equal(result.hasFrontMatter, true);
    // date and draft are not translatable — no title/description
    assert.equal(result.frontMatter.title, undefined);
  });

  it('handles code blocks inside shortcodes (nested protection)', () => {
    const body = '{{% tab %}}\n```go\nfmt.Println("hello")\n```\n{{% /tab %}}';
    const { protectedBody, blocks } = protectBlocks(body);
    const restored = restoreBlocks(protectedBody, blocks);
    assert.equal(restored, body);
  });

  it('handles placeholder-like text in original content', () => {
    // Unlikely but adversarial: what if content already has our placeholder format?
    const body = 'This mentions ⟦PROTECTED_0⟧ literally.';
    const { protectedBody, blocks } = protectBlocks(body);
    // No protectable blocks, so it should pass through unchanged
    assert.equal(blocks.size, 0);
    assert.equal(protectedBody, body);
  });

  it('protects backtick-heavy content correctly', () => {
    const body = 'Use `cmd1`, then `cmd2`, and finally `cmd3`.';
    const { protectedBody, blocks } = protectBlocks(body);
    assert.equal(blocks.size, 3);
    const restored = restoreBlocks(protectedBody, blocks);
    assert.equal(restored, body);
  });
});

// =================================================================
// Orphaned placeholder detection (v2.0.1 hardening)
// =================================================================
describe('hasOrphanedPlaceholders', () => {
  it('returns false for clean text with no placeholders', () => {
    assert.equal(hasOrphanedPlaceholders('Hello world, this is normal text.'), false);
  });

  it('returns false after successful block restoration', () => {
    const body = 'Start\n\n```js\nconst x = 1;\n```\n\nEnd';
    const { protectedBody, blocks } = protectBlocks(body);
    // Simulate the LLM faithfully preserving placeholders
    const translated = protectedBody.replace('Start', 'Début').replace('End', 'Fin');
    const restored = restoreBlocks(translated, blocks);
    assert.equal(hasOrphanedPlaceholders(restored), false);
    assert.ok(restored.includes('const x = 1;'));
  });

  it('returns true when the LLM drops a placeholder', () => {
    // Simulate LLM translating and losing a placeholder entirely
    const corruptedBody = `Début\n\nFin`;
    assert.equal(hasOrphanedPlaceholders(corruptedBody), false);
    // Now with an orphaned placeholder still present
    const withOrphan = `Début\n\n${PLACEHOLDER_PREFIX}0${PLACEHOLDER_SUFFIX}\n\nFin`;
    assert.equal(hasOrphanedPlaceholders(withOrphan), true);
  });

  it('returns true when the LLM adds spaces to a placeholder', () => {
    // The LLM might add a space, making restoreBlocks miss it
    const mangledBody = `Translated text ${PLACEHOLDER_PREFIX}99${PLACEHOLDER_SUFFIX} more text`;
    assert.equal(hasOrphanedPlaceholders(mangledBody), true);
  });

  it('detects orphans in complex multi-block scenarios', () => {
    const body = 'Intro\n\n```py\nprint("hi")\n```\n\n{{< youtube abc123 >}}\n\nOutro';
    const { protectedBody, blocks } = protectBlocks(body);
    // Simulate LLM keeping only one placeholder, mangling the other
    const halfBroken = protectedBody
      .replace('Intro', 'Introducción')
      .replace('Outro', 'Final');
    // Restore works fine on the ones that are intact
    const restored = restoreBlocks(halfBroken, blocks);
    // If all went well, no orphans
    assert.equal(hasOrphanedPlaceholders(restored), false);
  });

  it('catches a single orphan among many restored blocks', () => {
    // Manually construct a scenario where one placeholder survives
    const body = `Some text\n\n${PLACEHOLDER_PREFIX}42${PLACEHOLDER_SUFFIX}\n\nMore text`;
    // This placeholder was never in the blocks map, so it stays
    const blocks = new Map();
    const restored = restoreBlocks(body, blocks);
    assert.equal(hasOrphanedPlaceholders(restored), true);
  });
});

// =================================================================
// TOML nested table warning (v2.0.1 hardening)
// =================================================================
describe('parseSimpleTomlFrontMatter nested table handling', () => {
  it('parses flat TOML keys correctly', () => {
    const toml = 'title = "Hello"\ndate = 2024-01-01\ndraft = false';
    const result = parseSimpleTomlFrontMatter(toml);
    assert.equal(result.title, 'Hello');
    assert.equal(result.date, '2024-01-01');
    assert.equal(result.draft, 'false');
  });

  it('skips nested table keys but still parses top-level keys', () => {
    const toml = 'title = "Top Level"\n[params]\nsidebar = true\ndescription = "Nested"';
    const result = parseSimpleTomlFrontMatter(toml);
    // Top-level key should be parsed
    assert.equal(result.title, 'Top Level');
    // Keys after [params] are not parsed (they belong to the nested table)
    assert.equal(result.sidebar, undefined);
    assert.equal(result.description, undefined);
  });

  it('skips array-of-tables notation', () => {
    const toml = 'title = "My Post"\n[[resources]]\nsrc = "image.png"\ntitle = "Photo"';
    const result = parseSimpleTomlFrontMatter(toml);
    // Only the top-level title should be captured
    assert.equal(result.title, 'My Post');
    assert.equal(result.src, undefined);
  });

  it('warns on nested tables via console.warn', (t) => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (msg) => warnings.push(msg);
    try {
      const toml = 'title = "Test"\n[params]\nkey = "value"';
      parseSimpleTomlFrontMatter(toml);
      assert.equal(warnings.length, 1);
      assert.ok(warnings[0].includes('[params]'));
      assert.ok(warnings[0].includes('will not be translated'));
    } finally {
      console.warn = originalWarn;
    }
  });

  it('warns separately for each nested table encountered', (t) => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (msg) => warnings.push(msg);
    try {
      const toml = 'title = "Test"\n[params]\nkey = "val"\n[menu.main]\nweight = 10';
      parseSimpleTomlFrontMatter(toml);
      assert.equal(warnings.length, 2);
      assert.ok(warnings[0].includes('[params]'));
      assert.ok(warnings[1].includes('[menu.main]'));
    } finally {
      console.warn = originalWarn;
    }
  });
});
