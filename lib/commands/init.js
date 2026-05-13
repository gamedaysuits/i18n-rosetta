/**
 * Command: init
 *
 * Interactive setup wizard that creates a v3 config file.
 * Uses Node.js built-in readline — zero external dependencies.
 *
 * When run non-interactively (piped stdin, CI, or --yes flag),
 * falls back to generating a sensible default config silently.
 *
 * Wizard flow:
 *   1. Source locale (default: en)
 *   2. Target languages (comma-separated codes, with suggestions)
 *   3. Locales directory (default: ./locales)
 *   4. File format (auto/json/toml/yaml)
 *   5. Model (default: openai/gpt-4o-mini)
 *   6. Hugo content directory (optional)
 *   7. Confirmation + write
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { CONFIG_FILENAMES } from '../config.js';
import { DEFAULT_REGISTERS } from '../registers.js';
import { output } from '../output.js';

const DEFAULT_CONFIG_FILENAME = CONFIG_FILENAMES[0]; // i18n-rosetta.config.json

// Popular language groups for quick selection
const LANGUAGE_PRESETS = {
  european: ['fr', 'de', 'es', 'it', 'pt', 'nl'],
  asian: ['ja', 'zh', 'ko'],
  global: ['fr', 'es', 'de', 'ja', 'zh', 'ko', 'pt', 'ar'],
  nordic: ['da', 'fi', 'nb', 'sv'],
};

/**
 * Checks whether stdin is interactive (attached to a TTY).
 * If piped or in CI, we skip the interactive wizard.
 */
function isInteractive() {
  return process.stdin.isTTY === true;
}

/**
 * Prompt the user for a single line of input.
 * Returns the trimmed response, or the default if empty.
 */
function ask(rl, question, defaultValue) {
  return new Promise((resolve) => {
    const suffix = defaultValue ? ` (${defaultValue})` : '';
    rl.question(`  ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

/**
 * Parse a comma-separated language input string.
 * Supports preset names (e.g., "european") and individual codes.
 *
 * @param {string} input - Raw user input
 * @returns {string[]} Deduplicated array of locale codes
 */
function parseLanguageInput(input) {
  if (!input) return [];

  const codes = new Set();
  const parts = input.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  for (const part of parts) {
    if (LANGUAGE_PRESETS[part]) {
      // Expand preset into individual codes
      for (const code of LANGUAGE_PRESETS[part]) {
        codes.add(code);
      }
    } else {
      codes.add(part);
    }
  }

  return [...codes];
}

/**
 * Display a summary of the config about to be written and ask for confirmation.
 */
async function confirmConfig(rl, config) {
  console.log('');
  console.log('  Config Summary:');
  console.log('  ──────────────────────────────────────');
  console.log(`    Source locale:   ${config.inputLocale}`);
  console.log(`    Target locales:  ${config.languages.length > 0 ? config.languages.join(', ') : '(auto-detect from directory)'}`);
  console.log(`    Locales dir:     ${config.localesDir}`);
  console.log(`    Format:          ${config.format}`);
  console.log(`    Model:           ${config.model}`);
  if (config.contentDir) {
    console.log(`    Content dir:     ${config.contentDir}`);
  }
  console.log('  ──────────────────────────────────────');
  console.log('');

  const confirm = await ask(rl, 'Write this config?', 'yes');
  return confirm.toLowerCase().startsWith('y');
}

/**
 * Build a config object from wizard answers.
 */
function buildConfig(answers) {
  const config = {
    version: 3,
    inputLocale: answers.source,
    localesDir: answers.localesDir,
    languages: answers.languages,
    model: answers.model,
    batchSize: 30,
    format: answers.format,
  };

  // Only include contentDir if the user specified one
  if (answers.contentDir) {
    config.contentDir = answers.contentDir;
  }

  // Only include baseUrl if the user specified one
  if (answers.baseUrl) {
    config.baseUrl = answers.baseUrl;
  }

  return config;
}

/**
 * Run the interactive init wizard.
 */
async function runInteractive(cwd) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log('');
    console.log('  i18n-rosetta — Project Setup');
    console.log('  ────────────────────────────────────────────────');
    console.log('');

    // Step 1: Source locale
    const source = await ask(rl, 'Source locale', 'en');

    // Step 2: Target languages
    console.log('');
    console.log('  Target languages — enter codes separated by commas.');
    console.log('  Presets: european (fr,de,es,it,pt,nl) | asian (ja,zh,ko)');
    console.log('           global (fr,es,de,ja,zh,ko,pt,ar) | nordic (da,fi,nb,sv)');
    console.log('  Example: fr, de, ja  or  european, ja');
    console.log('  Leave blank to auto-detect from your locales directory.');
    const langInput = await ask(rl, 'Target languages', '');
    const languages = parseLanguageInput(langInput);

    // Show what was resolved (with language names)
    if (languages.length > 0) {
      const named = languages.map(code => {
        const reg = DEFAULT_REGISTERS[code];
        return reg ? `${code} (${reg.name})` : code;
      });
      console.log(`  → ${named.join(', ')}`);
    }

    // Step 3: Locales directory
    console.log('');
    const localesDir = await ask(rl, 'Locales directory', './locales');

    // Step 4: File format
    const format = await ask(rl, 'File format (auto/json/toml/yaml)', 'auto');

    // Step 5: Model
    const model = await ask(rl, 'Translation model', 'openai/gpt-4o-mini');

    // Step 6: Hugo content directory (optional)
    console.log('');
    console.log('  Hugo/content translation (leave blank to skip):');
    const contentDir = await ask(rl, 'Content directory', '');

    // Confirm and write
    const config = buildConfig({
      source,
      languages,
      localesDir,
      format,
      model,
      contentDir,
    });

    const confirmed = await confirmConfig(rl, config);
    if (!confirmed) {
      console.log('  Cancelled. No files written.');
      return 0;
    }

    return config;
  } finally {
    rl.close();
  }
}

/**
 * Generate a default config for non-interactive mode.
 * Uses CLI args for any overrides (--dir, --source).
 */
function buildDefaultConfig(args) {
  return {
    version: 3,
    inputLocale: args.source || 'en',
    localesDir: args.dir || './locales',
    languages: [],
    model: args.model || 'openai/gpt-4o-mini',
    batchSize: 30,
    format: args.format || 'auto',
  };
}

async function run(args, cwd) {
  const configPath = path.join(cwd, DEFAULT_CONFIG_FILENAME);

  // ── Help ──
  if (args.help) {
    showHelp();
    return 0;
  }

  // ── Guard: config already exists ──
  if (fs.existsSync(configPath)) {
    output.warn(`Config file already exists: ${DEFAULT_CONFIG_FILENAME}`);
    output.raw('   Delete it first if you want to regenerate.');
    return 0;
  }



  // ── Choose mode: interactive wizard or silent defaults ──
  let config;
  if (!args.yes && isInteractive()) {
    config = await runInteractive(cwd);
    if (!config) return 0; // User cancelled or returned 0
  } else {
    config = buildDefaultConfig(args);
  }

  // ── Write config ──
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  output.ok(`Created ${DEFAULT_CONFIG_FILENAME}`);
  output.raw('');
  output.raw('Next steps:');
  output.raw('  1. Set your OPENROUTER_API_KEY in .env.local or your environment');
  if (config.languages.length === 0) {
    output.raw('  2. Add target locale files to your locales directory (e.g., fr.json)');
  }
  output.raw(`  ${config.languages.length === 0 ? '3' : '2'}. Run: i18n-rosetta sync`);
  return 0;
}

function showHelp() {
  console.log(`
  i18n-rosetta init — Create a new project config

  USAGE
    i18n-rosetta init [options]

  DESCRIPTION
    Runs an interactive setup wizard that guides you through configuring
    your project's source locale, target languages, file format, and
    translation model. Writes i18n-rosetta.config.json to the current
    directory.

    In non-interactive environments (CI, piped stdin), or when --yes is
    set, generates a sensible default config without prompting.

  OPTIONS
    --yes             Skip interactive wizard, use defaults
    --source <code>   Source locale (default: en)
    --dir <path>      Locales directory (default: ./locales)
    --model <model>   Translation model (default: openai/gpt-4o-mini)
    --format <fmt>    File format: auto, json, toml, yaml (default: auto)

  EXAMPLES
    i18n-rosetta init                  # Interactive wizard
    i18n-rosetta init --yes            # Quick setup with defaults
    i18n-rosetta init --source en --dir ./i18n
  `);
}

export { run, parseLanguageInput, buildDefaultConfig };
