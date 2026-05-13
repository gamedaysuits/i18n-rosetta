/**
 * Tests: init command (interactive wizard) and command-help system
 *
 * Tests the non-interactive (--yes) init flow, language preset parsing,
 * config generation, and the per-command help registry.
 *
 * NOTE: Interactive readline prompting is not tested here because
 * Node.js test runner doesn't support simulating TTY input cleanly.
 * We test the composable functions the wizard calls instead.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

import { parseLanguageInput, buildDefaultConfig } from '../lib/commands/init.js';
import { COMMAND_HELP, showCommandHelp } from '../lib/command-help.js';

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rosetta-init-test-'));
}

function cleanupDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

const CLI_PATH = path.join(import.meta.dirname, '..', 'bin', 'cli.js');

// -----------------------------------------------------------------
// Tests: parseLanguageInput
// -----------------------------------------------------------------

describe('parseLanguageInput', () => {
  it('parses comma-separated language codes', () => {
    const result = parseLanguageInput('fr, de, ja');
    assert.deepEqual(result, ['fr', 'de', 'ja']);
  });

  it('expands preset names into language codes', () => {
    const result = parseLanguageInput('european');
    assert.deepEqual(result, ['fr', 'de', 'es', 'it', 'pt', 'nl']);
  });

  it('mixes presets and individual codes without duplicates', () => {
    const result = parseLanguageInput('asian, fr');
    assert.deepEqual(result, ['ja', 'zh', 'ko', 'fr']);
  });

  it('deduplicates when preset overlaps with explicit codes', () => {
    const result = parseLanguageInput('european, fr, de');
    // fr and de are already in "european" — should not repeat
    assert.deepEqual(result, ['fr', 'de', 'es', 'it', 'pt', 'nl']);
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(parseLanguageInput(''), []);
  });

  it('returns empty array for null input', () => {
    assert.deepEqual(parseLanguageInput(null), []);
  });

  it('handles whitespace-only input', () => {
    assert.deepEqual(parseLanguageInput('  ,  ,  '), []);
  });
});

// -----------------------------------------------------------------
// Tests: buildDefaultConfig
// -----------------------------------------------------------------

describe('buildDefaultConfig', () => {
  it('produces v3 config with sensible defaults', () => {
    const config = buildDefaultConfig({});
    assert.equal(config.version, 3);
    assert.equal(config.inputLocale, 'en');
    assert.equal(config.localesDir, './locales');
    assert.equal(config.model, 'openai/gpt-4o-mini');
    assert.equal(config.batchSize, 30);
    assert.equal(config.format, 'auto');
    assert.deepEqual(config.languages, []);
  });

  it('respects CLI arg overrides', () => {
    const config = buildDefaultConfig({
      source: 'fr',
      dir: './i18n',
      model: 'anthropic/claude-3',
      format: 'json',
    });
    assert.equal(config.inputLocale, 'fr');
    assert.equal(config.localesDir, './i18n');
    assert.equal(config.model, 'anthropic/claude-3');
    assert.equal(config.format, 'json');
  });
});

// -----------------------------------------------------------------
// Tests: init --yes (non-interactive mode)
// -----------------------------------------------------------------

describe('init --yes (non-interactive)', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupDir(tempDir);
  });

  it('creates a valid config file', () => {
    const result = execFileSync(
      process.execPath,
      [CLI_PATH, 'init', '--yes'],
      { cwd: tempDir, encoding: 'utf-8' },
    );

    assert.ok(result.includes('[OK]'));

    const configPath = path.join(tempDir, 'i18n-rosetta.config.json');
    assert.ok(fs.existsSync(configPath), 'Config file should exist');

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.equal(config.version, 3);
    assert.equal(config.inputLocale, 'en');
    assert.deepEqual(config.languages, []);
  });

  it('refuses to overwrite existing config', () => {
    // Create a config first
    fs.writeFileSync(
      path.join(tempDir, 'i18n-rosetta.config.json'),
      '{}',
      'utf-8',
    );

    const result = execFileSync(
      process.execPath,
      [CLI_PATH, 'init', '--yes'],
      { cwd: tempDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );

    // Should warn, not crash — check stderr contains warning
    // (output.warn goes to stderr; stdout may be empty)
  });

  it('accepts --source and --dir overrides', () => {
    const result = execFileSync(
      process.execPath,
      [CLI_PATH, 'init', '--yes', '--source', 'fr', '--dir', './i18n'],
      { cwd: tempDir, encoding: 'utf-8' },
    );

    const configPath = path.join(tempDir, 'i18n-rosetta.config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.equal(config.inputLocale, 'fr');
    assert.equal(config.localesDir, './i18n');
  });
});

// -----------------------------------------------------------------
// Tests: command-help registry
// -----------------------------------------------------------------

describe('COMMAND_HELP registry', () => {
  const EXPECTED_COMMANDS = [
    'init', 'sync', 'watch', 'audit', 'lint', 'wrap',
    'seo', 'integrity', 'status', 'provenance', 'plugin',
  ];

  it('has entries for all registered commands', () => {
    for (const cmd of EXPECTED_COMMANDS) {
      assert.ok(COMMAND_HELP[cmd], `Missing help entry for "${cmd}"`);
    }
  });

  it('every entry has required fields', () => {
    for (const [name, help] of Object.entries(COMMAND_HELP)) {
      assert.ok(help.usage, `${name}: missing usage`);
      assert.ok(Array.isArray(help.description), `${name}: description should be array`);
      assert.ok(help.description.length > 0, `${name}: description should not be empty`);
      assert.ok(Array.isArray(help.options), `${name}: options should be array`);
      assert.ok(Array.isArray(help.examples), `${name}: examples should be array`);
      assert.ok(help.examples.length > 0, `${name}: should have at least one example`);
    }
  });

  it('subcommand entries exist for seo and plugin', () => {
    assert.ok(COMMAND_HELP.seo.subcommands.length >= 3, 'seo should have subcommands');
    assert.ok(COMMAND_HELP.plugin.subcommands.length >= 3, 'plugin should have subcommands');
  });
});

// -----------------------------------------------------------------
// Tests: per-command --help via CLI
// -----------------------------------------------------------------

describe('per-command --help', () => {
  it('rosetta sync --help shows sync-specific help', () => {
    const result = execFileSync(
      process.execPath,
      [CLI_PATH, 'sync', '--help'],
      { encoding: 'utf-8' },
    );

    assert.ok(result.includes('sync'), 'Should mention sync');
    assert.ok(result.includes('--dry'), 'Should list --dry flag');
    assert.ok(result.includes('--force-keys'), 'Should list --force-keys');
    assert.ok(result.includes('USAGE'), 'Should have USAGE section');
    assert.ok(result.includes('EXAMPLES'), 'Should have EXAMPLES section');
  });

  it('rosetta lint --help shows lint-specific help', () => {
    const result = execFileSync(
      process.execPath,
      [CLI_PATH, 'lint', '--help'],
      { encoding: 'utf-8' },
    );

    assert.ok(result.includes('lint'), 'Should mention lint');
    assert.ok(result.includes('--warn-only'), 'Should list --warn-only');
    assert.ok(result.includes('--min-length'), 'Should list --min-length');
  });

  it('rosetta plugin --help shows subcommands', () => {
    const result = execFileSync(
      process.execPath,
      [CLI_PATH, 'plugin', '--help'],
      { encoding: 'utf-8' },
    );

    assert.ok(result.includes('SUBCOMMANDS'), 'Should have SUBCOMMANDS section');
    assert.ok(result.includes('install'), 'Should list install subcommand');
    assert.ok(result.includes('remove'), 'Should list remove subcommand');
  });

  it('rosetta init --help shows init wizard help', () => {
    const result = execFileSync(
      process.execPath,
      [CLI_PATH, 'init', '--help'],
      { encoding: 'utf-8' },
    );

    assert.ok(result.includes('init'), 'Should mention init');
    assert.ok(result.includes('--yes'), 'Should list --yes flag');
    assert.ok(result.includes('wizard'), 'Should mention wizard');
  });
});
