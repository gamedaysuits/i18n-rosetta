/**
 * Main sync orchestrator — ties together config, diff, hash, translate, and file I/O.
 *
 * This is the core "do the thing" module. It:
 *   1. Reads the source locale file (JSON, TOML, or YAML)
 *   2. Loads the hash manifest to detect changed English content
 *   3. Iterates over all target pairs (v3 pair graph)
 *   4. Diffs each one against the source (missing + fallback + changed + forced)
 *   5. Translates stale/missing keys via the pair's configured method
 *   6. Writes updated locale files
 *   7. Saves updated hash manifest
 *   8. Optionally syncs Hugo Markdown content files
 *
 * Modes:
 *   - sync:  one-shot, translate and write
 *   - dry:   report only, no writes
 *   - audit: list all [EN]-prefixed values still needing real translation
 *
 * Watch mode and content sync are handled by separate modules
 * (lib/watch.js and lib/content-sync.js respectively).
 */

import fs from 'node:fs';
import path from 'node:path';
import { flattenKeys, setNestedValue } from './flatten.js';
import { diffLocale, diffLabel } from './diff.js';
import { translateBatch, isUnsafeKey } from './translate.js';
import { resolveConfig, autoDetectLanguages } from './config.js';
import { buildHashManifest, detectChangedKeys, readManifest, writeManifest } from './hash.js';
import { detectFormatFromDir, getExtension, readLocaleFile, writeLocaleFile } from './format.js';
import { resolvePairs } from './pairs.js';
import { loadPlugins, resolvePluginForPair } from './plugins.js';
import { isPathContained } from './security.js';
import { loadApiKey } from './api-key.js';
import { runContentSync } from './content-sync.js';
import { auditProvenance } from './provenance.js';

/**
 * Run the main sync operation.
 *
 * @param {object} options - { dryRun, audit, cwd, cliArgs }
 */
async function runSync(options = {}) {
  const { dryRun = false, audit = false, cwd = process.cwd(), cliArgs = {} } = options;
  const config = resolveConfig(cliArgs, cwd);
  const apiKey = loadApiKey(config, cwd);

  // Verify locales directory exists
  if (!fs.existsSync(config.localesDir)) {
    throw new Error(`Locales directory not found: ${config.localesDir}. Create it or set "localesDir" in your config file.`);
  }

  // Detect locale file format (JSON, TOML, or YAML)
  // CLI flag takes priority, then config file, then auto-detect from directory
  const format = config.format !== 'auto'
    ? config.format
    : detectFormatFromDir(config.localesDir);
  const ext = getExtension(format);

  // Read source locale (v3 uses inputLocale, sourceLocale is kept as alias)
  const inputLocale = config.inputLocale || config.sourceLocale || 'en';
  const sourceFile = `${inputLocale}${ext}`;
  const sourcePath = path.join(config.localesDir, sourceFile);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source locale not found: ${sourcePath}`);
  }

  // For JSON, read and flatten the nested structure.
  // For TOML/YAML, readLocaleFile already returns a flat map.
  const sourceRaw = readLocaleFile(sourcePath, format);
  const sourceFlat = format === 'json' ? flattenKeys(sourceRaw) : sourceRaw;

  // Defense-in-depth: remove any keys that could cause prototype pollution.
  // Extremely unlikely in real locale files but important for a public package.
  for (const key of Object.keys(sourceFlat)) {
    if (isUnsafeKey(key)) {
      delete sourceFlat[key];
    }
  }

  const sourceKeyCount = Object.keys(sourceFlat).length;

  // Load the hash manifest and detect which English values changed
  // since the last sync. On first run (no manifest), this returns []
  // and everything flows through the normal missing-key detection.
  const oldManifest = readManifest(cwd);
  const changedKeys = detectChangedKeys(sourceFlat, oldManifest);
  const currentManifest = buildHashManifest(sourceFlat);

  // Resolve target languages — from config or auto-detect.
  // WHY: We need resolvedLanguages populated before calling resolvePairs,
  // because resolvePairs builds pairs from the languages array (simple mode)
  // and then applies overrides from the pairs object (advanced mode).
  let languages = config.resolvedLanguages;
  if (Object.keys(languages).length === 0) {
    languages = autoDetectLanguages(config);
    config.resolvedLanguages = languages;
  }

  // Build the pair graph — this is the v3 drivetrain.
  // Each pair carries its method, model, register, and plugin context.
  // The pair graph drives method dispatch: sync iterates pairs, not flat language entries.
  const pairs = resolvePairs(config);
  const plugins = loadPlugins(cwd);

  // Resolve plugin configs into each pair that references one.
  // This merges plugin data (endpoint, benchmarks, provenance) into the pair config
  // so that translateBatch receives a complete method context.
  const resolvedPairs = new Map();
  for (const [pairKey, rawPairConfig] of pairs) {
    resolvedPairs.set(pairKey, resolvePluginForPair(plugins, rawPairConfig));
  }

  // Provenance check — warn about uncleared licensing before sync starts.
  // This is informational only (does not block execution).
  const provenanceAudit = auditProvenance(resolvedPairs);
  if (!provenanceAudit.allClear) {
    for (const blockedKey of provenanceAudit.blockedPairs) {
      const blockedPair = resolvedPairs.get(blockedKey);
      console.warn(`[WARN] ${blockedKey}: Method "${blockedPair.method}" has unverified licensing. Run \`i18n-rosetta provenance\` for details.`);
    }
  }

  // Build a sorted list of pairs for deterministic output ordering
  const pairEntries = [...resolvedPairs.entries()].sort(([a], [b]) => a.localeCompare(b));

  if (pairEntries.length === 0) {
    console.log('No target languages configured. Run `i18n-rosetta init` to set up.');
    return;
  }

  // --- Audit mode ---
  if (audit) {
    console.log('Audit: scanning for untranslated values...\n');
    let total = 0;
    for (const [, pairConfig] of pairEntries) {
      const code = pairConfig.target;
      const filename = `${code}${ext}`;
      const filePath = path.join(config.localesDir, filename);
      if (!fs.existsSync(filePath)) continue;
      const dataRaw = readLocaleFile(filePath, format);
      const flat = format === 'json' ? flattenKeys(dataRaw) : dataRaw;
      const untranslated = Object.entries(flat)
        .filter(([, val]) => typeof val === 'string' && val.startsWith(config.fallbackPrefix));
      if (untranslated.length > 0) {
        console.log(`  ${filename}: ${untranslated.length} keys still need translation`);
        for (const [key] of untranslated) {
          console.log(`     - ${key}`);
        }
        total += untranslated.length;
      }
    }
    console.log(total === 0
      ? '\n  All locale files are fully translated.'
      : `\n  Total: ${total} keys need translation.`);
    return { untranslatedCount: total };
  }

  // --- Sync mode ---
  // Determine if we should use fallback mode.
  // In v3, each method manages its own API key internally.
  // The global apiKey (OPENROUTER_API_KEY) is still passed as an option
  // for backward compat — the LLM method reads it from options or env.
  const useFallback = cliArgs.fallback || false;
  const methodSummary = pairEntries.map(([, p]) => `${p.target}:${p.method}`).join(', ');
  console.log(`[INFO] Source: ${sourceFile} (${sourceKeyCount} keys)`);
  console.log(`[INFO] Pairs: ${methodSummary}`);
  if (changedKeys.length > 0) {
    console.log(`[INFO] Changed: ${changedKeys.length} key(s) have updated source content`);
  }
  if (dryRun) console.log('[INFO] Dry-run mode — no files will be modified.');
  console.log('');

  let totalProcessed = 0;

  for (const [pairKey, pairConfig] of pairEntries) {
    const code = pairConfig.target;
    const filename = `${code}${ext}`;
    const filePath = path.join(config.localesDir, filename);

    // Security: verify the resolved write path is still within localesDir.
    // Prevents path traversal via crafted language codes like "../../../etc/passwd".
    if (!isPathContained(filePath, config.localesDir)) {
      console.error(`  [ERR] ${filename} — refusing to write outside locales directory`);
      continue;
    }

    // If locale file doesn't exist yet, create it as empty
    let data = {};
    if (fs.existsSync(filePath)) {
      data = readLocaleFile(filePath, format);
    }

    // For JSON, flatten the nested structure. TOML/YAML is already flat.
    const targetFlat = format === 'json' ? flattenKeys(data) : { ...data };
    const diff = diffLocale(sourceFlat, targetFlat, config.fallbackPrefix, config.forceKeys, changedKeys);

    if (diff.toProcess.length === 0 && diff.extra.length === 0) {
      console.log(`  [OK] ${filename} — fully synced`);
      continue;
    }

    if (diff.toProcess.length > 0) {
      console.log(`  [SYNC] ${filename} — ${diffLabel(diff)}`);

      if (!dryRun) {
        let translated = null;

        const stringKeys = diff.toProcess.filter(k => typeof sourceFlat[k] === 'string');
        if (stringKeys.length > 0) {
          // Pass the fully-resolved pairConfig to translateBatch.
          // This activates the v3 dispatch path in translate.js:
          // pairConfig.method → getMethod() → correct TranslationMethod subclass.
          process.stdout.write(`     Translating to ${pairConfig.name} (${pairConfig.method})...`);
          translated = await translateBatch(stringKeys, sourceFlat, pairConfig, {
            apiKey,
            model: pairConfig.model,
            batchSize: pairConfig.batchSize,
          });

          if (translated) {
            console.log(' [OK]');
          } else {
            // Method returned null — it could not translate (missing key, service down, etc.)
            if (!useFallback) {
              console.log(' [ERR]');
              console.error(`  [ERR] ${pairKey}: Translation method "${pairConfig.method}" returned no results.`);
              console.error(`        Check your API key and configuration. Use --fallback to write [EN] prefixed values.`);
              continue;
            }
            console.log(' [WARN] using fallback prefix');
          }
        }

        for (const key of diff.toProcess) {
          const sourceValue = sourceFlat[key];
          let value;

          if (translated && key in translated) {
            value = translated[key];
          } else if (typeof sourceValue === 'string') {
            // Fallback: write [EN]-prefixed value.
            // In v3, this only runs when --fallback is set or the method returned partial results.
            value = `${config.fallbackPrefix}${sourceValue}`;
          } else {
            value = sourceValue;
          }

          if (format === 'json') {
            setNestedValue(data, key, value);
          } else {
            // For TOML/YAML, data is already flat — just set the key directly
            data[key] = value;
          }
        }

        totalProcessed += diff.toProcess.length;
      }
    }

    if (diff.extra.length > 0) {
      console.log(`  [WARN] ${filename} — ${diff.extra.length} extra key(s) not in source`);
    }

    // Write updated file
    if (!dryRun && diff.toProcess.length > 0) {
      writeLocaleFile(filePath, data, format, format !== 'json' ? data : undefined);
    }
  }

  console.log(`\n${dryRun ? '[INFO] Would have processed' : '[OK] Synced'} ${totalProcessed} keys total.`);

  // Write the updated hash manifest so the next sync knows
  // what state the translations are based on.
  // Skip in dry-run mode — don't mark stale keys as resolved.
  if (!dryRun) {
    writeManifest(cwd, currentManifest);
  }

  // Content sync — translate Hugo Markdown content files if configured.
  // Uses the same resolved pair graph as key-value sync, ensuring method
  // dispatch is consistent across both translation modes.
  if (config.contentDir) {
    await runContentSync({
      contentDir: config.contentDir,
      sourceLocale: inputLocale,
      pairs: resolvedPairs,
      translatableFields: config.translatableFields,
      apiKey,
      dryRun,
    });
  }
}

export { runSync, runContentSync, loadApiKey };
