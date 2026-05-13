import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { GoogleTranslateMethod, normalizeLocaleForGoogle } from '../lib/methods/google-translate.js';

// -----------------------------------------------------------------
// Tests: GoogleTranslateMethod — unit tests (no real API calls)
// -----------------------------------------------------------------

describe('GoogleTranslateMethod', () => {
  it('constructor sets correct method name', () => {
    const method = new GoogleTranslateMethod();
    assert.equal(method.name, 'google-translate');
  });

  it('getQualityTier returns standard', () => {
    const method = new GoogleTranslateMethod();
    assert.equal(method.getQualityTier(), 'standard');
  });

  it('getProvenance returns Google Cloud info', () => {
    const method = new GoogleTranslateMethod();
    const prov = method.getProvenance();
    assert.equal(prov.commercialReady, true);
    assert.equal(prov.resources.length, 1);
    assert.ok(prov.resources[0].name.includes('Google'));
  });

  it('estimateCost returns a valid cost object', () => {
    const method = new GoogleTranslateMethod();
    const cost = method.estimateCost(1000);
    assert.equal(cost.currency, 'USD');
    assert.ok(cost.estimatedCost > 0);
    assert.ok(cost.estimatedCost < 1); // 1000 keys should be well under $1
  });

  it('translate returns null when no API key is set', async () => {
    // Ensure the env var is not set for this test
    const original = process.env.GOOGLE_TRANSLATE_API_KEY;
    delete process.env.GOOGLE_TRANSLATE_API_KEY;
    delete process.env.GOOGLE_API_KEY;

    const method = new GoogleTranslateMethod();
    const result = await method.translate(
      ['hello.world'],
      { 'hello.world': 'Hello' },
      { target: 'fr', source: 'en' },
      {},
    );
    assert.equal(result, null);

    // Restore env
    if (original) process.env.GOOGLE_TRANSLATE_API_KEY = original;
  });

  it('translateContent returns null (not supported)', async () => {
    const method = new GoogleTranslateMethod();
    const result = await method.translateContent('some prompt', {}, {});
    assert.equal(result, null);
  });
});

// -----------------------------------------------------------------
// Tests: normalizeLocaleForGoogle
// -----------------------------------------------------------------

describe('normalizeLocaleForGoogle', () => {
  it('maps Hebrew he to iw for Google API', () => {
    assert.equal(normalizeLocaleForGoogle('he'), 'iw');
  });

  it('maps Javanese jv to jw for Google API', () => {
    assert.equal(normalizeLocaleForGoogle('jv'), 'jw');
  });

  it('passes through standard locale codes unchanged', () => {
    assert.equal(normalizeLocaleForGoogle('fr'), 'fr');
    assert.equal(normalizeLocaleForGoogle('de'), 'de');
    assert.equal(normalizeLocaleForGoogle('zh-TW'), 'zh-TW');
    assert.equal(normalizeLocaleForGoogle('ja'), 'ja');
  });
});
