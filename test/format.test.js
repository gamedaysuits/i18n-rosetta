#!/usr/bin/env node
/**
 * Format adapter test suite — TOML and YAML parsing/serialization.
 * Run: node test/format.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  detectFormat,
  detectFormatFromDir,
  getExtension,
  readLocaleFile,
  parseTOMLToFlat,
  parseYAMLToFlat,
  flatToTOML,
  flatToYAML,
  groupFlatKeys,
  sectionsToFlat,
} from '../lib/format.js';

// =================================================================
// 1. Format detection
// =================================================================
describe('Format detection', () => {
  it('detects TOML from file extension', () => {
    assert.equal(detectFormat('en.toml'), 'toml');
    assert.equal(detectFormat('/path/to/i18n/fr.toml'), 'toml');
  });

  it('detects YAML from .yaml extension', () => {
    assert.equal(detectFormat('en.yaml'), 'yaml');
  });

  it('detects YAML from .yml extension', () => {
    assert.equal(detectFormat('en.yml'), 'yaml');
  });

  it('defaults to JSON for .json and unknown extensions', () => {
    assert.equal(detectFormat('en.json'), 'json');
    assert.equal(detectFormat('en.txt'), 'json');
    assert.equal(detectFormat('en'), 'json');
  });

  it('returns correct file extensions', () => {
    assert.equal(getExtension('toml'), '.toml');
    assert.equal(getExtension('yaml'), '.yaml');
    assert.equal(getExtension('json'), '.json');
  });

  it('detects format from directory contents', () => {
    const hugoDir = path.join(import.meta.dirname, 'fixtures', 'hugo-i18n');
    assert.equal(detectFormatFromDir(hugoDir), 'toml');

    const yamlDir = path.join(import.meta.dirname, 'fixtures', 'yaml-locales');
    assert.equal(detectFormatFromDir(yamlDir), 'yaml');
  });

  it('defaults to JSON for nonexistent directory', () => {
    assert.equal(detectFormatFromDir('/tmp/does-not-exist-12345'), 'json');
  });
});

// =================================================================
// 2. TOML parsing
// =================================================================
describe('TOML parsing', () => {
  it('parses simple Hugo i18n TOML', () => {
    const toml = `[home]\nother = "Home"\n\n[about]\nother = "About Us"\n`;
    const flat = parseTOMLToFlat(toml);
    assert.equal(flat['home'], 'Home');
    assert.equal(flat['about'], 'About Us');
  });

  it('parses plural forms as dotted sub-keys', () => {
    const toml = `[items]\none = "{{ .Count }} item"\nother = "{{ .Count }} items"\n`;
    const flat = parseTOMLToFlat(toml);
    assert.equal(flat['items.one'], '{{ .Count }} item');
    assert.equal(flat['items.other'], '{{ .Count }} items');
    // Should NOT have a bare "items" key
    assert.equal(flat['items'], undefined);
  });

  it('handles three+ plural forms', () => {
    const toml = `[comments]\nzero = "No comments"\none = "1 comment"\nother = "{{ .Count }} comments"\n`;
    const flat = parseTOMLToFlat(toml);
    assert.equal(flat['comments.zero'], 'No comments');
    assert.equal(flat['comments.one'], '1 comment');
    assert.equal(flat['comments.other'], '{{ .Count }} comments');
  });

  it('skips comment lines', () => {
    const toml = `# This is a comment\n[home]\n# Another comment\nother = "Home"\n`;
    const flat = parseTOMLToFlat(toml);
    assert.equal(flat['home'], 'Home');
  });

  it('handles escaped quotes in values', () => {
    const toml = `[quote]\nother = "She said \\"hello\\""\n`;
    const flat = parseTOMLToFlat(toml);
    assert.equal(flat['quote'], 'She said "hello"');
  });

  it('handles single-quoted values (TOML literal strings)', () => {
    const toml = `[path]\nother = 'C:\\Users\\test'\n`;
    const flat = parseTOMLToFlat(toml);
    assert.equal(flat['path'], 'C:\\Users\\test');
  });

  it('handles empty TOML content', () => {
    const flat = parseTOMLToFlat('');
    assert.deepEqual(flat, {});
  });

  it('handles TOML with only comments', () => {
    const flat = parseTOMLToFlat('# Just a comment\n# Another one\n');
    assert.deepEqual(flat, {});
  });

  it('reads the Hugo fixture file correctly', () => {
    const fixturePath = path.join(import.meta.dirname, 'fixtures', 'hugo-i18n', 'en.toml');
    const flat = readLocaleFile(fixturePath, 'toml');
    assert.equal(flat['home'], 'Home');
    assert.equal(flat['welcome'], 'Welcome to our website');
    assert.equal(flat['items.one'], '{{ .Count }} item');
    assert.equal(flat['items.other'], '{{ .Count }} items');
  });

  it('returns empty object for nonexistent file', () => {
    const flat = readLocaleFile('/tmp/nope.toml', 'toml');
    assert.deepEqual(flat, {});
  });
});

// =================================================================
// 3. TOML serialization
// =================================================================
describe('TOML serialization', () => {
  it('serializes simple keys with [section] + other', () => {
    const toml = flatToTOML({ home: 'Home', about: 'About Us' });
    assert.ok(toml.includes('[home]'));
    assert.ok(toml.includes('other = "Home"'));
    assert.ok(toml.includes('[about]'));
    assert.ok(toml.includes('other = "About Us"'));
  });

  it('serializes plural keys under one section', () => {
    const toml = flatToTOML({ 'items.one': '1 item', 'items.other': '{{ .Count }} items' });
    assert.ok(toml.includes('[items]'));
    assert.ok(toml.includes('one = "1 item"'));
    assert.ok(toml.includes('other = "{{ .Count }} items"'));
    // Should NOT have [items.one] or [items.other] sections
    assert.ok(!toml.includes('[items.one]'));
  });

  it('escapes double quotes in values', () => {
    const toml = flatToTOML({ quote: 'She said "hello"' });
    assert.ok(toml.includes('other = "She said \\"hello\\""'));
  });

  it('round-trips simple keys', () => {
    const original = { home: 'Home', about: 'About Us', contact: 'Contact' };
    const toml = flatToTOML(original);
    const parsed = parseTOMLToFlat(toml);
    assert.deepEqual(parsed, original);
  });

  it('round-trips plural keys', () => {
    const original = { 'items.one': '1 item', 'items.other': '{{ .Count }} items' };
    const toml = flatToTOML(original);
    const parsed = parseTOMLToFlat(toml);
    assert.deepEqual(parsed, original);
  });

  it('round-trips mixed simple and plural keys', () => {
    const original = {
      home: 'Home',
      'items.one': '1 item',
      'items.other': '{{ .Count }} items',
      about: 'About',
    };
    const toml = flatToTOML(original);
    const parsed = parseTOMLToFlat(toml);
    assert.deepEqual(parsed, original);
  });
});

// =================================================================
// 4. YAML parsing
// =================================================================
describe('YAML parsing', () => {
  it('parses simple Hugo i18n YAML', () => {
    const yaml = `home:\n  other: Home\nabout:\n  other: About Us\n`;
    const flat = parseYAMLToFlat(yaml);
    assert.equal(flat['home'], 'Home');
    assert.equal(flat['about'], 'About Us');
  });

  it('parses plural forms as dotted sub-keys', () => {
    const yaml = `items:\n  one: "{{ .Count }} item"\n  other: "{{ .Count }} items"\n`;
    const flat = parseYAMLToFlat(yaml);
    assert.equal(flat['items.one'], '{{ .Count }} item');
    assert.equal(flat['items.other'], '{{ .Count }} items');
  });

  it('handles quoted values', () => {
    const yaml = `greeting:\n  other: "Hello, world!"\n`;
    const flat = parseYAMLToFlat(yaml);
    assert.equal(flat['greeting'], 'Hello, world!');
  });

  it('handles single-quoted values', () => {
    const yaml = `greeting:\n  other: 'Hello'\n`;
    const flat = parseYAMLToFlat(yaml);
    assert.equal(flat['greeting'], 'Hello');
  });

  it('skips comment lines', () => {
    const yaml = `# Comment\nhome:\n  # Another comment\n  other: Home\n`;
    const flat = parseYAMLToFlat(yaml);
    assert.equal(flat['home'], 'Home');
  });

  it('handles empty YAML content', () => {
    const flat = parseYAMLToFlat('');
    assert.deepEqual(flat, {});
  });

  it('reads the YAML fixture file correctly', () => {
    const fixturePath = path.join(import.meta.dirname, 'fixtures', 'yaml-locales', 'en.yaml');
    const flat = readLocaleFile(fixturePath, 'yaml');
    assert.equal(flat['home'], 'Home');
    assert.equal(flat['welcome'], 'Welcome to our website');
    assert.equal(flat['items.one'], '{{ .Count }} item');
    assert.equal(flat['items.other'], '{{ .Count }} items');
  });
});

// =================================================================
// 5. YAML serialization
// =================================================================
describe('YAML serialization', () => {
  it('serializes simple keys', () => {
    const yaml = flatToYAML({ home: 'Home', about: 'About Us' });
    assert.ok(yaml.includes('home:'));
    assert.ok(yaml.includes('  other: Home'));
    assert.ok(yaml.includes('about:'));
    assert.ok(yaml.includes('  other: About Us'));
  });

  it('quotes values with special characters', () => {
    const yaml = flatToYAML({ count: '{{ .Count }} items' });
    // Should be quoted because of { and }
    assert.ok(yaml.includes('"{{ .Count }} items"'));
  });

  it('round-trips simple keys', () => {
    const original = { home: 'Home', about: 'About Us' };
    const yaml = flatToYAML(original);
    const parsed = parseYAMLToFlat(yaml);
    assert.deepEqual(parsed, original);
  });

  it('round-trips plural keys', () => {
    const original = { 'items.one': '1 item', 'items.other': '{{ .Count }} items' };
    const yaml = flatToYAML(original);
    const parsed = parseYAMLToFlat(yaml);
    assert.deepEqual(parsed, original);
  });
});

// =================================================================
// 6. groupFlatKeys utility
// =================================================================
describe('groupFlatKeys', () => {
  it('wraps simple keys as { other: value }', () => {
    const grouped = groupFlatKeys({ home: 'Home' });
    assert.deepEqual(grouped, { home: { other: 'Home' } });
  });

  it('groups plural sub-keys under parent', () => {
    const grouped = groupFlatKeys({ 'items.one': '1', 'items.other': 'many' });
    assert.deepEqual(grouped, { items: { one: '1', other: 'many' } });
  });

  it('does not treat non-plural dotted keys as plurals', () => {
    const grouped = groupFlatKeys({ 'nav.home': 'Home' });
    // "home" is not a CLDR plural form, so it should be its own section
    assert.deepEqual(grouped, { 'nav.home': { other: 'Home' } });
  });
});

// =================================================================
// 7. RED TEAM: Edge cases
// =================================================================
describe('RED TEAM: format edge cases', () => {
  it('handles TOML with no trailing newline', () => {
    const flat = parseTOMLToFlat('[home]\nother = "Home"');
    assert.equal(flat['home'], 'Home');
  });

  it('handles TOML with Windows line endings', () => {
    const flat = parseTOMLToFlat('[home]\r\nother = "Home"\r\n');
    assert.equal(flat['home'], 'Home');
  });

  it('handles TOML values with equals signs', () => {
    const flat = parseTOMLToFlat('[eq]\nother = "a = b = c"');
    assert.equal(flat['eq'], 'a = b = c');
  });

  it('handles TOML with escaped newlines in value', () => {
    const flat = parseTOMLToFlat('[multi]\nother = "line1\\nline2"');
    assert.equal(flat['multi'], 'line1\nline2');
  });

  it('handles YAML with colon in value (quoted)', () => {
    const flat = parseYAMLToFlat('time:\n  other: "Time: 3:00 PM"');
    assert.equal(flat['time'], 'Time: 3:00 PM');
  });

  it('handles YAML boolean-like values as strings', () => {
    const yaml = flatToYAML({ confirm: 'yes' });
    const parsed = parseYAMLToFlat(yaml);
    assert.equal(parsed['confirm'], 'yes');
  });

  it('handles empty string values in TOML', () => {
    const flat = parseTOMLToFlat('[empty]\nother = ""');
    assert.equal(flat['empty'], '');
  });

  it('handles empty string values in YAML round-trip', () => {
    const yaml = flatToYAML({ empty: '' });
    const parsed = parseYAMLToFlat(yaml);
    assert.equal(parsed['empty'], '');
  });
});
