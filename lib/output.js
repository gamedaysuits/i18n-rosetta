/**
 * Central output controller — routes all CLI messages through a single interface.
 *
 * WHY: Without a central controller, every lib file does its own console.log
 * with inconsistent formatting (emoji prefixes, ad-hoc colors, mixed stderr/stdout).
 * This module provides a single point of control for:
 *   - Mode switching: default (clean text), json (machine-readable), quiet (errors only)
 *   - Consistent prefixes: [INFO], [OK], [WARN], [ERR]
 *   - Stderr routing: warnings and errors always go to stderr
 *   - Structured output: --json mode produces parseable JSON objects
 *
 * USAGE:
 *   import { output } from './output.js';
 *   output.info('Source file loaded', { keys: 42 });
 *   output.ok('Sync complete');
 *   output.warn('Missing API key');
 *   output.error('Translation failed', { pair: 'en:fr' });
 */

/**
 * Output modes:
 *   - 'default':  Human-readable text with [PREFIX] labels
 *   - 'json':     Machine-readable JSON objects, one per line
 *   - 'quiet':    Errors and warnings only (suppress info/ok/progress)
 *   - 'verbose':  Full detail including debug-level messages
 */
let mode = 'default';

/**
 * Set the output mode. Call once during CLI bootstrap.
 *
 * @param {'default'|'json'|'quiet'|'verbose'} newMode
 */
function setMode(newMode) {
  const valid = ['default', 'json', 'quiet', 'verbose'];
  if (!valid.includes(newMode)) {
    console.error(`[ERR] Invalid output mode "${newMode}" — expected one of: ${valid.join(', ')}`);
    return;
  }
  mode = newMode;
}

/**
 * Get the current output mode.
 *
 * @returns {string}
 */
function getMode() {
  return mode;
}

/**
 * Informational message — general status updates.
 * Suppressed in quiet mode.
 *
 * @param {string} msg - Human-readable message
 * @param {object} [data] - Structured data (emitted in json mode)
 */
function info(msg, data) {
  if (mode === 'quiet') return;
  if (mode === 'json') {
    console.log(JSON.stringify({ level: 'info', message: msg, ...data }));
    return;
  }
  console.log(`[INFO] ${msg}`);
}

/**
 * Success message — operation completed correctly.
 * Suppressed in quiet mode.
 *
 * @param {string} msg - Human-readable message
 * @param {object} [data] - Structured data (emitted in json mode)
 */
function ok(msg, data) {
  if (mode === 'quiet') return;
  if (mode === 'json') {
    console.log(JSON.stringify({ level: 'ok', message: msg, ...data }));
    return;
  }
  console.log(`[OK] ${msg}`);
}

/**
 * Warning — something is off but not fatal.
 * Always emitted (even in quiet mode). Goes to stderr.
 *
 * @param {string} msg - Human-readable message
 * @param {object} [data] - Structured data (emitted in json mode)
 */
function warn(msg, data) {
  if (mode === 'json') {
    console.error(JSON.stringify({ level: 'warn', message: msg, ...data }));
    return;
  }
  console.error(`[WARN] ${msg}`);
}

/**
 * Error — operation failed.
 * Always emitted. Goes to stderr.
 *
 * @param {string} msg - Human-readable message
 * @param {object} [data] - Structured data (emitted in json mode)
 */
function error(msg, data) {
  if (mode === 'json') {
    console.error(JSON.stringify({ level: 'error', message: msg, ...data }));
    return;
  }
  console.error(`[ERR] ${msg}`);
}

/**
 * Progress message — inline status for long-running operations.
 * Suppressed in quiet and json modes.
 *
 * @param {string} msg - Progress description
 */
function progress(msg) {
  if (mode === 'quiet' || mode === 'json') return;
  process.stdout.write(msg);
}

/**
 * Debug message — verbose detail, only shown in verbose mode.
 *
 * @param {string} msg - Debug message
 * @param {object} [data] - Structured data
 */
function debug(msg, data) {
  if (mode !== 'verbose') return;
  console.log(`[DEBUG] ${msg}`);
}

/**
 * Summary — end-of-command structured report.
 * In json mode, emits a single JSON summary object.
 * In default/verbose mode, prints a formatted summary.
 *
 * @param {object} data - Summary data
 * @param {string} [data.title] - Summary title
 */
function summary(data) {
  if (mode === 'quiet') return;
  if (mode === 'json') {
    console.log(JSON.stringify({ level: 'summary', ...data }));
    return;
  }
  if (data.title) {
    console.log(`\n${data.title}`);
  }
}

/**
 * Raw output — bypasses all formatting. Use sparingly for
 * pre-formatted content like tables, ASCII art, or help text.
 *
 * @param {string} msg - Raw text to output
 */
function raw(msg) {
  if (mode === 'quiet') return;
  console.log(msg);
}

const output = {
  setMode,
  getMode,
  info,
  ok,
  warn,
  error,
  progress,
  debug,
  summary,
  raw,
};

export { output };
