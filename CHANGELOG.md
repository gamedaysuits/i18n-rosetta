# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.1.0] - 2026-05-13

### Added
- **`--method` CLI flag**: Override the default translation method from the command line (`llm`, `google-translate`, `api`).
- **Smart method detection**: If `GOOGLE_TRANSLATE_API_KEY` is set but no `OPENROUTER_API_KEY`, auto-switches to Google Translate.
- **Markdown safety warnings**: Google Translate method now warns when content translation falls back to LLM, explaining that Google Translate has no awareness of code blocks, shortcodes, or interpolation variables.
- **Register display**: `init` wizard shows the active register for each selected language. `status` command shows registers with `(default)` or `(custom)` labels.

### Changed
- **Config field standardized**: `inputLocale` is the canonical field. The deprecated `sourceLocale` alias has been removed.
- **Simplified config pipeline**: Removed v2→v3 auto-migration system (no external users to migrate).
- **Pairs use `defaultMethod`**: The pair graph respects the global `defaultMethod` config value, enabling CLI-driven and env-driven method selection.

### Removed
- `lib/migrate.js` — v2→v3 migration system (dead code).
- `sourceLocale` config alias — use `inputLocale` instead.
- v2 compatibility branch in translation dispatch.

## [3.0.0] - 2026-05-12

Initial public release. Per-pair translation engine with pluggable methods.

### Architecture
- **Pair graph** (`lib/pairs.js`): Each source→target pair is independently configurable with method, model, quality tier, batch size, and register.
- **Pluggable methods**: LLM (default), coached LLM, Google Translate, and remote API. Each pair can use a different method.
- **Plugin system** (`lib/plugins.js`): Install, remove, and validate pre-packaged translation recipes (JSON manifests, not code).
- **Pure ESM** with Node.js 20.11+ required.

### Translation Methods
- **LLM** (`lib/methods/llm.js`): Default method via OpenRouter with exponential backoff, key validation, and content-aware Markdown shielding.
- **Google Translate** (`lib/methods/google-translate.js`): Google Cloud Translation API v2 for key-value pairs. API key sent via header.
- **Coached LLM** (`lib/methods/llm-coached.js`): Grammar rules, dictionaries, and style notes injected into LLM prompts.
- **Remote API** (`lib/methods/api.js`): Thin HTTP client for community-hosted or IP-protected endpoints.
- **Script converters** (`lib/scripts.js`): Deterministic transliteration (Simplified↔Traditional Chinese, Cyrillic↔Latin Serbian) — zero-LLM, zero-cost.

### Formats & Content
- JSON, TOML, YAML locale files (auto-detected from file extensions).
- Hugo Markdown translation with front matter + body block protection (code fences, shortcodes, HTML).

### Developer Tools
- `sync`, `watch`, `audit`, `lint`, `wrap`, `seo`, `integrity`, `status`, `provenance`, `plugin` commands.
- Interactive `init` wizard with language preset groups and register display.
- Per-command `--help` for every command.
- JSON Schema for plugin manifests (`schemas/rosetta-plugin.schema.json`).

### Security
- Prototype pollution guard: `__proto__`, `constructor`, `prototype` rejected.
- Path containment: file writes validated to configured directories.
- Response validation: rejects hallucinated keys from LLM responses.
- Adversarial test suite (`test/redteam.test.js`).

### Quality
- 45+ language registers with culturally appropriate tones, RTL hints, and script directions.
- 618 tests across 141 suites — zero external dependencies.
