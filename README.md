# i18n-rosetta

[![npm version](https://img.shields.io/npm/v/i18n-rosetta.svg)](https://www.npmjs.com/package/i18n-rosetta)
[![CI](https://github.com/gamedaysuits/i18n-rosetta/actions/workflows/ci.yml/badge.svg)](https://github.com/gamedaysuits/i18n-rosetta/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Pluggable translation engine for i18n projects.** Sync locale files from a single source — JSON, TOML, YAML, or Markdown. Zero dependencies, config-optional.

```bash
npx i18n-rosetta sync       # translate all missing keys
```

## Quick Start

```bash
npm install --save-dev i18n-rosetta
```

Set your API key and sync:

```bash
export OPENROUTER_API_KEY=sk-or-v1-...
npx i18n-rosetta sync
```

That's it. Rosetta auto-detects your locale files, their format, and the target languages. For more control, create a config file:

```bash
npx i18n-rosetta init
```

## v3 Breaking Changes

If you're upgrading from v2:

- **Node.js 20+ required** (dropped Node 18)
- **ESM only** — the package is now pure ESM. `require()` is no longer supported.
- **Config `version: 3`** — v2 configs are auto-migrated on first run
- **Config filename** — `i18n-rosetta.config.json` only
- **Lock filename** — `.i18n-rosetta.lock` only

## What It Does

You handle the i18n framework (next-intl, i18next, Hugo). Rosetta handles the translation files.

- **Multi-format** — JSON, TOML, YAML, and Hugo Markdown (front matter + body)
- **Incremental** — Only translates what changed (SHA-256 hash tracking)
- **Pluggable methods** — LLM (default), coached LLM, Google Translate, or remote API via per-pair config
- **Per-pair config** — Different models, methods, and quality tiers per language pair
- **45+ registers** — Culturally tuned tones (formal French, polite Japanese, etc.)
- **Pipeline tools** — `lint`, `audit`, `integrity`, `seo` for CI gates
- **Zero dependencies** — Node.js built-ins only. Requires Node 20+

## Choose Your Method

| Method | Key | What It Does | Cost |
|--------|-----|-------------|------|
| `llm` (default) | `OPENROUTER_API_KEY` | LLM translation via OpenRouter | ~$0.01/1K keys |
| `llm-coached` | `OPENROUTER_API_KEY` | LLM + grammar rules & dictionaries | ~$0.01/1K keys |
| `google-translate` | `GOOGLE_TRANSLATE_API_KEY` | Google Cloud Translation API v2 | ~$20/M chars |
| `api` | *(per provider)* | Remote translation API | Per provider |

Methods are configured per language pair in your config:

```json
{
  "version": 3,
  "pairs": {
    "en:fr": { "method": "llm" },
    "en:ja": { "method": "google-translate" },
    "en:crk": { "methodPlugin": "crk-coached-v1" }
  }
}
```

If no config or pairs are specified, rosetta uses the default LLM method via OpenRouter.

## Plugins

Plugins are pre-packaged translation recipes for specific language pairs. They're JSON manifests — not code — that tell rosetta which method to use, with what settings, and what quality has been benchmarked.

```bash
i18n-rosetta plugin install ./french-formal-v1/    # install from directory
i18n-rosetta plugin list                           # see installed plugins
i18n-rosetta plugin remove french-formal-v1        # uninstall
i18n-rosetta status                                # shows quality tiers + benchmarks
```

See [docs/METHOD_PLUGIN_SPEC.md](docs/METHOD_PLUGIN_SPEC.md) for the manifest format.

## Commands

| Command | Purpose |
|---------|---------|
| `init` | Interactive setup wizard (or `--yes` for quick defaults) |
| `sync` | Translate & sync all locale files |
| `watch` | Auto-sync on file changes |
| `audit` | Flag incomplete locales (CI gate) |
| `lint` | Find hardcoded strings in source code |
| `wrap` | Auto-wrap hardcoded strings in `t()` calls (with undo) |
| `seo` | Generate hreflang, sitemap.xml, or JSON-LD schema |
| `integrity` | Check for placeholder corruption and encoding issues |
| `status` | Show pair configuration, methods, and quality tiers |
| `provenance` | Audit translation resource licensing |
| `plugin` | Install, remove, or list method plugins |

Run `i18n-rosetta <command> --help` for detailed help on any command.

Full reference: [docs/CLI_REFERENCE.md](docs/CLI_REFERENCE.md)

## Configuration

Create `i18n-rosetta.config.json` or run `i18n-rosetta init`:

```json
{
  "version": 3,
  "inputLocale": "en",
  "localesDir": "./locales",
  "model": "openai/gpt-4o-mini",
  "pairs": {
    "en:fr": { "qualityTier": "high" },
    "en:ja": { "method": "google-translate" }
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `inputLocale` | `"en"` | Source language code (`sourceLocale` also accepted) |
| `localesDir` | `"./locales"` | Path to locale files |
| `contentDir` | `null` | Hugo content directory (enables Markdown translation) |
| `format` | `"auto"` | File format: `json`, `toml`, `yaml`, or `auto` |
| `model` | `"openai/gpt-4o-mini"` | Default OpenRouter model |
| `batchSize` | `30` | Keys per translation batch |
| `pairs` | `{}` | Per-pair method, model, and quality overrides |

**Zero-config mode**: No config file? Rosetta auto-detects locale files, format, and target languages from your project.

**Custom registers**: Control translation tone per language:

```json
{
  "languages": {
    "fr": "Formal academic French. Use vous-form.",
    "ja": "Polite professional register (です/ます form)."
  }
}
```

Framework setup guides: [docs/INTEGRATION_GUIDES.md](docs/INTEGRATION_GUIDES.md)

## Hardening

- **Exponential backoff** — 3 retries with jitter on 429/5xx errors
- **30s request timeout** — AbortController prevents hanging
- **Response validation** — only accepts keys that were sent for translation
- **Prototype pollution guard** — blocks `__proto__`, `constructor`, `prototype`
- **Path containment** — file writes validated to stay within configured directories
- **Block protection** — code blocks, shortcodes, HTML shielded during content translation
- **Graceful degradation** — `[EN]`-prefixed fallbacks when the API is down
- **Partial success** — one failed batch doesn't block the rest

## Testing

```bash
npm test                         # all tests
npm run test:unit                # core sync pipeline
npm run test:redteam             # adversarial edge cases
npm run test:format              # TOML/YAML adapters
npm run test:content             # Markdown content parser
npm run test:hugo                # full Hugo E2E
npm run test:lint                # hardcoded string detection
npm run test:pairs               # pair graph resolution
npm run test:methods             # translation method suite
```

**635 tests, zero dependencies.**

## License

MIT
