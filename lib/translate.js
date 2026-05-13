/**
 * Translation orchestrator — delegates to method-specific implementations.
 *
 * v3 ARCHITECTURE:
 *   In v2, this module contained all the OpenRouter API logic directly.
 *   In v3, the actual API calls live in lib/methods/llm.js (and future
 *   method implementations). This module is now the orchestrator:
 *
 *   1. Receives a pair config (from pairs.js) with method/model/qualityTier
 *   2. Instantiates the correct TranslationMethod subclass
 *   3. Delegates the translation call
 *   4. Returns the result
 *
 *   This separation means adding a new translation strategy (e.g., fst-gated,
 *   human-review) requires only implementing a new method class — zero changes
 *   to the sync pipeline or any other consumer.
 *
 * BACKWARD COMPAT:
 *   The exported API (translateBatch, translateRawContent, isUnsafeKey) is
 *   preserved so that sync.js and content.js continue to work without
 *   changes during the transition. The only difference is that translateBatch
 *   now accepts an optional pairConfig as the third argument.
 */

import { LLMMethod, isUnsafeKey, buildPrompt, inferKeyTypes } from './methods/llm.js';
import { LLMCoachedMethod } from './methods/llm-coached.js';
import { GoogleTranslateMethod } from './methods/google-translate.js';
import { APIMethod } from './methods/api.js';

/**
 * Registry of available translation methods.
 *
 * Each entry maps a method name to its constructor.
 * To add a new method:
 *   1. Create the class in lib/methods/<name>.js
 *   2. Register it here
 *   3. Users can reference it in config pairs: { method: "<name>" }
 */
const METHOD_REGISTRY = {
  'llm': LLMMethod,
  'llm-coached': LLMCoachedMethod,
  'google-translate': GoogleTranslateMethod,
  'api': APIMethod,
};

/**
 * Get a TranslationMethod instance for the given method name.
 *
 * @param {string} methodName - Method name from pair config
 * @returns {TranslationMethod} Method instance
 */
function getMethod(methodName, pluginContext) {
  const MethodClass = METHOD_REGISTRY[methodName];
  if (!MethodClass) {
    console.error(`[WARN] Unknown translation method "${methodName}" — falling back to "llm"`);
    return new LLMMethod();
  }

  // APIMethod needs plugin context (endpoint, provenance, quality tier)
  if (methodName === 'api' && pluginContext) {
    return new MethodClass({
      endpoint: pluginContext.endpoint,
      methodName: pluginContext.pluginName,
      methodVersion: pluginContext.pluginVersion,
      qualityTier: pluginContext.qualityTier,
      provenance: pluginContext.pluginProvenance,
    });
  }

  return new MethodClass();
}

/**
 * Translate a batch of key-value pairs.
 *
 * v3 SIGNATURE: Accepts either the v2 langConfig or a v3 pairConfig.
 * Detection is automatic — if the third argument has a `method` field,
 * it's a v3 pairConfig; otherwise it's a v2 langConfig.
 *
 * @param {string[]} keys - Flat dot-notation keys to translate
 * @param {object} sourceFlat - Full flattened source locale
 * @param {object} langConfigOrPairConfig - v2 langConfig or v3 pairConfig
 * @param {object} options - { apiKey, model, batchSize }
 * @returns {object|null} Map of key → translated value, or null
 */
async function translateBatch(keys, sourceFlat, langConfigOrPairConfig, options) {
  // Detect v2 vs v3 config format
  const isV3 = langConfigOrPairConfig && langConfigOrPairConfig.method;

  if (isV3) {
    // v3 path: use the method specified in the pair config
    const pairConfig = langConfigOrPairConfig;
    const method = getMethod(pairConfig.method, pairConfig);
    return method.translate(keys, sourceFlat, pairConfig, options);
  }

  // v2 compat path: use the default LLM method
  const langConfig = langConfigOrPairConfig;
  const method = new LLMMethod();
  const pairConfig = {
    source: 'en',
    target: 'unknown',
    method: 'llm',
    model: options.model || 'openai/gpt-4o-mini',
    batchSize: options.batchSize || 30,
    name: langConfig.name,
    register: langConfig.register,
  };

  return method.translate(keys, sourceFlat, pairConfig, options);
}

/**
 * Translate freeform text content (e.g., Markdown body).
 *
 * @param {string} prompt - Complete translation prompt
 * @param {object} options - { apiKey, model } or { apiKey, pairConfig }
 * @returns {string|null} Translated text, or null on failure
 */
async function translateRawContent(prompt, options) {
  const pairConfig = options.pairConfig || {
    model: options.model || 'openai/gpt-4o-mini',
    method: 'llm',
  };

  const method = getMethod(pairConfig.method);
  return method.translateContent(prompt, pairConfig, options);
}

export { translateBatch, translateRawContent, buildPrompt, isUnsafeKey, inferKeyTypes, getMethod, METHOD_REGISTRY };
