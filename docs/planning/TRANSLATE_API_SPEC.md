# Rosetta Translate — API Specification v1.0

> **Status: Planned** — This API is under development. The specification documents the target contract for when the service is built. i18n-rosetta's `APIMethod` client is implemented and ready, but no server exists yet.

> **Service name**: Rosetta Translate  
> **Consumer**: i18n-rosetta (`api` method type)  
> **Purpose**: Metered, IP-protected translation service. Hosts proprietary coaching data, prompt engineering, and linguistic pipelines server-side. Rosetta sends keys, receives translations. No IP leaves the server.

---

## Base URL

```
https://api.gds-translate.com/v1
```

---

## Authentication

All requests require a valid API key in the `Authorization` header.

```
Authorization: Bearer rosetta_sk_live_abc123...
```

**Key format**: `rosetta_sk_live_<random>` (live) or `rosetta_sk_test_<random>` (test/sandbox)

Keys are issued per-organization. Usage is metered per-character translated.

---

## Endpoints

### POST /translate

Translate a batch of key-value pairs from a source locale to a target locale.

#### Request

```json
{
  "source_locale": "en",
  "target_locale": "crk",
  "method": "crk-coached-v1",
  "keys": {
    "hero.title": "Welcome to our platform",
    "hero.subtitle": "Build something great",
    "nav.home": "Home",
    "nav.settings": "Settings"
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `source_locale` | string | ✅ | BCP-47 source locale code |
| `target_locale` | string | ✅ | BCP-47 target locale code |
| `method` | string | ✅ | Rosetta method identifier (from plugin manifest `name`) |
| `keys` | object | ✅ | Map of flat dot-notation key → source text value |

**Limits:**
- Max 100 keys per request (clients batch larger payloads)
- Max 10,000 characters total source text per request
- Max request body size: 256 KB

#### Response — 200 OK

```json
{
  "translations": {
    "hero.title": "tawâw ohci ni-...",
    "hero.subtitle": "osihtâ kîkway...",
    "nav.home": "kîwêwin",
    "nav.settings": "nanahitamowin"
  },
  "meta": {
    "method": "crk-coached-v1",
    "method_version": "1.2.0",
    "model": "google/gemini-2.5-flash",
    "source_locale": "en",
    "target_locale": "crk",
    "keys_translated": 4,
    "characters_billed": 142,
    "cost_usd": 0.004,
    "quality_tier": "research",
    "latency_ms": 1230
  }
}
```

| Field | Type | Description |
|---|---|---|
| `translations` | object | Map of key → translated value. Mirrors request key structure. |
| `meta.method` | string | Method used (echoed back) |
| `meta.method_version` | string | Server-side method version |
| `meta.model` | string | Underlying LLM model used |
| `meta.keys_translated` | number | Count of successfully translated keys |
| `meta.characters_billed` | number | Total source characters billed |
| `meta.cost_usd` | number | Cost of this request in USD |
| `meta.quality_tier` | string | `standard`, `high`, `research`, or `verified` |
| `meta.latency_ms` | number | Server-side processing time |

#### Response — Partial Success (207 Multi-Status)

If some keys fail but others succeed:

```json
{
  "translations": {
    "hero.title": "tawâw ohci ni-...",
    "nav.home": "kîwêwin"
  },
  "errors": {
    "hero.subtitle": { "code": "TRANSLATION_FAILED", "message": "LLM returned empty response" },
    "nav.settings": { "code": "UNSUPPORTED_CONTENT", "message": "Key contains HTML markup" }
  },
  "meta": { ... }
}
```

---

### GET /methods

List all available translation methods on the server. Rosetta uses this to show available Rosetta methods.

#### Response — 200 OK

```json
{
  "methods": [
    {
      "name": "crk-coached-v1",
      "version": "1.2.0",
      "description": "Plains Cree coached translation with FST-validated grammar",
      "locales": ["crk"],
      "quality_tier": "research",
      "benchmarks": {
        "crk": {
          "corpus_chrf": 40.2,
          "exact_match_rate": 0.31,
          "corpus_size": 404,
          "date": "2026-05-09T00:00:00Z"
        }
      },
      "pricing": {
        "per_million_chars_usd": 25.00,
        "free_tier_chars": 50000
      }
    },
    {
      "name": "french-formal-v1",
      "version": "1.0.0",
      "description": "Formally-tuned French with terminology enforcement",
      "locales": ["fr"],
      "quality_tier": "high",
      "benchmarks": {
        "fr": {
          "corpus_chrf": 72.3,
          "exact_match_rate": 0.42,
          "corpus_size": 500,
          "date": "2026-05-11T00:00:00Z"
        }
      },
      "pricing": {
        "per_million_chars_usd": 15.00,
        "free_tier_chars": 100000
      }
    }
  ]
}
```

---

### GET /methods/:name

Get details for a specific method, including its full manifest (compatible with i18n-rosetta plugin format).

#### Response — 200 OK

Returns the method manifest in i18n-rosetta plugin format so the CLI can install it directly:

```json
{
  "name": "crk-coached-v1",
  "type": "api",
  "version": "1.2.0",
  "description": "Plains Cree coached translation with FST-validated grammar",
  "author": "Rosetta Research",
  "locales": ["crk"],
  "endpoint": "https://api.gds-translate.com/v1/translate",
  "config": {
    "register": "Formal, respectful register",
    "batchSize": 30
  },
  "benchmarks": {
    "crk": {
      "corpus_chrf": 40.2,
      "exact_match_rate": 0.31,
      "corpus_size": 404,
      "date": "2026-05-09T00:00:00Z",
      "harness_version": "1.0.0"
    }
  },
  "provenance": {
    "resources": [
      { "name": "Rosetta Coached Pipeline", "license": "proprietary", "type": "method" }
    ],
    "commercialReady": true,
    "flags": []
  },
  "pricing": {
    "per_million_chars_usd": 25.00,
    "free_tier_chars": 50000
  }
}
```

---

### GET /usage

Check current billing period usage.

#### Response — 200 OK

```json
{
  "organization": "acme-corp",
  "billing_period": "2026-05",
  "characters_used": 245000,
  "characters_limit": null,
  "cost_usd": 6.12,
  "methods_used": {
    "crk-coached-v1": { "characters": 180000, "requests": 42 },
    "french-formal-v1": { "characters": 65000, "requests": 18 }
  }
}
```

---

## Error Responses

All errors follow a consistent format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description",
    "details": {}
  }
}
```

| HTTP Status | Error Code | Description |
|---|---|---|
| 400 | `INVALID_REQUEST` | Malformed body, missing required fields |
| 400 | `UNSUPPORTED_LOCALE` | Target locale not supported by the requested method |
| 401 | `UNAUTHORIZED` | Missing or invalid API key |
| 402 | `PAYMENT_REQUIRED` | Account has exceeded usage limits |
| 404 | `METHOD_NOT_FOUND` | Requested method does not exist |
| 429 | `RATE_LIMITED` | Too many requests. Includes `Retry-After` header. |
| 500 | `INTERNAL_ERROR` | Server-side failure |
| 503 | `SERVICE_UNAVAILABLE` | Temporary outage, retry later |

---

## Rate Limits

| Plan | Requests/min | Characters/month |
|---|---|---|
| Free | 10 | 50,000 |
| Starter | 60 | 1,000,000 |
| Pro | 300 | 10,000,000 |
| Enterprise | Custom | Custom |

Rate limit headers included in every response:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 42
X-RateLimit-Reset: 1715400000
```

---

## Rosetta Integration

### How rosetta calls Rosetta Translate

1. User installs a plugin: `rosetta plugin install crk-coached-v1`
2. Plugin manifest saved to `.rosetta/methods/crk-coached-v1/method.json`
3. Manifest `type` is `"api"` → rosetta routes to `APIMethod`
4. `APIMethod` reads the `endpoint` from the manifest
5. POSTs keys to `POST /translate` with the user's API key
6. Receives translations, returns to sync pipeline

### Environment variable

```bash
export ROSETTA_TRANSLATE_API_KEY=rosetta_sk_live_abc123...
```

Rosetta reads this automatically when using any `api`-type method.
