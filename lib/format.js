/**
 * Format adapter — reads and writes locale files in JSON, TOML, and YAML.
 *
 * WHY: Hugo uses TOML or YAML for i18n string files, not JSON.
 * Hugo's i18n/ structure looks like:
 *
 *   [home]                    # TOML section = translation key
 *   other = "Home"            # 'other' = the default/plural form
 *
 *   [items]
 *   one = "{{ .Count }} item"
 *   other = "{{ .Count }} items"
 *
 * This module converts between Hugo's format and our internal flat
 * key→value map, so the diff/translate/hash engine stays format-agnostic.
 *
 * ZERO DEPENDENCIES: Hugo i18n files have a constrained, predictable
 * structure. We don't need js-yaml or a full TOML parser — just
 * targeted parsers for the subset Hugo actually uses.
 */

import fs from 'node:fs';

// CLDR plural categories used by Hugo/go-i18n
const PLURAL_FORMS = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

// -----------------------------------------------------------------
// Format detection
// -----------------------------------------------------------------

/**
 * Detect the locale file format from a file path's extension.
 *
 * @param {string} filePath - Path to a locale file
 * @returns {'json'|'toml'|'yaml'} Detected format
 */
function detectFormat(filePath) {
  if (filePath.endsWith('.toml')) return 'toml';
  if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) return 'yaml';
  return 'json';
}

/**
 * Get the file extension string for a format.
 *
 * @param {'json'|'toml'|'yaml'} format
 * @returns {string} File extension including the dot
 */
function getExtension(format) {
  if (format === 'toml') return '.toml';
  if (format === 'yaml') return '.yaml';
  return '.json';
}

/**
 * Auto-detect the format used in a locales directory by scanning
 * for the most common file extension present.
 *
 * @param {string} localesDir - Path to the locales directory
 * @returns {'json'|'toml'|'yaml'} Detected format, defaults to 'json'
 */
function detectFormatFromDir(localesDir) {
  if (!fs.existsSync(localesDir)) return 'json';

  const files = fs.readdirSync(localesDir);
  const counts = { json: 0, toml: 0, yaml: 0 };

  for (const file of files) {
    if (file.endsWith('.toml')) counts.toml++;
    else if (file.endsWith('.yaml') || file.endsWith('.yml')) counts.yaml++;
    else if (file.endsWith('.json')) counts.json++;
  }

  // Return whichever format has the most files
  if (counts.toml > counts.json && counts.toml >= counts.yaml) return 'toml';
  if (counts.yaml > counts.json && counts.yaml >= counts.toml) return 'yaml';
  return 'json';
}

// -----------------------------------------------------------------
// Read: format → flat key-value map
// -----------------------------------------------------------------

/**
 * Read a locale file and return a flat key→value map.
 *
 * For TOML/YAML Hugo files, simple keys (only 'other') flatten to
 * { "key": "value" }. Plural keys flatten to { "key.one": "...",
 * "key.other": "..." }.
 *
 * @param {string} filePath - Path to the locale file
 * @param {'json'|'toml'|'yaml'} format - File format
 * @returns {object} Flat key→value map
 */
function readLocaleFile(filePath, format) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, 'utf-8');
  if (!raw.trim()) return {};

  if (format === 'toml') return parseTOMLToFlat(raw);
  if (format === 'yaml') return parseYAMLToFlat(raw);
  return JSON.parse(raw); // JSON: caller handles flattening
}

/**
 * Write a nested data object to a locale file in the specified format.
 *
 * For JSON, this writes the nested structure directly.
 * For TOML/YAML, this converts to Hugo's i18n section format.
 *
 * @param {string} filePath - Output file path
 * @param {object} data - Nested data object (for JSON) or flat map (for TOML/YAML)
 * @param {'json'|'toml'|'yaml'} format - Target format
 * @param {object} flatData - Flat key→value map (used for TOML/YAML reconstruction)
 */
function writeLocaleFile(filePath, data, format, flatData) {
  if (format === 'toml') {
    fs.writeFileSync(filePath, flatToTOML(flatData || data), 'utf-8');
  } else if (format === 'yaml') {
    fs.writeFileSync(filePath, flatToYAML(flatData || data), 'utf-8');
  } else {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  }
}

// -----------------------------------------------------------------
// TOML parser (Hugo i18n subset)
// -----------------------------------------------------------------

/**
 * Parse Hugo i18n TOML content into a flat key→value map.
 *
 * Handles:
 *   [section]           → section header (translation key)
 *   other = "value"     → simple string (flattens to { section: value })
 *   one = "singular"    → plural form (flattens to { section.one: value })
 *   # comments          → skipped
 *
 * @param {string} content - Raw TOML file content
 * @returns {object} Flat key→value map
 */
function parseTOMLToFlat(content) {
  const sections = parseTOMLSections(content);
  return sectionsToFlat(sections);
}

/**
 * Parse TOML into an intermediate section map.
 * { sectionName: { subKey: value, ... }, ... }
 */
function parseTOMLSections(content) {
  const sections = {};
  let currentSection = null;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Section header: [key_name]
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      if (!sections[currentSection]) sections[currentSection] = {};
      continue;
    }

    // Key-value pair within a section
    if (currentSection) {
      const kv = parseTOMLKeyValue(trimmed);
      if (kv) {
        sections[currentSection][kv.key] = kv.value;
      }
    }
  }

  return sections;
}

/**
 * Parse a single TOML key = "value" line.
 * Handles double-quoted, single-quoted, and bare values.
 */
function parseTOMLKeyValue(line) {
  const eqIdx = line.indexOf('=');
  if (eqIdx < 0) return null;

  const key = line.slice(0, eqIdx).trim();
  let value = line.slice(eqIdx + 1).trim();

  // Double-quoted string
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t');
    return { key, value };
  }

  // Single-quoted string (literal, no escapes in TOML spec)
  if (value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1);
    return { key, value };
  }

  // Bare value (shouldn't happen in i18n files, but handle gracefully)
  return { key, value };
}

/**
 * Serialize a flat key→value map to Hugo i18n TOML format.
 *
 * Simple keys write as:
 *   [key]
 *   other = "value"
 *
 * Plural keys (key.one, key.other) group under one section:
 *   [key]
 *   one = "singular"
 *   other = "plural"
 *
 * @param {object} flat - Flat key→value map
 * @returns {string} TOML content
 */
function flatToTOML(flat) {
  const grouped = groupFlatKeys(flat);
  const lines = [];

  for (const [section, values] of Object.entries(grouped)) {
    lines.push(`[${section}]`);
    for (const [subKey, value] of Object.entries(values)) {
      const escaped = String(value)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t');
      lines.push(`${subKey} = "${escaped}"`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// -----------------------------------------------------------------
// YAML parser (Hugo i18n subset)
// -----------------------------------------------------------------

/**
 * Parse Hugo i18n YAML content into a flat key→value map.
 *
 * Handles the standard Hugo format:
 *   key:
 *     other: "value"
 *   items:
 *     one: "singular"
 *     other: "plural"
 *
 * @param {string} content - Raw YAML file content
 * @returns {object} Flat key→value map
 */
function parseYAMLToFlat(content) {
  const sections = parseYAMLSections(content);
  return sectionsToFlat(sections);
}

/**
 * Parse YAML into an intermediate section map.
 */
function parseYAMLSections(content) {
  const sections = {};
  let currentSection = null;

  for (const line of content.split('\n')) {
    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith('#')) continue;

    // Top-level key (no leading whitespace)
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      // Section with sub-keys: "key:" (nothing after colon, or only whitespace)
      const sectionMatch = line.match(/^([^\s:]+):\s*$/);
      if (sectionMatch) {
        currentSection = sectionMatch[1];
        sections[currentSection] = {};
        continue;
      }

      // Flat key-value: "key: value"
      const kvMatch = line.match(/^([^\s:]+):\s+(.+)$/);
      if (kvMatch) {
        const key = kvMatch[1];
        const value = unquoteYAML(kvMatch[2]);
        sections[key] = { other: value };
        currentSection = null;
        continue;
      }
    }

    // Indented sub-key within a section
    if (currentSection && (line.startsWith('  ') || line.startsWith('\t'))) {
      const match = line.trim().match(/^([^\s:]+):\s+(.+)$/);
      if (match) {
        sections[currentSection][match[1]] = unquoteYAML(match[2]);
      }
    }
  }

  return sections;
}

/**
 * Remove surrounding quotes from a YAML value.
 */
function unquoteYAML(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Serialize a flat key→value map to Hugo i18n YAML format.
 *
 * @param {object} flat - Flat key→value map
 * @returns {string} YAML content
 */
function flatToYAML(flat) {
  const grouped = groupFlatKeys(flat);
  const lines = [];

  for (const [section, values] of Object.entries(grouped)) {
    lines.push(`${section}:`);
    for (const [subKey, value] of Object.entries(values)) {
      const strValue = String(value);
      const needsQuotes = strValue.includes(':') || strValue.includes('#') ||
                          strValue.includes('{') || strValue.includes('}') ||
                          strValue.includes('[') || strValue.includes(']') ||
                          strValue.startsWith(' ') || strValue.endsWith(' ') ||
                          strValue.includes('"') || strValue.includes("'") ||
                          strValue === '' || strValue === 'true' || strValue === 'false' ||
                          strValue === 'null' || strValue === 'yes' || strValue === 'no';
      const formatted = needsQuotes
        ? `"${strValue.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
        : strValue;
      lines.push(`  ${subKey}: ${formatted}`);
    }
  }

  return lines.join('\n') + '\n';
}

// -----------------------------------------------------------------
// Shared utilities
// -----------------------------------------------------------------

/**
 * Convert an intermediate section map to a flat key→value map.
 *
 * If a section has only 'other', flatten to { section: value }.
 * If a section has plural forms, flatten to { section.one: ..., section.other: ... }.
 *
 * @param {object} sections - { sectionName: { subKey: value } }
 * @returns {object} Flat key→value map
 */
function sectionsToFlat(sections) {
  const flat = {};
  for (const [section, values] of Object.entries(sections)) {
    const subKeys = Object.keys(values);
    if (subKeys.length === 1 && subKeys[0] === 'other') {
      // Simple string — just use the section name as the flat key
      flat[section] = values.other;
    } else {
      // Plural forms or multiple sub-keys — preserve the structure
      for (const [subKey, value] of Object.entries(values)) {
        flat[`${section}.${subKey}`] = value;
      }
    }
  }
  return flat;
}

/**
 * Group flat keys back into section → { subKey: value } structure
 * for TOML/YAML serialization.
 *
 * Keys without plural suffixes get wrapped as { other: value }.
 * Keys ending in a CLDR plural form (one, other, few, etc.)
 * are grouped under their parent section.
 *
 * @param {object} flat - Flat key→value map
 * @returns {object} Grouped sections: { section: { subKey: value } }
 */
function groupFlatKeys(flat) {
  const sections = {};

  for (const [key, value] of Object.entries(flat)) {
    const lastDot = key.lastIndexOf('.');
    const possibleSection = lastDot > 0 ? key.substring(0, lastDot) : null;
    const possibleSubKey = lastDot > 0 ? key.substring(lastDot + 1) : null;

    if (possibleSubKey && PLURAL_FORMS.has(possibleSubKey)) {
      // This is a plural form — group under the parent section
      if (!sections[possibleSection]) sections[possibleSection] = {};
      sections[possibleSection][possibleSubKey] = value;
    } else {
      // Simple string — wrap as { other: value }
      if (!sections[key]) sections[key] = {};
      sections[key].other = value;
    }
  }

  return sections;
}

export {
  detectFormat,
  detectFormatFromDir,
  getExtension,
  readLocaleFile,
  writeLocaleFile,
  parseTOMLToFlat,
  parseYAMLToFlat,
  flatToTOML,
  flatToYAML,
  sectionsToFlat,
  groupFlatKeys,
  PLURAL_FORMS,
};
