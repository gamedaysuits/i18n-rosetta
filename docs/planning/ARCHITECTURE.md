# Rosetta Translation Ecosystem — Architecture Guide

> **Version**: 1.1  
> **Purpose**: Explains how the three pieces of the Rosetta translation ecosystem fit together.  
> **Ecosystem status**: i18n-rosetta is the production-ready open-source tool. Rosetta Translate API and the eval harness are internal/planned infrastructure — documented here for architectural context.

---

## The Three Pieces

The Rosetta translation ecosystem is three independent tools that work together
through well-defined contracts. None of them depend on each other at build
time. They communicate through a shared **method plugin format** and a
**REST API contract**.

```
┌───────────────────────┐          ┌────────────────────────┐
│  gds-mt-eval-harness  │          │     Rosetta Translate       │
│  ──────────────────── │          │  ──────────────────────  │
│  Research tool         │          │  Metered API service    │
│  Develops & benchmarks │          │  Hosts IP-protected     │
│  translation methods   │          │  translation pipelines  │
│                        │          │                         │
│  Python / standalone   │          │  Node.js or Python      │
│  [PRIVATE / INTERNAL]  │          │  [PLANNED]              │
└──────────┬────────────┘          └──────────┬─────────────┘
           │                                  │
           │  method.json                     │  REST API
           │  + coaching data                 │  POST /v1/translate
           │  (export)                        │  GET /v1/methods
           │                                  │
           ▼                                  ▼
┌─────────────────────────────────────────────────────────┐
│                     i18n-rosetta                         │
│  ─────────────────────────────────────────────────────── │
│  Open-source developer tool (npm)                        │
│  Translates locale files using pluggable methods         │
│  Zero dependencies · Node.js 20+                         │
│                                                          │
│  Built-in methods:                                       │
│    llm             → OpenRouter / any LLM                │
│    llm-coached     → LLM + grammar/dictionary coaching   │
│    google-translate → Google Cloud Translation API       │
│    api             → Thin pipe to any remote API         │
│                                                          │
│  Plugin system:                                          │
│    .rosetta/methods/<name>/method.json                   │
│    Installed via CLI: rosetta plugin install <path>       │
└─────────────────────────────────────────────────────────┘
```

---

## How They Connect

### 1. Eval Harness → i18n-rosetta (one-way export)

The eval harness is a **research tool**. It develops, tests, and benchmarks
translation methods. When a method reaches acceptable quality, the harness
exports a **method plugin** — a `method.json` manifest and optional coaching
data files.

```
gds-mt-eval-harness              i18n-rosetta
──────────────────               ─────────────
Run benchmarks                   rosetta plugin install ./french-formal-v1/
Export method.json       ────►   Plugin saved to .rosetta/methods/
Include coaching data            Method available for rosetta sync
Include benchmark scores         Benchmarks shown in rosetta status
```

**The harness never runs inside rosetta.** It's a separate tool that produces
static output (JSON files). Rosetta just reads those files.

**Contract**: `docs/METHOD_PLUGIN_SPEC.md`

---

### 2. Rosetta Translate → i18n-rosetta (API at runtime)

Rosetta Translate is a **metered API service**. It hosts proprietary translation
methods server-side — the prompts, coaching data, and linguistic pipelines
never leave the server.

```
i18n-rosetta (client)            Rosetta Translate (server)
─────────────────────            ──────────────────────
rosetta sync                     Receives keys + target locale
  → APIMethod.translate()        Loads coaching data (server-side)
  → POST /v1/translate           Calls LLM (OpenRouter, etc.)
  ← translations + billing       Validates output
  ← meta.cost_usd                Returns translations
```

Rosetta's `APIMethod` (lib/methods/api.js) is a **dumb pipe**. It sends keys
out and receives translations back. It contains zero translation logic and
zero proprietary content.

**Contract**: `docs/planning/TRANSLATE_API_SPEC.md`

---

### 3. Eval Harness → Rosetta Translate (method deployment)

The eval harness also feeds Rosetta Translate. When a proprietary method is
developed and benchmarked, the coaching data and config are deployed to the
Rosetta Translate server — NOT exported to a public plugin.

```
gds-mt-eval-harness              Rosetta Translate
──────────────────               ──────────────
Develop method                   Deploy to methods/ directory
Benchmark method         ────►   Register in methods table
Verify quality metrics           Available via GET /v1/methods
                                 Callable via POST /v1/translate
```

The key difference from the i18n-rosetta export path:

| | Open Plugin (→ rosetta) | Proprietary (→ Rosetta Translate) |
|---|---|---|
| Coaching data location | Bundled in plugin directory | Server-side only |
| Method type in rosetta | `llm-coached` | `api` |
| User sees prompts? | Yes | No |
| Pricing | Free | Metered |
| IP protection | None (open source) | Full (server-side) |

---

## The Plugin Format (Shared Contract)

The `method.json` manifest is the universal interchange format. The eval
harness produces it, rosetta consumes it, and Rosetta Translate's `/methods/:name`
endpoint returns it.

```json
{
  "name": "french-formal-v1",
  "type": "llm-coached",
  "version": "1.0.0",
  "description": "Formally-tuned French with terminology enforcement",
  "locales": ["fr"],
  "config": {
    "model": "openai/gpt-4o-mini",
    "register": "formal",
    "batchSize": 30
  },
  "benchmarks": {
    "fr": {
      "corpus_chrf": 72.3,
      "exact_match_rate": 0.42,
      "corpus_size": 500,
      "date": "2026-05-11T00:00:00Z",
      "harness_version": "1.0.0"
    }
  },
  "provenance": {
    "resources": [],
    "commercialReady": false,
    "flags": ["license-unclear"]
  }
}
```

**Full spec**: `docs/METHOD_PLUGIN_SPEC.md`

---

## What Each Piece Knows About the Others

| Tool | Knows about rosetta? | Knows about Rosetta Translate? | Knows about harness? |
|---|---|---|---|
| **i18n-rosetta** | (is rosetta) | Yes — `api` method calls it | No — just reads plugin exports |
| **Rosetta Translate** | Yes — serves its requests | (is Rosetta Translate) | No — receives deployed methods |
| **Eval Harness** | Yes — exports plugin format | No — methods deployed separately | (is the harness) |

---

## User Scenarios

### Scenario 1: Free, zero-config (most users)

```bash
export OPENROUTER_API_KEY=sk-...
npx i18n-rosetta sync
```
- Uses built-in `llm` method
- No plugins, no Rosetta Translate, no harness

### Scenario 2: Google Translate baseline

```bash
export GOOGLE_TRANSLATE_API_KEY=AIza...
npx i18n-rosetta sync
```
- Uses built-in `google-translate` method
- No plugins needed

### Scenario 3: Premium server-side translations

```bash
export ROSETTA_TRANSLATE_API_KEY=rosetta_sk_live_...
rosetta plugin install crk-coached-v1      # installs API manifest
rosetta sync                                # routes crk keys through Rosetta Translate
```
- Plugin manifest has `type: "api"` → rosetta uses `APIMethod`
- All IP stays on the Rosetta Translate server

### Scenario 4: Open plugin with bundled coaching

```bash
rosetta plugin install ./french-formal-v1/  # from harness export
rosetta sync                                # uses llm-coached with bundled data
```
- Plugin has `type: "llm-coached"` → rosetta uses user's own OpenRouter key
- Coaching data is local (no server call)

### Scenario 5: DIY coaching (no plugin, no harness)

```json
// i18n-rosetta.config.json
{
  "version": 3,
  "pairs": {
    "en:fr": { "method": "llm-coached" }
  }
}
```
```
.rosetta/coaching/fr.json   ← user writes their own coaching data
```
- No plugin, no harness, no Rosetta Translate
- User maintains their own grammar rules and dictionary

---

## Design Principles

1. **No circular dependencies.** The bridges are one-way. The harness exports
   to rosetta; rosetta calls Rosetta Translate. Neither calls back.

2. **Rosetta is the lightweight core.** Zero dependencies, config-optional,
   works out of the box. Plugins and API are additive.

3. **IP protection is architectural.** Proprietary techniques stay server-side
   in Rosetta Translate. The npm package ships nothing proprietary.

4. **The plugin format is the contract.** Everything flows through `method.json`.
   If the harness can produce it and rosetta can read it, the system works.

5. **Each tool has one job:**
   - Harness → develop and validate translation methods
   - Rosetta Translate → host and meter premium translations
   - Rosetta → translate locale files using whatever method is configured
