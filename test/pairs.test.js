/**
 * Pair resolution test suite — validates the language pair graph system.
 *
 * Tests cover:
 *   - Simple mode (languages array → pairs)
 *   - Advanced mode (explicit pairs config)
 *   - Pair key parsing (colon :, Unicode →, and ASCII -> separators)
 *   - Quality tiers, cost estimation
 *   - Edge cases: empty configs, unknown locales, pair overrides
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolvePairs,
  parsePairKey,
  buildPairKey,
  getTargetLocales,
  getPairForTarget,
  estimateCost,
  QUALITY_TIERS,
  PAIR_DEFAULTS,
} from '../lib/pairs.js';

// =================================================================
// parsePairKey
// =================================================================
describe('parsePairKey', () => {
  it('parses canonical colon separator', () => {
    const result = parsePairKey('en:fr');
    assert.equal(result.source, 'en');
    assert.equal(result.target, 'fr');
  });

  it('parses legacy Unicode arrow separator', () => {
    const result = parsePairKey('en→fr');
    assert.equal(result.source, 'en');
    assert.equal(result.target, 'fr');
  });

  it('parses legacy ASCII arrow separator', () => {
    const result = parsePairKey('en->fr');
    assert.equal(result.source, 'en');
    assert.equal(result.target, 'fr');
  });

  it('handles locale codes with hyphens (colon format)', () => {
    const result = parsePairKey('en:zh-TW');
    assert.equal(result.source, 'en');
    assert.equal(result.target, 'zh-TW');
  });

  it('handles locale codes with hyphens (legacy arrow)', () => {
    const result = parsePairKey('en→zh-TW');
    assert.equal(result.source, 'en');
    assert.equal(result.target, 'zh-TW');
  });

  it('handles spaces around colon separator', () => {
    const result = parsePairKey('en : fr');
    assert.equal(result.source, 'en');
    assert.equal(result.target, 'fr');
  });

  it('handles spaces around legacy arrow separator', () => {
    const result = parsePairKey('en → fr');
    assert.equal(result.source, 'en');
    assert.equal(result.target, 'fr');
  });

  it('returns null for invalid pair keys', () => {
    const result = parsePairKey('not-a-pair');
    assert.equal(result.source, null);
    assert.equal(result.target, null);
  });

  it('returns null for empty string', () => {
    const result = parsePairKey('');
    assert.equal(result.source, null);
    assert.equal(result.target, null);
  });

  it('returns null when source is missing (colon)', () => {
    const result = parsePairKey(':fr');
    assert.equal(result.source, null);
    assert.equal(result.target, null);
  });

  it('returns null when source is missing (arrow)', () => {
    const result = parsePairKey('→fr');
    assert.equal(result.source, null);
    assert.equal(result.target, null);
  });

  it('returns null when target is missing (colon)', () => {
    const result = parsePairKey('en:');
    assert.equal(result.source, null);
    assert.equal(result.target, null);
  });

  it('returns null when target is missing (arrow)', () => {
    const result = parsePairKey('en→');
    assert.equal(result.source, null);
    assert.equal(result.target, null);
  });

  it('all three formats parse to the same result', () => {
    const colon = parsePairKey('en:fr');
    const arrow = parsePairKey('en→fr');
    const ascii = parsePairKey('en->fr');
    assert.deepEqual(colon, arrow);
    assert.deepEqual(arrow, ascii);
  });
});

// =================================================================
// buildPairKey
// =================================================================
describe('buildPairKey', () => {
  it('builds a pair key with colon separator', () => {
    assert.equal(buildPairKey('en', 'fr'), 'en:fr');
  });

  it('handles hyphenated locale codes', () => {
    assert.equal(buildPairKey('en', 'zh-TW'), 'en:zh-TW');
  });
});

// =================================================================
// resolvePairs — simple mode (from languages)
// =================================================================
describe('resolvePairs — simple mode', () => {
  it('builds pairs from resolvedLanguages', () => {
    const config = {
      inputLocale: 'en',
      model: 'openai/gpt-4o-mini',
      batchSize: 30,
      resolvedLanguages: {
        fr: { name: 'French', register: 'Formal French.' },
        de: { name: 'German', register: 'Sie-form.' },
      },
    };

    const pairs = resolvePairs(config);
    assert.equal(pairs.size, 2);

    const frPair = pairs.get('en:fr');
    assert.ok(frPair, 'Should have en:fr pair');
    assert.equal(frPair.source, 'en');
    assert.equal(frPair.target, 'fr');
    assert.equal(frPair.method, 'llm');
    assert.equal(frPair.name, 'French');
    assert.equal(frPair.register, 'Formal French.');
    assert.equal(frPair.qualityTier, 'standard');
  });

  it('handles empty resolvedLanguages', () => {
    const config = {
      inputLocale: 'en',
      resolvedLanguages: {},
    };

    const pairs = resolvePairs(config);
    assert.equal(pairs.size, 0);
  });

  it('uses inputLocale as pair source', () => {
    const config = {
      inputLocale: 'es',
      resolvedLanguages: {
        en: { name: 'English', register: 'Standard.' },
      },
    };

    const pairs = resolvePairs(config);
    const pair = pairs.get('es:en');
    assert.ok(pair, 'Should build pair using inputLocale as source');
    assert.equal(pair.source, 'es');
  });

  it('falls back to sourceLocale if inputLocale is missing', () => {
    const config = {
      sourceLocale: 'fr',
      resolvedLanguages: {
        en: { name: 'English', register: 'Standard.' },
      },
    };

    const pairs = resolvePairs(config);
    assert.ok(pairs.has('fr:en'));
  });

  it('defaults to en when no locale is specified', () => {
    const config = {
      resolvedLanguages: {
        fr: { name: 'French', register: 'Standard.' },
      },
    };

    const pairs = resolvePairs(config);
    assert.ok(pairs.has('en:fr'));
  });

  it('pulls dir from registers for known languages', () => {
    const config = {
      inputLocale: 'en',
      resolvedLanguages: {
        ar: { name: 'Arabic', register: 'MSA.' },
      },
    };

    const pairs = resolvePairs(config);
    assert.equal(pairs.get('en:ar').dir, 'rtl');
  });
});

// =================================================================
// resolvePairs — advanced mode (explicit pairs)
// =================================================================
describe('resolvePairs — advanced mode', () => {
  it('applies overrides from config.pairs', () => {
    const config = {
      inputLocale: 'en',
      resolvedLanguages: {
        fr: { name: 'French', register: 'Standard.' },
      },
      pairs: {
        'en:fr': { method: 'llm-coached', qualityTier: 'high' },
      },
    };

    const pairs = resolvePairs(config);
    const frPair = pairs.get('en:fr');
    assert.equal(frPair.method, 'llm-coached');
    assert.equal(frPair.qualityTier, 'high');
    // Name should be preserved from simple mode
    assert.equal(frPair.name, 'French');
  });

  it('adds entirely new pairs not in languages', () => {
    const config = {
      inputLocale: 'en',
      resolvedLanguages: {},
      pairs: {
        'en:crk': { method: 'fst-gated', qualityTier: 'research' },
      },
    };

    const pairs = resolvePairs(config);
    assert.equal(pairs.size, 1);
    const crkPair = pairs.get('en:crk');
    assert.equal(crkPair.method, 'fst-gated');
    assert.equal(crkPair.qualityTier, 'research');
  });

  it('allows non-default source locales in pairs', () => {
    const config = {
      inputLocale: 'en',
      resolvedLanguages: {},
      pairs: {
        'es:en': { method: 'llm' },
      },
    };

    const pairs = resolvePairs(config);
    const pair = pairs.get('es:en');
    assert.ok(pair);
    assert.equal(pair.source, 'es');
    assert.equal(pair.target, 'en');
  });

  it('skips invalid pair keys with warning', () => {
    const warnings = [];
    const origError = console.error;
    console.error = (msg) => warnings.push(msg);

    try {
      const config = {
        inputLocale: 'en',
        resolvedLanguages: {},
        pairs: {
          'bad-key-format': { method: 'llm' },
        },
      };

      const pairs = resolvePairs(config);
      assert.equal(pairs.size, 0);
      assert.ok(warnings.some(w => w.includes('Invalid pair key')));
    } finally {
      console.error = origError;
    }
  });

  it('normalizes legacy arrow format to colon in Map keys', () => {
    const config = {
      inputLocale: 'en',
      resolvedLanguages: {},
      pairs: {
        'en→fr': { method: 'llm-coached' },
      },
    };

    const pairs = resolvePairs(config);
    // Legacy arrow key should be normalized to colon format in the Map
    assert.ok(pairs.has('en:fr'), 'Arrow key should be stored as en:fr');
    assert.ok(!pairs.has('en→fr'), 'Should not store raw arrow key');
    assert.equal(pairs.get('en:fr').method, 'llm-coached');
  });

  it('normalizes ASCII arrow format to colon in Map keys', () => {
    const config = {
      inputLocale: 'en',
      resolvedLanguages: {},
      pairs: {
        'en->de': { method: 'google-translate' },
      },
    };

    const pairs = resolvePairs(config);
    assert.ok(pairs.has('en:de'), 'ASCII arrow key should be stored as en:de');
    assert.equal(pairs.get('en:de').method, 'google-translate');
  });
});

// =================================================================
// getTargetLocales
// =================================================================
describe('getTargetLocales', () => {
  it('returns unique target codes', () => {
    const pairs = new Map([
      ['en:fr', { target: 'fr' }],
      ['en:de', { target: 'de' }],
      ['es:fr', { target: 'fr' }],
    ]);

    const targets = getTargetLocales(pairs);
    assert.deepEqual(targets.sort(), ['de', 'fr']);
  });
});

// =================================================================
// getPairForTarget
// =================================================================
describe('getPairForTarget', () => {
  it('finds the pair for a target code', () => {
    const pairs = new Map([
      ['en:fr', { source: 'en', target: 'fr', name: 'French' }],
    ]);

    const pair = getPairForTarget(pairs, 'fr');
    assert.ok(pair);
    assert.equal(pair.name, 'French');
  });

  it('returns null for unknown target', () => {
    const pairs = new Map([
      ['en:fr', { source: 'en', target: 'fr' }],
    ]);

    const pair = getPairForTarget(pairs, 'de');
    assert.equal(pair, null);
  });
});

// =================================================================
// estimateCost
// =================================================================
describe('estimateCost', () => {
  it('delegates to method class — LLM returns null (model-dependent)', () => {
    const result = estimateCost(100, { method: 'llm' });
    assert.equal(result.estimatedCost, null, 'LLM pricing is model-dependent');
    assert.equal(result.currency, 'USD');
    assert.equal(result.source, 'model-dependent');
  });

  it('delegates to method class — Google returns real pricing', () => {
    const result = estimateCost(100, { method: 'google-translate' });
    assert.ok(result.estimatedCost > 0, 'Google has documented pricing');
    assert.equal(result.source, 'google-cloud-pricing');
  });

  it('handles unknown method by falling back to LLM', () => {
    // getMethod falls back to LLM for unknown methods, so cost is model-dependent
    const result = estimateCost(100, { method: 'nonexistent-xyz' });
    assert.equal(result.estimatedCost, null);
    assert.equal(result.source, 'model-dependent');
  });

  it('defaults to llm method when unspecified', () => {
    const result = estimateCost(100, {});
    assert.equal(result.estimatedCost, null);
    assert.equal(result.source, 'model-dependent');
  });
});

// =================================================================
// QUALITY_TIERS
// =================================================================
describe('QUALITY_TIERS', () => {
  it('has all four tiers', () => {
    const expected = ['standard', 'high', 'research', 'verified'];
    for (const tier of expected) {
      assert.ok(QUALITY_TIERS[tier], `Missing tier: ${tier}`);
      assert.ok(QUALITY_TIERS[tier].label, `${tier} missing label`);
      assert.ok(QUALITY_TIERS[tier].description, `${tier} missing description`);
    }
  });
});

// =================================================================
// PAIR_DEFAULTS
// =================================================================
describe('PAIR_DEFAULTS', () => {
  it('uses llm as default method', () => {
    assert.equal(PAIR_DEFAULTS.method, 'llm');
  });

  it('uses standard as default quality tier', () => {
    assert.equal(PAIR_DEFAULTS.qualityTier, 'standard');
  });
});
