#!/usr/bin/env node
/**
 * Migration test suite — validates v2→v3 config auto-migration.
 *
 * Tests cover:
 *   - Detection of v2 configs (no version, version < 3)
 *   - Config field migration (sourceLocale → inputLocale)
 *   - Backup creation
 *   - Full migration pipeline
 *   - Idempotency (running migration twice doesn't break anything)
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  needsMigration,
  migrateConfig,
  runMigration,
} from '../lib/migrate.js';

const tmpDir = path.join(import.meta.dirname, 'fixtures', '_tmp_migrate_test');

describe('needsMigration', () => {
  it('returns true for configs with no version', () => {
    assert.equal(needsMigration({}), true);
    assert.equal(needsMigration({ sourceLocale: 'en' }), true);
  });

  it('returns true for version 1', () => {
    assert.equal(needsMigration({ version: 1 }), true);
  });

  it('returns true for version 2', () => {
    assert.equal(needsMigration({ version: 2 }), true);
  });

  it('returns false for version 3', () => {
    assert.equal(needsMigration({ version: 3 }), false);
  });

  it('returns false for version 4 (future-proof)', () => {
    assert.equal(needsMigration({ version: 4 }), false);
  });
});

describe('migrateConfig', () => {
  it('adds version 3', () => {
    const { migrated, changes } = migrateConfig({});
    assert.equal(migrated.version, 3);
    assert.ok(changes.some(c => c.includes('version: 3')));
  });

  it('renames sourceLocale to inputLocale', () => {
    const { migrated, changes } = migrateConfig({ sourceLocale: 'es' });
    assert.equal(migrated.inputLocale, 'es');
    assert.equal(migrated.sourceLocale, undefined);
    assert.ok(changes.some(c => c.includes('sourceLocale → inputLocale')));
  });

  it('preserves existing inputLocale', () => {
    const { migrated } = migrateConfig({ inputLocale: 'fr' });
    assert.equal(migrated.inputLocale, 'fr');
  });

  it('defaults to en when no locale is specified', () => {
    const { migrated, changes } = migrateConfig({});
    assert.equal(migrated.inputLocale, 'en');
    assert.ok(changes.some(c => c.includes('default')));
  });

  it('adds empty baseUrl', () => {
    const { migrated, changes } = migrateConfig({});
    assert.equal(migrated.baseUrl, '');
    assert.ok(changes.some(c => c.includes('baseUrl')));
  });

  it('preserves existing baseUrl', () => {
    const { migrated } = migrateConfig({ baseUrl: 'https://example.com' });
    assert.equal(migrated.baseUrl, 'https://example.com');
  });

  it('does not mutate the input object', () => {
    const original = { sourceLocale: 'en', model: 'gpt-4' };
    const copy = { ...original };
    migrateConfig(original);
    assert.deepEqual(original, copy);
  });

  it('preserves all other fields untouched', () => {
    const { migrated } = migrateConfig({
      sourceLocale: 'en',
      localesDir: './i18n',
      model: 'anthropic/claude',
      batchSize: 50,
      languages: ['fr', 'de'],
      contentDir: './content',
    });

    assert.equal(migrated.localesDir, './i18n');
    assert.equal(migrated.model, 'anthropic/claude');
    assert.equal(migrated.batchSize, 50);
    assert.deepEqual(migrated.languages, ['fr', 'de']);
    assert.equal(migrated.contentDir, './content');
  });
});



describe('runMigration — full pipeline', () => {
  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('migrates a v2 config end-to-end', () => {
    const v2Config = {
      sourceLocale: 'en',
      localesDir: './locales',
      model: 'openai/gpt-4o-mini',
      languages: ['fr', 'de'],
    };

    const configPath = path.join(tmpDir, 'i18n-rosetta.config.json');
    fs.writeFileSync(configPath, JSON.stringify(v2Config, null, 2));

    // Suppress console output during test
    const origLog = console.log;
    console.log = () => {};

    try {
      const result = runMigration(configPath, tmpDir);
      assert.equal(result.migrated, true);
      assert.ok(result.changes.length > 0);

      // Verify the migrated config
      const migrated = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      assert.equal(migrated.version, 3);
      assert.equal(migrated.inputLocale, 'en');
      assert.equal(migrated.sourceLocale, undefined);

      // Verify backup was created
      const backupPath = configPath.replace('.json', '-v2-backup.json');
      assert.ok(fs.existsSync(backupPath), 'Backup should exist');
      const backup = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
      assert.equal(backup.sourceLocale, 'en');
      assert.equal(backup.version, undefined);
    } finally {
      console.log = origLog;
    }
  });

  it('is idempotent — running twice does not break things', () => {
    const v3Config = {
      version: 3,
      inputLocale: 'en',
      baseUrl: '',
      localesDir: './locales',
    };

    const configPath = path.join(tmpDir, 'i18n-rosetta.config.json');
    fs.writeFileSync(configPath, JSON.stringify(v3Config, null, 2));

    const result = runMigration(configPath, tmpDir);
    assert.equal(result.migrated, false);
    assert.equal(result.changes.length, 0);

    // Config should be unchanged
    const reRead = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.deepEqual(reRead, v3Config);
  });

  it('handles missing config file gracefully', () => {
    const result = runMigration('/nonexistent/path.json', tmpDir);
    assert.equal(result.migrated, false);
  });

  it('handles malformed config file gracefully', () => {
    const configPath = path.join(tmpDir, 'bad.config.json');
    fs.writeFileSync(configPath, 'NOT JSON');

    const warnings = [];
    const origError = console.error;
    console.error = (msg) => warnings.push(msg);

    try {
      const result = runMigration(configPath, tmpDir);
      assert.equal(result.migrated, false);
    } finally {
      console.error = origError;
    }
  });
});
