/**
 * Language pair resolution — converts config into a directional pair graph.
 *
 * WHY: i18n-rosetta v2 assumed English→X for everything. v3 models
 * translation as directional pairs (en:fr, es:en, en:crk) where each
 * pair can have its own method, model, quality tier, and cost profile.
 *
 * The pair model supports two config modes:
 *   1. Simple: `languages: ["fr", "de"]` — all pairs use default method/model
 *   2. Advanced: `pairs: { "en:crk": { method: "fst-gated" } }` — per-pair overrides
 *
 * Both can coexist: `pairs` overrides `languages` for specific language targets.
 *
 * PAIR KEY FORMAT: "source:target" (e.g., "en:fr")
 * Canonical separator is the colon (:) — compact, ASCII-safe, and
 * unambiguous since no locale code contains a colon. Legacy formats
 * (→, ->) are still accepted by parsePairKey for backward compatibility.
 */

import { DEFAULT_REGISTERS } from './registers.js';
import { getMethod } from './translate.js';

/**
 * Quality tiers — define the expected reliability of a translation.
 *
 * These tiers aren't arbitrary labels. Each corresponds to a concrete
 * verification level that determines how much the output can be trusted
 * without human review.
 */
const QUALITY_TIERS = {
  standard: {
    label: 'Standard',
    description: 'Direct LLM translation. No post-processing verification.',
  },
  high: {
    label: 'High',
    description: 'LLM translation with grammar/dictionary coaching. Better for complex morphology.',
  },
  research: {
    label: 'Research',
    description: 'LLM + deterministic FST/grammar gate. Morphologically verified output.',
  },
  verified: {
    label: 'Verified',
    description: 'LLM draft flagged for human review. Highest confidence.',
  },
};

/**
 * Default method config — applied to all pairs unless overridden.
 */
const PAIR_DEFAULTS = {
  method: 'llm',
  model: null,       // null = inherit from top-level config.model
  qualityTier: 'standard',
  batchSize: null,   // null = inherit from top-level config.batchSize
};

/**
 * Resolve the full pair graph from config.
 *
 * Returns a Map of pairKey → pairConfig, where each pairConfig contains:
 *   - source:      source locale code (e.g., "en")
 *   - target:      target locale code (e.g., "fr")
 *   - method:      translation method name (e.g., "llm", "llm-coached")
 *   - model:       model identifier (e.g., "openai/gpt-4o-mini")
 *   - qualityTier: one of QUALITY_TIERS keys
 *   - batchSize:   keys per API batch
 *   - register:    target language register (tone/style instructions)
 *   - name:        target language display name
 *   - dir:         text directionality ('ltr' or 'rtl')
 *   - scripts:     available script conversions (if any)
 *
 * Pair keys use colon separator: "en:fr", "en:crk".
 * Legacy arrow formats (en→fr, en->fr) in config.pairs are accepted
 * by parsePairKey but stored internally in colon format.
 *
 * @param {object} config - Resolved config (post-migration, post-defaults)
 * @returns {Map<string, object>} Pair graph
 */
function resolvePairs(config) {
  const pairs = new Map();
  const inputLocale = config.inputLocale || config.sourceLocale || 'en';
  const defaultModel = config.model || 'openai/gpt-4o-mini';
  const defaultBatchSize = config.batchSize || 30;

  // Step 1: Build pairs from the `languages` array (simple mode)
  const languages = config.resolvedLanguages || {};
  for (const [code, langConfig] of Object.entries(languages)) {
    const pairKey = buildPairKey(inputLocale, code);
    const registerInfo = DEFAULT_REGISTERS[code] || {};

    pairs.set(pairKey, {
      source: inputLocale,
      target: code,
      method: PAIR_DEFAULTS.method,
      model: defaultModel,
      qualityTier: PAIR_DEFAULTS.qualityTier,
      batchSize: defaultBatchSize,
      register: langConfig.register || registerInfo.register || 'Professional register.',
      name: langConfig.name || registerInfo.name || code,
      dir: registerInfo.dir || 'ltr',
      scripts: registerInfo.scripts || null,
    });
  }

  // Step 2: Apply overrides from `pairs` object (advanced mode)
  // These can override simple-mode pairs or add entirely new ones
  if (config.pairs && typeof config.pairs === 'object') {
    for (const [rawPairKey, pairOverride] of Object.entries(config.pairs)) {
      const { source, target } = parsePairKey(rawPairKey);
      if (!source || !target) {
        console.error(`[ERR] Invalid pair key "${rawPairKey}" — expected format "source:target" (e.g., "en:fr")`);
        continue;
      }

      // Normalize to canonical colon format regardless of input format
      const pairKey = buildPairKey(source, target);
      const registerInfo = DEFAULT_REGISTERS[target] || {};
      const existing = pairs.get(pairKey) || {};

      pairs.set(pairKey, {
        source,
        target,
        method: pairOverride.method || existing.method || PAIR_DEFAULTS.method,
        model: pairOverride.model || existing.model || defaultModel,
        qualityTier: pairOverride.qualityTier || existing.qualityTier || PAIR_DEFAULTS.qualityTier,
        batchSize: pairOverride.batchSize || existing.batchSize || defaultBatchSize,
        register: pairOverride.register || existing.register || registerInfo.register || 'Professional register.',
        name: pairOverride.name || existing.name || registerInfo.name || target,
        dir: existing.dir || registerInfo.dir || 'ltr',
        scripts: existing.scripts || registerInfo.scripts || null,
        // Plugin reference — the plugin loader will merge its config into this pair
        methodPlugin: pairOverride.methodPlugin || null,
      });
    }
  }

  return pairs;
}

/**
 * Parse a pair key into its source and target components.
 *
 * Supports three separator formats (checked in this order):
 *   1. ":"  — canonical format (e.g., "en:fr")
 *   2. "→" — legacy Unicode arrow (e.g., "en→fr")
 *   3. "->" — legacy ASCII arrow (e.g., "en->fr")
 *
 * WHY colon: Compact, ASCII-safe, and unambiguous — no locale code
 * contains a colon, unlike underscores (pt_BR) or hyphens (zh-TW).
 * Legacy arrow formats are accepted for backward compatibility with
 * existing configs.
 *
 * @param {string} pairKey - Pair key to parse
 * @returns {{ source: string|null, target: string|null }}
 */
function parsePairKey(pairKey) {
  // Canonical colon first, then legacy arrow formats
  const separators = [':', '→', '->'];
  for (const sep of separators) {
    const idx = pairKey.indexOf(sep);
    if (idx !== -1) {
      const source = pairKey.slice(0, idx).trim();
      const target = pairKey.slice(idx + sep.length).trim();
      if (source && target) {
        return { source, target };
      }
    }
  }
  return { source: null, target: null };
}

/**
 * Build a pair key from source and target locale codes.
 *
 * Uses the canonical colon separator format.
 *
 * @param {string} source - Source locale code
 * @param {string} target - Target locale code
 * @returns {string} Pair key (e.g., "en:fr")
 */
function buildPairKey(source, target) {
  return `${source}:${target}`;
}

/**
 * Get all target locale codes from a pair graph.
 *
 * @param {Map<string, object>} pairs - Pair graph
 * @returns {string[]} Unique target locale codes
 */
function getTargetLocales(pairs) {
  const targets = new Set();
  for (const pair of pairs.values()) {
    targets.add(pair.target);
  }
  return [...targets];
}

/**
 * Get the pair config for a specific target locale.
 * Searches for any pair where the target matches the given code.
 *
 * @param {Map<string, object>} pairs - Pair graph
 * @param {string} targetCode - Target locale code
 * @returns {object|null} Pair config, or null if not found
 */
function getPairForTarget(pairs, targetCode) {
  for (const pair of pairs.values()) {
    if (pair.target === targetCode) {
      return pair;
    }
  }
  return null;
}

/**
 * Estimate the cost of translating a set of keys for a given pair.
 *
 * Delegates to the pair's configured method class. Each method knows
 * its own pricing model (or honestly returns null when it can't know).
 *
 * @param {number} keyCount - Number of keys to translate
 * @param {object} pairConfig - Pair config with method and model
 * @returns {{ estimatedCost: number|null, currency: string, source: string, note: string }}
 */
function estimateCost(keyCount, pairConfig) {
  const methodName = pairConfig.method || 'llm';

  // Delegate to the method's own cost estimate.
  // WHY: We can't hardcode pricing here because each method has its own
  // pricing model (or lack thereof). Google has documented rates ($20/1M chars),
  // LLM varies by model, API is server-determined.
  try {
    const method = getMethod(methodName);
    return method.estimateCost(keyCount);
  } catch {
    // If method resolution fails, return an honest "unknown"
    return {
      estimatedCost: null,
      currency: 'USD',
      source: 'unknown',
      note: `Could not resolve method "${methodName}" for cost estimation.`,
    };
  }
}

export {
  resolvePairs,
  parsePairKey,
  buildPairKey,
  getTargetLocales,
  getPairForTarget,
  estimateCost,
  QUALITY_TIERS,
  PAIR_DEFAULTS,
};
