#!/usr/bin/env node
/**
 * Translation method test suite — validates the pluggable method system.
 *
 * Tests cover:
 *   - TranslationMethod base class contract
 *   - LLMMethod prompt building and key-type inference
 *   - LLMCoachedMethod fallback behavior
 *   - Method registry lookup in translate.js
 *   - Provenance reporting
 *   - Script conversion (SRO→Syllabics, Latin→Cyrillic)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { TranslationMethod } from '../lib/methods/base.js';
import { LLMMethod, buildPrompt, isUnsafeKey, inferKeyTypes } from '../lib/methods/llm.js';
import { LLMCoachedMethod } from '../lib/methods/llm-coached.js';
import { getMethod, METHOD_REGISTRY } from '../lib/translate.js';
import { getProvenance, isCommercialReady, auditProvenance, formatProvenanceReport } from '../lib/provenance.js';
import { sroToSyllabics, latinToCyrillicSr, convertScript, hasScriptConverter, getConverterInfo } from '../lib/scripts.js';

// =================================================================
// TranslationMethod base class
// =================================================================
describe('TranslationMethod base class', () => {
  it('throws on unimplemented translate()', async () => {
    const base = new TranslationMethod('test');
    await assert.rejects(
      () => base.translate([], {}, {}, {}),
      { message: /not implemented by test/ }
    );
  });

  it('returns null for unsupported translateContent()', async () => {
    const base = new TranslationMethod('test');
    const result = await base.translateContent('prompt', {}, {});
    assert.equal(result, null);
  });

  it('returns unknown cost estimate by default', () => {
    const base = new TranslationMethod('test');
    const cost = base.estimateCost(100);
    assert.equal(cost.estimatedCost, null, 'Unknown methods return null, not zero');
    assert.equal(cost.currency, 'USD');
    assert.equal(cost.source, 'none');
  });

  it('returns standard quality tier by default', () => {
    const base = new TranslationMethod('test');
    assert.equal(base.getQualityTier(), 'standard');
  });

  it('returns clean provenance by default', () => {
    const base = new TranslationMethod('test');
    const prov = base.getProvenance();
    assert.equal(prov.commercialReady, true);
    assert.equal(prov.resources.length, 0);
    assert.equal(prov.flags.length, 0);
  });
});

// =================================================================
// LLMMethod
// =================================================================
describe('LLMMethod', () => {
  it('has the correct name', () => {
    const method = new LLMMethod();
    assert.equal(method.name, 'llm');
  });

  it('returns standard quality tier', () => {
    const method = new LLMMethod();
    assert.equal(method.getQualityTier(), 'standard');
  });

  it('returns null cost (model-dependent pricing)', () => {
    const method = new LLMMethod();
    const cost = method.estimateCost(100);
    assert.equal(cost.estimatedCost, null, 'LLM cost is model-dependent — cannot hardcode');
    assert.equal(cost.source, 'model-dependent');
    assert.ok(cost.note.length > 0, 'Should include explanatory note');
  });

  it('returns null when no API key is provided', async () => {
    const method = new LLMMethod();
    const result = await method.translate(['test.key'], { 'test.key': 'Hello' }, {
      name: 'French',
      register: 'Standard.',
    }, { apiKey: null });
    assert.equal(result, null);
  });
});

// =================================================================
// LLMCoachedMethod
// =================================================================
describe('LLMCoachedMethod', () => {
  it('has the correct name', () => {
    const method = new LLMCoachedMethod();
    assert.equal(method.name, 'llm-coached');
  });

  it('returns high quality tier', () => {
    const method = new LLMCoachedMethod();
    assert.equal(method.getQualityTier(), 'high');
  });

  it('acknowledges higher cost due to coaching overhead', () => {
    const coached = new LLMCoachedMethod();
    const cost = coached.estimateCost(100);
    assert.equal(cost.estimatedCost, null, 'Coached cost is also model-dependent');
    assert.ok(cost.note.includes('2-3x'), 'Note should mention coaching overhead');
  });
});

// =================================================================
// Method Registry
// =================================================================
describe('METHOD_REGISTRY', () => {
  it('contains llm method', () => {
    assert.ok(METHOD_REGISTRY['llm']);
  });

  it('contains llm-coached method', () => {
    assert.ok(METHOD_REGISTRY['llm-coached']);
  });

  it('getMethod returns LLMMethod for "llm"', () => {
    const method = getMethod('llm');
    assert.equal(method.name, 'llm');
  });

  it('getMethod returns LLMCoachedMethod for "llm-coached"', () => {
    const method = getMethod('llm-coached');
    assert.equal(method.name, 'llm-coached');
  });

  it('getMethod falls back to LLMMethod for unknown methods', () => {
    const warnings = [];
    const origError = console.error;
    console.error = (msg) => warnings.push(msg);

    try {
      const method = getMethod('nonexistent');
      assert.equal(method.name, 'llm');
      assert.ok(warnings.some(w => w.includes('Unknown translation method')));
    } finally {
      console.error = origError;
    }
  });
});

// =================================================================
// Provenance
// =================================================================
describe('Provenance', () => {
  it('llm method is commercially ready', () => {
    assert.equal(isCommercialReady('llm'), true);
  });

  it('fst-gated method is not commercially ready', () => {
    assert.equal(isCommercialReady('fst-gated'), false);
  });

  it('unknown methods default to commercially ready', () => {
    assert.equal(isCommercialReady('totally-new-method'), true);
  });

  it('auditProvenance flags blocked pairs', () => {
    const pairs = new Map([
      ['en:fr', { method: 'llm' }],
      ['en:crk', { method: 'fst-gated' }],
    ]);

    const audit = auditProvenance(pairs);
    assert.equal(audit.allClear, false);
    assert.ok(audit.blockedPairs.includes('en:crk'));
    assert.ok(audit.flags.includes('PROPRIETARY_DATASET'));
  });

  it('auditProvenance returns allClear for clean configs', () => {
    const pairs = new Map([
      ['en:fr', { method: 'llm' }],
      ['en:de', { method: 'llm' }],
    ]);

    const audit = auditProvenance(pairs);
    assert.equal(audit.allClear, true);
    assert.equal(audit.blockedPairs.length, 0);
  });

  it('formatProvenanceReport produces readable output', () => {
    const pairs = new Map([
      ['en:crk', { method: 'fst-gated' }],
    ]);

    const report = formatProvenanceReport(pairs);
    assert.ok(report.includes('PROVENANCE WARNINGS'));
    assert.ok(report.includes('fst-gated'));
  });
});

// =================================================================
// Script Converters
// =================================================================
describe('Script converters', () => {
  it('sroToSyllabics converts basic syllables', () => {
    // "ni" → ᓂ, "ya" → ᔭ
    const result = sroToSyllabics('niya');
    assert.ok(result.includes('ᓂ'), 'Should convert ni');
    assert.ok(result.includes('ᔭ'), 'Should convert ya');
  });

  it('sroToSyllabics handles the th digraph', () => {
    // "th" should map to ᖧ, not ᐟᐦ (t+h separately)
    const result = sroToSyllabics('th');
    assert.equal(result, 'ᖧ');
  });

  it('sroToSyllabics preserves spaces and punctuation', () => {
    const result = sroToSyllabics('ni, ka.');
    assert.ok(result.includes(','), 'Should preserve comma');
    assert.ok(result.includes('.'), 'Should preserve period');
    assert.ok(result.includes(' '), 'Should preserve space');
  });

  it('latinToCyrillicSr converts basic text', () => {
    assert.equal(latinToCyrillicSr('a'), 'а');
    assert.equal(latinToCyrillicSr('b'), 'б');
  });

  it('latinToCyrillicSr handles digraphs', () => {
    assert.equal(latinToCyrillicSr('lj'), 'љ');
    assert.equal(latinToCyrillicSr('nj'), 'њ');
    assert.equal(latinToCyrillicSr('dž'), 'џ');
  });

  it('latinToCyrillicSr preserves non-mapped characters', () => {
    const result = latinToCyrillicSr('test 123!');
    assert.ok(result.includes('123'));
    assert.ok(result.includes('!'));
  });

  it('convertScript uses the correct converter for crk', () => {
    const result = convertScript('ni', 'crk');
    assert.equal(result.converterUsed, 'SRO (Standard Roman Orthography) → Cree Syllabics');
    assert.ok(result.converted !== 'ni', 'Should be converted');
  });

  it('convertScript passes through for unknown locales', () => {
    const result = convertScript('hello', 'xx-unknown');
    assert.equal(result.converted, 'hello');
    assert.equal(result.converterUsed, null);
  });

  it('hasScriptConverter returns true for registered locales', () => {
    assert.equal(hasScriptConverter('crk'), true);
    assert.equal(hasScriptConverter('sr'), true);
  });

  it('hasScriptConverter returns false for unregistered locales', () => {
    assert.equal(hasScriptConverter('fr'), false);
  });

  it('getConverterInfo returns safe-to-serialize info', () => {
    const info = getConverterInfo('crk');
    assert.ok(info);
    assert.equal(info.type, 'deterministic');
    assert.ok(!info.converter, 'Should not include function reference');
  });

  it('getConverterInfo returns null for unknown locales', () => {
    assert.equal(getConverterInfo('xx'), null);
  });
});
