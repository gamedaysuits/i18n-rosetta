/**
 * Watch mode — monitors the source locale file and re-syncs on changes.
 *
 * WHY THIS EXISTS: Extracted from sync.js to reduce the god-module
 * and give watch its own lifecycle management.
 *
 * Uses fs.watch (inotify/FSEvents) with a 500ms debounce to prevent
 * duplicate syncs when editors write in multiple steps (write + rename).
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveConfig } from './config.js';
import { detectFormatFromDir, getExtension } from './format.js';
import { runSync } from './sync.js';

/**
 * Start watch mode — sync once, then re-sync on source file changes.
 *
 * @param {object} options
 * @param {string} [options.cwd] - Working directory
 * @param {object} [options.cliArgs] - CLI arguments
 */
function startWatch(options = {}) {
  const { cwd = process.cwd(), cliArgs = {} } = options;
  const config = resolveConfig(cliArgs, cwd);
  const format = config.format !== 'auto'
    ? config.format
    : detectFormatFromDir(config.localesDir);
  const ext = getExtension(format);
  const inputLocale = config.inputLocale || config.sourceLocale || 'en';
  const sourceFile = `${inputLocale}${ext}`;
  const sourcePath = path.join(config.localesDir, sourceFile);

  console.log(`[INFO] Watching ${sourceFile} for changes...\n`);

  // Initial sync
  runSync({ cwd, cliArgs });

  // Watch with debounce to handle multi-step editor writes
  let timeout = null;
  const watcher = fs.watch(sourcePath, () => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      console.log(`\n[INFO] ${sourceFile} changed — syncing locales...`);
      runSync({ cwd, cliArgs });
    }, 500);
  });

  // Cleanup on process exit
  process.on('SIGINT', () => {
    if (timeout) clearTimeout(timeout);
    watcher.close();
    process.exit(0);
  });
}

export { startWatch };
