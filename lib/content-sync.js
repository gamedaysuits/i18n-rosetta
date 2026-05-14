/**
 * Content sync — translates Hugo Markdown content files.
 *
 * WHY THIS EXISTS: This was extracted from sync.js to reduce the
 * god-module's line count and give content translation its own
 * testable, focused module.
 *
 * v3 PAIR GRAPH: This module now accepts the resolved pair Map
 * (from pairs.js + plugins.js) rather than the v2 `languages` object.
 * Each pair carries its method, model, register, and name — the same
 * pairConfig that the key-value sync path uses. This ensures method
 * dispatch is consistent across both key-value and content translation.
 *
 * Pipeline for each source file × target pair:
 *   1. Check if translated version already exists (skip if so)
 *   2. Parse front matter and body
 *   3. Protect code blocks, shortcodes, and HTML
 *   4. Translate front matter fields + body via pair's configured method
 *   5. Check for placeholder corruption (orphaned ⟦PROTECTED_N⟧ tokens)
 *   6. Reassemble and write the target file
 */

import fs from 'node:fs';
import path from 'node:path';
import { translateBatch, translateRawContent } from './translate.js';
import { DEFAULT_REGISTERS } from './registers.js';
import { isPathContained } from './security.js';
import {
  discoverContentFiles,
  getTargetContentPath,
  parseContentFile,
  protectBlocks,
  restoreBlocks,
  hasOrphanedPlaceholders,
  buildContentPrompt,
  reassembleContentFile,
  DEFAULT_TRANSLATABLE_FIELDS,
} from './content.js';

/**
 * Run content sync — translate Hugo Markdown content files.
 *
 * @param {object} options
 * @param {string} options.contentDir - Path to Hugo content directory
 * @param {string} options.sourceLocale - Source language code
 * @param {Map<string, object>} options.pairs - Resolved pair graph (pairKey → pairConfig)
 * @param {string[]|null} options.translatableFields - Front matter fields to translate
 * @param {string|null} options.apiKey - OpenRouter API key (fallback for LLM methods)
 * @param {boolean} options.dryRun - Whether to write files
 */
async function runContentSync(options) {
  const {
    contentDir,
    sourceLocale,
    pairs,
    translatableFields,
    apiKey,
    dryRun = false,
  } = options;

  if (!fs.existsSync(contentDir)) {
    console.log(`\n[WARN] Content directory not found: ${contentDir}`);
    return;
  }

  const sourceFiles = discoverContentFiles(contentDir, sourceLocale);
  if (sourceFiles.length === 0) {
    console.log('\n[INFO] No source content files found.');
    return;
  }

  const fieldsList = translatableFields || DEFAULT_TRANSLATABLE_FIELDS;

  // Sort pair entries for deterministic output ordering
  const pairEntries = [...pairs.entries()].sort(([a], [b]) => a.localeCompare(b));

  console.log(`\n[INFO] Content sync: ${sourceFiles.length} source file(s) → ${pairEntries.length} language(s)`);
  if (dryRun) console.log('[INFO] Dry-run mode — no content files will be written.');

  let translated = 0;
  let fallbackCount = 0;
  let skipped = 0;

  for (const sourcePath of sourceFiles) {
    const relPath = path.relative(contentDir, sourcePath);

    for (const [, pairConfig] of pairEntries) {
      const code = pairConfig.target;
      const targetPath = getTargetContentPath(sourcePath, code, sourceLocale);

      // Security: verify target path stays within content directory
      if (!isPathContained(targetPath, contentDir)) {
        console.error(`  [ERR] ${relPath} → ${code} — refusing to write outside content directory`);
        continue;
      }

      // Skip if target already exists (don't overwrite existing translations).
      // Users can delete the target file to force re-translation.
      if (fs.existsSync(targetPath)) {
        skipped++;
        continue;
      }

      if (dryRun) {
        const targetRel = path.relative(contentDir, targetPath);
        console.log(`  [INFO] Would create: ${targetRel}`);
        translated++;
        continue;
      }

      // Read and parse the source file
      const raw = fs.readFileSync(sourcePath, 'utf-8');
      const { frontMatter, rawFrontMatter, body, hasFrontMatter, frontMatterFormat } = parseContentFile(raw);

      // Translate front matter fields using the pair's configured method.
      // translateBatch detects pairConfig (has .method field) and uses the v3
      // dispatch path, routing through the correct TranslationMethod subclass.
      const translatedFields = {};
      if (hasFrontMatter && apiKey) {
        // Only translate configured fields that exist in the front matter
        const fieldsToTranslate = {};
        for (const field of fieldsList) {
          if (frontMatter[field] && typeof frontMatter[field] === 'string') {
            fieldsToTranslate[field] = frontMatter[field];
          }
        }

        if (Object.keys(fieldsToTranslate).length > 0) {
          process.stdout.write(`  [SYNC] ${relPath} → ${code} front matter (${pairConfig.method})...`);
          const result = await translateBatch(
            Object.keys(fieldsToTranslate),
            fieldsToTranslate,
            pairConfig,
            { apiKey, model: pairConfig.model, batchSize: pairConfig.batchSize || 30 },
          );
          if (result) {
            Object.assign(translatedFields, result);
            console.log(' [OK]');
          } else {
            // Fall back to [EN]-prefixed values
            for (const [field, value] of Object.entries(fieldsToTranslate)) {
              translatedFields[field] = `[EN] ${value}`;
            }
            console.log(' [WARN] fallback');
          }
        }
      } else if (hasFrontMatter) {
        // No API — use fallback prefix for front matter fields.
        // LOG THIS: the user needs to know their content is getting placeholders, not translations.
        console.log(`  [WARN] ${relPath} → ${code}: no API key — front matter will use [EN] prefix`);
        for (const field of fieldsList) {
          if (frontMatter[field] && typeof frontMatter[field] === 'string') {
            translatedFields[field] = `[EN] ${frontMatter[field]}`;
          }
        }
      }

      // Translate body — uses the pair's method via translateRawContent
      let translatedBody = body;
      if (body.trim()) {
        const { protectedBody, blocks } = protectBlocks(body);

        if (apiKey) {
          process.stdout.write(`  [SYNC] ${relPath} → ${code} body (${pairConfig.method})...`);
          const prompt = buildContentPrompt(protectedBody, pairConfig, {
            sourceLanguageName: DEFAULT_REGISTERS[sourceLocale]?.name || sourceLocale,
          });
          const result = await translateRawContent(prompt, {
            apiKey,
            pairConfig,
          });

          if (result) {
            translatedBody = restoreBlocks(result, blocks);

            // Safety check: if the LLM mangled any placeholder tokens
            // (dropped, duplicated, or subtly altered them), the restored
            // body will still contain orphaned ⟦PROTECTED_N⟧ sentinels.
            // Rather than writing corrupted content with broken code blocks
            // or raw Unicode tokens, fall back to English with a loud warning.
            if (hasOrphanedPlaceholders(translatedBody)) {
              console.log(' [ERR] PLACEHOLDER CORRUPTION — falling back to English body');
              console.warn(
                `     [WARN] ${relPath} → ${code}: LLM mangled protected block placeholders. ` +
                `The translated body contained orphaned ⟦PROTECTED_N⟧ tokens. ` +
                `English body preserved to prevent content corruption.`
              );
              translatedBody = `<!-- [EN] Original English content (translation had corrupted code blocks) -->\n${body}`;
            } else {
              console.log(' [OK]');
            }
          } else {
            // On API failure, keep the English body but mark it
            translatedBody = `<!-- [EN] Original English content -->\n${body}`;
            console.log(' [WARN] kept English');
          }
        } else {
          // No API — keep English body with a marker comment
          translatedBody = `<!-- [EN] Original English content -->\n${body}`;
        }
      }

      // Reassemble and write the target file
      const output = reassembleContentFile({
        rawFrontMatter,
        translatedFields,
        translatedBody,
        hasFrontMatter,
        frontMatterFormat,
      });

      // Ensure target directory exists (Hugo content can be nested)
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, output, 'utf-8');

      // Distinguish real translations from fallback-only files.
      // A file is "fallback" if it has no API key (entire file is [EN]-prefixed).
      if (!apiKey) {
        fallbackCount++;
      } else {
        translated++;
      }
    }
  }

  const totalCreated = translated + fallbackCount;
  if (totalCreated > 0 || skipped > 0) {
    if (fallbackCount > 0 && translated === 0) {
      console.log(`\n${dryRun ? '[INFO] Would have created' : '[WARN] Created'} ${totalCreated} content file(s) — ALL used [EN] fallback (no API key). ${skipped} already existed.`);
    } else if (fallbackCount > 0) {
      console.log(`\n${dryRun ? '[INFO] Would have created' : '[OK] Created'} ${translated} content file(s), ${fallbackCount} used [EN] fallback. ${skipped} already existed.`);
    } else {
      console.log(`\n${dryRun ? '[INFO] Would have created' : '[OK] Created'} ${translated} content file(s), ${skipped} already existed.`);
    }
  }
}

export { runContentSync };
