# Rosetta Translate — Service Buildout Prompt

> **Status: Internal Planning** — This document is a buildout specification for a service that has not yet been developed. It is included in the repository for architectural context and future reference.

---

## What You're Building

**Rosetta Translate** is a metered translation API service. It hosts proprietary translation methods (coaching data, prompt engineering, linguistic pipelines) server-side and exposes a simple REST API for translation requests. Its primary consumer is [i18n-rosetta](https://github.com/gamedaysuits/i18n-rosetta), an open-source i18n translation engine.

### Why It Exists

i18n-rosetta is a free, open-source developer tool for translating app locale files. It supports pluggable translation methods. Rosetta Translate is the **premium tier** — it provides higher-quality translations using proprietary techniques (grammar coaching, dictionary injection, FST-gated validation) that we don't want to ship in the open-source package.

The key architectural constraint: **no IP leaves the server.** Users send untranslated keys, they receive translations back. The prompts, coaching data, grammar rules, and evaluation pipelines stay server-side.

---

## Architecture Overview

```
┌─────────────────┐       HTTPS/JSON        ┌─────────────────────┐
│   i18n-rosetta   │ ─────────────────────► │    Rosetta Translate     │
│   (Node.js CLI)  │ ◄───────────────────── │    (API service)     │
│                  │     translations        │                     │
│  Sends:          │                         │  Has:                │
│  - source keys   │                         │  - coaching data     │
│  - target locale │                         │  - prompt templates  │
│  - method name   │                         │  - grammar rules     │
│  - API key       │                         │  - dictionary files  │
│                  │                         │  - benchmark history │
└─────────────────┘                         │                     │
                                            │  Calls:              │
                                            │  - OpenRouter API    │
                                            │  - (or Google, etc.) │
                                            └─────────────────────┘
```

---

## API Contract

The full API specification is in `docs/planning/TRANSLATE_API_SPEC.md` in the i18n-rosetta repo. Key endpoints:

| Endpoint | Purpose |
|---|---|
| `POST /v1/translate` | Translate a batch of key-value pairs |
| `GET /v1/methods` | List available translation methods |
| `GET /v1/methods/:name` | Get method details (plugin manifest format) |
| `GET /v1/usage` | Check current billing period usage |

**The rosetta client already has the `APIMethod` class that will call these endpoints.** You are building the server side.

---

## Method Architecture

Each "method" on the server is a self-contained translation pipeline. It consists of:

### 1. Method Config
```
methods/
  crk-coached-v1/
    config.json              # Model, temperature, batch settings
    coaching/crk.json        # Grammar rules, dictionary, style notes
    prompts/
      system.txt             # System prompt template
      batch.txt              # Per-batch prompt template  
    benchmarks/
      latest.json            # Most recent eval harness results
```

### 2. Translation Pipeline

When a request comes in for `crk-coached-v1`:

1. **Load method config** — model, temperature, register
2. **Load coaching data** — grammar rules, dictionary for the target locale
3. **Build prompt** — inject coaching context into the prompt template
4. **Dictionary pre-pass** — scan source values for dictionary matches, inject term hints
5. **Call LLM** — send to OpenRouter (or whichever provider the method config specifies)
6. **Validate response** — check the LLM returned all requested keys, no garbage
7. **Return translations** — send back the key-value map + billing metadata

### 3. Reference: Coached Method Logic

The coached translation logic already exists in the open-source `i18n-rosetta/lib/methods/llm-coached.js`. This is the **same logic** you run server-side — but with proprietary coaching data that isn't in the open-source package. You can use that file as a direct reference for the prompt construction, dictionary matching, and validation pipeline. The difference is:

- **Open source**: User provides their own coaching data (or uses none)
- **Rosetta Translate**: You provide the coaching data, user never sees it

---

## Data Model

### Organizations
```
organizations:
  id: uuid
  name: string
  plan: free | starter | pro | enterprise
  created_at: timestamp
```

### API Keys
```
api_keys:
  id: uuid
  organization_id: uuid (FK)
  key_hash: string        # Store hashed, never plaintext
  prefix: string          # "rosetta_sk_live_" or "rosetta_sk_test_"
  last_four: string       # For display: "...abc1"
  active: boolean
  created_at: timestamp
```

### Usage Tracking
```
usage_records:
  id: uuid
  organization_id: uuid (FK)
  method: string
  characters: integer
  keys_count: integer
  cost_usd: decimal
  created_at: timestamp
```

### Methods
```
methods:
  name: string (PK)        # e.g., "crk-coached-v1"
  version: string
  description: text
  locales: string[]
  quality_tier: string
  model: string
  active: boolean
  pricing_per_million_chars: decimal
  free_tier_chars: integer
```

---

## Method Management

### Adding a New Method

The workflow for adding a new translation method to Rosetta Translate:

1. **Develop** — Use `gds-mt-eval-harness` to test coaching data + prompt configurations
2. **Benchmark** — Run the harness, verify quality metrics meet threshold
3. **Export** — Package coaching data, config, and benchmark results into the method directory
4. **Deploy** — Add to the `methods/` directory on the server, register in the methods table
5. **Verify** — Run smoke tests through the API

### Method Versioning

Methods are versioned independently. When you update coaching data or prompts:
- Bump the method version in config
- The `meta.method_version` in API responses reflects the running version
- Clients see the version in `GET /methods/:name`

---

## Billing & Metering

### How Billing Works

1. Each request counts **source characters** (the text being translated, not the translations)
2. Characters are summed across all keys in the request
3. Cost = `characters × method.pricing_per_million_chars / 1,000,000`
4. Usage is tracked per-organization, per-billing-period (monthly)

### Free Tier

Every method has a `free_tier_chars` allowance (per month, per organization). After the free tier is exhausted, requests require an active billing plan.

### Suggested Pricing

| Method | Per 1M chars | Free tier |
|---|---|---|
| Standard LLM methods | $15 | 100,000 chars |
| Coached methods | $25 | 50,000 chars |
| Research-grade (FST-gated) | $40 | 25,000 chars |

---

## Infrastructure Requirements

### Runtime
- **Language**: Node.js (same runtime as rosetta, can share method logic) or Python (if FST methods need it)
- **Framework**: Express, Fastify, or Hono
- **Database**: PostgreSQL (Supabase) for organizations, keys, usage
- **Cache**: Redis for rate limiting and method config caching

### External Dependencies
- **OpenRouter API** — LLM inference (the service proxies through its own key)
- **Google Cloud Translation API** — if Google Translate methods are offered
- **gds-mt-eval-harness** — used offline for method development, NOT in the request path

### Deployment
- Cloud Run, Railway, or Fly.io (containerized)
- Stateless — all state in the database
- Auto-scaling based on request volume

### Security
- API keys hashed at rest (bcrypt or SHA-256)
- HTTPS only
- Rate limiting per API key (token bucket)
- Input validation: reject keys with prototype pollution patterns (`__proto__`, `constructor`)
- No PII in logs — log method name, key count, and latency, not translation content

---

## Monitoring & Observability

### Metrics to Track
- Request latency (p50, p95, p99) per method
- Translation success rate per method
- Characters translated per day/week/month
- Error rate by type (LLM failure, timeout, validation failure)
- Revenue per method per billing period

### Alerts
- Error rate > 5% sustained for 5 minutes
- p99 latency > 10 seconds
- LLM provider returning 429s (upstream rate limits)
- Free tier abuse (single org making excessive requests)

---

## Development Phases

### Phase 1: Core API (MVP)
- [ ] `POST /v1/translate` — core translation endpoint
- [ ] `GET /v1/methods` — list available methods
- [ ] API key authentication
- [ ] Usage tracking (per-request character counting)
- [ ] One method deployed: `french-formal-v1` or similar for testing
- [ ] Basic rate limiting
- [ ] Deploy to Cloud Run

### Phase 2: Billing & Management
- [ ] `GET /v1/usage` — usage dashboard endpoint
- [ ] `GET /v1/methods/:name` — method detail (plugin manifest format)
- [ ] Free tier enforcement
- [ ] Stripe integration for paid plans
- [ ] Organization management API
- [ ] Admin dashboard for method management

### Phase 3: Research Methods
- [ ] Deploy research-grade methods (Cree coached, FST-gated if applicable)
- [ ] Method-specific pre/post-processing pipelines
- [ ] Benchmark result caching and display
- [ ] Webhook notifications for usage thresholds

---

## Testing Strategy

### Unit Tests
- Method loading and config validation
- Prompt construction from coaching data
- Response validation (all keys returned, no pollution)
- Billing calculation accuracy

### Integration Tests
- End-to-end: request → LLM call → response
- Rate limiting behavior
- API key authentication flow
- Partial failure handling (207 responses)

### Smoke Tests (post-deploy)
- Translate 10 keys with each active method
- Verify response format matches API spec
- Verify usage tracking increments correctly

---

## Files to Reference

In the `i18n-rosetta` repository:
- `docs/planning/TRANSLATE_API_SPEC.md` — The full API contract (your server must implement this)
- `docs/METHOD_PLUGIN_SPEC.md` — Plugin manifest format (your `/methods/:name` endpoint returns this)
- `lib/methods/llm-coached.js` — Reference implementation for coached translation logic
- `lib/methods/llm.js` — Reference implementation for base LLM translation
- `lib/methods/api.js` — The client that will call your server (once Phase 4 ships)
