/**
 * Command: help
 *
 * Prints the full CLI help screen with all commands, options,
 * supported formats, and quick-start instructions.
 */

import { CONFIG_FILENAMES } from '../config.js';

const DEFAULT_CONFIG_FILENAME = CONFIG_FILENAMES[0];

function run() {
  console.log(`
  i18n-rosetta v3 — Research-grade translation engine for i18n projects

  COMMANDS
    init         Interactive setup wizard (or --yes for quick defaults)
    sync         Translate & sync all locale files
    watch        Auto-sync when the source file changes
    audit        List all untranslated [EN] fallback values
    lint         Scan source files for hardcoded strings (pre-commit gate)
    wrap         Auto-wrap hardcoded strings in t() calls (with undo)
    seo          Generate hreflang, sitemap.xml, or JSON-LD schema
    integrity    Audit locale files for placeholder/encoding issues
    status       Show pair graph, methods, and config summary
    provenance   Show licensing & resource dependencies for all pairs
    plugin       Manage method plugins (install, remove, list)

  OPTIONS
    --config <path>    Path to config file (default: ${DEFAULT_CONFIG_FILENAME})
    --dir <path>       Override locales directory
    --content-dir <p>  Hugo content directory for Markdown translation
    --source <code>    Override source locale (default: en)
    --base-url <url>   Override base URL for SEO commands
    --model <model>    Override translation model
    --format <fmt>     Locale file format: json, toml, yaml, or auto (default: auto)
    --dry              Preview changes without writing files
    --force-keys <k>   Comma-separated dot-notation keys to force re-translate
    --src <path>       Source directory for lint/wrap (auto-detected)
    --min-length <n>   Minimum string length to flag (default: 2)
    --warn-only        Exit 0 even with issues (lint, integrity)
    --undo             Restore files from .rosetta-backup/ (wrap)
    --out <path>       Write output to file (seo sitemap)

  SUPPORTED FORMATS
    json     Standard JSON (next-intl, i18next, react-intl)
    toml     Hugo i18n TOML files (i18n/*.toml)
    yaml     Hugo i18n YAML files (i18n/*.yaml)
    auto     Auto-detect from file extensions in locales directory

  QUICK START
    1. Set OPENROUTER_API_KEY in your environment or .env.local
    2. Put your source locale (en.json / en.toml / en.yaml) in a locales/ directory
    3. Run: i18n-rosetta sync

  The tool will:
    • Auto-detect locale file format (JSON, TOML, or YAML)
    • Translate missing keys via OpenRouter (gpt-4o-mini)
    • Translate Hugo Markdown content files (if --content-dir is set)
    • Fall back to [EN]-prefixed English if the API is unavailable
    • Batch translations to avoid token overflow
    • Preserve your file structure and formatting

  Run i18n-rosetta <command> --help for detailed help on any command.
  `);
}

export { run };
