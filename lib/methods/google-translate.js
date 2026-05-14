/**
 * Google Translate Method — Google Cloud Translation API v2.
 *
 * The universal baseline. Works out of the box with just a Google API key.
 * Zero prompt engineering, zero coaching data — pure neural MT. This gives
 * rosetta a free/cheap option that supports 130+ languages.
 *
 * HOW IT WORKS:
 *   1. Reads GOOGLE_TRANSLATE_API_KEY from environment
 *   2. Chunks keys into batches (max 128 segments per Google API call)
 *   3. POSTs to Google Cloud Translation API v2 REST endpoint
 *   4. Maps Google's response array back to rosetta's key-value format
 *   5. Returns translations
 *
 * WHY BUILT-IN (not a plugin):
 *   Google Translate is the universal i18n baseline. Every developer
 *   expects it. It should work with zero config — just an env var.
 *   No plugin install, no method manifest, no coaching data.
 *
 * COST PROFILE: ~$20 per 1M characters (Google's pricing)
 * QUALITY TIER: standard — no post-processing or verification
 *
 * ZERO DEPENDENCIES: Uses Node.js built-in fetch() against the REST API.
 */

import { TranslationMethod } from './base.js';
import {
  MAX_RETRIES, BASE_DELAY_MS,
  isRetryable, getBackoffDelay, sleep,
} from './http-utils.js';

const GOOGLE_API_URL = 'https://translation.googleapis.com/language/translate/v2';

// Google's batch limit per request
const MAX_SEGMENTS_PER_REQUEST = 128;

// Google Translate responses are fast — use a shorter timeout than the default
const GOOGLE_REQUEST_TIMEOUT_MS = 15000;

class GoogleTranslateMethod extends TranslationMethod {
  constructor(options = {}) {
    super('google-translate', options);
  }

  /**
   * Translate a batch of key-value pairs via Google Cloud Translation API.
   *
   * @param {string[]} keys - Flat dot-notation keys to translate
   * @param {object} sourceFlat - Full flattened source locale
   * @param {object} pairConfig - Pair config (target, source, etc.)
   * @param {object} options - { googleApiKey } or reads from env
   * @returns {object|null} Map of key → translated value, or null
   */
  async translate(keys, sourceFlat, pairConfig, options) {
    const apiKey = options.googleApiKey
      || process.env.GOOGLE_TRANSLATE_API_KEY
      || process.env.GOOGLE_API_KEY;

    if (!apiKey) {
      console.error('\n     [ERR] Google Translate: No API key found.');
      console.error('        Set GOOGLE_TRANSLATE_API_KEY in your environment.');
      return null;
    }

    const targetLocale = pairConfig.target;
    const sourceLocale = pairConfig.source || 'en';
    const allTranslated = {};

    // Chunk keys into batches of MAX_SEGMENTS_PER_REQUEST
    for (let i = 0; i < keys.length; i += MAX_SEGMENTS_PER_REQUEST) {
      const chunk = keys.slice(i, i + MAX_SEGMENTS_PER_REQUEST);

      // Build parallel arrays: ordered keys and their source values
      const orderedKeys = [];
      const sourceTexts = [];
      for (const key of chunk) {
        const value = sourceFlat[key];
        if (value && typeof value === 'string') {
          orderedKeys.push(key);
          sourceTexts.push(value);
        }
      }

      if (sourceTexts.length === 0) continue;

      const batchNum = Math.floor(i / MAX_SEGMENTS_PER_REQUEST) + 1;
      const result = await this._translateBatchWithRetry(
        orderedKeys,
        sourceTexts,
        sourceLocale,
        targetLocale,
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
   * Google Translate cannot safely translate freeform Markdown content.
   *
   * WHY: Google Translate is a text-in/text-out API — it has zero awareness
   * of Markdown structure. It will translate inside code blocks, break
   * [link text](url) syntax, mangle {{< shortcodes >}}, and corrupt
   * {placeholder} interpolation variables. The LLM methods explicitly
   * shield all of these during translation.
   *
   * Returns null so the orchestrator falls back to LLM for content.
   * Logs a warning so the user understands why and can switch methods.
   */
  async translateContent(_prompt, _pairConfig, _options) {
    console.error('\n     ⚠ Google Translate cannot safely translate Markdown content.');
    console.error('       It has no awareness of code blocks, shortcodes, links, or');
    console.error('       interpolation variables — these would be corrupted in translation.');
    console.error('       Falling back to LLM for this content block.');
    console.error('       → To avoid this, use method: "llm" for content-heavy pairs.\n');
    return null;
  }

  /**
   * Call Google Cloud Translation API v2 with retry.
   *
   * @param {string[]} orderedKeys - Keys in the same order as sourceTexts
   * @param {string[]} sourceTexts - Source values to translate
   * @param {string} sourceLocale - Source language code
   * @param {string} targetLocale - Target language code
   * @param {string} apiKey - Google Cloud API key
   * @param {number} batchNum - Batch number for logging
   * @returns {object|null} Map of key → translated value
   */
  async _translateBatchWithRetry(orderedKeys, sourceTexts, sourceLocale, targetLocale, apiKey, batchNum) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), GOOGLE_REQUEST_TIMEOUT_MS);

        // Google Translation API v2 accepts 'q' as an array of strings
        // API key sent via header (not query string) to avoid leaking in logs/proxies
        const response = await fetch(GOOGLE_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            q: sourceTexts,
            source: normalizeLocaleForGoogle(sourceLocale),
            target: normalizeLocaleForGoogle(targetLocale),
            format: 'text',
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (isRetryable(response.status)) {
          if (attempt < MAX_RETRIES) {
            const delay = getBackoffDelay(attempt);
            console.error(`\n     ⏳ Google batch ${batchNum}: ${response.status} — retrying in ${Math.round(delay / 1000)}s...`);
            await sleep(delay);
            continue;
          }
          console.error(`\n     [ERR] Google batch ${batchNum}: ${response.status} after ${MAX_RETRIES + 1} attempts`);
          return null;
        }

        if (!response.ok) {
          const errorBody = await response.text();
          console.error(`\n     [ERR] Google batch ${batchNum}: ${response.status} — ${errorBody}`);
          return null;
        }

        const json = await response.json();
        const translations = json?.data?.translations;

        if (!translations || translations.length !== orderedKeys.length) {
          console.error(`\n     [ERR] Google batch ${batchNum}: Response length mismatch (expected ${orderedKeys.length}, got ${translations?.length || 0})`);
          return null;
        }

        // Map translations back to key-value pairs
        const result = {};
        for (let i = 0; i < orderedKeys.length; i++) {
          result[orderedKeys[i]] = translations[i].translatedText;
        }

        const charCount = sourceTexts.reduce((sum, t) => sum + t.length, 0);
        process.stdout.write(`  ✓ Google batch ${batchNum} (${orderedKeys.length} keys, ${charCount} chars)`);

        return result;

      } catch (err) {
        if (err.name === 'AbortError') {
          console.error(`\n     ⏳ Google batch ${batchNum}: Timeout — retrying...`);
        } else if (attempt < MAX_RETRIES) {
          const delay = getBackoffDelay(attempt);
          console.error(`\n     ⏳ Google batch ${batchNum}: ${err.message} — retrying in ${Math.round(delay / 1000)}s...`);
          await sleep(delay);
        } else {
          console.error(`\n     [ERR] Google batch ${batchNum}: ${err.message} after ${MAX_RETRIES + 1} attempts`);
          return null;
        }
      }
    }
    return null;
  }

  /**
   * Estimate translation cost at Google's documented rate ($20/million chars).
   * Source: https://cloud.google.com/translate/pricing
   */
  estimateCost(keyCount) {
    // Average UI string: ~25 characters
    const estimatedChars = keyCount * 25;
    const costPerChar = 20 / 1_000_000;
    return {
      estimatedCost: Math.round(estimatedChars * costPerChar * 10000) / 10000,
      currency: 'USD',
      source: 'google-cloud-pricing',
      note: 'Based on Google Cloud Translation API v2 pricing ($20/1M chars). Actual cost depends on string length.',
    };
  }

  getQualityTier() {
    return 'standard';
  }

  getProvenance() {
    return {
      resources: [
        {
          name: 'Google Cloud Translation API',
          license: 'Proprietary (Google ToS)',
          type: 'api',
        },
      ],
      commercialReady: true,
      flags: [],
    };
  }
}

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------

/**
 * Normalize rosetta locale codes to Google Translate codes.
 *
 * Google uses BCP-47 but with some quirks:
 *   - 'zh-TW' → 'zh-TW' (fine)
 *   - 'crk' → not supported by Google (will return error)
 *   - Some codes need mapping: 'he' ↔ 'iw', 'jw' ↔ 'jv'
 */
function normalizeLocaleForGoogle(locale) {
  const GOOGLE_LOCALE_MAP = {
    'he': 'iw',   // Hebrew: BCP-47 is 'he', Google uses 'iw'
    'jv': 'jw',   // Javanese: BCP-47 is 'jv', Google uses 'jw'
  };
  return GOOGLE_LOCALE_MAP[locale] || locale;
}

export { GoogleTranslateMethod, normalizeLocaleForGoogle };
