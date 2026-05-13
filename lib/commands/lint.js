/**
 * Command: lint
 *
 * Scans source files for hardcoded user-facing strings that should
 * be wrapped in t() calls. Returns exit code 1 if issues found
 * (unless --warn-only is set).
 */

import { runLint } from '../lint.js';

async function run(args, cwd) {
  const exitCode = await runLint({
    cwd,
    cliArgs: args,
    warnOnly: !!args['warn-only'],
  });
  return exitCode;
}

export { run };
