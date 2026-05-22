---
sidebar_position: 4
title: Run Card Specification
---

# Run Card Specification

The run card is the complete record of a single evaluation run. It contains everything needed to understand, reproduce, and verify the experiment: configuration, scores, individual results, token usage, and environment metadata.

**Schema version:** 2.0

---

## Top-Level Fields

| Field | Type | Description |
|-------|------|-------------|
| `run_id` | `string` | UUID v4 generated at the start of the run |
| `harness_version` | `string` | Semantic version of the harness that produced this card (e.g., `2.0`) |
| `model_slug` | `string` | OpenRouter model slug used for the run (e.g., `openai/gpt-4o`) |
| `model_id` | `string` | Resolved model identifier returned by the API (e.g., `gpt-4o-2024-08-06`) |
| `condition` | `string` | Experiment label (e.g., `baseline`, `coached-v3`, `few-shot`) |
| `timestamp` | `string` | ISO 8601 UTC timestamp when the run started |
| `elapsed_seconds` | `number` | Wall-clock duration of the entire run |

```json
{
  "run_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "harness_version": "2.0",
  "model_slug": "openai/gpt-4o",
  "model_id": "gpt-4o-2024-08-06",
  "condition": "baseline",
  "timestamp": "2025-05-20T03:22:41Z",
  "elapsed_seconds": 142.7
}
```

---

## `dataset`

Identifies the evaluation dataset and pins it to a specific content version via SHA-256.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Dataset identifier (e.g., `edtekla-dev-v1`) |
| `version` | `string` | Dataset version string |
| `language_pair` | `string` | Display label (e.g., `EN→CRK`) |
| `sha256` | `string` | SHA-256 hash of the dataset file contents. Guarantees the exact data used |
| `entry_count` | `number` | Number of entries in the dataset |

```json
{
  "dataset": {
    "id": "edtekla-dev-v1",
    "version": "1.0",
    "language_pair": "EN→CRK",
    "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "entry_count": 124
  }
}
```

---

## `config`

The API and batching configuration used for this run.

| Field | Type | Description |
|-------|------|-------------|
| `api_provider` | `string` | API provider name (e.g., `openrouter`) |
| `temperature` | `number` | Sampling temperature |
| `max_tokens` | `number` | Maximum tokens per completion |
| `batch_size` | `number` | Entries per concurrent batch |
| `concurrency` | `number` | Maximum parallel API requests |

```json
{
  "config": {
    "api_provider": "openrouter",
    "temperature": 0.3,
    "max_tokens": 1024,
    "batch_size": 5,
    "concurrency": 3
  }
}
```

---

## `system_prompt_sha256` / `system_prompt_used`

| Field | Type | Description |
|-------|------|-------------|
| `system_prompt_sha256` | `string` | SHA-256 hash of the system prompt. Included in the fingerprint |
| `system_prompt_used` | `string` | The full system prompt text sent to the model |

The prompt hash is part of the [fingerprint](#fingerprint) — two runs with different prompts will have different fingerprints even if all other settings match.

---

## `fingerprint`

A reproducibility identifier. Two runs with identical fingerprints used the same experimental setup.

| Field | Type | Description |
|-------|------|-------------|
| `hash` | `string` | SHA-256 hash of the sorted components |
| `components` | `object` | The input values that were hashed |

### Fingerprint Components

| Component | Description |
|-----------|-------------|
| `dataset_sha256` | Hash of the dataset file |
| `model_slug` | Model used |
| `condition` | Experiment condition label |
| `system_prompt_sha256` | Hash of the system prompt |
| `temperature` | Sampling temperature |
| `harness_version` | Harness version |

```json
{
  "fingerprint": {
    "hash": "7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069",
    "components": {
      "dataset_sha256": "e3b0c44298fc1c14...",
      "model_slug": "openai/gpt-4o",
      "condition": "baseline",
      "system_prompt_sha256": "abc123...",
      "temperature": 0.3,
      "harness_version": "2.0"
    }
  }
}
```

:::info Fingerprint ≠ Run Card Hash
The fingerprint identifies the *experiment configuration*. The `run_card_hash` verifies the *result file integrity*. See [Fingerprint vs Run Card Hash](/docs/eval/harness#fingerprint-vs-run-card-hash) for details.
:::

---

## `scores`

Aggregate metrics for the entire run.

### Top-Level Scores

| Field | Type | Description |
|-------|------|-------------|
| `total` | `number` | Total entries evaluated |
| `exact_matches` | `number` | Entries where output exactly matched the gold standard |
| `exact_match_rate` | `number` | `exact_matches / total` (0.0–1.0) |
| `fst_accepted` | `number` | Entries where the FST analyzer accepted the output |
| `fst_acceptance_rate` | `number` | `fst_accepted / total` (0.0–1.0). `null` if no FST analyzer was used |
| `chrf_plus_plus` | `number` | Corpus-level chrF++ score (0–100) |
| `errors` | `number` | Entries that failed (API error, timeout, etc.) |
| `avg_latency_seconds` | `number` | Mean response time across all entries |
| `median_latency_seconds` | `number` | Median response time |
| `p95_latency_seconds` | `number` | 95th percentile response time |

### `by_difficulty`

Scores broken down by difficulty tier. Each key (`easy`, `medium`, `hard`) contains the same metric fields as the top-level scores.

```json
{
  "by_difficulty": {
    "easy": {
      "total": 42,
      "exact_matches": 8,
      "exact_match_rate": 0.1905,
      "chrf_plus_plus": 51.2,
      "fst_accepted": 35,
      "fst_acceptance_rate": 0.8333
    },
    "medium": { ... },
    "hard": { ... }
  }
}
```

### `by_provenance`

Scores broken down by entry provenance. Each key (e.g., `gold_standard`, `textbook`) contains the same metric fields.

```json
{
  "by_provenance": {
    "gold_standard": {
      "total": 80,
      "exact_matches": 10,
      "exact_match_rate": 0.125,
      "chrf_plus_plus": 44.8
    },
    "textbook": { ... }
  }
}
```

---

## `totals`

Token usage and cost tracking for the entire run.

| Field | Type | Description |
|-------|------|-------------|
| `prompt_tokens` | `number` | Total input tokens across all API calls |
| `completion_tokens` | `number` | Total output tokens |
| `reasoning_tokens` | `number` | Tokens used for chain-of-thought reasoning (model-dependent, 0 for most models) |
| `cached_tokens` | `number` | Tokens served from the provider's prompt cache |
| `total_cost_usd` | `number` | Total cost in USD (as reported by the API) |
| `cost_per_entry_usd` | `number` | `total_cost_usd / entry_count` |
| `reasoning_ratio` | `number` | `reasoning_tokens / completion_tokens` (0.0–1.0) |

```json
{
  "totals": {
    "prompt_tokens": 48200,
    "completion_tokens": 3100,
    "reasoning_tokens": 0,
    "cached_tokens": 12000,
    "total_cost_usd": 0.42,
    "cost_per_entry_usd": 0.0034,
    "reasoning_ratio": 0.0
  }
}
```

---

## `environment`

Runtime environment metadata for reproducibility.

| Field | Type | Description |
|-------|------|-------------|
| `harness_version` | `string` | Harness version (mirrors top-level `harness_version`) |
| `harness_git_commit` | `string` | Git commit SHA of the harness at run time |
| `python_version` | `string` | Python interpreter version |
| `sacrebleu_version` | `string` | sacrebleu library version (used for chrF++ scoring) |
| `os` | `string` | Operating system identifier |

```json
{
  "environment": {
    "harness_version": "2.0",
    "harness_git_commit": "a1b2c3d",
    "python_version": "3.11.9",
    "sacrebleu_version": "2.4.0",
    "os": "macOS-14.5-arm64"
  }
}
```

---

## `results[]`

The per-entry results array. One object per dataset entry, in index order.

| Field | Type | Description |
|-------|------|-------------|
| `entry_index` | `number` | Index of this entry in the dataset (matches `entries[].index`) |
| `source_text` | `string` | The source text that was translated |
| `target_expected` | `string` | The gold-standard reference from the dataset |
| `target_output` | `string` | The model's actual output |
| `exact_match` | `boolean` | Whether `target_output === target_expected` |
| `entry_chrf` | `number` | Sentence-level chrF++ score for this entry (0–100) |
| `fst_accepted` | `boolean \| null` | Whether the FST analyzer accepted the output. `null` if no analyzer was configured |
| `fst_analysis` | `string[]` | FST analysis strings for the output (empty array if not analyzed or rejected) |
| `difficulty` | `string` | Difficulty tier from the dataset (`easy`, `medium`, `hard`) |
| `provenance` | `string` | Provenance tag from the dataset |
| `latency_seconds` | `number` | Response time for this individual entry |
| `usage` | `object` | Per-entry token usage: `{ prompt_tokens, completion_tokens, reasoning_tokens }` |
| `error` | `string \| null` | Error message if this entry failed. `null` on success |

```json
{
  "results": [
    {
      "entry_index": 0,
      "source_text": "Hello",
      "target_expected": "tânisi",
      "target_output": "tânisi",
      "exact_match": true,
      "entry_chrf": 100.0,
      "fst_accepted": true,
      "fst_analysis": ["tânisi+V+AI+Ind+2Sg"],
      "difficulty": "easy",
      "provenance": "gold_standard",
      "latency_seconds": 0.82,
      "usage": {
        "prompt_tokens": 385,
        "completion_tokens": 12,
        "reasoning_tokens": 0
      },
      "error": null
    }
  ]
}
```

---

## `run_card_hash`

| Field | Type | Description |
|-------|------|-------------|
| `run_card_hash` | `string` | SHA-256 hash of the entire run card JSON, with the `run_card_hash` field itself set to `""` during hashing |

This is the tamper-detection seal. The leaderboard re-computes this hash on submission and rejects cards where it doesn't match.

**Computing the hash:**

1. Serialize the run card to JSON with `run_card_hash` set to `""`
2. Compute SHA-256 of the serialized string
3. Set `run_card_hash` to the resulting hex digest

```python
import hashlib, json

card["run_card_hash"] = ""
card_json = json.dumps(card, sort_keys=True, ensure_ascii=False)
card["run_card_hash"] = hashlib.sha256(card_json.encode()).hexdigest()
```
