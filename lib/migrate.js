/**
 * Config migration — auto-upgrades v2 configs to v3 format.
 *
 * WHY: v3 introduces breaking config changes (sourceLocale → inputLocale,
 * new pair model, new fields). Rather than forcing users to manually
 * update their config files, we detect v2 configs and auto-migrate them.
 *
 * WHAT CHANGES:
 *   - `sourceLocale` → `inputLocale`
 *   - Adds `version: 3`
 *   - Adds `baseUrl: ""` (empty, user must fill in for SEO commands)
 *   - Creates a backup of the original config
 *
 * WHAT STAYS THE SAME:
 *   - `languages` array works unchanged (simple mode)
 *   - `localesDir`, `contentDir`, `model`, `batchSize` — unchanged
 *   - `lint` config block — unchanged
 *   - All locale files — unchanged
 *
 * DETECTION: A config is v2 if it has no `version` field or `version < 3`.
 */

import fs from 'node:fs';
import path from 'node:path';



/**
 * Check if a config object needs migration.
 *
 * @param {object} config - Raw parsed config from file
 * @returns {boolean} True if migration is needed
 */
function needsMigration(config) {
  // No version field = v2 (or v1)
  if (!config.version) return true;
  // Explicit version check
  if (config.version < 3) return true;
  return false;
}

/**
 * Migrate a v2 config object to v3 format.
 * Returns a new object — does not mutate the input.
 *
 * @param {object} v2Config - Original v2 config
 * @returns {{ migrated: object, changes: string[] }} Migrated config and list of changes
 */
function migrateConfig(v2Config) {
  const changes = [];
  const migrated = { ...v2Config };

  // Add version
  migrated.version = 3;
  changes.push('Added version: 3');

  // Rename sourceLocale → inputLocale
  if (migrated.sourceLocale) {
    migrated.inputLocale = migrated.sourceLocale;
    delete migrated.sourceLocale;
    changes.push(`Renamed sourceLocale → inputLocale ("${migrated.inputLocale}")`);
  } else if (!migrated.inputLocale) {
    migrated.inputLocale = 'en';
    changes.push('Added inputLocale: "en" (default)');
  }

  // Add baseUrl placeholder (required for SEO commands)
  if (!migrated.baseUrl) {
    migrated.baseUrl = '';
    changes.push('Added baseUrl: "" (set this for SEO commands)');
  }

  // Preserve everything else unchanged
  // languages, localesDir, contentDir, model, batchSize, lint, etc.

  return { migrated, changes };
}



/**
 * Run the full migration pipeline.
 * Reads the config file, migrates it, writes a backup, and saves the new version.
 *
 * @param {string} configPath - Path to the config file
 * @param {string} cwd - Project root directory
 * @returns {{ migrated: boolean, changes: string[] }} Migration result
 */
function runMigration(configPath, cwd) {
  if (!configPath || !fs.existsSync(configPath)) {
    return { migrated: false, changes: [] };
  }

  let rawConfig;
  try {
    rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (err) {
    console.error(`[WARN] Failed to parse config for migration: ${err.message}`);
    return { migrated: false, changes: [] };
  }

  if (!needsMigration(rawConfig)) {
    return { migrated: false, changes: [] };
  }

  // Perform config migration
  const { migrated, changes } = migrateConfig(rawConfig);

  // Write backup of original config
  const backupPath = configPath.replace('.json', '-v2-backup.json');
  fs.writeFileSync(backupPath, JSON.stringify(rawConfig, null, 2) + '\n', 'utf-8');
  changes.push(`Backup saved to ${path.basename(backupPath)}`);

  // Write migrated config
  fs.writeFileSync(configPath, JSON.stringify(migrated, null, 2) + '\n', 'utf-8');

  // Print migration summary
  console.log('\n  Config migrated to v3:');
  for (const change of changes) {
    console.log(`     • ${change}`);
  }
  console.log('');

  return { migrated: true, changes };
}

export {
  needsMigration,
  migrateConfig,
  runMigration,
};
