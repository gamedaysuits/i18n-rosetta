#!/usr/bin/env node
/**
 * i18n-rosetta RED TEAM test suite
 *
 * Probes edge cases, adversarial inputs, and failure modes that
 * the happy-path suite doesn't cover. Categories:
 *
 *   1. Flatten — pathological inputs (empty strings, dots in keys, deep nesting)
 *   2. Diff — boundary conditions (empty locales, identical content, prefix collisions)
 *   3. Config — malformed configs, missing fields, type coercion
 *   4. Translate — prompt injection, malformed API responses
 *   5. Sync — filesystem edge cases, concurrent writes
 *
 * Run: node test/redteam.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { flattenKeys, setNestedValue } from '../lib/flatten.js';
import { diffLocale, diffLabel } from '../lib/diff.js';
import { resolveConfig, autoDetectLanguages, generateConfigTemplate } from '../lib/config.js';
import { DEFAULT_REGISTERS } from '../lib/registers.js';
import { buildPrompt, isUnsafeKey, inferKeyTypes } from '../lib/translate.js';
import { loadApiKey, runSync } from '../lib/sync.js';

// =================================================================
// 1. FLATTEN — Pathological inputs
// =================================================================
describe('RED TEAM: flattenKeys edge cases', () => {
  it('handles keys with dots in them (ambiguous paths)', () => {
    // WHY: If a user has {"a.b": "value"} at the top level,
    // flattenKeys produces "a.b" which is indistinguishable from {a:{b:"value"}}
    const result = flattenKeys({ 'a.b': 'dotted' });
    assert.equal(result['a.b'], 'dotted');
  });

  it('handles empty string keys', () => {
    const result = flattenKeys({ '': 'empty key' });
    assert.equal(result[''], 'empty key');
  });

  it('handles empty string values', () => {
    const result = flattenKeys({ key: '' });
    assert.equal(result['key'], '');
  });

  it('handles unicode keys and values', () => {
    const result = flattenKeys({ '日本語': { 'キー': '値' } });
    assert.equal(result['日本語.キー'], '値');
  });

  it('handles very deep nesting (100 levels)', () => {
    let obj = { leaf: 'deep' };
    for (let i = 0; i < 100; i++) {
      obj = { [`level${i}`]: obj };
    }
    const result = flattenKeys(obj);
    const keys = Object.keys(result);
    assert.equal(keys.length, 1);
    assert.equal(result[keys[0]], 'deep');
  });

  it('handles mixed types at same level', () => {
    const result = flattenKeys({
      str: 'hello',
      num: 42,
      bool: false,
      nil: null,
      arr: [1, 2, 3],
      nested: { inner: 'value' },
    });
    assert.equal(result['str'], 'hello');
    assert.equal(result['num'], 42);
    assert.equal(result['bool'], false);
    assert.equal(result['nil'], null);
    assert.deepEqual(result['arr'], [1, 2, 3]);
    assert.equal(result['nested.inner'], 'value');
    // 'nested' itself should NOT be a key (it's an object, not a leaf)
    assert.equal(result['nested'], undefined);
  });

  it('handles numeric string keys', () => {
    const result = flattenKeys({ '0': { '1': 'indexed' } });
    assert.equal(result['0.1'], 'indexed');
  });
});

// =================================================================
// 2. setNestedValue — Adversarial paths
// =================================================================
describe('RED TEAM: setNestedValue edge cases', () => {
  it('handles empty string path segment', () => {
    const obj = {};
    setNestedValue(obj, '.a', 'value');
    // Should create { "": { a: "value" } }
    assert.equal(obj['']['a'], 'value');
  });

  it('overwrites a primitive with a nested object path', () => {
    // WHY: If "a" was a string, then setting "a.b" should overwrite it with an object
    const obj = { a: 'was-a-string' };
    setNestedValue(obj, 'a.b', 'nested');
    assert.equal(obj.a.b, 'nested');
  });

  it('handles very long dot-notation paths', () => {
    const obj = {};
    const longPath = Array.from({ length: 50 }, (_, i) => `k${i}`).join('.');
    setNestedValue(obj, longPath, 'deep');

    let current = obj;
    for (let i = 0; i < 49; i++) {
      current = current[`k${i}`];
      assert.ok(typeof current === 'object', `Level ${i} should be object`);
    }
    assert.equal(current['k49'], 'deep');
  });
});

// =================================================================
// 3. DIFF — Boundary conditions
// =================================================================
describe('RED TEAM: diffLocale edge cases', () => {
  it('handles both source and target being empty', () => {
    const diff = diffLocale({}, {});
    assert.equal(diff.missing.length, 0);
    assert.equal(diff.needsTranslation.length, 0);
    assert.equal(diff.extra.length, 0);
    assert.equal(diff.toProcess.length, 0);
  });

  it('handles empty source with populated target', () => {
    const diff = diffLocale({}, { 'a': 'orphan', 'b': 'stale' });
    assert.equal(diff.missing.length, 0);
    assert.equal(diff.extra.length, 2);
  });

  it('handles empty target with populated source', () => {
    const source = { 'a': 'hello', 'b': 'world' };
    const diff = diffLocale(source, {});
    assert.equal(diff.missing.length, 2);
    assert.equal(diff.toProcess.length, 2);
  });

  it('does not double-count keys that are both missing AND [EN]-prefixed', () => {
    // A key can't be both missing AND [EN]-prefixed, because if it exists
    // with [EN] prefix, it's not missing. This tests the set logic.
    const source = { 'a': 'hello', 'b': 'world' };
    const target = { 'a': '[EN] hello' };
    const diff = diffLocale(source, target);
    // 'a' is in needsTranslation, 'b' is missing
    // toProcess should be 2, not 3
    assert.equal(diff.toProcess.length, 2);
  });

  it('handles values that accidentally look like fallback prefix', () => {
    // WHY: If a legitimate English value starts with "[EN] ",
    // it would be incorrectly flagged as needing translation
    const source = { 'key': '[EN] This is actually the real value' };
    const target = { 'key': '[EN] This is actually the real value' };
    const diff = diffLocale(source, target);
    // This IS a known limitation — it will flag it
    assert.equal(diff.needsTranslation.length, 1);
    // Documenting this as a known edge case
  });

  it('handles non-string values correctly (numbers, booleans, null)', () => {
    const source = { 'count': 42, 'active': true, 'nothing': null };
    const target = { 'count': 42, 'active': true, 'nothing': null };
    const diff = diffLocale(source, target);
    // Non-string values can't have [EN] prefix, should be clean
    assert.equal(diff.needsTranslation.length, 0);
    assert.equal(diff.toProcess.length, 0);
  });

  it('handles non-string values with [EN] prefix correctly', () => {
    const source = { 'count': 42 };
    const target = { 'count': '[EN] 42' }; // Somehow got stringified with prefix
    const diff = diffLocale(source, target);
    // The target has a string starting with [EN], so it's flagged
    assert.equal(diff.needsTranslation.length, 1);
  });
});

// =================================================================
// 4. CONFIG — Malformed inputs
// =================================================================
describe('RED TEAM: resolveConfig edge cases', () => {
  const tmpDir = path.join(import.meta.dirname, 'fixtures', '_tmp_config_test');

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('survives a completely malformed config file', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'i18n-rosetta.config.json'),
      'THIS IS NOT JSON AT ALL {{{',
      'utf-8'
    );
    // Should not throw — should fall back to defaults
    const config = resolveConfig({}, tmpDir);
    assert.equal(config.inputLocale, 'en');
    assert.equal(config.model, 'openai/gpt-4o-mini');
  });

  it('survives an empty config file', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'i18n-rosetta.config.json'),
      '',
      'utf-8'
    );
    // Empty string is not valid JSON, should fall back
    const config = resolveConfig({}, tmpDir);
    assert.equal(config.inputLocale, 'en');
  });

  it('survives a config with unexpected types', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'i18n-rosetta.config.json'),
      JSON.stringify({
        inputLocale: 12345,        // Should be string
        batchSize: 'not-a-number',  // Should be number
        languages: 'not-an-array',  // Should be array or object
      }),
      'utf-8'
    );
    // Should not throw
    const config = resolveConfig({}, tmpDir);
    assert.equal(config.inputLocale, 12345); // Passes through — no validation
  });

  it('handles config with extra unknown fields gracefully', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'i18n-rosetta.config.json'),
      JSON.stringify({
        inputLocale: 'en',
        unknownField: 'should be ignored',
        anotherRandom: { nested: true },
      }),
      'utf-8'
    );
    const config = resolveConfig({}, tmpDir);
    assert.equal(config.inputLocale, 'en');
    // Unknown fields pass through but shouldn't break anything
    assert.equal(config.unknownField, 'should be ignored');
  });

  it('handles object-style languages with mixed formats', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'i18n-rosetta.config.json'),
      JSON.stringify({
        languages: {
          fr: 'Custom French register',
          de: { name: 'Deutsch', register: 'Formal register' },
          xx: { register: 'Unknown language' },
          yy: 42, // Invalid type for language entry
        },
      }),
      'utf-8'
    );
    const config = resolveConfig({}, tmpDir);
    assert.equal(config.resolvedLanguages.fr.register, 'Custom French register');
    assert.equal(config.resolvedLanguages.de.name, 'Deutsch');
    assert.equal(config.resolvedLanguages.xx.name, 'xx'); // Falls back to code
    // yy with value 42 (number) should be skipped silently
    assert.equal(config.resolvedLanguages.yy, undefined);
  });
});

// =================================================================
// 5. CONFIG — generateConfigTemplate
// =================================================================
describe('RED TEAM: generateConfigTemplate', () => {
  it('produces valid JSON', () => {
    const template = generateConfigTemplate('./my-locales', 'es');
    assert.doesNotThrow(() => JSON.parse(template));
    const parsed = JSON.parse(template);
    assert.equal(parsed.inputLocale, 'es');
    assert.equal(parsed.localesDir, './my-locales');
  });

  it('uses defaults for undefined arguments', () => {
    const template = generateConfigTemplate(undefined, undefined);
    const parsed = JSON.parse(template);
    assert.equal(parsed.inputLocale, 'en');
    assert.equal(parsed.localesDir, './locales');
  });
});

// =================================================================
// 6. AUTO-DETECT — Edge cases
// =================================================================
describe('RED TEAM: autoDetectLanguages', () => {
  const tmpDir = path.join(import.meta.dirname, 'fixtures', '_tmp_detect_test');

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ignores non-locale files in locales directory', () => {
    fs.writeFileSync(path.join(tmpDir, 'fr.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'readme.txt'), 'not a locale');
    fs.writeFileSync(path.join(tmpDir, 'data.yaml'), 'also not');
    fs.writeFileSync(path.join(tmpDir, 'en.json'), '{}');

    const config = { inputLocale: 'en', localesDir: tmpDir };
    const detected = autoDetectLanguages(config);
    assert.ok(detected['fr'], 'Should detect fr.json');
    assert.ok(!detected['readme'], 'Should not detect txt files');
    // v2.0: YAML files are now valid locale formats and should be detected
    assert.ok(detected['data'], 'Should detect data.yaml as a locale file');
  });

  it('excludes source locale from detected languages', () => {
    fs.writeFileSync(path.join(tmpDir, 'en.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'fr.json'), '{}');

    const config = { inputLocale: 'en', localesDir: tmpDir };
    const detected = autoDetectLanguages(config);
    assert.ok(!detected['en'], 'Should not include source locale');
    assert.ok(detected['fr'], 'Should include non-source locales');
  });

  it('handles unknown language codes gracefully', () => {
    fs.writeFileSync(path.join(tmpDir, 'en.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'xx-custom.json'), '{}');

    const config = { inputLocale: 'en', localesDir: tmpDir };
    const detected = autoDetectLanguages(config);
    // Unknown codes should get the code itself as the name
    assert.equal(detected['xx-custom'].name, 'xx-custom');
    assert.equal(detected['xx-custom'].register, 'Professional register.');
  });

  it('handles empty locales directory', () => {
    const config = { inputLocale: 'en', localesDir: tmpDir };
    const detected = autoDetectLanguages(config);
    assert.deepEqual(detected, {});
  });

  it('handles nonexistent locales directory', () => {
    const config = { inputLocale: 'en', localesDir: '/tmp/does-not-exist-12345' };
    const detected = autoDetectLanguages(config);
    assert.deepEqual(detected, {});
  });
});

// =================================================================
// 7. SYNC — loadApiKey edge cases
// =================================================================
describe('RED TEAM: loadApiKey', () => {
  const tmpDir = path.join(import.meta.dirname, 'fixtures', '_tmp_apikey_test');


  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('strips double quotes from .env.local values', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.env.local'),
      'OPENROUTER_API_KEY="sk-or-v1-quoted-key"',
      'utf-8'
    );
    const key = loadApiKey({ apiKeyEnvVar: 'OPENROUTER_API_KEY' }, tmpDir);
    assert.equal(key, 'sk-or-v1-quoted-key');
  });

  it('strips single quotes from .env.local values', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.env.local'),
      "OPENROUTER_API_KEY='sk-or-v1-single-quoted'",
      'utf-8'
    );
    const key = loadApiKey({ apiKeyEnvVar: 'OPENROUTER_API_KEY' }, tmpDir);
    assert.equal(key, 'sk-or-v1-single-quoted');
  });

  it('skips comment lines in .env files', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.env.local'),
      '# This is a comment\n# OPENROUTER_API_KEY=wrong\nOPENROUTER_API_KEY=correct-key',
      'utf-8'
    );
    const key = loadApiKey({ apiKeyEnvVar: 'OPENROUTER_API_KEY' }, tmpDir);
    assert.equal(key, 'correct-key');
  });

  it('handles .env.local with blank lines', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.env.local'),
      '\n\n  \nOPENROUTER_API_KEY=key-with-blanks\n\n',
      'utf-8'
    );
    const key = loadApiKey({ apiKeyEnvVar: 'OPENROUTER_API_KEY' }, tmpDir);
    assert.equal(key, 'key-with-blanks');
  });

  it('falls back to .env when .env.local is missing', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.env'),
      'OPENROUTER_API_KEY=from-dotenv',
      'utf-8'
    );
    const key = loadApiKey({ apiKeyEnvVar: 'OPENROUTER_API_KEY' }, tmpDir);
    assert.equal(key, 'from-dotenv');
  });

  it('returns null when no key found anywhere', () => {
    const key = loadApiKey({ apiKeyEnvVar: 'OPENROUTER_API_KEY' }, tmpDir);
    assert.equal(key, null);
  });

  it('prefers environment variable over .env.local', () => {
    const saved = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'from-env-var';
    fs.writeFileSync(
      path.join(tmpDir, '.env.local'),
      'OPENROUTER_API_KEY=from-file',
      'utf-8'
    );
    try {
      const key = loadApiKey({ apiKeyEnvVar: 'OPENROUTER_API_KEY' }, tmpDir);
      assert.equal(key, 'from-env-var');
    } finally {
      if (saved) {
        process.env.OPENROUTER_API_KEY = saved;
      } else {
        delete process.env.OPENROUTER_API_KEY;
      }
    }
  });

  it('handles keys with equals signs in the value', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.env.local'),
      'OPENROUTER_API_KEY=sk-or-v1-key=with=equals',
      'utf-8'
    );
    const key = loadApiKey({ apiKeyEnvVar: 'OPENROUTER_API_KEY' }, tmpDir);
    assert.equal(key, 'sk-or-v1-key=with=equals');
  });

  it('handles export prefix in .env files', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.env.local'),
      'export OPENROUTER_API_KEY=sk-or-v1-exported-key',
      'utf-8'
    );
    const key = loadApiKey({ apiKeyEnvVar: 'OPENROUTER_API_KEY' }, tmpDir);
    assert.equal(key, 'sk-or-v1-exported-key');
  });

  it('handles export prefix combined with quotes', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.env.local'),
      'export OPENROUTER_API_KEY="sk-or-v1-export-quoted"',
      'utf-8'
    );
    const key = loadApiKey({ apiKeyEnvVar: 'OPENROUTER_API_KEY' }, tmpDir);
    assert.equal(key, 'sk-or-v1-export-quoted');
  });
});

// =================================================================
// 8. SYNC — Fallback mode with empty target files
// =================================================================
describe('RED TEAM: sync with empty/new locale files', () => {
  const tmpDir = path.join(import.meta.dirname, 'fixtures', '_tmp_empty_sync');

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    // Source with a few keys
    fs.writeFileSync(path.join(tmpDir, 'en.json'), JSON.stringify({
      greeting: 'Hello',
      farewell: 'Goodbye',
    }));
    // Empty target (brand new locale)
    fs.writeFileSync(path.join(tmpDir, 'fr.json'), '{}');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('populates an empty locale file with [EN]-prefixed fallbacks', async () => {
    const saved = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    const logs = [];
    const origLog = console.log;
    const origWrite = process.stdout.write;
    console.log = (...args) => logs.push(args.join(' '));
    process.stdout.write = (s) => logs.push(s);

    try {

      await runSync({
        cwd: import.meta.dirname,
        cliArgs: { dir: tmpDir, fallback: true },
      });

      const frUpdated = JSON.parse(fs.readFileSync(path.join(tmpDir, 'fr.json'), 'utf-8'));
      assert.equal(frUpdated.greeting, '[EN] Hello');
      assert.equal(frUpdated.farewell, '[EN] Goodbye');
    } finally {
      console.log = origLog;
      process.stdout.write = origWrite;
      if (saved) process.env.OPENROUTER_API_KEY = saved;
      else delete process.env.OPENROUTER_API_KEY;
    }
  });
});

// =================================================================
// 9. REGISTERS — Completeness and consistency
// =================================================================
describe('RED TEAM: registers integrity', () => {
  it('no register has an empty name', () => {
    for (const [code, reg] of Object.entries(DEFAULT_REGISTERS)) {
      assert.ok(reg.name.length > 0, `${code} has empty name`);
    }
  });

  it('no register has an empty register instruction', () => {
    for (const [code, reg] of Object.entries(DEFAULT_REGISTERS)) {
      assert.ok(reg.register.length > 0, `${code} has empty register`);
    }
  });

  it('register codes are unique', () => {
    const codes = Object.keys(DEFAULT_REGISTERS);
    const unique = new Set(codes);
    assert.equal(codes.length, unique.size, 'Duplicate register codes found');
  });

  it('register names are unique', () => {
    const names = Object.values(DEFAULT_REGISTERS).map(r => r.name);
    const unique = new Set(names);
    assert.equal(names.length, unique.size, 'Duplicate register names found');
  });
});

// =================================================================
// 10. CLI arg parser — Edge cases
// =================================================================
describe('RED TEAM: CLI arg parsing edge cases', () => {
  // Re-implement parseArgs locally since it's not exported
  function parseArgs(argv) {
    const args = { _: [] };
    for (let i = 2; i < argv.length; i++) {
      const arg = argv[i];
      if (arg.startsWith('--')) {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          args[key] = next;
          i++;
        } else {
          args[key] = true;
        }
      } else {
        args._.push(arg);
      }
    }
    return args;
  }

  it('handles --flag at end of argv (boolean)', () => {
    const args = parseArgs(['node', 'cli.js', 'sync', '--dry']);
    assert.equal(args.dry, true);
    assert.deepEqual(args._, ['sync']);
  });

  it('handles --key value pairs', () => {
    const args = parseArgs(['node', 'cli.js', '--model', 'anthropic/claude']);
    assert.equal(args.model, 'anthropic/claude');
  });

  it('handles multiple flags', () => {
    const args = parseArgs(['node', 'cli.js', 'sync', '--dry', '--model', 'x']);
    assert.equal(args.dry, true);
    assert.equal(args.model, 'x');
  });

  it('handles consecutive boolean flags', () => {
    const args = parseArgs(['node', 'cli.js', '--dry', '--verbose']);
    assert.equal(args.dry, true);
    assert.equal(args.verbose, true);
  });

  it('defaults to empty positionals', () => {
    const args = parseArgs(['node', 'cli.js']);
    assert.deepEqual(args._, []);
  });
});

// =================================================================
// 11. ROUND-TRIP — flatten → setNestedValue consistency
// =================================================================
describe('RED TEAM: flatten/unflatten round-trip', () => {
  it('round-trips a complex nested object', () => {
    const original = {
      nav: { home: 'Home', about: 'About', nested: { deep: 'Value' } },
      pages: { home: { title: 'Title', cta: 'Click' } },
      simple: 'Top-level',
    };

    const flat = flattenKeys(original);
    const rebuilt = {};
    for (const [key, value] of Object.entries(flat)) {
      setNestedValue(rebuilt, key, value);
    }

    assert.deepEqual(rebuilt, original);
  });

  it('round-trips with numeric and boolean values', () => {
    const original = {
      meta: { count: 42, active: true, empty: null },
    };

    const flat = flattenKeys(original);
    const rebuilt = {};
    for (const [key, value] of Object.entries(flat)) {
      setNestedValue(rebuilt, key, value);
    }

    assert.deepEqual(rebuilt, original);
  });
});

// =================================================================
// v1.3.0 — Security: Prototype pollution guard
// =================================================================
describe('RED TEAM: prototype pollution guard', () => {
  it('isUnsafeKey detects __proto__', () => {
    assert.equal(isUnsafeKey('__proto__'), true);
  });

  it('isUnsafeKey detects nested __proto__', () => {
    assert.equal(isUnsafeKey('some.path.__proto__.evil'), true);
  });

  it('isUnsafeKey detects constructor', () => {
    assert.equal(isUnsafeKey('constructor'), true);
  });

  it('isUnsafeKey detects prototype', () => {
    assert.equal(isUnsafeKey('some.prototype.method'), true);
  });

  it('isUnsafeKey allows normal keys', () => {
    assert.equal(isUnsafeKey('nav.home'), false);
    assert.equal(isUnsafeKey('pages.about.title'), false);
    assert.equal(isUnsafeKey('footer.copyright'), false);
  });

  it('isUnsafeKey allows keys that contain but are not equal to unsafe segments', () => {
    // "construction" contains "constructor" but isn't the segment itself
    assert.equal(isUnsafeKey('pages.construction.title'), false);
    assert.equal(isUnsafeKey('ui.prototyping.label'), false);
  });
});

// =================================================================
// v1.3.0 — buildPrompt: UI context and string-type hints
// =================================================================
describe('RED TEAM: buildPrompt v1.3.0 improvements', () => {
  const langConfig = { name: 'French', register: 'Formal French. Use vous-form.' };

  it('includes UI context in the prompt', () => {
    const prompt = buildPrompt({ 'nav.home': 'Home' }, langConfig);
    assert.ok(prompt.includes('UI strings for a web/mobile application'),
      'Prompt should mention UI context');
  });

  it('includes gender-neutrality instruction', () => {
    const prompt = buildPrompt({ 'nav.home': 'Home' }, langConfig);
    assert.ok(prompt.includes('gender-neutral'),
      'Prompt should include gender-neutrality guidance');
  });

  it('includes the register instruction', () => {
    const prompt = buildPrompt({ 'nav.home': 'Home' }, langConfig);
    assert.ok(prompt.includes('Formal French. Use vous-form.'),
      'Prompt should include the register');
  });

  it('includes the JSON payload', () => {
    const prompt = buildPrompt({ 'nav.home': 'Home' }, langConfig);
    assert.ok(prompt.includes('"nav.home"'),
      'Prompt should include the key');
    assert.ok(prompt.includes('"Home"'),
      'Prompt should include the value');
  });

  it('includes UI element type instruction', () => {
    const prompt = buildPrompt({ 'nav.home': 'Home' }, langConfig);
    assert.ok(prompt.includes('button labels should be concise'),
      'Prompt should include UI element type guidance');
  });
});

// =================================================================
// v1.3.0 — inferKeyTypes: string-type inference from key names
// =================================================================
describe('RED TEAM: inferKeyTypes', () => {
  it('detects button keys', () => {
    const hints = inferKeyTypes({ 'form.submitBtn': 'Submit' });
    assert.equal(hints.length, 1);
    assert.ok(hints[0].includes('button label'));
  });

  it('detects CTA keys', () => {
    const hints = inferKeyTypes({ 'hero.cta': 'Get Started' });
    assert.equal(hints.length, 1);
    assert.ok(hints[0].includes('button label'));
  });

  it('detects title/heading keys', () => {
    const hints = inferKeyTypes({ 'pages.about.title': 'About Us' });
    assert.equal(hints.length, 1);
    assert.ok(hints[0].includes('heading'));
  });

  it('detects description keys', () => {
    const hints = inferKeyTypes({ 'meta.description': 'A great app' });
    assert.equal(hints.length, 1);
    assert.ok(hints[0].includes('description'));
  });

  it('detects error message keys', () => {
    const hints = inferKeyTypes({ 'form.email.error': 'Invalid email' });
    assert.equal(hints.length, 1);
    assert.ok(hints[0].includes('error'));
  });

  it('detects placeholder keys', () => {
    const hints = inferKeyTypes({ 'search.placeholder': 'Search...' });
    assert.equal(hints.length, 1);
    assert.ok(hints[0].includes('placeholder'));
  });

  it('detects navigation keys', () => {
    const hints = inferKeyTypes({ 'nav.dashboard': 'Dashboard' });
    assert.equal(hints.length, 1);
    assert.ok(hints[0].includes('navigation'));
  });

  it('detects tooltip keys', () => {
    const hints = inferKeyTypes({ 'settings.darkMode.tooltip': 'Toggle dark mode' });
    assert.equal(hints.length, 1);
    assert.ok(hints[0].includes('tooltip'));
  });

  it('returns empty for generic keys', () => {
    const hints = inferKeyTypes({ 'app.version': '1.0.0' });
    assert.equal(hints.length, 0, 'Generic keys should not get type hints');
  });

  it('handles multiple keys with mixed types', () => {
    const hints = inferKeyTypes({
      'form.submitBtn': 'Submit',
      'pages.title': 'Welcome',
      'app.version': '1.0.0',
      'form.email.placeholder': 'Enter email',
    });
    // 3 of 4 keys should match (app.version is generic)
    assert.equal(hints.length, 3);
  });

  it('first match wins for ambiguous keys', () => {
    // "submit" matches button pattern — should not also match label
    const hints = inferKeyTypes({ 'form.submit': 'Go' });
    assert.equal(hints.length, 1);
    assert.ok(hints[0].includes('button'));
  });
});

// =================================================================
// v1.3.0 — Register completeness (enriched + new languages)
// =================================================================
describe('RED TEAM: v1.3.0 register enhancements', () => {
  it('Filipino register includes code-switching guidance', () => {
    const tl = DEFAULT_REGISTERS['tl'];
    assert.ok(tl, 'tl register should exist');
    assert.ok(tl.register.toLowerCase().includes('taglish'),
      'Filipino register should mention Taglish code-switching');
  });

  it('RTL registers mention script direction', () => {
    const rtlCodes = ['ar', 'fa', 'he', 'ur'];
    for (const code of rtlCodes) {
      const reg = DEFAULT_REGISTERS[code];
      assert.ok(reg, `${code} register should exist`);
      assert.ok(
        reg.register.toLowerCase().includes('right-to-left') || reg.register.includes('RTL'),
        `${code} register should mention RTL script direction`
      );
    }
  });

  it('new v1.3.0 languages are present', () => {
    const newLangs = ['bg', 'cs', 'da', 'fi', 'sk'];
    for (const code of newLangs) {
      const reg = DEFAULT_REGISTERS[code];
      assert.ok(reg, `${code} register should exist`);
      assert.ok(reg.name, `${code} should have a name`);
      assert.ok(reg.register, `${code} should have a register`);
    }
  });

  it('contains 35+ language definitions after v1.3.0 expansion', () => {
    const count = Object.keys(DEFAULT_REGISTERS).length;
    assert.ok(count >= 35, `Expected 35+ registers, got ${count}`);
  });

  it('Japanese register mentions formality nuance', () => {
    const ja = DEFAULT_REGISTERS['ja'];
    assert.ok(ja.register.includes('です/ます'), 'Should mention polite form');
    assert.ok(
      ja.register.toLowerCase().includes('plain form') || ja.register.includes('する'),
      'Should mention plain form for short UI elements'
    );
  });

  it('gendered European registers include inclusivity guidance', () => {
    const genderedCodes = ['fr', 'es', 'de', 'it', 'pt'];
    for (const code of genderedCodes) {
      const reg = DEFAULT_REGISTERS[code];
      assert.ok(reg, `${code} register should exist`);
      assert.ok(
        reg.register.toLowerCase().includes('gender') || reg.register.toLowerCase().includes('inclusi'),
        `${code} register should include gender/inclusivity guidance`
      );
    }
  });
});
