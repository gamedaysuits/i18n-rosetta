/**
 * Command: provenance
 *
 * Shows licensing and resource dependencies for all translation pairs.
 * Important for commercial readiness audits — each method reports what
 * external resources it relies on and their license status.
 */

import { resolveConfig, autoDetectLanguages } from '../config.js';
import { resolvePairs } from '../pairs.js';
import { formatProvenanceReport } from '../provenance.js';
import { output } from '../output.js';

async function run(args, cwd) {
  const config = resolveConfig(args, cwd);

  let languages = config.resolvedLanguages;
  if (Object.keys(languages).length === 0) {
    languages = autoDetectLanguages(config);
  }
  config.resolvedLanguages = languages;

  const pairs = resolvePairs(config);
  const report = formatProvenanceReport(pairs);
  output.raw('\n  i18n-rosetta — Provenance Report\n');
  output.raw(report);

  return 0;
}

export { run };
