/**
 * API key loader — reads translation API keys from environment or .env files.
 *
 * WHY THIS EXISTS: The API key resolution logic was embedded in sync.js
 * (the "god module"). Extracting it provides:
 *   1. A single, testable function for key resolution
 *   2. Clear priority chain: process.env → .env.local → .env
 *   3. Consistent handling of quoted values and export prefixes
 *
 * This is a simple key=value parser. It handles:
 *   - Standard: KEY=value
 *   - Quoted: KEY="value" or KEY='value'
 *   - Export prefix: export KEY=value
 *   - Comments: lines starting with #
 *   - Empty lines
 *
 * It does NOT handle multiline values, variable expansion ($OTHER_KEY),
 * or other dotenv features. For those, install dotenv.
 *
 * Priority: process.env → .env.local → .env
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Parse a single line from an env file.
 * Returns { key, value } or null if the line is empty/comment.
 *
 * @param {string} line - Raw line from env file
 * @returns {{ key: string, value: string } | null}
 */
function parseEnvLine(line) {
  let trimmed = line.trim();

  // Skip empty lines and comments
  if (!trimmed || trimmed.startsWith('#')) return null;

  // Handle `export KEY=value` syntax
  if (trimmed.startsWith('export ')) {
    trimmed = trimmed.slice(7).trim();
  }

  const eqIdx = trimmed.indexOf('=');
  if (eqIdx <= 0) return null;

  const key = trimmed.slice(0, eqIdx).trim();
  const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');

  return { key, value: val };
}

/**
 * Load an API key by name, checking process.env first, then .env.local,
 * then .env in the project root.
 *
 * @param {object} config - Config object with apiKeyEnvVar property
 * @param {string} config.apiKeyEnvVar - Name of the environment variable
 * @param {string} cwd - Project root directory
 * @returns {string|null} The API key value, or null if not found
 */
function loadApiKey(config, cwd) {
  // Priority 1: Check environment directly
  if (process.env[config.apiKeyEnvVar]) {
    return process.env[config.apiKeyEnvVar];
  }

  // Priority 2: .env.local (Vercel/Next.js convention)
  const envLocalPath = path.join(cwd, '.env.local');
  const fromLocal = readKeyFromFile(envLocalPath, config.apiKeyEnvVar);
  if (fromLocal) return fromLocal;

  // Priority 3: .env
  const envPath = path.join(cwd, '.env');
  const fromEnv = readKeyFromFile(envPath, config.apiKeyEnvVar);
  if (fromEnv) return fromEnv;

  return null;
}

/**
 * Read a specific key from an env file.
 *
 * @param {string} filePath - Path to the env file
 * @param {string} targetKey - Key name to find
 * @returns {string|null} The value, or null if not found
 */
function readKeyFromFile(filePath, targetKey) {
  if (!fs.existsSync(filePath)) return null;

  const content = fs.readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const parsed = parseEnvLine(line);
    if (parsed && parsed.key === targetKey) {
      return parsed.value;
    }
  }

  return null;
}

export { loadApiKey, parseEnvLine };
