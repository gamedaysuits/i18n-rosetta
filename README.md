# i18n-rosetta

[![npm version](https://img.shields.io/npm/v/i18n-rosetta.svg)](https://www.npmjs.com/package/i18n-rosetta)
[![CI](https://github.com/gamedaysuits/i18n-rosetta/actions/workflows/ci.yml/badge.svg)](https://github.com/gamedaysuits/i18n-rosetta/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> Most translation tools assume Google Translate speaks your language. What if it doesn't?

**i18n-rosetta** is a pluggable translation engine where each language pair can use a different method — LLM, coached LLM with grammar rules, Google Translate, or a custom API. Born from translating a production website into Plains Cree, where no off-the-shelf API exists.

```bash
npx i18n-rosetta sync       # translate all missing keys
```

## Quick Start

```bash
npm install --save-dev i18n-rosetta
```

### Get an API Key

Rosetta needs a translation API. Pick one:

| Provider | Key | Best for |
|----------|-----|----------|
| **OpenRouter** (recommended) | `OPENROUTER_API_KEY` | Content-heavy projects, Markdown, 200+ models |
| **Google Translate** | `GOOGLE_TRANSLATE_API_KEY` | High-volume key-value pairs (130+ languages) |

**OpenRouter** (free tier available): Sign up at [openrouter.ai](https://openrouter.ai), then:

```bash
export OPENROUTER_API_KEY=sk-or-v1-...
npx i18n-rosetta sync
```

**Google Translate** alternative (key-value pairs only — no Markdown awareness):

```bash
export GOOGLE_TRANSLATE_API_KEY=...
npx i18n-rosetta sync --method google-translate
```

> **Note**: If only `GOOGLE_TRANSLATE_API_KEY` is set, rosetta auto-switches to Google Translate. No config change needed.

That's it. Rosetta auto-detects your locale files, their format, and the target languages. For more control, create a config file:

```bash
npx i18n-rosetta init
```

### Non-English Source

If your source language isn't English:

```bash
i18n-rosetta sync --source fr                      # CLI flag
```

Or set it permanently in your config:

```json
{ "inputLocale": "fr" }
```

## Why Per-Pair Methods?

Translating into French and translating into Plains Cree are fundamentally different problems. French has massive training data, grammar checkers, and Google Translate support. Plains Cree has none of that — it needs coached LLM prompts with morphological rules, or a custom API backed by community-built resources.

Rosetta lets each language pair use whatever method actually works:

```json
{
  "version": 3,
  "pairs": {
    "en:fr": { "method": "google-translate" },
    "en:ja": { "method": "llm" },
    "en:crk": { "methodPlugin": "crk-coached-v1" }
  }
}
```

If no config or pairs are specified, rosetta uses the default LLM method via OpenRouter.

## What It Does

You handle the i18n framework (next-intl, i18next, Hugo). Rosetta handles the translation files.

- **Multi-format** — JSON, TOML, YAML, and Hugo Markdown (front matter + body)
- **Incremental** — Only translates what changed (SHA-256 hash tracking)
- **Pluggable methods** — LLM (default), coached LLM, Google Translate, or remote API via per-pair config
- **Per-pair config** — Different models, methods, and quality tiers per language pair
- **Language registers** — Culturally tuned tones (formal French, polite Japanese, etc.) — visible during setup, customizable per language
- **Content-aware** — LLM methods shield code blocks, shortcodes, links, and interpolation variables during Markdown translation
- **Pipeline tools** — `lint`, `audit`, `integrity`, `seo` for CI gates
- **Zero dependencies** — Node.js built-ins only. Requires Node 20+

## Choose Your Method

| Method | Key | What It Does | Best For |
|--------|-----|-------------|----------|
| `llm` (default) | `OPENROUTER_API_KEY` | LLM translation via OpenRouter | General purpose, content-heavy projects |
| `llm-coached` | `OPENROUTER_API_KEY` | LLM + grammar rules & dictionaries | Low-resource languages, specialized domains |
| `google-translate` | `GOOGLE_TRANSLATE_API_KEY` | Google Cloud Translation API v2 | High-volume key-value pairs (130+ languages) |
| `api` | *(per provider)* | Remote translation API | IP-protected or community-hosted models |

**Smart method detection**: If only `GOOGLE_TRANSLATE_API_KEY` is set (no OpenRouter key), rosetta auto-switches to Google Translate. You can also force a method via CLI:

```bash
i18n-rosetta sync --method google-translate
```

> **Note**: Google Translate handles key-value pairs well but cannot safely translate Markdown content (it has no awareness of code blocks, shortcodes, or interpolation variables). For content-heavy projects, LLM methods are recommended — they explicitly shield structured elements during translation.

## Plugins

Plugins are pre-packaged translation recipes for specific language pairs. They're JSON manifests — not code — that tell rosetta which method to use, with what settings, and what quality has been benchmarked.

```bash
i18n-rosetta plugin install ./french-formal-v1/    # install from directory
i18n-rosetta plugin list                           # see installed plugins
i18n-rosetta plugin remove french-formal-v1        # uninstall
i18n-rosetta status                                # shows quality tiers + benchmarks
```

See [docs/METHOD_PLUGIN_SPEC.md](https://github.com/gamedaysuits/i18n-rosetta/blob/main/docs/METHOD_PLUGIN_SPEC.md) for the manifest format.

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
| `status` | Show pair configuration, methods, registers, and quality tiers |
| `provenance` | Audit translation resource licensing |
| `plugin` | Install, remove, or list method plugins |

Run `i18n-rosetta <command> --help` for detailed help on any command.

Full reference: [docs/CLI_REFERENCE.md](https://github.com/gamedaysuits/i18n-rosetta/blob/main/docs/CLI_REFERENCE.md)

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
| `inputLocale` | `"en"` | Source language code |
| `localesDir` | `"./locales"` | Path to locale files |
| `contentDir` | `null` | Hugo content directory (enables Markdown translation) |
| `format` | `"auto"` | File format: `json`, `toml`, `yaml`, or `auto` |
| `model` | `"openai/gpt-4o-mini"` | Default OpenRouter model |
| `defaultMethod` | `"llm"` | Default translation method (overridden by `--method` flag) |
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

Framework setup guides: [docs/INTEGRATION_GUIDES.md](https://github.com/gamedaysuits/i18n-rosetta/blob/main/docs/INTEGRATION_GUIDES.md)

## Hardening

- **Exponential backoff** — 3 retries with jitter on 429/5xx errors
- **30s request timeout** — AbortController prevents hanging
- **Response validation** — only accepts keys that were sent for translation
- **Prototype pollution guard** — blocks `__proto__`, `constructor`, `prototype`
- **Path containment** — file writes validated to stay within configured directories
- **Block protection** — code blocks, shortcodes, HTML shielded during content translation
- **Explicit fallback** — `--fallback` writes `[EN]`-prefixed placeholders when the API is unavailable (re-sync with a key for real translations)
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

**Zero dependencies.**

## License

MIT
