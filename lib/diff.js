/**
 * Key diff engine — compares source locale against target locales.
 *
 * Detects five categories of keys:
 *   1. Missing:  exist in source but not in target
 *   2. Stale:    exist in target but removed from source
 *   3. Fallback: exist in target but prefixed with [EN] (need real translation)
 *   4. Changed:  source content hash differs from last sync (auto-detected)
 *   5. Forced:   explicitly requested for re-translation via --force-keys
 *
 * WHY: The diff is the decision layer that determines what work needs
 * to be done. By separating it from the translation and write layers,
 * we can dry-run, audit, or sync with identical detection logic.
 */

import { flattenKeys } from './flatten.js';

/**
 * Diff a target locale against the source.
 *
 * @param {object} sourceFlat - Flattened source locale
 * @param {object} targetFlat - Flattened target locale
 * @param {string} fallbackPrefix - The prefix marking untranslated values (default: "[EN] ")
 * @param {string[]} forceKeys - Dot-notation keys to force re-translate (default: [])
 * @param {string[]} changedKeys - Keys detected as changed via content hashing (default: [])
 * @returns {object} { missing, needsTranslation, changed, forced, extra, toProcess }
 */
function diffLocale(sourceFlat, targetFlat, fallbackPrefix = '[EN] ', forceKeys = [], changedKeys = []) {
  const sourceKeys = new Set(Object.keys(sourceFlat));
  const targetKeys = new Set(Object.keys(targetFlat));

  // Keys in source but not in target
  const missing = [...sourceKeys].filter(k => !targetKeys.has(k));

  // Keys in target that are still [EN]-prefixed fallbacks
  const needsTranslation = [...targetKeys].filter(k =>
    typeof targetFlat[k] === 'string' && targetFlat[k].startsWith(fallbackPrefix)
  );

  // Keys whose English source content changed since last sync (auto-detected).
  // Only include keys that exist in the source (defensive filter).
  const changed = changedKeys.filter(k => sourceKeys.has(k));

  // Keys explicitly forced for re-translation (only if they exist in source).
  // Silently ignore any forced keys that don't exist in the source.
  const forced = forceKeys.filter(k => sourceKeys.has(k));

  // Keys in target but not in source (stale/orphaned)
  const extra = [...targetKeys].filter(k => !sourceKeys.has(k));

  // Combined set of keys that need work (deduplicated)
  const toProcess = [...new Set([...missing, ...needsTranslation, ...changed, ...forced])];

  return { missing, needsTranslation, changed, forced, extra, toProcess };
}

/**
 * Generate a human-readable label for the diff result.
 */
function diffLabel(diff) {
  const { missing, needsTranslation, changed } = diff;
  const parts = [];
  if (missing.length > 0) parts.push(`${missing.length} missing`);
  if (needsTranslation.length > 0) parts.push(`${needsTranslation.length} [EN] fallback(s)`);
  if (changed && changed.length > 0) parts.push(`${changed.length} changed`);
  if (parts.length > 0) return parts.join(' + ');
  return 'fully synced';
}

export { diffLocale, diffLabel };
