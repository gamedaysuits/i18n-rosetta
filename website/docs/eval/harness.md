---
sidebar_position: 2
title: Eval Harness v2.0
---

# Eval Harness v2.0

The harness runs translation experiments and produces run cards. It handles prompt construction, API calls, scoring, and result serialization — you supply the dataset and the model.

## Installation

**Requirements:** Python 3.10+

```bash
pip install sacrebleu aiohttp
```

Clone the harness repository:

```bash
git clone https://github.com/gamedaysuits/gds-mt-eval-harness.git
cd gds-mt-eval-harness
```

## Usage

```bash
python eval/baseline_experiment.py --dataset path/to/dataset.json
```

This runs every entry in the dataset through the configured model, scores the outputs, and writes a run card JSON file to the `results/` directory.

## CLI Flags

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--dataset` | ✅ | — | Path to the evaluation dataset JSON file |
| `--model` | — | `openai/gpt-4o` | OpenRouter model slug (e.g., `google/gemini-2.5-pro`) |
| `--condition` | — | `baseline` | Experiment label. Use to distinguish prompt strategies (e.g., `coached`, `few-shot`, `dictionary-augmented`) |
| `--temperature` | — | `0.3` | Sampling temperature. Lower = more deterministic |
| `--batch-size` | — | `5` | Number of entries per concurrent API batch |
| `--fst-analyzer` | — | `null` | Path to an FST analyzer binary. When provided, each output is tested for morphological acceptance |
| `--submit` | — | `false` | Submit the run card to the leaderboard API after the run completes |

### Examples

```bash
# Run with defaults (GPT-4o, baseline condition)
python eval/baseline_experiment.py --dataset data/edtekla-dev-v1.json

# Coached experiment with Gemini, lower temperature
python eval/baseline_experiment.py \
  --dataset data/edtekla-dev-v1.json \
  --model google/gemini-2.5-pro \
  --condition coached-v3 \
  --temperature 0.1

# Run with FST validation and auto-submit
python eval/baseline_experiment.py \
  --dataset data/edtekla-dev-v1.json \
  --fst-analyzer ./bin/crk-analyzer \
  --submit
```

---

## Run Card Schema

Every experiment produces a **run card** — a self-contained JSON document. The top-level structure:

```json
{
  "run_id": "uuid-v4",
  "harness_version": "2.0",
  "model_slug": "openai/gpt-4o",
  "model_id": "gpt-4o-2024-08-06",
  "condition": "baseline",
  "timestamp": "2025-05-20T03:22:41Z",
  "elapsed_seconds": 142.7,
  "dataset": { ... },
  "config": { ... },
  "system_prompt_sha256": "abc123...",
  "system_prompt_used": "You are a translator...",
  "fingerprint": { ... },
  "scores": { ... },
  "totals": { ... },
  "environment": { ... },
  "results": [ ... ],
  "run_card_hash": "sha256-of-entire-card"
}
```

See the [Run Card Specification](/docs/eval/run-card) for the full schema with every field documented.

### Key Blocks

**`dataset`** — Identifies which dataset was used, including its content hash so results are tied to a specific version:

```json
{
  "id": "edtekla-dev-v1",
  "version": "1.0",
  "language_pair": "EN→CRK",
  "sha256": "...",
  "entry_count": 124
}
```

**`scores`** — Aggregate metrics for the run:

```json
{
  "total": 124,
  "exact_matches": 12,
  "exact_match_rate": 0.0968,
  "fst_accepted": 87,
  "fst_acceptance_rate": 0.7016,
  "chrf_plus_plus": 42.31,
  "errors": 0,
  "avg_latency_seconds": 1.15,
  "median_latency_seconds": 1.02,
  "p95_latency_seconds": 2.34,
  "by_difficulty": { ... },
  "by_provenance": { ... }
}
```

**`totals`** — Token usage and cost tracking:

```json
{
  "prompt_tokens": 48200,
  "completion_tokens": 3100,
  "reasoning_tokens": 0,
  "cached_tokens": 12000,
  "total_cost_usd": 0.42,
  "cost_per_entry_usd": 0.0034,
  "reasoning_ratio": 0.0
}
```

---

## Fingerprint vs Run Card Hash

The harness produces two distinct hashes. They serve different purposes:

### Fingerprint

The **fingerprint** answers: *"Could this run be reproduced?"*

It hashes the combination of inputs that define the experiment configuration — not the outputs:

- Dataset SHA-256
- Model slug
- Condition label
- System prompt SHA-256
- Temperature
- Harness version

Two runs with identical fingerprints used the same setup. Their results should be comparable (modulo API non-determinism).

### Run Card Hash

The **run card hash** answers: *"Has this specific result file been tampered with?"*

It's the SHA-256 of the entire run card JSON (excluding the `run_card_hash` field itself). If any field changes — a score, a timestamp, a single output — the hash breaks.

:::info When to use which
Use the **fingerprint** to group comparable runs (same experiment, different executions). Use the **run card hash** to verify integrity of a specific result file.
:::

---

## Submitting to the Leaderboard

### Automatic submission

Pass `--submit` to upload the run card on completion:

```bash
python eval/baseline_experiment.py \
  --dataset data/edtekla-dev-v1.json \
  --submit
```

### Manual submission

Run cards are saved as JSON files in `results/`. You can submit any run card file via the leaderboard UI at [/leaderboard](/leaderboard), or through the API:

```bash
curl -X POST https://i18n-rosetta.com/api/leaderboard/submit \
  -H "Content-Type: application/json" \
  -d @results/your-run-card.json
```

:::warning Leaderboard validation
The leaderboard validates submitted run cards against the dataset registry. Submissions referencing unknown datasets, or with a broken `run_card_hash`, are rejected.
:::
