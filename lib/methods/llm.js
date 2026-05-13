/**
 * LLM Translation Method — direct LLM prompting via OpenRouter.
 *
 * This is the default translation method and the foundation all other
 * methods build on. It extracts the existing translateBatch/translateRawContent
 * logic from the v2 translate.js into a proper method class.
 *
 * HOW IT WORKS:
 *   1. Receives keys + source values from the orchestrator
 *   2. Chunks them into batches (default 30 keys per batch)
 *   3. Builds a register-steered prompt per batch
 *   4. Sends to OpenRouter with exponential backoff retry
 *   5. Validates response (only accept keys we sent, block prototype pollution)
 *   6. Returns merged results
 *
 * COST PROFILE: ~$0.01 per 1k keys at GPT-4o-mini pricing.
 * QUALITY TIER: standard — no post-processing or verification.
 */

import { TranslationMethod } from './base.js';
import { REQUEST_TIMEOUT_MS } from './http-utils.js';
import { callOpenRouter, callOpenRouterJSON } from './openrouter-client.js';

/**
 * Keys that could trigger prototype pollution if accepted from LLM output.
 * Blocked in response validation as a defense-in-depth measure.
 */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Check if a key path contains any unsafe segments */
function isUnsafeKey(key) {
  return key.split('.').some(segment => UNSAFE_KEYS.has(segment));
}

class LLMMethod extends TranslationMethod {
  constructor(options = {}) {
    super('llm', options);
  }

  /**
   * Translate a batch of key-value pairs via OpenRouter.
   *
   * @param {string[]} keys - Flat dot-notation keys to translate
   * @param {object} sourceFlat - Full flattened source locale
   * @param {object} pairConfig - Pair config (method, model, register, name, etc.)
   * @param {object} options - { apiKey, batchSize }
   * @returns {object|null} Map of key → translated value, or null if all failed
   */
  async translate(keys, sourceFlat, pairConfig, options) {
    const { apiKey } = options;
    const batchSize = pairConfig.batchSize || options.batchSize || 30;
    const model = pairConfig.model || options.model || 'openai/gpt-4o-mini';
    if (!apiKey) return null;

    const langConfig = {
      name: pairConfig.name,
      register: pairConfig.register,
    };

    const allTranslated = {};

    for (let i = 0; i < keys.length; i += batchSize) {
      const chunk = keys.slice(i, i + batchSize);
      const toTranslate = {};
      for (const key of chunk) {
        toTranslate[key] = sourceFlat[key];
      }

      const batchNum = Math.floor(i / batchSize) + 1;
      const result = await this._translateChunkWithRetry(toTranslate, langConfig, {
        apiKey,
        model,
        batchNum,
      });

      if (result) {
        Object.assign(allTranslated, result);
      }
    }

    return Object.keys(allTranslated).length > 0 ? allTranslated : null;
  }

  /**
   * Translate freeform content (Markdown body, etc.) via OpenRouter.
   *
   * @param {string} prompt - Complete translation prompt
   * @param {object} pairConfig - Pair config
   * @param {object} options - { apiKey }
   * @returns {string|null} Translated text, or null on failure
   */
  async translateContent(prompt, pairConfig, options) {
    const { apiKey } = options;
    const model = pairConfig.model || options.model || 'openai/gpt-4o-mini';
    if (!apiKey) return null;

    // Content translation can produce longer output — allow 2x timeout
    return callOpenRouter({
      prompt,
      apiKey,
      model,
      temperature: 0.3,
      timeoutMs: REQUEST_TIMEOUT_MS * 2,
      label: 'Content',
    });
  }

  /**
   * Cost estimation — varies by model selected via OpenRouter.
   * We cannot hardcode a price because the user may choose any model.
   */
  estimateCost(keyCount) {
    return {
      estimatedCost: null,
      currency: 'USD',
      source: 'model-dependent',
      note: 'Cost varies by model. Check OpenRouter pricing for your configured model.',
    };
  }

  getQualityTier() {
    return 'standard';
  }

  getProvenance() {
    return {
      resources: [],
      commercialReady: true,
      flags: [],
    };
  }

  // -----------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------

  /**
   * Translate a single chunk via the shared OpenRouter client.
   * Prompt building and key validation stay here — HTTP mechanics
   * are handled by openrouter-client.js.
   */
  async _translateChunkWithRetry(toTranslate, langConfig, options) {
    const { apiKey, model, batchNum } = options;
    const prompt = buildPrompt(toTranslate, langConfig);

    return callOpenRouterJSON({
      prompt,
      apiKey,
      model,
      temperature: 0.3,
      label: `Batch ${batchNum}`,
      expectedKeys: new Set(Object.keys(toTranslate)),
      isUnsafeKey,
    });
  }
}

// -----------------------------------------------------------------
// Prompt building (preserved from v2 translate.js)
// -----------------------------------------------------------------

/**
 * Build the translation prompt for a chunk.
 * Includes register instructions and UI context hints.
 */
function buildPrompt(toTranslate, langConfig) {
  const typeHints = inferKeyTypes(toTranslate);
  const hintsBlock = typeHints.length > 0
    ? `\nUI context for these keys:\n${typeHints.join('\n')}\n`
    : '';

  return `You are translating UI strings for a web/mobile application from English to ${langConfig.name}.

Register/tone: ${langConfig.register}

Rules:
- Translate ONLY the values, keep the keys exactly as-is.
- Proper nouns (product names, company names, place names) should NOT be translated.
- Technical terms and role descriptions that are industry-standard should stay in English.
- When gender is ambiguous, prefer gender-neutral forms or the most inclusive option available in ${langConfig.name}.
- Respect the UI element type: button labels should be concise, descriptions can be natural-length, error messages should be clear and direct.
- Return ONLY valid JSON, no markdown fences, no explanation.
${hintsBlock}
${JSON.stringify(toTranslate, null, 2)}`;
}

/**
 * Infer UI element types from key naming patterns.
 */
const KEY_TYPE_PATTERNS = [
  { pattern: /(?:^|\.)(?:.*(?:btn|button|cta|action|submit|cancel|confirm|dismiss))/i, type: 'button label — keep concise' },
  { pattern: /(?:^|\.)(?:.*(?:title|heading|h[1-6]))/i, type: 'heading/title' },
  { pattern: /(?:^|\.)(?:.*(?:description|desc|subtitle|summary|body|paragraph))/i, type: 'description text — natural length OK' },
  { pattern: /(?:^|\.)(?:.*(?:error|warning|validation|alert))/i, type: 'error/status message — be clear and direct' },
  { pattern: /(?:^|\.)(?:.*(?:placeholder|hint))/i, type: 'input placeholder — keep very short' },
  { pattern: /(?:^|\.)(?:.*(?:label|field))/i, type: 'form label' },
  { pattern: /(?:^|\.)(?:.*(?:tooltip|popover|help))/i, type: 'tooltip/help text' },
  { pattern: /(?:^|\.)(?:.*(?:toast|notification|snackbar))/i, type: 'notification message' },
  { pattern: /(?:^|\.)(?:.*(?:nav|menu|tab|breadcrumb|link))/i, type: 'navigation element — keep concise' },
  { pattern: /(?:^|\.)(?:.*(?:modal|dialog))/i, type: 'dialog/modal text' },
];

function inferKeyTypes(toTranslate) {
  const hints = [];
  for (const key of Object.keys(toTranslate)) {
    for (const { pattern, type } of KEY_TYPE_PATTERNS) {
      if (pattern.test(key)) {
        hints.push(`- "${key}": ${type}`);
        break;
      }
    }
  }
  return hints;
}

export { LLMMethod, buildPrompt, isUnsafeKey, inferKeyTypes };
