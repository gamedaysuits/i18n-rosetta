---
sidebar_position: 4
title: Method Interface
---

# Shared Method Interface

The eval harness and i18n-rosetta share a common concept of **translation method**. A method is any procedure that takes source text and produces translated text — whether it's a direct LLM call, a multi-stage pipeline, a third-party API, or a human translator.

## Architecture

```
Method Plugin (v2 Spec)
├── manifest.json         ← Shared metadata (name, version, supported pairs)
├── method_card.json      ← Leaderboard description (what, not how)
├── translate.py          ← Python entry point (for eval harness)
└── translate.js          ← Node.js entry point (for i18n-rosetta CLI)
```

## Two Systems, One Interface

| | Eval Harness | i18n-rosetta |
|---|---|---|
| **Language** | Python | Node.js |
| **Entry point** | `translate.py` | `translate.js` |
| **Interface** | `TranslationProcess` protocol | `methodPlugin` config |
| **Purpose** | Batch evaluation with scoring | Live localization in dev/CI |
| **Output** | Run card with metrics | Translated locale files |

A method that supports both systems provides two entry points — one for each language runtime. The **method card** is the bridge: it describes the method in a format both systems understand.

## Method Card

A method card describes *what* a translation method is without revealing proprietary details like the full system prompt. It answers:

- What class of method is this? (raw LLM, coached LLM, pipeline, API, etc.)
- What tools does it use? (FST analyzer, dictionary, etc.)
- Is the implementation open source?
- What language pairs does it support?

See the [Method Card Spec](https://github.com/gamedaysuits/gds-mt-eval-harness/blob/main/docs/method-card-spec.md) for the full JSON schema.

### Example

```json
{
  "method_id": "fst-gated-v8",
  "name": "FST-Gated Coached Translation v8",
  "class": "pipeline",
  "description": "LLM translation with morphological validation. Failed words are retried with FST feedback.",
  "author": "Curtis Forbes",
  "tools_used": ["HFST morphological analyzer", "Wolvengrey dictionary"],
  "open_source": false,
  "supported_pairs": ["eng>crk"]
}
```

### Method Classes

| Class | Description |
|-------|-------------|
| `raw-llm` | Direct LLM call with minimal instruction |
| `coached-llm` | LLM with structured prompt, examples, constraints |
| `pipeline` | Multi-stage pipeline with deterministic components |
| `custom-plugin` | External process implementing the `TranslationProcess` protocol |
| `api` | Third-party translation API (Google Translate, DeepL, etc.) |
| `human` | Human translation (for establishing baselines) |

## Eval Harness: TranslationProcess Protocol

The eval harness uses Python's structural typing (`Protocol`) for plugins. Any class with the right method signature works — no inheritance required:

```python
class MyMethod:
    async def translate(self, entries: list[dict], config: RunConfig) -> list[dict]:
        results = []
        for entry in entries:
            translation = await self.do_translation(entry["source"])
            results.append({
                "id": entry["id"],
                "predicted": translation,
                "latency_s": 0.5,
                "usage": {"prompt_tokens": 0, "completion_tokens": 0},
                "error": None,
                "tool_calls": [],
                "tool_call_count": 0,
                "metadata": {},
            })
        return results
```

See the [Plugin Protocol](https://github.com/gamedaysuits/gds-mt-eval-harness/blob/main/docs/plugin-protocol.md) for complete documentation including wrapper examples for non-Python methods.

## i18n-rosetta: methodPlugin Config

In rosetta, methods are registered per language pair in `i18n-rosetta.config.json`:

```json
{
  "version": 3,
  "pairs": {
    "en:crk": {
      "methodPlugin": "crk-coached-v1"
    }
  }
}
```

See the [Plugin Spec](/docs/reference/plugin-spec) for the rosetta-side interface.

## Leaderboard Integration

When a method card is attached to a run (via `--method-card`), it's embedded in the run card and displayed on the leaderboard:

```bash
mt-eval run --corpus data/corpus.json --method-card method_card.json
mt-eval submit run_card.json
```

The leaderboard shows:
- **Class badge** — visual indicator (e.g., "pipeline", "coached-llm")
- **Method name** — from the method card
- **Tools used** — listed from the method card
- **Open source indicator**

When no method card is attached, the leaderboard shows harness-native configuration (model, condition, temperature, tools enabled).
