/**
 * Security utilities — path containment and traversal prevention.
 *
 * WHY THIS EXISTS: Locale codes and content paths come from user config.
 * A crafted code like "../../../etc/passwd" would resolve outside the
 * expected directory. This module provides the guard that prevents
 * writes to arbitrary filesystem locations.
 *
 * Used by: sync.js (key-value locale writes), content-sync.js (content writes)
 */

import path from 'node:path';

/**
 * Verify that a resolved file path is contained within the expected
 * parent directory. Prevents path traversal via crafted language codes
 * or filenames in the config (e.g., "../../../etc/passwd.json").
 *
 * @param {string} filePath - Resolved absolute path to check
 * @param {string} parentDir - Expected parent directory
 * @returns {boolean} True if filePath is within parentDir
 */
function isPathContained(filePath, parentDir) {
  const resolved = path.resolve(filePath);
  const parent = path.resolve(parentDir);
  return resolved.startsWith(parent + path.sep) || resolved === parent;
}

export { isPathContained };
