/**
 * LLM-Coached Translation Method — grammar/dictionary-injected LLM prompting.
 *
 * This method sits between raw LLM translation and a full FST-gated pipeline.
 * It injects developer-provided linguistic hints into the prompt before each
 * translation batch, giving the LLM explicit guidance for languages where
 * naive prompting produces frequent errors.
 *
 * HOW IT WORKS:
 *   1. Loads coaching data from .rosetta/coaching/<locale>.json
 *   2. For each batch, builds an augmented prompt with:
 *      a) Grammar rules (e.g., "French adjectives agree in gender/number")
 *      b) Dictionary overrides (e.g., "dashboard" → "tableau de bord")
 *      c) Style notes (e.g., "Prefer active voice, avoid anglicisms")
 *   3. Scans source values for dictionary matches and injects explicit hints
 *   4. Delegates the actual API call to the LLM method's infrastructure
 *
 * COACHING DATA FORMAT (.rosetta/coaching/<locale>.json):
 *   {
 *     "grammar_rules": [
 *       "French adjectives agree in gender and number with the noun",
 *       "Use 'vous' for formal contexts, 'tu' for informal"
 *     ],
 *     "dictionary": {
 *       "dashboard": "tableau de bord",
 *       "deployment": "déploiement",
 *       "settings": "paramètres"
 *     },
 *     "style_notes": "Prefer active voice. Avoid anglicisms where a native French term exists."
 *   }
 *
 * WHY .rosetta/ AND NOT localesDir/:
 *   Coaching data is a development tool artifact, not a deployable asset.
 *   Locale files in localesDir/ get bundled into the app. Coaching hints
 *   are tool configuration — they live in the project's .rosetta/ directory,
 *   following the same convention as .husky/, .eslintrc/, etc.
 *
 * COST PROFILE: ~$0.02–0.04 per 1k keys (longer prompts from coaching context)
 * QUALITY TIER: high
 */

import path from 'node:path';
import fs from 'node:fs';
import { TranslationMethod } from './base.js';
import { callOpenRouterJSON } from './openrouter-client.js';

// Re-use the LLM method's infrastructure (prompt building, key validation)
import { LLMMethod, inferKeyTypes, isUnsafeKey } from './llm.js';

/**
 * Default coaching data directory, relative to project root.
 * Users can override via config: coaching.dir
 */
const DEFAULT_COACHING_DIR = '.rosetta/coaching';

class LLMCoachedMethod extends TranslationMethod {
  constructor(options = {}) {
    super('llm-coached', options);
    this._coachingCache = new Map();
  }

  /**
   * Translate a batch of key-value pairs with coaching augmentation.
   *
   * Strategy:
   *   1. Load coaching data for the target locale
   *   2. If no coaching data exists, fall back to plain LLM method
   *   3. If coaching data exists, build augmented prompts and translate
   *
   * @param {string[]} keys - Flat dot-notation keys to translate
   * @param {object} sourceFlat - Full flattened source locale
   * @param {object} pairConfig - Pair config (method, model, register, name, etc.)
   * @param {object} options - { apiKey, batchSize, cwd }
   * @returns {object|null} Map of key → translated value, or null
   */
  async translate(keys, sourceFlat, pairConfig, options) {
    const { apiKey } = options;
    if (!apiKey) {
      console.error('     [WARN] LLM-Coached translate: no API key provided — skipping batch.');
      return null;
    }

    // Resolve the target locale from the pair config
    const targetLocale = pairConfig.target || pairConfig.locale;
    const cwd = options.cwd || process.cwd();
    const coachingDir = options.coachingDir || path.join(cwd, DEFAULT_COACHING_DIR);

    // Load coaching data for this locale
    const coaching = this._loadCoachingData(coachingDir, targetLocale);

    if (!coaching) {
      // No coaching data — fall back to plain LLM with a note
      console.error(`\n     [INFO] No coaching data for "${targetLocale}" at ${coachingDir}/${targetLocale}.json`);
      console.error('         Falling back to standard LLM method. Create coaching data for better results.\n');
      const fallback = new LLMMethod();
      return fallback.translate(keys, sourceFlat, pairConfig, options);
    }

    // Translate with coaching-augmented prompts
    const batchSize = pairConfig.batchSize || options.batchSize || 30;
    const model = pairConfig.model || options.model || 'openai/gpt-4o-mini';
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

      const prompt = buildCoachedPrompt(toTranslate, langConfig, coaching);
      const batchNum = Math.floor(i / batchSize) + 1;

      // Use LLM method's retry infrastructure for the API call
      const result = await this._callWithRetry(prompt, Object.keys(toTranslate), {
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
   * Translate freeform content with coaching context.
   *
   * For content translation, we prepend coaching style notes and grammar
   * rules to the existing prompt (which already contains the content).
   */
  async translateContent(prompt, pairConfig, options) {
    const { apiKey } = options;
    if (!apiKey) {
      console.error('     [WARN] LLM-Coached translateContent: no API key provided — skipping.');
      return null;
    }

    const targetLocale = pairConfig.target || pairConfig.locale;
    const cwd = options.cwd || process.cwd();
    const coachingDir = options.coachingDir || path.join(cwd, DEFAULT_COACHING_DIR);

    const coaching = this._loadCoachingData(coachingDir, targetLocale);

    if (!coaching) {
      // No coaching data — plain LLM fallback
      const fallback = new LLMMethod();
      return fallback.translateContent(prompt, pairConfig, options);
    }

    // Augment the content prompt with coaching context
    const coachingBlock = buildContentCoachingBlock(coaching);
    const augmentedPrompt = coachingBlock + '\n\n' + prompt;

    // Delegate to LLM method for the actual API call
    const fallback = new LLMMethod();
    return fallback.translateContent(augmentedPrompt, pairConfig, options);
  }

  /**
   * Cost estimation — same as LLM (model-dependent) but prompts are 2-3x larger
   * due to injected grammar/dictionary context. We still can't hardcode pricing.
   */
  estimateCost(keyCount) {
    return {
      estimatedCost: null,
      currency: 'USD',
      source: 'model-dependent',
      note: 'Cost varies by model. Coached prompts are ~2-3x larger than standard LLM due to injected context.',
    };
  }

  getQualityTier() {
    return 'high';
  }

  getProvenance() {
    return {
      resources: [
        { name: 'User-provided coaching data', license: 'project-local', type: 'dictionary/grammar' },
      ],
      commercialReady: true,
      flags: [],
    };
  }

  // -----------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------

  /**
   * Load coaching data for a locale, with caching.
   *
   * @param {string} coachingDir - Path to coaching data directory
   * @param {string} locale - Target locale code
   * @returns {object|null} Coaching data, or null if not found
   */
  _loadCoachingData(coachingDir, locale) {
    if (!locale) return null;

    // Check cache first
    const cacheKey = `${coachingDir}:${locale}`;
    if (this._coachingCache.has(cacheKey)) {
      return this._coachingCache.get(cacheKey);
    }

    const filePath = path.join(coachingDir, `${locale}.json`);

    if (!fs.existsSync(filePath)) {
      this._coachingCache.set(cacheKey, null);
      return null;
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);

      // Validate required structure
      const coaching = {
        grammar_rules: Array.isArray(data.grammar_rules) ? data.grammar_rules : [],
        dictionary: (data.dictionary && typeof data.dictionary === 'object') ? data.dictionary : {},
        style_notes: typeof data.style_notes === 'string' ? data.style_notes : '',
      };

      this._coachingCache.set(cacheKey, coaching);
      return coaching;
    } catch (err) {
      console.error(`\n     [WARN] Failed to load coaching data: ${filePath}`);
      console.error(`         ${err.message}\n`);
      this._coachingCache.set(cacheKey, null);
      return null;
    }
  }

  /**
   * Make a coached API call via the shared OpenRouter client.
   *
   * Prompt building and coaching data injection happen upstream —
   * this just delegates the HTTP mechanics to openrouter-client.js.
   */
  async _callWithRetry(prompt, expectedKeysList, options) {
    const { apiKey, model, batchNum } = options;

    return callOpenRouterJSON({
      prompt,
      apiKey,
      model,
      temperature: 0.2, // Lower than standard for coached (more deterministic)
      label: `Coached batch ${batchNum}`,
      xTitle: 'i18n-rosetta (coached)',
      expectedKeys: new Set(expectedKeysList),
      isUnsafeKey,
    });
  }
}

// -----------------------------------------------------------------
// Coached prompt building
// -----------------------------------------------------------------

/**
 * Build a coaching-augmented translation prompt.
 *
 * Structure:
 *   1. Standard translation instruction (role, register, rules)
 *   2. COACHING CONTEXT block (grammar, dictionary, style)
 *   3. Dictionary match hints for THIS batch
 *   4. UI context hints (from key name inference)
 *   5. JSON payload
 *
 * @param {object} toTranslate - Key-value map to translate
 * @param {object} langConfig - { name, register }
 * @param {object} coaching - Coaching data { grammar_rules, dictionary, style_notes }
 * @returns {string} Complete prompt
 */
function buildCoachedPrompt(toTranslate, langConfig, coaching) {
  // Standard instruction
  const instruction = `You are translating UI strings for a web/mobile application from English to ${langConfig.name}.

Register/tone: ${langConfig.register}

Rules:
- Translate ONLY the values, keep the keys exactly as-is.
- Proper nouns (product names, company names, place names) should NOT be translated.
- Technical terms and role descriptions that are industry-standard should stay in English.
- When gender is ambiguous, prefer gender-neutral forms or the most inclusive option available in ${langConfig.name}.
- Respect the UI element type: button labels should be concise, descriptions can be natural-length, error messages should be clear and direct.
- Return ONLY valid JSON, no markdown fences, no explanation.`;

  // Coaching context block
  const coachingParts = [];

  if (coaching.grammar_rules.length > 0) {
    coachingParts.push(
      'GRAMMAR RULES (follow strictly):',
      ...coaching.grammar_rules.map(r => `  • ${r}`)
    );
  }

  if (coaching.style_notes) {
    coachingParts.push(
      '',
      `STYLE GUIDE: ${coaching.style_notes}`
    );
  }

  // Find dictionary matches in this batch's source values
  const dictHints = findDictionaryMatches(toTranslate, coaching.dictionary);
  if (dictHints.length > 0) {
    coachingParts.push(
      '',
      'REQUIRED TERMINOLOGY (use these exact translations):',
      ...dictHints.map(h => `  • "${h.term}" → "${h.translation}"`)
    );
  }

  const coachingBlock = coachingParts.length > 0
    ? `\n\n--- COACHING CONTEXT ---\n${coachingParts.join('\n')}\n--- END COACHING ---\n`
    : '';

  // UI context hints (same as base LLM method)
  const typeHints = inferKeyTypes(toTranslate);
  const hintsBlock = typeHints.length > 0
    ? `\nUI context for these keys:\n${typeHints.join('\n')}\n`
    : '';

  return `${instruction}${coachingBlock}${hintsBlock}
${JSON.stringify(toTranslate, null, 2)}`;
}

/**
 * Build a coaching context block for freeform content translation.
 *
 * Lighter than the key-value version — only grammar and style, no dictionary
 * matching (content is too freeform for term-level matching).
 */
function buildContentCoachingBlock(coaching) {
  const parts = [];

  if (coaching.grammar_rules.length > 0) {
    parts.push(
      'IMPORTANT — Follow these grammar rules:',
      ...coaching.grammar_rules.map(r => `  • ${r}`)
    );
  }

  if (coaching.style_notes) {
    parts.push('', `STYLE GUIDE: ${coaching.style_notes}`);
  }

  return parts.length > 0 ? parts.join('\n') : '';
}

/**
 * Scan source values for dictionary term matches.
 *
 * Uses case-insensitive word-boundary matching to find terms from the
 * coaching dictionary that appear in the current batch's source values.
 *
 * @param {object} toTranslate - Key-value map to scan
 * @param {object} dictionary - Term → translation map
 * @returns {Array<{ term: string, translation: string }>} Matched hints
 */
function findDictionaryMatches(toTranslate, dictionary) {
  if (!dictionary || Object.keys(dictionary).length === 0) return [];

  const matches = [];
  const seen = new Set();
  const values = Object.values(toTranslate).join(' ').toLowerCase();

  for (const [term, translation] of Object.entries(dictionary)) {
    if (seen.has(term)) continue;

    // Case-insensitive word-boundary check
    // Use a simple indexOf for performance — the dictionary is usually small
    if (values.includes(term.toLowerCase())) {
      matches.push({ term, translation });
      seen.add(term);
    }
  }

  return matches;
}

export {
  LLMCoachedMethod,
  buildCoachedPrompt,
  buildContentCoachingBlock,
  findDictionaryMatches,
  DEFAULT_COACHING_DIR,
};
