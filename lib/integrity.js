/**
 * Integrity linter — catches translation defects that silently break UI.
 *
 * THREE CLASSES OF DEFECT:
 *
 * 1. FORMAT LEAKS: ICU placeholders ({name}, {count, plural, ...}) that
 *    the translator mangled or dropped. Detected by comparing placeholder
 *    tokens between source and target.
 *
 * 2. ENCODING ISSUES: BOM markers, non-UTF-8 sequences, invisible
 *    directional marks (LRM/RLM/ZWJ/ZWNJ) where they shouldn't be.
 *
 * 3. STRUCTURAL PARITY: Target file has extra keys the source doesn't,
 *    or values that are clearly just the source value copy-pasted (same
 *    string in a different locale file = untranslated).
 *
 * Zero external dependencies. All string-based analysis.
 */

import fs from 'node:fs';
import path from 'node:path';

// -----------------------------------------------------------------
// Placeholder extraction
// -----------------------------------------------------------------

/**
 * Extract ICU-style placeholders from a string.
 *
 * Handles:
 *   - Simple: {name}, {count}
 *   - Nested ICU: {count, plural, one {# item} other {# items}}
 *   - React-intl: <bold>text</bold>
 *
 * @param {string} text - Translation string
 * @returns {string[]} Sorted array of placeholder tokens
 */
function extractPlaceholders(text) {
  if (typeof text !== 'string') return [];

  const placeholders = new Set();

  // Simple ICU placeholders: {name}, {count}
  // Match top-level braces only (not nested plurals)
  const simplePattern = /\{(\w+)(?:[,}])/g;
  let match;
  while ((match = simplePattern.exec(text)) !== null) {
    placeholders.add(match[1]);
  }

  // React-intl XML tags: <bold>, </bold>, <link>, </link>
  const xmlPattern = /<\/?(\w+)>/g;
  while ((match = xmlPattern.exec(text)) !== null) {
    placeholders.add(`<${match[1]}>`);
  }

  return [...placeholders].sort();
}

/**
 * Compare placeholders between source and target strings.
 *
 * @param {string} sourceValue - Source locale value
 * @param {string} targetValue - Target locale value
 * @returns {{ missing: string[], extra: string[] }} Placeholder differences
 */
function comparePlaceholders(sourceValue, targetValue) {
  const sourcePH = extractPlaceholders(sourceValue);
  const targetPH = extractPlaceholders(targetValue);

  const missing = sourcePH.filter(p => !targetPH.includes(p));
  const extra = targetPH.filter(p => !sourcePH.includes(p));

  return { missing, extra };
}

// -----------------------------------------------------------------
// Encoding checks
// -----------------------------------------------------------------

/**
 * Invisible Unicode characters that cause silent UI bugs.
 *
 * Each entry has:
 *   - name: Human-readable name
 *   - regex: Detection pattern
 *   - severity: 'error' (likely bug) or 'warning' (suspicious but maybe intentional)
 */
const INVISIBLE_CHARS = [
  { name: 'BOM (Byte Order Mark)', regex: /\uFEFF/, severity: 'error' },
  { name: 'Zero-Width Space (ZWSP)', regex: /\u200B/, severity: 'warning' },
  { name: 'Zero-Width Non-Joiner (ZWNJ)', regex: /\u200C/, severity: 'warning' },
  { name: 'Zero-Width Joiner (ZWJ)', regex: /\u200D/, severity: 'warning' },
  { name: 'Left-to-Right Mark (LRM)', regex: /\u200E/, severity: 'warning' },
  { name: 'Right-to-Left Mark (RLM)', regex: /\u200F/, severity: 'warning' },
  { name: 'Left-to-Right Override', regex: /\u202D/, severity: 'error' },
  { name: 'Right-to-Left Override', regex: /\u202E/, severity: 'error' },
  { name: 'Pop Directional Formatting', regex: /\u202C/, severity: 'warning' },
  { name: 'Object Replacement Character', regex: /\uFFFC/, severity: 'error' },
  { name: 'Replacement Character (encoding error)', regex: /\uFFFD/, severity: 'error' },
];

/**
 * Check a string value for invisible/problematic Unicode characters.
 *
 * @param {string} value - String to check
 * @returns {{ name: string, severity: string }[]} Array of detected issues
 */
function checkEncoding(value) {
  if (typeof value !== 'string') return [];

  const issues = [];
  for (const check of INVISIBLE_CHARS) {
    if (check.regex.test(value)) {
      issues.push({ name: check.name, severity: check.severity });
    }
  }
  return issues;
}

/**
 * Check if a file has a UTF-8 BOM at the start.
 *
 * @param {string} filePath - Path to the file
 * @returns {boolean} True if BOM is present
 */
function hasBOM(filePath) {
  const buffer = fs.readFileSync(filePath);
  return buffer.length >= 3 &&
    buffer[0] === 0xEF &&
    buffer[1] === 0xBB &&
    buffer[2] === 0xBF;
}

// -----------------------------------------------------------------
// Cross-locale parity
// -----------------------------------------------------------------

/**
 * Check for untranslated values (target value === source value).
 *
 * Returns keys where the target is an exact copy of the source,
 * excluding keys that look like they SHOULD be the same (brand names,
 * URLs, format strings, numbers).
 *
 * @param {object} sourceFlat - Flattened source locale
 * @param {object} targetFlat - Flattened target locale
 * @param {string} targetLang - Target language code (for RTL direction checks)
 * @returns {string[]} Keys with identical source/target values
 */
function findUntranslatedCopies(sourceFlat, targetFlat, targetLang) {
  const copies = [];

  for (const [key, sourceVal] of Object.entries(sourceFlat)) {
    const targetVal = targetFlat[key];
    if (targetVal === undefined) continue;
    if (typeof sourceVal !== 'string' || typeof targetVal !== 'string') continue;

    // Skip if values are different — it's translated
    if (sourceVal !== targetVal) continue;

    // Skip values that are EXPECTED to be the same across locales
    if (isLocaleInvariant(sourceVal)) continue;

    copies.push(key);
  }

  return copies;
}

/**
 * Check if a value is expected to be the same across all locales.
 *
 * Brand names, URLs, format patterns, single-word identifiers,
 * numeric values, etc.
 *
 * @param {string} value - The value to check
 * @returns {boolean} True if the value should NOT be flagged as untranslated
 */
function isLocaleInvariant(value) {
  const v = value.trim();
  if (v.length === 0) return true;

  // URLs
  if (/^https?:\/\//.test(v)) return true;
  // Email addresses
  if (/^\S+@\S+\.\S+$/.test(v)) return true;
  // Pure numbers (with optional formatting)
  if (/^[\d.,\-+%$€£¥]+$/.test(v)) return true;
  // Single word under 4 characters (likely a code or abbreviation)
  if (/^\w{1,3}$/.test(v)) return true;
  // Pure placeholder string: {name}
  if (/^\{[\w,.\s]+\}$/.test(v)) return true;
  // Format patterns: YYYY-MM-DD, HH:mm:ss
  if (/^[YMDHhmsSzZ\-/:.\s]+$/.test(v)) return true;
  // Known brand names that shouldn't be translated
  // (Keeping this minimal — better to flag false positives than miss real copies)
  if (/^(GitHub|Google|Facebook|Twitter|LinkedIn|YouTube|Instagram|WhatsApp|Stripe|PayPal|Apple|Microsoft)$/.test(v)) return true;

  return false;
}

/**
 * Find keys present in target but NOT in source (orphaned keys).
 *
 * @param {object} sourceFlat - Flattened source locale
 * @param {object} targetFlat - Flattened target locale
 * @returns {string[]} Keys only in target
 */
function findOrphanedKeys(sourceFlat, targetFlat) {
  return Object.keys(targetFlat).filter(k => !(k in sourceFlat));
}

// -----------------------------------------------------------------
// Full integrity audit
// -----------------------------------------------------------------

/**
 * Run a full integrity audit on a locale pair.
 *
 * @param {object} sourceFlat - Flattened source locale
 * @param {object} targetFlat - Flattened target locale
 * @param {string} targetLang - Target language code
 * @returns {{ placeholderIssues: object[], encodingIssues: object[], copies: string[], orphans: string[] }}
 */
function auditLocalePair(sourceFlat, targetFlat, targetLang) {
  const placeholderIssues = [];
  const encodingIssues = [];

  for (const [key, sourceVal] of Object.entries(sourceFlat)) {
    const targetVal = targetFlat[key];
    if (targetVal === undefined) continue;

    // Check placeholder preservation
    if (typeof sourceVal === 'string' && typeof targetVal === 'string') {
      const { missing, extra } = comparePlaceholders(sourceVal, targetVal);
      if (missing.length > 0 || extra.length > 0) {
        placeholderIssues.push({ key, missing, extra, sourceVal, targetVal });
      }
    }

    // Check encoding in target values
    if (typeof targetVal === 'string') {
      const issues = checkEncoding(targetVal);
      if (issues.length > 0) {
        encodingIssues.push({ key, value: targetVal, issues });
      }
    }
  }

  const copies = findUntranslatedCopies(sourceFlat, targetFlat, targetLang);
  const orphans = findOrphanedKeys(sourceFlat, targetFlat);

  return { placeholderIssues, encodingIssues, copies, orphans };
}

/**
 * Format an integrity audit result as a console report.
 *
 * @param {string} targetLang - Target language code
 * @param {object} audit - Result from auditLocalePair
 * @returns {string} Formatted report
 */
function formatIntegrityReport(targetLang, audit) {
  const lines = [];
  const { placeholderIssues, encodingIssues, copies, orphans } = audit;

  const totalIssues = placeholderIssues.length + encodingIssues.length + copies.length + orphans.length;

  lines.push(`\n  Integrity Audit: ${targetLang}`);
  lines.push(`  ${'─'.repeat(40)}`);

  if (totalIssues === 0) {
    lines.push('  [OK] All checks passed — no issues found');
    lines.push('');
    return lines.join('\n');
  }

  // Placeholder issues
  if (placeholderIssues.length > 0) {
    lines.push(`\n  PLACEHOLDER ISSUES (${placeholderIssues.length})`);
    for (const issue of placeholderIssues.slice(0, 10)) {
      lines.push(`  ├── ${issue.key}`);
      if (issue.missing.length > 0) {
        lines.push(`  │   Missing: ${issue.missing.join(', ')}`);
      }
      if (issue.extra.length > 0) {
        lines.push(`  │   Extra: ${issue.extra.join(', ')}`);
      }
    }
    if (placeholderIssues.length > 10) {
      lines.push(`  └── ... and ${placeholderIssues.length - 10} more`);
    }
  }

  // Encoding issues
  if (encodingIssues.length > 0) {
    lines.push(`\n  [WARN] ENCODING ISSUES (${encodingIssues.length})`);
    for (const issue of encodingIssues.slice(0, 10)) {
      const names = issue.issues.map(i => i.name).join(', ');
      lines.push(`  ├── ${issue.key}: ${names}`);
    }
    if (encodingIssues.length > 10) {
      lines.push(`  └── ... and ${encodingIssues.length - 10} more`);
    }
  }

  // Untranslated copies
  if (copies.length > 0) {
    lines.push(`\n  [WARN] UNTRANSLATED COPIES (${copies.length})`);
    lines.push('  └── These keys have identical source/target values:');
    for (const key of copies.slice(0, 10)) {
      lines.push(`      ${key}`);
    }
    if (copies.length > 10) {
      lines.push(`      ... and ${copies.length - 10} more`);
    }
  }

  // Orphaned keys
  if (orphans.length > 0) {
    lines.push(`\n  [WARN] ORPHANED KEYS (${orphans.length})`);
    lines.push('  └── Keys in target not present in source:');
    for (const key of orphans.slice(0, 10)) {
      lines.push(`      ${key}`);
    }
    if (orphans.length > 10) {
      lines.push(`      ... and ${orphans.length - 10} more`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

export {
  extractPlaceholders,
  comparePlaceholders,
  checkEncoding,
  hasBOM,
  findUntranslatedCopies,
  isLocaleInvariant,
  findOrphanedKeys,
  auditLocalePair,
  formatIntegrityReport,
  INVISIBLE_CHARS,
};
