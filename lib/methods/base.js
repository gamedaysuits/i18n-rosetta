/**
 * TranslationMethod — base interface for all translation methods.
 *
 * WHY: i18n-rosetta v2 hardcoded a single OpenRouter fetch in translate.js.
 * v3 abstracts this into a pluggable method system so that different
 * language pairs can use different translation strategies:
 *
 *   - llm:          Direct LLM prompt (current behavior, cheapest)
 *   - llm-coached:  LLM + grammar/dictionary injection (better for complex morphology)
 *   - fst-gated:    LLM + deterministic morphological gate (research-grade, most expensive)
 *   - human-review: LLM draft flagged for human review (highest confidence)
 *
 * Each method must implement:
 *   - translate(keys, sourceFlat, pairConfig, options) → { key: value } or null
 *   - estimateCost(keyCount) → { estimatedCost: number|null, currency, source }
 *   - getQualityTier() → 'standard' | 'high' | 'research' | 'verified'
 *   - getProvenance() → { resources: [], commercialReady: boolean, flags: [] }
 *
 * HOW IT WORKS:
 *   The translate orchestrator in translate.js looks up the method name
 *   from the pair config, instantiates the corresponding method class,
 *   and delegates the translation call. The method handles prompting,
 *   API communication, and any post-processing specific to its strategy.
 */

/**
 * Base class for translation methods.
 * Subclasses must override translate() at minimum.
 */
class TranslationMethod {
  constructor(name, options = {}) {
    this.name = name;
    this.options = options;
  }

  /**
   * Translate a set of key-value pairs.
   *
   * @param {string[]} keys - Flat dot-notation keys to translate
   * @param {object} sourceFlat - Full flattened source locale (for value lookup)
   * @param {object} pairConfig - Pair config from pairs.js (method, model, register, etc.)
   * @param {object} options - { apiKey, batchSize, ... }
   * @returns {object|null} Map of key → translated value, or null if all batches failed
   */
  async translate(keys, sourceFlat, pairConfig, options) {
    throw new Error(`TranslationMethod.translate() not implemented by ${this.name}`);
  }

  /**
   * Translate freeform text content (e.g., Markdown body).
   *
   * Not all methods support this — freeform content is harder to gate
   * deterministically. Methods that don't support it should return null,
   * and the orchestrator will fall back to the default LLM method.
   *
   * @param {string} prompt - Complete translation prompt
   * @param {object} pairConfig - Pair config
   * @param {object} options - { apiKey, model }
   * @returns {string|null} Translated text, or null if unsupported
   */
  async translateContent(prompt, pairConfig, options) {
    // Default: unsupported. Subclasses override if they can handle freeform.
    return null;
  }

  /**
   * Estimate the cost of translating N keys with this method.
   *
   * Subclasses should override with real pricing data.
   * Returning `estimatedCost: null` means "unknown" — consumers must
   * distinguish this from zero (which would mean "free").
   *
   * @param {number} keyCount - Number of keys to translate
   * @returns {{ estimatedCost: number|null, currency: string, source: string }}
   */
  estimateCost(keyCount) {
    return { estimatedCost: null, currency: 'USD', source: 'none' };
  }

  /**
   * Get the quality tier for this method.
   *
   * @deprecated Use plugin benchmarks instead of tier labels.
   *   Tier labels are subjective; benchmarks are measurable.
   *   Kept for backward compat — nothing makes dispatch decisions based on this.
   *
   * @returns {string} One of: 'standard', 'high', 'research', 'verified'
   */
  getQualityTier() {
    return 'standard';
  }

  /**
   * Get provenance information for this method.
   *
   * Lists all external resources (datasets, tools, APIs) that this method
   * depends on, their licenses, and whether commercial use is cleared.
   *
   * @returns {{ resources: Array, commercialReady: boolean, flags: string[] }}
   */
  getProvenance() {
    return {
      resources: [],
      commercialReady: true,
      flags: [],
    };
  }
}

export { TranslationMethod };
