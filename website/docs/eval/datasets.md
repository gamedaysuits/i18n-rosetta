---
sidebar_position: 3
title: Evaluation Datasets
---

# Evaluation Datasets

Datasets are the fixed targets that the harness runs against. Each dataset is a JSON file containing source→target pairs with gold-standard references. The harness scores model outputs against these references — it never modifies them.

:::danger DO NOT TRAIN on evaluation data

⚠️ **These datasets are evaluation-only.** Methods trained, fine-tuned, few-shot-prompted, or otherwise exposed to evaluation data will produce artificially inflated scores and will be **disqualified from the leaderboard.**

Use separate corpora for training. Evaluation sets must remain unseen by your model during development.
:::

---

## Dataset Format

Every dataset follows the same JSON schema:

```json
{
  "dataset": {
    "id": "dataset-slug",
    "version": "1.0",
    "language_pair": "EN→CRK",
    "description": "Human-readable description of the dataset",
    "source_language": "en",
    "target_language": "crk",
    "created": "2025-05-01",
    "license": "CC-BY-NC-4.0",
    "provenance": ["gold_standard", "textbook"]
  },
  "entries": [
    {
      "index": 0,
      "source_text": "Hello",
      "target_expected": "tânisi",
      "difficulty": "easy",
      "provenance": "gold_standard",
      "notes": "Common greeting, SRO orthography"
    }
  ]
}
```

### Top-Level `dataset` Block

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique dataset identifier (used in run cards and leaderboard) |
| `version` | `string` | Semantic version. Incrementing this invalidates prior run card comparisons |
| `language_pair` | `string` | Display label (e.g., `EN→CRK`) |
| `description` | `string` | Human-readable summary |
| `source_language` | `string` | BCP 47 source language code |
| `target_language` | `string` | BCP 47 target language code |
| `created` | `string` | ISO 8601 creation date |
| `license` | `string` | SPDX license identifier |
| `provenance` | `string[]` | List of provenance tags used across entries |

### Entry Fields

| Field | Type | Description |
|-------|------|-------------|
| `index` | `number` | Zero-based entry index. Must be unique and sequential |
| `source_text` | `string` | The source text to translate |
| `target_expected` | `string` | The gold-standard reference translation |
| `difficulty` | `string` | Difficulty tier: `easy`, `medium`, `hard` |
| `provenance` | `string` | Origin of this entry (e.g., `gold_standard`, `textbook`, `elicited`) |
| `notes` | `string` | Optional context for human reviewers |

---

## Available Datasets

### EDTeKLA Development Set v1

The first evaluation dataset, built for English→Plains Cree (SRO) translation.

| Property | Value |
|----------|-------|
| **ID** | `edtekla-dev-v1` |
| **Version** | `1.0` |
| **Language pair** | EN → CRK (Plains Cree, SRO orthography) |
| **Entry count** | 124 |
| **Difficulty distribution** | Easy, Medium, Hard |
| **Provenance** | `gold_standard` (verified by speakers), `textbook` (published educational materials) |
| **License** | CC-BY-NC-4.0 |

**What it tests:**

- Basic greetings and common phrases
- Noun animacy and obviation
- Verb conjugation across persons and tenses
- Locative constructions
- Possessive paradigms
- Complex sentence structures

:::tip Why 124 entries?
The dataset is deliberately small and curated. Each entry was verified by fluent speakers or sourced from published Cree language textbooks. A small, high-quality dataset with verified gold standards is more useful than a large, noisy one — especially for a low-resource language where "close enough" translations are often morphologically invalid.
:::

---

## Creating a New Dataset

To create a dataset for a new language pair or domain:

### 1. Structure the JSON

Follow the [Dataset Format](#dataset-format) schema. Every entry must have `source_text`, `target_expected`, `difficulty`, and `provenance`.

### 2. Assign a unique ID

Use a descriptive slug: `{project}-{split}-v{version}` (e.g., `edtekla-dev-v1`, `quechua-test-v1`).

### 3. Verify gold standards

Every `target_expected` value must be verified by a fluent speaker or sourced from a published, peer-reviewed resource. Machine-generated references defeat the purpose of evaluation.

### 4. Set difficulty tiers

Assign each entry a difficulty level:

| Tier | Criteria |
|------|----------|
| `easy` | Short phrases, common vocabulary, simple morphology |
| `medium` | Full sentences, moderate morphological complexity |
| `hard` | Complex grammar, rare constructions, culturally specific content |

### 5. Tag provenance

Each entry should indicate where it came from. Common tags:

- `gold_standard` — Verified by fluent speakers
- `textbook` — From published educational materials
- `elicited` — Produced through structured elicitation sessions
- `corpus` — Extracted from a parallel corpus

### 6. Validate the file

Run the harness against your dataset with any model to verify the JSON is well-formed and all required fields are present:

```bash
python eval/baseline_experiment.py --dataset path/to/your-dataset.json
```

The harness will error on missing fields, duplicate indices, or schema violations.

### 7. Submit for inclusion

Open a pull request against the [eval harness repository](https://github.com/gamedaysuits/gds-mt-eval-harness) with your dataset file in the `data/` directory. Include documentation of your verification methodology and provenance sources.
