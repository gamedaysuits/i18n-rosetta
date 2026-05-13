/**
 * API Translation Method — thin HTTP client for remote translation endpoints.
 *
 * This method contains ZERO translation logic. It is purely a transport layer
 * that delegates translation to a remote server. All prompts, coaching data,
 * grammar rules, and linguistic pipelines live server-side.
 *
 * HOW IT WORKS:
 *   1. Reads the endpoint URL from the plugin manifest
 *   2. Reads API key from ROSETTA_API_KEY env var
 *   3. POSTs keys to the endpoint per the rosetta API contract
 *   4. Receives translations + billing metadata
 *   5. Returns the key-value map to the sync pipeline
 *
 * WHY THIS IS A DUMB PIPE:
 *   The entire point of the API method is IP protection. The prompts,
 *   coaching data, and evaluation techniques stay on the server. This
 *   method ships in the open-source npm package and must contain nothing
 *   proprietary. It sends keys out, gets translations back. That's it.
 *
 * REQUEST FORMAT (what rosetta sends):
 *   {
 *     source_locale: "en",
 *     target_locale: "crk",
 *     method: "crk-coached-v1",
 *     keys: { "hero.title": "Welcome", ... }
 *   }
 *
 * RESPONSE FORMAT (what the API returns):
 *   {
 *     translations: { "hero.title": "tawâw...", ... },
 *     meta: { model, cost_usd, quality_tier, ... }
 *   }
 *
 * COST PROFILE: Varies by method — determined server-side
 * QUALITY TIER: Varies by method — read from plugin manifest
 */

import { TranslationMethod } from './base.js';
import {
  MAX_RETRIES, REQUEST_TIMEOUT_MS,
  getBackoffDelay, sleep,
} from './http-utils.js';

// Maximum keys per API request (server-side limit)
const MAX_KEYS_PER_REQUEST = 100;

class APIMethod extends TranslationMethod {
  constructor(options = {}) {
    super('api', options);

    // These come from the plugin manifest, set by the orchestrator
    this.endpoint = options.endpoint || null;
    this.methodName = options.methodName || null;
    this.methodVersion = options.methodVersion || null;
    this.qualityTier = options.qualityTier || 'standard';
    this.pluginProvenance = options.provenance || null;
  }

  /**
   * Translate a batch of key-value pairs via a remote API.
   *
   * @param {string[]} keys - Flat dot-notation keys to translate
   * @param {object} sourceFlat - Full flattened source locale
   * @param {object} pairConfig - Pair config (target, source, endpoint, etc.)
   * @param {object} options - { apiKey } or reads from env
   * @returns {object|null} Map of key → translated value, or null
   */
  async translate(keys, sourceFlat, pairConfig, options) {
    const apiKey = options.apiKey
      || process.env.ROSETTA_API_KEY;

    if (!apiKey) {
      console.error('\n     [ERR] API method: No API key found.');
      console.error('        Set ROSETTA_API_KEY in your environment.');
      return null;
    }

    // Endpoint comes from the plugin manifest or the pair config
    const endpoint = this.endpoint
      || pairConfig.endpoint
      || options.endpoint;

    if (!endpoint) {
      console.error('\n     [ERR] API method: No endpoint configured.');
      console.error('        Install a plugin: rosetta plugin install <method-name>');
      return null;
    }

    const sourceLocale = pairConfig.source || 'en';
    const targetLocale = pairConfig.target;
    const method = this.methodName || pairConfig.methodPlugin || 'default';

    const allTranslated = {};

    // Chunk keys into batches of MAX_KEYS_PER_REQUEST
    for (let i = 0; i < keys.length; i += MAX_KEYS_PER_REQUEST) {
      const chunk = keys.slice(i, i + MAX_KEYS_PER_REQUEST);

      // Build the key-value payload for this batch
      const keysPayload = {};
      for (const key of chunk) {
        const value = sourceFlat[key];
        if (value && typeof value === 'string') {
          keysPayload[key] = value;
        }
      }

      if (Object.keys(keysPayload).length === 0) continue;

      const batchNum = Math.floor(i / MAX_KEYS_PER_REQUEST) + 1;
      const result = await this._translateBatchWithRetry(
        keysPayload,
        sourceLocale,
        targetLocale,
        method,
        endpoint,
        apiKey,
        batchNum,
      );

      if (result) {
        Object.assign(allTranslated, result);
      }
    }

    return Object.keys(allTranslated).length > 0 ? allTranslated : null;
  }

  /**
   * Freeform content translation via the API.
   *
   * The API method could support this in the future, but for now
   * we only support key-value translation. Return null so the
   * orchestrator falls back to the local LLM method.
   */
  async translateContent(_prompt, _pairConfig, _options) {
    return null;
  }

  /**
   * POST to the remote API with exponential backoff retry.
   *
   * @param {object} keysPayload - Map of key → source value
   * @param {string} sourceLocale - Source language code
   * @param {string} targetLocale - Target language code
   * @param {string} method - Method name from plugin manifest
   * @param {string} endpoint - API endpoint URL
   * @param {string} apiKey - Remote API key
   * @param {number} batchNum - Batch number for logging
   * @returns {object|null} Map of key → translated value
   */
  async _translateBatchWithRetry(keysPayload, sourceLocale, targetLocale, method, endpoint, apiKey, batchNum) {
    const keyCount = Object.keys(keysPayload).length;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'User-Agent': 'i18n-rosetta',
          },
          body: JSON.stringify({
            source_locale: sourceLocale,
            target_locale: targetLocale,
            method,
            keys: keysPayload,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Handle rate limiting with retry
        if (response.status === 429) {
          if (attempt < MAX_RETRIES) {
            // Respect Retry-After header if present
            const retryAfter = response.headers.get('Retry-After');
            const delay = retryAfter
              ? parseInt(retryAfter, 10) * 1000
              : getBackoffDelay(attempt);
            console.error(`\n     ⏳ API batch ${batchNum}: Rate limited — retrying in ${Math.round(delay / 1000)}s...`);
            await sleep(delay);
            continue;
          }
          console.error(`\n     [ERR] API batch ${batchNum}: Rate limited after ${MAX_RETRIES + 1} attempts`);
          return null;
        }

        // Handle server errors with retry
        if (response.status >= 500) {
          if (attempt < MAX_RETRIES) {
            const delay = getBackoffDelay(attempt);
            console.error(`\n     ⏳ API batch ${batchNum}: ${response.status} — retrying in ${Math.round(delay / 1000)}s...`);
            await sleep(delay);
            continue;
          }
          console.error(`\n     [ERR] API batch ${batchNum}: ${response.status} after ${MAX_RETRIES + 1} attempts`);
          return null;
        }

        // Handle auth errors (no retry)
        if (response.status === 401) {
          const body = await response.json().catch(() => ({}));
          console.error(`\n     [ERR] API method: Unauthorized — ${body.error?.message || 'Invalid API key'}`);
          console.error('        Check your ROSETTA_API_KEY environment variable.');
          return null;
        }

        // Handle payment required (no retry)
        if (response.status === 402) {
          const body = await response.json().catch(() => ({}));
          console.error(`\n     [ERR] API method: ${body.error?.message || 'Payment required — usage limit exceeded.'}`);
          return null;
        }

        // Handle method not found (no retry)
        if (response.status === 404) {
          const body = await response.json().catch(() => ({}));
          console.error(`\n     [ERR] API method: Method "${method}" not found — ${body.error?.message || 'Unknown method'}`);
          return null;
        }

        // Handle other client errors (no retry)
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          console.error(`\n     [ERR] API batch ${batchNum}: ${response.status} — ${body.error?.message || 'Unknown error'}`);
          return null;
        }

        const json = await response.json();

        // Handle partial success (207)
        if (response.status === 207 && json.errors) {
          const errorCount = Object.keys(json.errors).length;
          console.error(`\n     [WARN] API batch ${batchNum}: ${errorCount} key(s) failed`);
          for (const [key, err] of Object.entries(json.errors)) {
            console.error(`        ${key}: ${err.message}`);
          }
        }

        if (!json.translations || typeof json.translations !== 'object') {
          console.error(`\n     [ERR] API batch ${batchNum}: Invalid response — no translations object`);
          return null;
        }

        const translatedCount = Object.keys(json.translations).length;
        const costStr = json.meta?.cost_usd ? ` $${json.meta.cost_usd.toFixed(4)}` : '';
        process.stdout.write(`  ✓ API batch ${batchNum} (${translatedCount}/${keyCount} keys${costStr})`);

        return json.translations;

      } catch (err) {
        if (err.name === 'AbortError') {
          if (attempt < MAX_RETRIES) {
            console.error(`\n     ⏳ API batch ${batchNum}: Timeout — retrying...`);
            continue;
          }
          console.error(`\n     [ERR] API batch ${batchNum}: Timeout after ${MAX_RETRIES + 1} attempts`);
          return null;
        }

        if (attempt < MAX_RETRIES) {
          const delay = getBackoffDelay(attempt);
          console.error(`\n     ⏳ API batch ${batchNum}: ${err.message} — retrying in ${Math.round(delay / 1000)}s...`);
          await sleep(delay);
        } else {
          console.error(`\n     [ERR] API batch ${batchNum}: ${err.message} after ${MAX_RETRIES + 1} attempts`);
          return null;
        }
      }
    }
    return null;
  }

  /**
   * Cost estimation — API method pricing is determined by the remote server.
   * We cannot estimate cost without querying the endpoint.
   */
  estimateCost(keyCount) {
    return {
      estimatedCost: null,
      currency: 'USD',
      source: 'server-determined',
      note: 'Cost is determined by the remote API. Contact the provider for pricing.',
    };
  }

  getQualityTier() {
    return this.qualityTier;
  }

  getProvenance() {
    if (this.pluginProvenance) {
      return this.pluginProvenance;
    }
    return {
      resources: [
        { name: 'Remote Translation API', license: 'Provider ToS', type: 'api' },
      ],
      commercialReady: true,
      flags: [],
    };
  }
}

export { APIMethod };
