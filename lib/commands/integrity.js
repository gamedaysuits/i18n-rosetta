/**
 * Command: integrity
 *
 * Audits locale files for format, encoding, and placeholder consistency.
 * Catches: mismatched {placeholders}, encoding corruption, untranslated
 * copies, and orphan keys not in the source file.
 *
 * Returns exit code 1 if issues found (unless --warn-only is set).
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveConfig } from '../config.js';
import { auditLocalePair, formatIntegrityReport } from '../integrity.js';
import { flattenKeys } from '../flatten.js';
import { readLocaleFile, detectFormatFromDir, getExtension } from '../format.js';
import { output } from '../output.js';

async function run(args, cwd) {
  const config = resolveConfig(args, cwd);
  const format = config.format !== 'auto'
    ? config.format
    : detectFormatFromDir(config.localesDir);
  const ext = getExtension(format);
  const sourcePath = path.join(config.localesDir, `${config.inputLocale}${ext}`);

  if (!fs.existsSync(sourcePath)) {
    output.error(`Source locale file not found: ${sourcePath}`);
    return 1;
  }

  const sourceRaw = readLocaleFile(sourcePath, format);
  const sourceFlat = format === 'json' ? flattenKeys(sourceRaw) : sourceRaw;

  // Detect target locales from directory listing
  const files = fs.readdirSync(config.localesDir);
  const targetLocales = files
    .filter(f => f.endsWith(ext) && !f.startsWith(config.inputLocale))
    .map(f => f.replace(ext, ''));

  output.raw('\n  i18n-rosetta integrity — Locale File Audit\n');
  output.raw(`  Source: ${config.inputLocale} (${Object.keys(sourceFlat).length} keys)`);
  output.raw(`  Targets: ${targetLocales.join(', ')}\n`);

  let totalIssues = 0;

  for (const locale of targetLocales) {
    const targetPath = path.join(config.localesDir, `${locale}${ext}`);
    const targetRaw = readLocaleFile(targetPath, format);
    const targetFlat = format === 'json' ? flattenKeys(targetRaw) : targetRaw;

    const audit = auditLocalePair(sourceFlat, targetFlat, locale);
    const report = formatIntegrityReport(locale, audit);
    output.raw(report);

    totalIssues += audit.placeholderIssues.length +
      audit.encodingIssues.length +
      audit.copies.length +
      audit.orphans.length;
  }

  output.raw(`  Total issues: ${totalIssues}`);
  return (totalIssues > 0 && !args['warn-only']) ? 1 : 0;
}

export { run };
