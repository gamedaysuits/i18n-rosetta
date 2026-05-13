#!/usr/bin/env node
/**
 * run-benchmark.js — Translation quality benchmark orchestrator.
 *
 * Runs 6 frontier LLMs × 2 conditions × 39 languages × 1,012 sentences
 * against FLORES+ references, logging OpenRouter costs per-request.
 *
 * Usage:
 *   node test/benchmark/run-benchmark.js [options]
 *
 * Options:
 *   --models       Comma-separated model slugs (default: all 6)
 *   --langs        Comma-separated lang codes (default: all 39)
 *   --condition    "register" | "naive" | "both" (default: both)
 *   --concurrency  Max concurrent languages per model (default: 5)
 *   --dry-run      Print plan without calling APIs
 *   --resume       Skip model/lang/condition combos that already have results
 *
 * Environment:
 *   OPENROUTER_API_KEY — Required
 *
 * Output:
 *   test/benchmark/results/raw/{model}/{condition}/{lang}.json
 *   test/benchmark/results/costs.json
 *
 * Concurrency model:
 *   All 6 models run in parallel (they route to different providers via
 *   OpenRouter, so rate limits are per-provider). Within each model, up to
 *   --concurrency languages run concurrently. Batches within a single
 *   language are sequential (order matters for crash-resilience).
 *
 * Methodology note — batch processing:
 *   Sentences are batched at BATCH_SIZE=30 per API call, matching i18n-rosetta's
 *   production default. This means model output for sentence N could be
 *   contextually influenced by sentences 1–(N-1) in the same batch. This is
 *   intentional — we evaluate the pipeline as deployed, not theoretical
 *   per-sentence performance. Both conditions use identical batch sizes,
 *   so this is controlled across the experimental design.
 *
 * WHY this design:
 *   - Each model/condition/language combo saves independently, so crashes
 *     don't lose progress and --resume works.
 *   - Cost tracking uses OpenRouter's `usage` response field for accurate
 *     token counts (not estimates).
 *   - The two conditions (register vs naive) isolate RQ3 — whether
 *     i18n-rosetta's register instructions actually improve quality.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_REGISTERS } from '../../lib/registers.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BENCHMARK_DIR = import.meta.dirname;
const FIXTURES_DIR = path.join(BENCHMARK_DIR, 'fixtures');
const RESULTS_DIR = path.join(BENCHMARK_DIR, 'results');
const COSTS_FILE = path.join(RESULTS_DIR, 'costs.json');

/** Models under test — verified OpenRouter slugs as of May 2026 */
const MODELS = {
  'gpt-4o-mini':        { slug: 'openai/gpt-4o-mini',              inputPer1M: 0.15,  outputPer1M: 0.60  },
  'gpt-5.5':            { slug: 'openai/gpt-5.5',                  inputPer1M: 5.00,  outputPer1M: 30.00 },
  'claude-opus-4.7':    { slug: 'anthropic/claude-opus-4.7',        inputPer1M: 5.00,  outputPer1M: 25.00 },
  'gemini-3.1-pro':     { slug: 'google/gemini-3.1-pro-preview',    inputPer1M: 2.00,  outputPer1M: 12.00 },
  'deepseek-v4-pro':    { slug: 'deepseek/deepseek-v4-pro',         inputPer1M: 0.435, outputPer1M: 0.87  },
  'mistral-large-3':    { slug: 'mistralai/mistral-large-2512',     inputPer1M: 0.50,  outputPer1M: 1.50  },
};

/** All 39 natural language targets (excluding en source) */
const ALL_LANGS = [
  'ar', 'tl', 'fr', 'es', 'de', 'ja', 'zh', 'it', 'pt', 'ko',
  'bn', 'bg', 'cs', 'da', 'el', 'fa', 'fi', 'he', 'hi', 'hu',
  'id', 'ms', 'nl', 'no', 'pl', 'pt-PT', 'ro', 'ru', 'sk', 'sv',
  'sw', 'th', 'tr', 'uk', 'ur', 'vi', 'zh-TW',
  'es-MX', 'fr-CA',
];

/** Batch size — matches i18n-rosetta's production default */
const BATCH_SIZE = 30;

/** API request timeout (ms) */
const REQUEST_TIMEOUT_MS = 60000;

/** Max retries per batch */
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

// ---------------------------------------------------------------------------
// Prompt builders — the two experimental conditions
// ---------------------------------------------------------------------------

/**
 * Condition A: Full i18n-rosetta pipeline prompt.
 * This uses the register system, UI context hints, and key-type annotations.
 * Identical to the production `buildPrompt()` from lib/translate.js.
 */
function buildRegisterPrompt(sentences, langConfig) {
  // Convert sentences to a key-value object (using sentence IDs as keys)
  const toTranslate = {};
  for (const s of sentences) {
    toTranslate[s.id] = s.text;
  }

  return `You are translating UI strings for a web/mobile application from English to ${langConfig.name}.

Register/tone: ${langConfig.register}

Rules:
- Translate ONLY the values, keep the keys exactly as-is.
- Proper nouns (product names, company names, place names) should NOT be translated.
- Technical terms and role descriptions that are industry-standard should stay in English.
- When gender is ambiguous, prefer gender-neutral forms or the most inclusive option available in ${langConfig.name}.
- Respect the UI element type: button labels should be concise, descriptions can be natural-length, error messages should be clear and direct.
- Return ONLY valid JSON, no markdown fences, no explanation.

${JSON.stringify(toTranslate, null, 2)}`;
}

/**
 * Condition B: Naive baseline prompt.
 * No register, no UI hints, no key-type annotations.
 * Just: "translate to X, return JSON."
 */
function buildNaivePrompt(sentences, langName) {
  const toTranslate = {};
  for (const s of sentences) {
    toTranslate[s.id] = s.text;
  }

  return `Translate the following English text to ${langName}. Return valid JSON with the same keys and translated values. No explanation, no markdown fences.

${JSON.stringify(toTranslate, null, 2)}`;
}

// ---------------------------------------------------------------------------
// API call with retry
// ---------------------------------------------------------------------------

async function callOpenRouter(prompt, modelSlug, apiKey) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/gamedaysuits/i18n-rosetta',
          'X-Title': 'i18n-rosetta-benchmark',
        },
        body: JSON.stringify({
          model: modelSlug,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Retryable errors
      if (response.status === 429 || response.status >= 500) {
        if (attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;
          process.stderr.write(`\n    ⏳ ${response.status} — retry in ${Math.round(delay / 1000)}s...`);
          await sleep(delay);
          continue;
        }
        return { error: `HTTP ${response.status} after ${MAX_RETRIES + 1} attempts`, usage: null };
      }

      if (!response.ok) {
        return { error: `HTTP ${response.status}`, usage: null };
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content?.trim();
      const usage = data.usage || null;

      if (!content) {
        return { error: 'Empty response', usage };
      }

      // Strip markdown fences
      const cleaned = content
        .replace(/^```json?\n?/i, '')
        .replace(/\n?```$/i, '')
        .trim();

      try {
        const parsed = JSON.parse(cleaned);
        return { result: parsed, usage, error: null };
      } catch {
        return { error: 'JSON parse failed', rawContent: cleaned, usage };
      }

    } catch (err) {
      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;
        process.stderr.write(`\n    ⏳ ${err.name === 'AbortError' ? 'timeout' : err.message} — retry...`);
        await sleep(delay);
        continue;
      }
      return { error: err.message, usage: null };
    }
  }
  return { error: 'Max retries exceeded', usage: null };
}

// ---------------------------------------------------------------------------
// Core benchmark logic
// ---------------------------------------------------------------------------

/**
 * Run the benchmark for one model × one condition × one language.
 *
 * Batches the 1,012 sentences into chunks of BATCH_SIZE, calls the API,
 * collects results and usage stats, and saves to disk.
 */
async function benchmarkOneLang(modelName, modelConfig, condition, langCode, sentences, apiKey) {
  const langConfig = DEFAULT_REGISTERS[langCode];
  const langName = langConfig?.name || langCode;

  // Prepare output directory
  const outDir = path.join(RESULTS_DIR, 'raw', modelName, condition);
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${langCode}.json`);

  const allTranslations = {};
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let batchErrors = 0;

  // Batch the sentences
  const batches = [];
  for (let i = 0; i < sentences.length; i += BATCH_SIZE) {
    batches.push(sentences.slice(i, i + BATCH_SIZE));
  }

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const batchLabel = `[${b + 1}/${batches.length}]`;

    // Build prompt based on condition
    const prompt = condition === 'register'
      ? buildRegisterPrompt(batch, langConfig)
      : buildNaivePrompt(batch, langName);

    const { result, usage, error } = await callOpenRouter(prompt, modelConfig.slug, apiKey);

    if (error) {
      batchErrors++;
      process.stderr.write(` ✗${batchLabel}`);
    } else {
      // Merge translations (keyed by sentence ID)
      for (const [id, text] of Object.entries(result)) {
        allTranslations[id] = text;
      }
      process.stderr.write(` ✓${batchLabel}`);
    }

    // Accumulate usage
    if (usage) {
      totalInputTokens += usage.prompt_tokens || 0;
      totalOutputTokens += usage.completion_tokens || 0;
    }

    // Brief delay between batches to avoid rate limiting
    if (b < batches.length - 1) {
      await sleep(200);
    }
  }

  // Calculate cost from actual token usage
  const inputCost = (totalInputTokens / 1_000_000) * modelConfig.inputPer1M;
  const outputCost = (totalOutputTokens / 1_000_000) * modelConfig.outputPer1M;
  const totalCost = inputCost + outputCost;

  // Save result
  const resultDoc = {
    model: modelName,
    modelSlug: modelConfig.slug,
    condition,
    language: langCode,
    languageName: langName,
    timestamp: new Date().toISOString(),
    stats: {
      totalSentences: sentences.length,
      translatedSentences: Object.keys(allTranslations).length,
      batchErrors,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      costUSD: Math.round(totalCost * 10000) / 10000,
    },
    translations: allTranslations,
  };

  fs.writeFileSync(outFile, JSON.stringify(resultDoc, null, 2));

  return resultDoc.stats;
}

// ---------------------------------------------------------------------------
// Cost ledger — thread-safe(ish) via write queue
// ---------------------------------------------------------------------------

/**
 * Centralized cost tracker. Because multiple model pipelines write
 * concurrently, we queue writes to avoid file corruption.
 */
class CostLedger {
  constructor() {
    this.entries = [];
    this.totalUSD = 0;
    this._writing = false;
    this._queue = [];

    // Load existing ledger if resuming
    if (fs.existsSync(COSTS_FILE)) {
      const existing = JSON.parse(fs.readFileSync(COSTS_FILE, 'utf-8'));
      this.entries = existing.entries || [];
      this.totalUSD = existing.totalUSD || 0;
    }
  }

  append(entry) {
    this.entries.push(entry);
    this.totalUSD = this.entries.reduce((sum, e) => sum + (e.costUSD || 0), 0);
    this.totalUSD = Math.round(this.totalUSD * 10000) / 10000;
    this._scheduleWrite();
  }

  _scheduleWrite() {
    this._queue.push(true);
    if (!this._writing) this._flush();
  }

  _flush() {
    if (this._queue.length === 0) {
      this._writing = false;
      return;
    }
    this._writing = true;
    this._queue.length = 0; // drain queue
    fs.mkdirSync(path.dirname(COSTS_FILE), { recursive: true });
    fs.writeFileSync(COSTS_FILE, JSON.stringify({
      entries: this.entries,
      totalUSD: this.totalUSD,
    }, null, 2));
    // Check if more writes came in while we were writing
    if (this._queue.length > 0) {
      this._flush();
    } else {
      this._writing = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Concurrency utilities
// ---------------------------------------------------------------------------

/**
 * Run async tasks with bounded concurrency.
 * Like Promise.all() but limits how many run simultaneously.
 *
 * WHY: OpenRouter routes to different model providers, so each model
 * pipeline can safely run in parallel. Within a model, we limit concurrent
 * languages to avoid hammering a single provider's rate limit.
 */
async function pooled(tasks, concurrency) {
  const results = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const i = nextIndex++;
      results[i] = await tasks[i]();
    }
  }

  const workers = [];
  for (let w = 0; w < Math.min(concurrency, tasks.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// CLI + main
// ---------------------------------------------------------------------------

/** Default concurrent languages per model — balances speed vs rate limits */
const DEFAULT_LANG_CONCURRENCY = 5;

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    models: Object.keys(MODELS),
    langs: ALL_LANGS,
    conditions: ['register', 'naive'],
    dryRun: false,
    resume: false,
    concurrency: DEFAULT_LANG_CONCURRENCY,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--models':
        opts.models = args[++i].split(',');
        break;
      case '--langs':
        opts.langs = args[++i].split(',');
        break;
      case '--condition':
        const val = args[++i];
        opts.conditions = val === 'both' ? ['register', 'naive'] : [val];
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--resume':
        opts.resume = true;
        break;
      case '--concurrency':
        opts.concurrency = parseInt(args[++i], 10);
        break;
    }
  }

  return opts;
}

function resultExists(modelName, condition, langCode) {
  const file = path.join(RESULTS_DIR, 'raw', modelName, condition, `${langCode}.json`);
  return fs.existsSync(file);
}

async function main() {
  const opts = parseArgs();
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey && !opts.dryRun) {
    console.error('[ERR] OPENROUTER_API_KEY not set');
    process.exit(1);
  }

  // Load English source sentences
  const enPath = path.join(FIXTURES_DIR, 'flores-devtest.en.json');
  if (!fs.existsSync(enPath)) {
    console.error('[ERR] English fixtures not found. Run extract_flores.py first.');
    process.exit(1);
  }
  const sentences = JSON.parse(fs.readFileSync(enPath, 'utf-8'));

  // Build work plan — grouped by model for parallel execution
  const modelPlans = {};
  let totalRuns = 0;
  let skippedRuns = 0;

  for (const modelName of opts.models) {
    if (!MODELS[modelName]) {
      console.error(`[ERR] Unknown model: ${modelName}`);
      console.error(`   Available: ${Object.keys(MODELS).join(', ')}`);
      process.exit(1);
    }
    modelPlans[modelName] = [];
    for (const condition of opts.conditions) {
      for (const lang of opts.langs) {
        if (opts.resume && resultExists(modelName, condition, lang)) {
          skippedRuns++;
          continue;
        }
        modelPlans[modelName].push({ condition, lang });
        totalRuns++;
      }
    }
  }

  // Report plan
  const batchesPerRun = Math.ceil(sentences.length / BATCH_SIZE);
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  i18n-rosetta Translation Benchmark');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Sentences:       ${sentences.length}`);
  console.log(`  Models:          ${opts.models.join(', ')}`);
  console.log(`  Conditions:      ${opts.conditions.join(', ')}`);
  console.log(`  Languages:       ${opts.langs.length}`);
  console.log(`  Total runs:      ${totalRuns}${skippedRuns > 0 ? ` (${skippedRuns} skipped via --resume)` : ''}`);
  console.log(`  Concurrency:     ${opts.models.length} models ∥ × ${opts.concurrency} langs ∥`);
  console.log(`  API requests:    ${totalRuns * batchesPerRun}`);
  console.log(`  Resume mode:     ${opts.resume ? 'ON' : 'OFF'}`);
  console.log('═══════════════════════════════════════════════════════\n');

  if (opts.dryRun) {
    console.log('DRY RUN — no API calls will be made.\n');
    for (const [modelName, runs] of Object.entries(modelPlans)) {
      console.log(`  ${modelName}: ${runs.length} runs`);
      for (const { condition, lang } of runs) {
        console.log(`    → ${condition} / ${lang}`);
      }
    }
    return;
  }

  // Execute — all models in parallel, languages pooled within each model
  const costLedger = new CostLedger();
  let completed = 0;
  const startTime = Date.now();

  // Each model gets its own pipeline running concurrently
  const modelPipelines = Object.entries(modelPlans).map(([modelName, runs]) => {
    if (runs.length === 0) return Promise.resolve();

    // Build per-language tasks for this model
    const langTasks = runs.map(({ condition, lang }) => {
      return async () => {
        const runStart = Date.now();
        const stats = await benchmarkOneLang(
          modelName, MODELS[modelName], condition, lang, sentences, apiKey
        );

        completed++;
        const elapsed = ((Date.now() - runStart) / 1000).toFixed(0);

        // Log cost
        costLedger.append({
          model: modelName,
          condition,
          language: lang,
          timestamp: new Date().toISOString(),
          inputTokens: stats.inputTokens,
          outputTokens: stats.outputTokens,
          costUSD: stats.costUSD,
        });

        console.log(
          `  ✓ [${completed}/${totalRuns}] ${modelName} / ${condition} / ${lang}` +
          ` — ${stats.translatedSentences}/${stats.totalSentences} sentences` +
          ` — $${stats.costUSD.toFixed(4)}` +
          ` — ${elapsed}s` +
          ` (running total: $${costLedger.totalUSD.toFixed(2)})`
        );

        return stats;
      };
    });

    // Run this model's languages with bounded concurrency
    console.log(`\n[INFO] Starting ${modelName} — ${runs.length} runs, ${opts.concurrency} concurrent`);
    return pooled(langTasks, opts.concurrency);
  });

  // Fire all model pipelines in parallel
  await Promise.all(modelPipelines);

  const totalElapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  Benchmark complete.`);
  console.log(`  Total cost:    $${costLedger.totalUSD.toFixed(2)}`);
  console.log(`  Total time:    ${totalElapsed} minutes`);
  console.log(`  Results:       ${RESULTS_DIR}/raw/`);
  console.log('═══════════════════════════════════════════════════════\n');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

