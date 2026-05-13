/**
 * Command: audit
 *
 * Lists untranslated [EN] fallback values across all locale files.
 * Returns exit code 1 if any untranslated keys exist — usable as a CI gate.
 */

import { runSync } from '../sync.js';

async function run(args, cwd) {
  const result = await runSync({
    audit: true,
    cwd,
    cliArgs: args,
  });

  // Exit 1 if any keys still need translation (parity gate)
  if (result && result.untranslatedCount > 0) {
    return 1;
  }
  return 0;
}

export { run };
