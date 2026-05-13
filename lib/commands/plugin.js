/**
 * Command: plugin
 *
 * Manages method plugins for i18n-rosetta:
 *   - list:    Show installed plugins with metadata
 *   - install: Install from a local directory (registry coming later)
 *   - remove:  Remove an installed plugin
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  installPluginFromLocal, removePlugin, listPlugins,
} from '../plugins.js';
import { output } from '../output.js';

async function run(args, cwd) {
  const subcommand = args._[1];
  const pluginArg = args._[2];

  if (subcommand === 'list') {
    const installed = listPlugins(cwd);
    if (installed.length === 0) {
      output.raw('\n  No plugins installed.');
      output.raw('  Install one: rosetta plugin install <name-or-path>\n');
    } else {
      output.raw(`\n  Installed Plugins (${installed.length}):\n`);
      for (const plugin of installed) {
        const localeStr = plugin.locales.join(', ');
        const benchStr = plugin.hasBenchmarks ? '| benchmarks: yes' : '';
        output.raw(`    ${plugin.name} v${plugin.version}`);
        output.raw(`      type: ${plugin.type}  |  locales: ${localeStr}  |  quality: ${plugin.qualityTier}  ${benchStr}`);
        if (plugin.description) {
          output.raw(`      ${plugin.description}`);
        }
      }
      output.raw('');
    }
    return 0;
  }

  if (subcommand === 'install') {
    if (!pluginArg) {
      output.error('Usage: rosetta plugin install <name-or-path>');
      return 1;
    }

    // Determine install source: local path or name (future: registry URL)
    const resolvedPath = path.resolve(pluginArg);
    if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
      // Local directory install
      const result = installPluginFromLocal(resolvedPath, cwd);
      if (result.success) {
        output.ok(`Installed plugin: ${result.name}`);
        output.raw(`     Location: .rosetta/methods/${result.name}/\n`);
        return 0;
      } else {
        output.error(`Install failed: ${result.error}`);
        return 1;
      }
    } else {
      // Name-based install — placeholder for future registry
      output.error(`Plugin "${pluginArg}" not found as a local directory.`);
      output.raw('     Remote plugin registries are not yet supported.');
      output.raw('     Install from a local directory:\n');
      output.raw(`     rosetta plugin install ./path/to/${pluginArg}/\n`);
      return 1;
    }
  }

  if (subcommand === 'remove') {
    if (!pluginArg) {
      output.error('Usage: rosetta plugin remove <name>');
      return 1;
    }

    const result = removePlugin(pluginArg, cwd);
    if (result.success) {
      output.ok(`Removed plugin: ${pluginArg}`);
      return 0;
    } else {
      output.error(result.error);
      return 1;
    }
  }

  // No valid subcommand — show help
  output.raw(`
  Plugin Commands:

    rosetta plugin list                List installed plugins
    rosetta plugin install <path>      Install a plugin from a local directory
    rosetta plugin remove <name>       Remove an installed plugin
  `);
  return 0;
}

export { run };
