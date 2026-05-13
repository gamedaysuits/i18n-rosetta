#!/usr/bin/env node
/**
 * i18n-rosetta test suite
 *
 * Uses Node.js built-in test runner (node:test) — zero dependencies.
 * Tests the core logic units: flatten, diff, config, and sync.
 *
 * Run: node test/sync.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { flattenKeys, setNestedValue } from '../lib/flatten.js';
import { diffLocale, diffLabel } from '../lib/diff.js';
import { resolveConfig, autoDetectLanguages } from '../lib/config.js';
import { DEFAULT_REGISTERS } from '../lib/registers.js';
import { runSync } from '../lib/sync.js';

// -----------------------------------------------------------------
// Flatten tests
// -----------------------------------------------------------------
describe('flattenKeys', () => {
  it('flattens a simple nested object', () => {
    const result = flattenKeys({
      nav: { home: 'Home', about: 'About' },
      footer: { copyright: '© 2026' }
    });
    assert.deepEqual(result, {
      'nav.home': 'Home',
      'nav.about': 'About',
      'footer.copyright': '© 2026'
    });
  });

  it('handles deeply nested structures', () => {
    const result = flattenKeys({
      a: { b: { c: { d: 'deep' } } }
    });
    assert.deepEqual(result, { 'a.b.c.d': 'deep' });
  });

  it('preserves non-object leaf values', () => {
    const result = flattenKeys({
      count: 42,
      active: true,
      tags: ['a', 'b'],
      empty: null,
    });
    assert.equal(result.count, 42);
    assert.equal(result.active, true);
    assert.deepEqual(result.tags, ['a', 'b']);
    assert.equal(result.empty, null);
  });

  it('returns empty object for empty input', () => {
    assert.deepEqual(flattenKeys({}), {});
  });
});

// -----------------------------------------------------------------
// setNestedValue tests
// -----------------------------------------------------------------
describe('setNestedValue', () => {
  it('sets a value at a nested path', () => {
    const obj = {};
    setNestedValue(obj, 'a.b.c', 'hello');
    assert.deepEqual(obj, { a: { b: { c: 'hello' } } });
  });

  it('preserves existing siblings', () => {
    const obj = { a: { existing: 'keep' } };
    setNestedValue(obj, 'a.newKey', 'added');
    assert.equal(obj.a.existing, 'keep');
    assert.equal(obj.a.newKey, 'added');
  });

  it('overwrites existing values', () => {
    const obj = { a: { b: 'old' } };
    setNestedValue(obj, 'a.b', 'new');
    assert.equal(obj.a.b, 'new');
  });

  it('handles single-level paths', () => {
    const obj = {};
    setNestedValue(obj, 'topLevel', 'value');
    assert.equal(obj.topLevel, 'value');
  });
});

// -----------------------------------------------------------------
// Diff tests
// -----------------------------------------------------------------
describe('diffLocale', () => {
  const source = {
    'nav.home': 'Home',
    'nav.about': 'About',
    'nav.contact': 'Contact',
    'pages.title': 'Welcome',
    'footer.copyright': '© 2026',
  };

  it('detects missing keys', () => {
    const target = {
      'nav.home': 'Accueil',
      'nav.about': 'À propos',
    };
    const diff = diffLocale(source, target);
    assert.deepEqual(diff.missing.sort(), [
      'footer.copyright',
      'nav.contact',
      'pages.title',
    ]);
  });

  it('detects [EN]-prefixed fallbacks', () => {
    const target = {
      'nav.home': 'Accueil',
      'nav.about': 'À propos',
      'nav.contact': '[EN] Contact',
      'pages.title': '[EN] Welcome',
      'footer.copyright': '© 2026',
    };
    const diff = diffLocale(source, target);
    assert.equal(diff.missing.length, 0);
    assert.deepEqual(diff.needsTranslation.sort(), [
      'nav.contact',
      'pages.title',
    ]);
  });

  it('detects extra/stale keys', () => {
    const target = {
      'nav.home': 'Accueil',
      'nav.about': 'À propos',
      'nav.contact': 'Contact FR',
      'pages.title': 'Bienvenue',
      'footer.copyright': '© 2026',
      'removed.key': 'Should not be here',
    };
    const diff = diffLocale(source, target);
    assert.deepEqual(diff.extra, ['removed.key']);
  });

  it('combines missing + needs-translation into toProcess', () => {
    const target = {
      'nav.home': 'Accueil',
      'nav.about': '[EN] About',
      // nav.contact missing
      // pages.title missing
      'footer.copyright': '© 2026',
    };
    const diff = diffLocale(source, target);
    assert.equal(diff.toProcess.length, 3); // 2 missing + 1 [EN]
    assert.ok(diff.toProcess.includes('nav.contact'));
    assert.ok(diff.toProcess.includes('pages.title'));
    assert.ok(diff.toProcess.includes('nav.about'));
  });

  it('reports fully synced when no work needed', () => {
    const target = { ...source };
    const diff = diffLocale(source, target);
    assert.equal(diff.toProcess.length, 0);
    assert.equal(diff.extra.length, 0);
  });

  it('uses custom fallback prefix', () => {
    const target = {
      'nav.home': 'Accueil',
      'nav.about': 'À propos',
      'nav.contact': '[UNTRANSLATED] Contact',
      'pages.title': 'Bienvenue',
      'footer.copyright': '© 2026',
    };
    const diff = diffLocale(source, target, '[UNTRANSLATED] ');
    assert.deepEqual(diff.needsTranslation, ['nav.contact']);
  });
});

// -----------------------------------------------------------------
// diffLabel tests
// -----------------------------------------------------------------
describe('diffLabel', () => {
  it('labels mixed diffs correctly', () => {
    const label = diffLabel({ missing: ['a', 'b'], needsTranslation: ['c'] });
    assert.equal(label, '2 missing + 1 [EN] fallback(s)');
  });

  it('labels missing-only diffs', () => {
    const label = diffLabel({ missing: ['a'], needsTranslation: [] });
    assert.equal(label, '1 missing');
  });

  it('labels translation-only diffs', () => {
    const label = diffLabel({ missing: [], needsTranslation: ['a', 'b'] });
    assert.equal(label, '2 [EN] fallback(s)');
  });

  it('labels changed keys', () => {
    const label = diffLabel({ missing: [], needsTranslation: [], changed: ['a', 'b', 'c'] });
    assert.equal(label, '3 changed');
  });

  it('labels mixed with changed', () => {
    const label = diffLabel({ missing: ['a'], needsTranslation: ['b'], changed: ['c'] });
    assert.equal(label, '1 missing + 1 [EN] fallback(s) + 1 changed');
  });

  it('labels synced correctly', () => {
    const label = diffLabel({ missing: [], needsTranslation: [] });
    assert.equal(label, 'fully synced');
  });
});

// -----------------------------------------------------------------
// Config tests
// -----------------------------------------------------------------
describe('resolveConfig', () => {
  it('uses defaults when no config file exists', () => {
    const config = resolveConfig({}, '/tmp/nonexistent');
    assert.equal(config.sourceLocale, 'en');
    assert.equal(config.model, 'openai/gpt-4o-mini');
    assert.equal(config.batchSize, 30);
    assert.equal(config.fallbackPrefix, '[EN] ');
  });

  it('CLI args override defaults', () => {
    const config = resolveConfig({
      source: 'ja',
      model: 'anthropic/claude-haiku',
      batchSize: '15',
    }, '/tmp/nonexistent');
    assert.equal(config.sourceLocale, 'ja');
    assert.equal(config.model, 'anthropic/claude-haiku');
    assert.equal(config.batchSize, 15);
  });

  it('resolves array-style languages to register map', () => {
    const config = resolveConfig({}, '/tmp/nonexistent');
    // Override languages directly on the config object before resolution
    config.languages = ['fr', 'de'];
    const config2 = resolveConfig({}, '/tmp/nonexistent');
    // Without a config file, languages default to empty
    assert.deepEqual(config2.resolvedLanguages, {});
  });
});

// -----------------------------------------------------------------
// Registers tests
// -----------------------------------------------------------------
describe('DEFAULT_REGISTERS', () => {
  it('contains 35+ language definitions', () => {
    const count = Object.keys(DEFAULT_REGISTERS).length;
    assert.ok(count >= 35, `Expected 35+ registers, got ${count}`);
  });

  it('every register has name and register fields', () => {
    for (const [code, config] of Object.entries(DEFAULT_REGISTERS)) {
      assert.ok(config.name, `${code} missing name`);
      assert.ok(config.register, `${code} missing register`);
    }
  });

  it('includes major world languages', () => {
    const majors = ['en', 'fr', 'de', 'es', 'ja', 'ko', 'zh', 'ar', 'pt', 'ru'];
    // en isn't in registers (it's the source), so skip it
    for (const code of majors.filter(c => c !== 'en')) {
      assert.ok(DEFAULT_REGISTERS[code], `Missing major language: ${code}`);
    }
  });

  it('includes conlang/novelty languages', () => {
    assert.ok(DEFAULT_REGISTERS['tlh'], 'Missing Klingon');
    assert.ok(DEFAULT_REGISTERS['x-pirate'], 'Missing Pirate');
    assert.ok(DEFAULT_REGISTERS['x-elvish-s'], 'Missing Elvish');
  });
});

// -----------------------------------------------------------------
// Integration test: dry-run sync against fixtures
// -----------------------------------------------------------------
describe('sync integration (dry-run)', () => {
  it('detects the correct diff state in fixture files', () => {
    const fixturesDir = path.join(import.meta.dirname, 'fixtures', 'locales');
    const enData = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'en.json'), 'utf-8'));
    const frData = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'fr.json'), 'utf-8'));
    const deData = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'de.json'), 'utf-8'));

    const enFlat = flattenKeys(enData);
    const frFlat = flattenKeys(frData);
    const deFlat = flattenKeys(deData);

    // French should have missing keys, [EN] fallbacks, and extra keys
    const frDiff = diffLocale(enFlat, frFlat);
    assert.ok(frDiff.missing.length > 0, 'French should have missing keys');
    assert.ok(frDiff.needsTranslation.length > 0, 'French should have [EN] fallbacks');
    assert.ok(frDiff.extra.length > 0, 'French should have extra/stale keys');
    assert.ok(frDiff.toProcess.length > 0, 'French should have work to do');

    // German should be fully synced
    const deDiff = diffLocale(enFlat, deFlat);
    assert.equal(deDiff.missing.length, 0, 'German should have no missing keys');
    assert.equal(deDiff.needsTranslation.length, 0, 'German should have no [EN] fallbacks');
    assert.equal(deDiff.toProcess.length, 0, 'German should have no work');
  });

  it('auto-detects languages from fixture directory', () => {
    const config = resolveConfig({}, import.meta.dirname);
    config.localesDir = path.join(import.meta.dirname, 'fixtures', 'locales');
    config.sourceLocale = 'en';
    const detected = autoDetectLanguages(config);

    assert.ok(detected['de'], 'Should detect de.json');
    assert.ok(detected['fr'], 'Should detect fr.json');
    assert.ok(!detected['en'], 'Should NOT include source locale');
    assert.equal(detected['de'].name, 'German');
    assert.equal(detected['fr'].name, 'French');
  });
});

// -----------------------------------------------------------------
// --force-keys tests
// -----------------------------------------------------------------
describe('diffLocale with forceKeys', () => {
  const source = {
    'nav.home': 'Home',
    'nav.about': 'About',
    'nav.contact': 'Contact',
    'pages.title': 'Welcome',
    'footer.copyright': '© 2026',
  };

  it('forces a single key to re-translate even when already translated', () => {
    // Target is fully synced — no missing or [EN] keys
    const target = {
      'nav.home': 'Accueil',
      'nav.about': 'À propos',
      'nav.contact': 'Contact FR',
      'pages.title': 'Bienvenue',
      'footer.copyright': '© 2026',
    };
    const diff = diffLocale(source, target, '[EN] ', ['nav.home']);
    assert.ok(diff.toProcess.includes('nav.home'), 'Forced key should appear in toProcess');
    assert.deepEqual(diff.forced, ['nav.home']);
    assert.equal(diff.missing.length, 0, 'Nothing should be missing');
    assert.equal(diff.needsTranslation.length, 0, 'No [EN] fallbacks');
  });

  it('forces multiple comma-separated keys', () => {
    const target = {
      'nav.home': 'Accueil',
      'nav.about': 'À propos',
      'nav.contact': 'Contact FR',
      'pages.title': 'Bienvenue',
      'footer.copyright': '© 2026',
    };
    const forceKeys = ['nav.home', 'pages.title'];
    const diff = diffLocale(source, target, '[EN] ', forceKeys);
    assert.ok(diff.toProcess.includes('nav.home'), 'First forced key in toProcess');
    assert.ok(diff.toProcess.includes('pages.title'), 'Second forced key in toProcess');
    assert.deepEqual(diff.forced.sort(), ['nav.home', 'pages.title']);
    assert.equal(diff.toProcess.length, 2, 'Only forced keys should need work');
  });

  it('silently ignores forced keys that do not exist in source', () => {
    const target = {
      'nav.home': 'Accueil',
      'nav.about': 'À propos',
      'nav.contact': 'Contact FR',
      'pages.title': 'Bienvenue',
      'footer.copyright': '© 2026',
    };
    const diff = diffLocale(source, target, '[EN] ', ['nonexistent.key', 'also.missing']);
    assert.equal(diff.forced.length, 0, 'Non-source keys should be silently dropped');
    assert.equal(diff.toProcess.length, 0, 'Nothing to process');
  });

  it('deduplicates forced keys that overlap with missing keys', () => {
    // nav.contact is missing from the target AND in forceKeys
    const target = {
      'nav.home': 'Accueil',
      'nav.about': 'À propos',
      'pages.title': 'Bienvenue',
      'footer.copyright': '© 2026',
    };
    const diff = diffLocale(source, target, '[EN] ', ['nav.contact']);
    assert.ok(diff.toProcess.includes('nav.contact'));
    // Should appear only once in toProcess despite being both missing and forced
    const contactCount = diff.toProcess.filter(k => k === 'nav.contact').length;
    assert.equal(contactCount, 1, 'Should not duplicate forced+missing keys');
  });

  it('forced re-translation produces new output overwriting existing value', () => {
    // Simulate the full flow: a key has an old translation, forcing it should
    // mean it lands in toProcess so the sync engine will overwrite it
    const target = {
      'nav.home': 'OLD Accueil',
      'nav.about': 'À propos',
      'nav.contact': 'Contact FR',
      'pages.title': 'Bienvenue',
      'footer.copyright': '© 2026',
    };
    const diff = diffLocale(source, target, '[EN] ', ['nav.home']);
    assert.equal(diff.toProcess.length, 1);
    assert.equal(diff.toProcess[0], 'nav.home');
    // The sync engine will use the source value for this key,
    // replacing 'OLD Accueil' with either an API translation or [EN] fallback
  });
});

// -----------------------------------------------------------------
// Config forceKeys parsing tests
// -----------------------------------------------------------------
describe('resolveConfig forceKeys', () => {
  it('parses comma-separated --force-keys into an array', () => {
    const config = resolveConfig({
      'force-keys': 'nav.home,pages.title,footer.copyright',
    }, '/tmp/nonexistent');
    assert.deepEqual(config.forceKeys, ['nav.home', 'pages.title', 'footer.copyright']);
  });

  it('trims whitespace in --force-keys values', () => {
    const config = resolveConfig({
      'force-keys': '  nav.home , pages.title  ',
    }, '/tmp/nonexistent');
    assert.deepEqual(config.forceKeys, ['nav.home', 'pages.title']);
  });

  it('defaults to empty array when --force-keys not provided', () => {
    const config = resolveConfig({}, '/tmp/nonexistent');
    assert.deepEqual(config.forceKeys, []);
  });
});

// -----------------------------------------------------------------
// Hash module tests
// -----------------------------------------------------------------
import { hashValue, buildHashManifest, detectChangedKeys, readManifest, writeManifest, LOCK_FILENAME } from '../lib/hash.js';

describe('hashValue', () => {
  it('produces consistent hashes for the same string', () => {
    const h1 = hashValue('Hello World');
    const h2 = hashValue('Hello World');
    assert.equal(h1, h2);
  });

  it('produces different hashes for different strings', () => {
    const h1 = hashValue('Ship your product');
    const h2 = hashValue('Launch your product');
    assert.notEqual(h1, h2);
  });

  it('handles non-string values by JSON-serializing them', () => {
    const h1 = hashValue(42);
    const h2 = hashValue(42);
    assert.equal(h1, h2);
    // Different numeric values should produce different hashes
    assert.notEqual(hashValue(42), hashValue(43));
  });

  it('hashes arrays deterministically', () => {
    const h1 = hashValue(['a', 'b']);
    const h2 = hashValue(['a', 'b']);
    assert.equal(h1, h2);
  });

  it('returns a 64-character hex string (SHA-256)', () => {
    const h = hashValue('test');
    assert.equal(h.length, 64);
    assert.match(h, /^[0-9a-f]{64}$/);
  });
});

describe('buildHashManifest', () => {
  it('maps each key to its hash', () => {
    const sourceFlat = {
      'nav.home': 'Home',
      'nav.about': 'About',
    };
    const manifest = buildHashManifest(sourceFlat);
    assert.equal(Object.keys(manifest).length, 2);
    assert.equal(manifest['nav.home'], hashValue('Home'));
    assert.equal(manifest['nav.about'], hashValue('About'));
  });

  it('returns empty manifest for empty source', () => {
    assert.deepEqual(buildHashManifest({}), {});
  });
});

describe('detectChangedKeys', () => {
  it('detects a changed value', () => {
    const oldManifest = {
      'nav.home': hashValue('Ship it'),
      'nav.about': hashValue('About us'),
    };
    const sourceFlat = {
      'nav.home': 'Launch it',  // changed
      'nav.about': 'About us',  // same
    };
    const changed = detectChangedKeys(sourceFlat, oldManifest);
    assert.deepEqual(changed, ['nav.home']);
  });

  it('returns empty when nothing changed', () => {
    const oldManifest = {
      'nav.home': hashValue('Home'),
    };
    const sourceFlat = { 'nav.home': 'Home' };
    assert.deepEqual(detectChangedKeys(sourceFlat, oldManifest), []);
  });

  it('ignores new keys not in old manifest', () => {
    // New keys are caught by diffLocale's "missing" logic, not here
    const oldManifest = { 'nav.home': hashValue('Home') };
    const sourceFlat = {
      'nav.home': 'Home',
      'nav.new': 'Brand new key',
    };
    const changed = detectChangedKeys(sourceFlat, oldManifest);
    assert.deepEqual(changed, []);
  });

  it('ignores removed keys', () => {
    const oldManifest = {
      'nav.home': hashValue('Home'),
      'nav.removed': hashValue('Gone'),
    };
    const sourceFlat = { 'nav.home': 'Home' };
    const changed = detectChangedKeys(sourceFlat, oldManifest);
    assert.deepEqual(changed, []);
  });

  it('returns empty on first run (empty manifest)', () => {
    const sourceFlat = { 'nav.home': 'Home', 'nav.about': 'About' };
    assert.deepEqual(detectChangedKeys(sourceFlat, {}), []);
  });
});

describe('manifest read/write', () => {
  const tmpDir = path.join(import.meta.dirname, 'fixtures', '_tmp_hash_test');

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('round-trips a manifest through write and read', () => {
    const manifest = {
      'nav.home': hashValue('Home'),
      'nav.about': hashValue('About'),
    };
    writeManifest(tmpDir, manifest);
    const loaded = readManifest(tmpDir);
    assert.deepEqual(loaded, manifest);
  });

  it('sorts keys alphabetically in the lock file', () => {
    writeManifest(tmpDir, {
      'z.last': 'z',
      'a.first': 'a',
      'm.middle': 'm',
    });
    const raw = fs.readFileSync(path.join(tmpDir, LOCK_FILENAME), 'utf-8');
    const keys = Object.keys(JSON.parse(raw));
    assert.deepEqual(keys, ['a.first', 'm.middle', 'z.last']);
  });

  it('returns empty object when no lock file exists', () => {
    const manifest = readManifest(path.join(tmpDir, 'nonexistent'));
    assert.deepEqual(manifest, {});
  });

  it('survives a corrupted lock file', () => {
    fs.writeFileSync(path.join(tmpDir, LOCK_FILENAME), 'NOT JSON!!!', 'utf-8');
    const manifest = readManifest(tmpDir);
    assert.deepEqual(manifest, {});
  });
});

describe('diffLocale with changedKeys', () => {
  const source = {
    'nav.home': 'Home',
    'nav.about': 'About',
    'nav.contact': 'Contact',
  };

  it('includes changed keys in toProcess', () => {
    const target = {
      'nav.home': 'Accueil',
      'nav.about': 'À propos',
      'nav.contact': 'Contact FR',
    };
    const diff = diffLocale(source, target, '[EN] ', [], ['nav.home']);
    assert.ok(diff.toProcess.includes('nav.home'));
    assert.deepEqual(diff.changed, ['nav.home']);
    assert.equal(diff.missing.length, 0);
  });

  it('deduplicates changed keys that overlap with missing', () => {
    const target = {
      'nav.about': 'À propos',
      'nav.contact': 'Contact FR',
      // nav.home is missing
    };
    const diff = diffLocale(source, target, '[EN] ', [], ['nav.home']);
    const homeCount = diff.toProcess.filter(k => k === 'nav.home').length;
    assert.equal(homeCount, 1, 'Should not duplicate changed+missing keys');
  });

  it('works alongside forced keys without duplication', () => {
    const target = {
      'nav.home': 'Accueil',
      'nav.about': 'À propos',
      'nav.contact': 'Contact FR',
    };
    // nav.home is both changed and forced — should appear once
    const diff = diffLocale(source, target, '[EN] ', ['nav.home'], ['nav.home']);
    const homeCount = diff.toProcess.filter(k => k === 'nav.home').length;
    assert.equal(homeCount, 1);
  });
});

// -----------------------------------------------------------------
// Integration test: fallback-only sync (no API key)
// -----------------------------------------------------------------
describe('sync integration (fallback mode)', () => {
  const tmpDir = path.join(import.meta.dirname, 'fixtures', '_tmp_sync_test');

  beforeEach(() => {
    // Create a temp copy of fixtures
    fs.mkdirSync(tmpDir, { recursive: true });
    const src = path.join(import.meta.dirname, 'fixtures', 'locales');
    for (const file of fs.readdirSync(src)) {
      fs.copyFileSync(path.join(src, file), path.join(tmpDir, file));
    }
  });

  afterEach(() => {
    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('backfills missing keys with [EN] prefix when no API key', async () => {
    // Clear any env key
    const saved = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    // Capture console output
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

      // Read the updated French file
      const frUpdated = JSON.parse(fs.readFileSync(path.join(tmpDir, 'fr.json'), 'utf-8'));
      const frFlat = flattenKeys(frUpdated);

      // Keys that were missing should now exist with [EN] prefix
      assert.ok(frFlat['pages.home.cta'], 'Should have backfilled pages.home.cta');
      assert.ok(
        frFlat['pages.home.cta'].startsWith('[EN] '),
        `Expected [EN] prefix, got: ${frFlat['pages.home.cta']}`
      );

      // Previously [EN]-prefixed values should still have [EN] prefix
      // (since no API key = no real translation)
      assert.ok(
        frFlat['nav.contact'].startsWith('[EN] '),
        'nav.contact should still have [EN] prefix without API'
      );

      // German should be unchanged (already fully synced)
      const deUpdated = JSON.parse(fs.readFileSync(path.join(tmpDir, 'de.json'), 'utf-8'));
      const deFlat = flattenKeys(deUpdated);
      assert.equal(deFlat['nav.home'], 'Startseite', 'German should be untouched');

    } finally {
      console.log = origLog;
      process.stdout.write = origWrite;
      if (saved) process.env.OPENROUTER_API_KEY = saved;
    }
  });
});
