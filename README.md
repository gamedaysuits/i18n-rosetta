# i18n-rosetta

[![npm version](https://img.shields.io/npm/v/i18n-rosetta.svg)](https://www.npmjs.com/package/i18n-rosetta)
[![CI](https://github.com/gamedaysuits/i18n-rosetta/actions/workflows/ci.yml/badge.svg)](https://github.com/gamedaysuits/i18n-rosetta/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Translate your locale files with one command:

```bash
npx i18n-rosetta sync
```

Rosetta auto-detects your locale files, their format, and the target languages. It translates missing keys, skips what's already done, and writes the results. That's it.

## Why Not Just Script It Yourself?

You could write a quick script that loops through your English keys and calls Google Translate. Most developers do — it takes about 30 lines. Here's why it breaks:

- **No change detection.** When you update an English string, the translation stays stale forever. Rosetta tracks every source value with SHA-256 hashes and re-translates only what changed.
- **No batching.** One API call per key means 200 keys = 200 round trips. Rosetta batches intelligently (configurable, default 30 keys/batch for LLM, 128 for Google).
- **No quality gate.** Machine translation hallucinates, echoes the source back, or outputs in the wrong script. Rosetta validates every translation before writing it — wrong-script, length inflation, and source echoes are caught and rejected.
- **No format awareness.** Hardcoded to JSON? Rosetta handles JSON, TOML, YAML, and Hugo Markdown (frontmatter + body) with auto-detection.
- **No safety.** Rosetta guards against prototype pollution, path traversal via crafted locale codes, and code block corruption during Markdown translation.

Rosetta is the production version of that script.

## Quick Start

```bash
npm install --save-dev i18n-rosetta
```

### Get an API Key

Rosetta needs a translation backend. Pick one:

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

> **Note**: If only `GOOGLE_TRANSLATE_API_KEY` is set, rosetta auto-switches to Google Translate. No config change needed. Uses the REST API directly — no SDK, no service account, no `pip install`. Just the key.

That's it. For more control, create a config file:

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

## What It Does

You handle the i18n framework (next-intl, i18next, Hugo). Rosetta handles the translation files.

- **Multi-format** — JSON, TOML, YAML, and Hugo Markdown (front matter + body)
- **Incremental** — Only translates what changed (SHA-256 hash tracking)
- **Quality-gated** — Validates every translation: catches hallucinations, wrong-script output, source echoes, and length inflation
- **Content-aware** — LLM methods shield code blocks, shortcodes, links, and interpolation variables during Markdown translation
- **Pipeline tools** — `lint`, `audit`, `integrity`, `seo` for CI gates
- **Zero dependencies** — Node.js built-ins only. No SDKs, no native modules. Requires Node 20+

## Beyond Google Translate

The quick start gets you running with an LLM or Google Translate. But Google Translate supports ~130 languages. There are over 7,000.

**Rosetta's core idea: the translation method is configurable per language pair.** Use Google Translate for French, an LLM with morphological coaching for Plains Cree, and a community-hosted API for Quechua — all in the same project, all with the same CLI.

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

If you can figure out how to translate a language pair — through prompt engineering, community dictionaries, FST pipelines, or fine-tuned models — rosetta lets you package that method as a plugin and deploy it alongside everything else.

> Born from translating a production website into Plains Cree, where no off-the-shelf API exists. The per-pair architecture isn't theoretical — it exists because one project needed Google Translate for French and a coached FST pipeline for an Indigenous language, running side by side in the same sync command.

The companion [MT Eval Harness](https://github.com/gamedaysuits/gds-mt-eval-harness) lets you benchmark and compare translation approaches, then export working methods as rosetta plugins. Anyone who speaks both languages can develop, test, and share a translation method — no proprietary platform required.

### Choose Your Method

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

**Per-language overrides**: Languages that need special handling can override model, batch size, and retry budget:

```json
{
  "languages": {
    "fr": "Formal academic French. Use vous-form.",
    "crk": {
      "name": "Plains Cree",
      "register": "SRO syllabics with grammatical precision.",
      "model": "google/gemini-2.5-pro",
      "batchSize": 5,
      "maxRetries": 5,
      "script": "cans"
    }
  }
}

**Zero-config mode**: No config file? Rosetta auto-detects locale files, format, and target languages from your project.

Language values can be a string (register shorthand) or an object (full control). Pair-level overrides in `pairs` take priority over language-level settings.

Framework setup guides: [docs/INTEGRATION_GUIDES.md](https://github.com/gamedaysuits/i18n-rosetta/blob/main/docs/INTEGRATION_GUIDES.md)

## Hardening

- **Exponential backoff** — 3 retries with jitter on 429/5xx errors
- **30s request timeout** — AbortController prevents hanging
- **Response validation** — only accepts keys that were sent for translation
- **Quality gate** — catches hallucination loops, wrong-script output, length inflation, and source echoes
- **Retry cascade** — on JSON parse failure, retries batch → half-batch → individual keys (budget-capped via `maxRetries`)
- **Prompt caching** — system/user message split enables provider-level caching, reducing token cost across batches
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
