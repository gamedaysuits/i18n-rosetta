/**
 * Per-command help text registry.
 *
 * Each command has a structured help entry with usage, description,
 * options, and examples. The CLI dispatcher routes `rosetta <cmd> --help`
 * to display the relevant entry.
 *
 * WHY: The main `rosetta help` screen is a dense overview of every command.
 * Users running `rosetta sync --help` expect focused, detailed help for
 * that specific command, including all relevant flags and examples.
 */

const COMMAND_HELP = {
  init: {
    usage: 'i18n-rosetta init [options]',
    description: [
      'Runs an interactive setup wizard to create i18n-rosetta.config.json.',
      'In non-interactive environments (CI/piped stdin), or with --yes,',
      'generates a default config without prompting.',
    ],
    options: [
      ['--yes',            'Skip wizard, use defaults'],
      ['--source <code>',  'Source locale (default: en)'],
      ['--dir <path>',     'Locales directory (default: ./locales)'],
      ['--model <model>',  'Translation model (default: openai/gpt-4o-mini)'],
      ['--format <fmt>',   'File format: auto, json, toml, yaml (default: auto)'],
    ],
    examples: [
      'i18n-rosetta init                  # Interactive wizard',
      'i18n-rosetta init --yes            # Quick setup with defaults',
      'i18n-rosetta init --source en --dir ./i18n',
    ],
  },

  sync: {
    usage: 'i18n-rosetta sync [options]',
    description: [
      'Translates and syncs all locale files based on the project config.',
      'Detects changed keys, batches them for translation, and writes',
      'the results back to each locale file. Also syncs Hugo Markdown',
      'content files when --content-dir is configured.',
    ],
    options: [
      ['--dry',               'Preview changes without writing files'],
      ['--force-keys <keys>', 'Comma-separated dot-notation keys to force re-translate'],
      ['--model <model>',     'Override translation model for this run'],
      ['--config <path>',     'Path to config file'],
      ['--dir <path>',        'Override locales directory'],
      ['--content-dir <p>',   'Hugo content directory for Markdown translation'],
      ['--source <code>',     'Override source locale (default: en)'],
      ['--format <fmt>',      'Locale file format: json, toml, yaml, auto'],
      ['--method <method>',   'Translation method: llm, google-translate (default: from config)'],
      ['--fallback',          'Write [EN]-prefixed values when translation fails'],
    ],
    examples: [
      'i18n-rosetta sync                          # Standard sync',
      'i18n-rosetta sync --dry                    # Preview only',
      'i18n-rosetta sync --force-keys hero.title  # Re-translate specific keys',
      'i18n-rosetta sync --content-dir ./content  # Include Hugo content',
    ],
  },

  watch: {
    usage: 'i18n-rosetta watch [options]',
    description: [
      'Starts a file watcher that auto-syncs when the source locale',
      'file changes. Runs until manually stopped (Ctrl+C).',
    ],
    options: [
      ['--config <path>', 'Path to config file'],
      ['--dir <path>',    'Override locales directory'],
      ['--source <code>', 'Override source locale'],
    ],
    examples: [
      'i18n-rosetta watch             # Watch and auto-sync on changes',
    ],
  },

  audit: {
    usage: 'i18n-rosetta audit [options]',
    description: [
      'Lists all untranslated [EN] fallback values across locale files.',
      'Returns exit code 1 if any untranslated keys exist — usable as',
      'a CI gate to block deploys with missing translations.',
    ],
    options: [
      ['--config <path>', 'Path to config file'],
      ['--dir <path>',    'Override locales directory'],
      ['--source <code>', 'Override source locale'],
      ['--format <fmt>',  'Locale file format: json, toml, yaml, auto'],
    ],
    examples: [
      'i18n-rosetta audit                         # List untranslated keys',
      'i18n-rosetta audit && echo "All translated" # CI gate',
    ],
  },

  lint: {
    usage: 'i18n-rosetta lint [options]',
    description: [
      'Scans source files for hardcoded user-facing strings that should',
      'be wrapped in t() calls. Returns exit code 1 if issues found',
      '(unless --warn-only is set). Usable as a pre-commit hook.',
    ],
    options: [
      ['--src <path>',    'Source directory to scan (auto-detected by default)'],
      ['--min-length <n>','Minimum string length to flag (default: 2)'],
      ['--warn-only',     'Exit 0 even if issues found'],
      ['--config <path>', 'Path to config file'],
    ],
    examples: [
      'i18n-rosetta lint                        # Scan for hardcoded strings',
      'i18n-rosetta lint --warn-only            # Non-blocking scan',
      'i18n-rosetta lint --src ./src --min-length 4',
    ],
  },

  wrap: {
    usage: 'i18n-rosetta wrap [options]',
    description: [
      'Auto-wraps hardcoded strings in t() calls. Creates a backup',
      'before modifying files, with --undo support to restore.',
      '',
      'Safety gates: git-clean check, automatic backup, diff preview.',
    ],
    options: [
      ['--dry',           'Preview changes without writing files'],
      ['--undo',          'Restore files from .rosetta-backup/'],
      ['--src <path>',    'Source directory to process'],
      ['--min-length <n>','Minimum string length to wrap (default: 2)'],
      ['--config <path>', 'Path to config file'],
    ],
    examples: [
      'i18n-rosetta wrap                        # Auto-wrap with backup',
      'i18n-rosetta wrap --dry                  # Preview wrapping changes',
      'i18n-rosetta wrap --undo                 # Restore from backup',
    ],
  },

  seo: {
    usage: 'i18n-rosetta seo <subcommand> [options]',
    description: [
      'Generates SEO artifacts for multilingual sites.',
    ],
    subcommands: [
      ['hreflang', 'Generate <link rel="alternate" hreflang> tags'],
      ['sitemap',  'Generate multilingual sitemap.xml'],
      ['jsonld',   'Generate JSON-LD WebSite language schema'],
    ],
    options: [
      ['--base-url <url>', 'Override site base URL (required for sitemap)'],
      ['--out <path>',     'Write output to file (sitemap only)'],
      ['--config <path>',  'Path to config file'],
    ],
    examples: [
      'i18n-rosetta seo hreflang                         # Print hreflang tags',
      'i18n-rosetta seo sitemap --base-url https://example.com --out sitemap.xml',
      'i18n-rosetta seo jsonld --base-url https://example.com',
    ],
  },

  integrity: {
    usage: 'i18n-rosetta integrity [options]',
    description: [
      'Audits locale files for structural issues:',
      '  - Missing or extra placeholders ({name}, {count}, etc.)',
      '  - HTML tag mismatches',
      '  - Encoding problems (mojibake, BOM issues)',
      '  - Key structure drift between locales',
      '',
      'Returns exit code 1 if issues found (unless --warn-only).',
    ],
    options: [
      ['--warn-only',     'Exit 0 even if issues found'],
      ['--config <path>', 'Path to config file'],
      ['--dir <path>',    'Override locales directory'],
    ],
    examples: [
      'i18n-rosetta integrity                   # Full integrity audit',
      'i18n-rosetta integrity --warn-only       # Non-blocking audit',
    ],
  },

  status: {
    usage: 'i18n-rosetta status [options]',
    description: [
      'Shows the project configuration summary:',
      '  - Resolved pair graph with methods and models',
      '  - Installed plugins with versions and benchmarks',
      '  - Translation cost estimates per pair',
      '  - Format and directory information',
    ],
    options: [
      ['--config <path>', 'Path to config file'],
      ['--dir <path>',    'Override locales directory'],
    ],
    examples: [
      'i18n-rosetta status                      # Full project summary',
    ],
  },

  provenance: {
    usage: 'i18n-rosetta provenance [options]',
    description: [
      'Shows licensing and resource dependencies for all translation pairs.',
      'Flags methods using non-commercial resources (PROPRIETARY datasets,',
      'FST grammars, etc.) so you can verify compliance before shipping.',
    ],
    options: [
      ['--config <path>', 'Path to config file'],
    ],
    examples: [
      'i18n-rosetta provenance                  # Show all pair provenance',
    ],
  },

  plugin: {
    usage: 'i18n-rosetta plugin <subcommand> [options]',
    description: [
      'Manages method plugins — installable translation strategies',
      'that bundle model config, coaching data, and benchmarks.',
    ],
    subcommands: [
      ['list',              'List installed plugins with metadata'],
      ['install <path>',    'Install a plugin from a local directory'],
      ['remove <name>',     'Remove an installed plugin'],
    ],
    options: [],
    examples: [
      'i18n-rosetta plugin list                          # List plugins',
      'i18n-rosetta plugin install ./french-formal-v1/   # Install from dir',
      'i18n-rosetta plugin remove french-formal-v1       # Remove plugin',
    ],
  },
};

/**
 * Format and print help for a specific command.
 *
 * @param {string} commandName - The command to show help for
 * @returns {boolean} true if help was displayed, false if command not found
 */
function showCommandHelp(commandName) {
  const help = COMMAND_HELP[commandName];
  if (!help) return false;

  console.log('');
  console.log(`  i18n-rosetta ${commandName} — ${help.description[0]}`);
  console.log('');

  // Usage
  console.log('  USAGE');
  console.log(`    ${help.usage}`);
  console.log('');

  // Description
  if (help.description.length > 1) {
    console.log('  DESCRIPTION');
    for (const line of help.description) {
      console.log(`    ${line}`);
    }
    console.log('');
  }

  // Subcommands (for plugin, seo)
  if (help.subcommands && help.subcommands.length > 0) {
    console.log('  SUBCOMMANDS');
    const maxLen = Math.max(...help.subcommands.map(([name]) => name.length));
    for (const [name, desc] of help.subcommands) {
      console.log(`    ${name.padEnd(maxLen + 2)} ${desc}`);
    }
    console.log('');
  }

  // Options
  if (help.options && help.options.length > 0) {
    console.log('  OPTIONS');
    const maxLen = Math.max(...help.options.map(([flag]) => flag.length));
    for (const [flag, desc] of help.options) {
      console.log(`    ${flag.padEnd(maxLen + 2)} ${desc}`);
    }
    console.log('');
  }

  // Examples
  if (help.examples && help.examples.length > 0) {
    console.log('  EXAMPLES');
    for (const example of help.examples) {
      console.log(`    ${example}`);
    }
    console.log('');
  }

  return true;
}

export { COMMAND_HELP, showCommandHelp };
