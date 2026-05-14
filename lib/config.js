/**
 * Config resolution — finds and merges configuration from multiple sources.
 *
 * Priority (highest to lowest):
 *   1. CLI flags (--source, --dir, --model, --method, etc.)
 *   2. Config file (i18n-rosetta.config.json)
 *   3. Sensible defaults
 *
 * WHY: The goal is zero-config for simple cases (just drop your locale
 * files in a folder and go) while allowing full customization for
 * complex setups with custom registers, models, and batch sizes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_REGISTERS } from './registers.js';

const CONFIG_FILENAMES = ['i18n-rosetta.config.json'];

const DEFAULTS = {
  version: 3,
  inputLocale: 'en',
  baseUrl: '',
  localesDir: './locales',
  contentDir: null,  // Hugo content directory (e.g. './content'). null = disabled.
  translatableFields: null,  // Override DEFAULT_TRANSLATABLE_FIELDS from content.js
  languages: [],
  pairs: null,       // Advanced per-pair overrides (see pairs.js)
  model: 'openai/gpt-4o-mini',
  defaultMethod: 'llm',     // Global default: llm, google-translate, api
  batchSize: 30,
  fallbackPrefix: '[EN] ',
  apiKeyEnvVar: 'OPENROUTER_API_KEY',
  format: 'auto',
  lint: {
    srcDir: null,       // Auto-detected from framework
    ignore: ['node_modules', '.next', 'dist', 'build', '.git', 'public', '.vercel'],
    minLength: 2,       // Minimum string length to flag
  },
  seo: {
    urlPattern: '/:locale/:path',
    pages: null,        // null = auto-detect from locale keys or explicit list
  },
  typegen: {
    output: null,       // null = disabled. e.g., './locales.d.ts'
    autoGenerate: false,
  },
};

/**
 * Resolve the full config by merging defaults → config file → CLI args.
 *
 * @param {object} cliArgs - Parsed CLI arguments
 * @param {string} cwd - Working directory to resolve paths from
 * @returns {object} Fully resolved config
 */
function resolveConfig(cliArgs = {}, cwd = process.cwd()) {
  // Start with defaults
  const config = { ...DEFAULTS };

  // Layer 2: config file
  let configPath;
  if (cliArgs.config) {
    configPath = path.resolve(cwd, cliArgs.config);
  } else {
    // Try each config filename in priority order
    configPath = CONFIG_FILENAMES
      .map(name => path.resolve(cwd, name))
      .find(p => fs.existsSync(p));
  }

  if (configPath && fs.existsSync(configPath)) {
    try {
      const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      Object.assign(config, fileConfig);
    } catch (err) {
      console.error(`[WARN] Failed to parse config file: ${err.message}`);
    }
  }

  // Layer 3: CLI overrides
  if (cliArgs.source) config.inputLocale = cliArgs.source;
  if (cliArgs.dir) config.localesDir = cliArgs.dir;
  if (cliArgs.model) config.model = cliArgs.model;
  if (cliArgs.method) config.defaultMethod = cliArgs.method;
  if (cliArgs.batchSize) config.batchSize = parseInt(cliArgs.batchSize, 10);
  if (cliArgs.format) config.format = cliArgs.format;
  if (cliArgs['content-dir']) config.contentDir = cliArgs['content-dir'];
  if (cliArgs['base-url']) config.baseUrl = cliArgs['base-url'];

  // Parse --force-keys: comma-separated dot-notation keys to force re-translate
  config.forceKeys = cliArgs['force-keys']
    ? cliArgs['force-keys'].split(',').map(k => k.trim()).filter(Boolean)
    : [];

  // Resolve localesDir and contentDir to absolute paths
  config.localesDir = path.resolve(cwd, config.localesDir);
  if (config.contentDir) {
    config.contentDir = path.resolve(cwd, config.contentDir);
  }

  // Resolve the languages config into a normalized map:
  // { "fr": { name: "French", register: "..." }, ... }
  config.resolvedLanguages = resolveLanguages(config);

  return config;
}

/**
 * Normalizes the `languages` config into a consistent map.
 *
 * Supports three input formats:
 *   - Array of codes:    ["fr", "de", "ja"]
 *   - Object with registers: { "fr": "My custom French tone", "de": { register: "..." } }
 *   - Empty (auto-detect from directory)
 */
function resolveLanguages(config) {
  const resolved = {};
  const langs = config.languages;

  if (Array.isArray(langs) && langs.length > 0) {
    // Simple array: ["fr", "de", "ja"]
    for (const code of langs) {
      const defaults = DEFAULT_REGISTERS[code];
      resolved[code] = {
        name: defaults?.name || code,
        register: defaults?.register || 'Professional register.',
      };
    }
  } else if (typeof langs === 'object' && !Array.isArray(langs) && Object.keys(langs).length > 0) {
    // Object form: { "fr": "Custom register", "de": { name: "German", register: "..." } }
    for (const [code, value] of Object.entries(langs)) {
      const defaults = DEFAULT_REGISTERS[code];
      if (typeof value === 'string') {
        // Shorthand: just a custom register string
        resolved[code] = {
          name: defaults?.name || code,
          register: value,
        };
      } else if (typeof value === 'object') {
        resolved[code] = {
          name: value.name || defaults?.name || code,
          register: value.register || defaults?.register || 'Professional register.',
        };
      }
    }
  }
  // If empty, auto-detection happens in sync.js by scanning the directory

  return resolved;
}

/**
 * Auto-detect target languages by scanning the locales directory
 * for locale files (JSON, TOML, or YAML) that aren't the source file.
 *
 * @param {object} config - Resolved config
 * @returns {object} Map of locale code → { name, register }
 */
function autoDetectLanguages(config) {
  const detected = {};
  const inputLocale = config.inputLocale || 'en';

  if (!fs.existsSync(config.localesDir)) return detected;

  // Supported locale file extensions
  const LOCALE_EXTS = ['.json', '.toml', '.yaml', '.yml'];

  const files = fs.readdirSync(config.localesDir)
    .filter(f => {
      const ext = path.extname(f);
      return LOCALE_EXTS.includes(ext);
    })
    .sort();

  for (const file of files) {
    const ext = path.extname(file);
    const code = path.basename(file, ext);

    // Skip source locale
    if (code === inputLocale) continue;

    const defaults = DEFAULT_REGISTERS[code];
    detected[code] = {
      name: defaults?.name || code,
      register: defaults?.register || 'Professional register.',
      filename: file,
    };
  }

  return detected;
}

/**
 * Generate a starter config file for `i18n-rosetta init`.
 * Produces v3 format config.
 */
function generateConfigTemplate(localesDir, inputLocale) {
  return JSON.stringify({
    _setup: 'Add your target language codes to the languages array below. Example: ["fr", "de", "ja"]',
    version: 3,
    inputLocale: inputLocale || 'en',
    baseUrl: '',
    localesDir: localesDir || './locales',
    languages: [],
    model: 'openai/gpt-4o-mini',
    batchSize: 30,
  }, null, 2);
}

export {
  resolveConfig,
  autoDetectLanguages,
  generateConfigTemplate,
  CONFIG_FILENAMES,
};
