# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-05-13

### ⚠️ BREAKING

- **Pure ESM** — the package is now ESM-only (`"type": "module"`). `require()` is no longer supported.
- **Node.js 20.11+** required (uses `import.meta.dirname`).
- **Config filename** — `i18n-rosetta.config.json` only. Legacy `i18n-autopilot.config.json` is no longer auto-detected.
- **Lock filename** — `.i18n-rosetta.lock` only.
- **CLI binary** — `i18n-rosetta` only. The `i18n-autopilot` alias has been removed.
- **API method env var** — `ROSETTA_API_KEY` replaces `GDS_TRANSLATE_API_KEY` for remote translation endpoints.
- **Pair-based architecture** — the translation engine is restructured around a pair graph. Each source→target pair is independently configurable.
- **Library errors** — core modules throw `Error` objects instead of calling `process.exit()`, enabling programmatic use.

### Added
- **Pair graph** (`lib/pairs.js`): Per-pair configuration with method, model, quality tier, batch size, and register. Pairs are resolved from config, auto-detected locales, and built-in register defaults.
- **Pluggable translation methods**: LLM (default), coached LLM, Google Translate, and remote API via the method registry. Each pair can use a different method.
- **Plugin system** (`lib/plugins.js`): Install, remove, list, and validate pre-packaged translation recipes (`method.json` manifests). Stored in `.rosetta/methods/`.
- **Google Translate method** (`lib/methods/google-translate.js`): Built-in baseline using Google Cloud Translation API v2. API key sent via header, not query string.
- **API method** (`lib/methods/api.js`): Thin HTTP client for remote translation endpoints. Zero translation logic client-side.
- **Coached translation method** (`lib/methods/llm-coached.js`): Grammar rules, dictionaries, and style notes injected into LLM prompts via `.rosetta/coaching/<locale>.json`.
- **Provenance tracking** (`lib/provenance.js`): Licensing audit for translation resources. Reports commercial readiness and flags per method.
- **Script converters** (`lib/scripts.js`): Deterministic transliteration (Simplified↔Traditional Chinese, Cyrillic↔Latin Serbian, etc.) — zero-LLM, zero-cost, lossless.
- **Lint command** (`lib/lint.js`): Static analysis for hardcoded strings in source code. Supports `.rosettaignore`.
- **Wrap command** (`lib/commands/wrap.js`): Auto-wrap hardcoded strings in `t()` calls with undo support.
- **SEO auditing** (`lib/seo.js`): Generate hreflang tags, sitemap.xml, and JSON-LD schema. Validates language meta attributes.
- **Integrity auditing** (`lib/integrity.js`): Detects placeholder corruption, encoding issues, and orphaned keys.
- **Migration tool** (`lib/migrate.js`): Automated v2→v3 config migration with backup.
- **Interactive init wizard** (`lib/commands/init.js`): Guided setup with language preset groups. Silent defaults via `--yes`.
- **Per-command `--help`**: Every command supports `i18n-rosetta <cmd> --help` with focused usage, options, and examples.
- **JSON Schema** (`schemas/rosetta-plugin.schema.json`): Machine-readable contract for plugin manifests. Published in npm package for IDE autocompletion.
- **Centralized OpenRouter client** (`lib/methods/openrouter-client.js`): Shared HTTP client with retry, backoff, and security filtering.
- **Multi-format locale support**: JSON, TOML, and YAML. Auto-detected from file extensions.
- **Hugo content translation** (`lib/content.js`): Markdown front matter + body translation with block protection for code fences, shortcodes, and HTML.
- **Red-team test suite** (`test/redteam.test.js`): Adversarial testing for injection, prototype pollution, prompt manipulation, and path traversal.
- **45+ language registers** with culturally appropriate tones, RTL hints, and script directions.
- **635 tests** across 144 suites — zero external dependencies.

### Changed
- **CLI decomposed**: `bin/cli.js` refactored from monolithic dispatcher to 69-line entry point with 11 command modules in `lib/commands/`.
- **All internal imports** use `node:` prefix and `.js` extensions (ESM-compliant).
- **Prototype pollution guard**: `__proto__`, `constructor`, `prototype` rejected from source files and LLM responses.
- **Path containment**: File writes validated to stay within configured directories.

## [2.0.1] - 2026-05-04

### Fixed
- **Placeholder corruption detection**: After restoring protected blocks in translated Markdown, the engine scans for orphaned `⟦PROTECTED_N⟧` tokens. Mangled placeholders cause the translated body to be discarded with a warning.
- **TOML nested table handling**: Parser now properly skips keys inside `[section]` headers.

## [2.0.0] - 2026-05-04

### Added
- Multi-format locale support (TOML, YAML alongside JSON).
- Hugo content translation with front matter and body.
- Raw content translation via OpenRouter.

### Changed
- Package published as `i18n-rosetta` on npm.

## [1.3.0] - 2026-05-04

### Added
- Context-aware translation prompts with per-key type hints.
- Gender-neutrality instruction for gendered languages.
- 5 new language registers (bg, cs, da, fi, sk).
- Security hardening: prototype pollution guard, path containment.

## [1.2.0] - 2026-05-03

### Added
- SHA-256 content hashing with `.i18n-rosetta.lock` manifest for automatic stale detection.
- `--force-keys` CLI flag for explicit re-translation.

## [1.1.0] - 2026-05-02

### Added
- 30+ built-in language registers.
- Constructed/novelty language support (Klingon, Pirate English, Elvish).
- `audit` command and `watch` mode.

## [1.0.0] - 2026-05-01

### Added
- Initial release.
- OpenRouter translation engine with batching, backoff, and timeout.
- Response key validation (rejects hallucinated keys).
- `[EN]`-prefixed fallbacks when API is unavailable.
- JSON flatten/unflatten for nested locales.
- Zero external dependencies.
