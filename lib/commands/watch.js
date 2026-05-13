/**
 * Command: watch
 *
 * Starts a file watcher that auto-syncs when the source locale changes.
 * Delegates to lib/watch.startWatch.
 */

import { startWatch } from '../watch.js';

async function run(args, cwd) {
  startWatch({ cwd, cliArgs: args });
  // Watch runs indefinitely — no exit code
}

export { run };
