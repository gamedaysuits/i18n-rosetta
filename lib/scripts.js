/**
 * Script conversion registry — deterministic orthography converters.
 *
 * WHY: Some languages have multiple scripts for the same spoken language.
 * Translation workflows often prefer a "working script" (easier to type,
 * edit, and version-control) that gets converted to a "display script"
 * as a post-translation step.
 *
 * Examples:
 *   - Plains Cree: SRO (Standard Roman Orthography) → Syllabics (ᓀᐦᐃᔭᐍᐏᐣ)
 *   - Serbian: Latin → Cyrillic
 *   - Japanese: Romaji → Hiragana/Katakana
 *   - Hindi: Romanized → Devanagari
 *
 * All converters here are DETERMINISTIC — no LLM needed, pure lookup tables.
 * They run as a post-translation hook: translate in working script, then
 * convert to display script.
 *
 * ADDING A NEW CONVERTER:
 *   1. Add the conversion map below
 *   2. Create the converter function (input string → output string)
 *   3. Register it in SCRIPT_CONVERTERS with the locale code
 *   4. Add the `scripts` field to the language's register entry in registers.js
 */

// -----------------------------------------------------------------
// Plains Cree: SRO → Syllabics
// -----------------------------------------------------------------

/**
 * SRO to Cree Syllabics conversion table.
 *
 * This is the standard mapping used by the University of Alberta's
 * ALTLab and documented in Wolvengrey's Cree: Words dictionary.
 *
 * The mapping is context-sensitive: consonant+vowel combinations map
 * to specific syllabic characters, while standalone consonants use
 * finals (small superscript forms).
 *
 * ORDER MATTERS: Longer sequences must be matched before shorter ones
 * (e.g., "twê" before "tw" before "t").
 */
const SRO_TO_SYLLABICS_MAP = [
  // Long vowels with w-glide (must come before short vowel w-glide)
  ['pwê', 'ᐻ'], ['pwî', 'ᐽ'], ['pwô', 'ᐿ'], ['pwâ', 'ᑁ'],
  ['twê', 'ᑗ'], ['twî', 'ᑙ'], ['twô', 'ᑛ'], ['twâ', 'ᑝ'],
  ['kwê', 'ᑵ'], ['kwî', 'ᑷ'], ['kwô', 'ᑹ'], ['kwâ', 'ᑻ'],
  ['cwê', 'ᒑ'], ['cwî', 'ᒓ'], ['cwô', 'ᒕ'], ['cwâ', 'ᒗ'],
  ['mwê', 'ᒫ'], ['mwî', 'ᒭ'], ['mwô', 'ᒯ'], ['mwâ', 'ᒱ'],
  ['nwê', 'ᓇ'], ['nwî', 'ᓉ'], ['nwô', 'ᓋ'], ['nwâ', 'ᓍ'],
  ['swê', 'ᓭ'], ['swî', 'ᓯ'], ['swô', 'ᓱ'], ['swâ', 'ᓳ'],
  ['ywê', 'ᔋ'], ['ywî', 'ᔍ'], ['ywô', 'ᔏ'], ['ywâ', 'ᔑ'],

  // Short vowels with w-glide
  ['pwe', 'ᐺ'], ['pwi', 'ᐼ'], ['pwo', 'ᐾ'], ['pwa', 'ᑀ'],
  ['twe', 'ᑖ'], ['twi', 'ᑘ'], ['two', 'ᑚ'], ['twa', 'ᑜ'],
  ['kwe', 'ᑴ'], ['kwi', 'ᑶ'], ['kwo', 'ᑸ'], ['kwa', 'ᑺ'],
  ['cwe', 'ᒐ'], ['cwi', 'ᒒ'], ['cwo', 'ᒔ'], ['cwa', 'ᒖ'],
  ['mwe', 'ᒪ'], ['mwi', 'ᒬ'], ['mwo', 'ᒮ'], ['mwa', 'ᒰ'],
  ['nwe', 'ᓈ'], ['nwi', 'ᓊ'], ['nwo', 'ᓌ'], ['nwa', 'ᓎ'],
  ['swe', 'ᓬ'], ['swi', 'ᓮ'], ['swo', 'ᓰ'], ['swa', 'ᓲ'],
  ['ywe', 'ᔊ'], ['ywi', 'ᔌ'], ['ywo', 'ᔎ'], ['ywa', 'ᔐ'],

  // Long vowels (macron forms — these must come before short vowels)
  ['pê', 'ᐯ'], ['pî', 'ᐲ'], ['pô', 'ᐴ'], ['pâ', 'ᐹ'],
  ['tê', 'ᑌ'], ['tî', 'ᑏ'], ['tô', 'ᑑ'], ['tâ', 'ᑖ'],
  ['kê', 'ᑫ'], ['kî', 'ᑮ'], ['kô', 'ᑰ'], ['kâ', 'ᑳ'],
  ['cê', 'ᒉ'], ['cî', 'ᒌ'], ['cô', 'ᒎ'], ['câ', 'ᒑ'],
  ['mê', 'ᒣ'], ['mî', 'ᒦ'], ['mô', 'ᒨ'], ['mâ', 'ᒫ'],
  ['nê', 'ᓀ'], ['nî', 'ᓃ'], ['nô', 'ᓅ'], ['nâ', 'ᓈ'],
  ['sê', 'ᓭ'], ['sî', 'ᓰ'], ['sô', 'ᓲ'], ['sâ', 'ᓵ'],
  ['yê', 'ᔦ'], ['yî', 'ᔩ'], ['yô', 'ᔫ'], ['yâ', 'ᔮ'],

  // Short vowels (consonant+vowel)
  ['pe', 'ᐯ'], ['pi', 'ᐱ'], ['po', 'ᐳ'], ['pa', 'ᐸ'],
  ['te', 'ᑌ'], ['ti', 'ᑎ'], ['to', 'ᑐ'], ['ta', 'ᑕ'],
  ['ke', 'ᑫ'], ['ki', 'ᑭ'], ['ko', 'ᑯ'], ['ka', 'ᑲ'],
  ['ce', 'ᒉ'], ['ci', 'ᒋ'], ['co', 'ᒍ'], ['ca', 'ᒐ'],
  ['me', 'ᒣ'], ['mi', 'ᒥ'], ['mo', 'ᒧ'], ['ma', 'ᒪ'],
  ['ne', 'ᓀ'], ['ni', 'ᓂ'], ['no', 'ᓄ'], ['na', 'ᓇ'],
  ['se', 'ᓭ'], ['si', 'ᓯ'], ['so', 'ᓱ'], ['sa', 'ᓴ'],
  ['ye', 'ᔦ'], ['yi', 'ᔨ'], ['yo', 'ᔪ'], ['ya', 'ᔭ'],

  // Standalone vowels (long first)
  ['ê', 'ᐁ'], ['î', 'ᐄ'], ['ô', 'ᐆ'], ['â', 'ᐋ'],
  ['e', 'ᐁ'], ['i', 'ᐃ'], ['o', 'ᐅ'], ['a', 'ᐊ'],

  // Digraphs (must come before single-char finals)
  ['th', 'ᖧ'],

  // Finals (standalone consonants — no following vowel)
  ['p', 'ᑊ'], ['t', 'ᐟ'], ['k', 'ᐠ'], ['c', 'ᐨ'],
  ['m', 'ᒼ'], ['n', 'ᐣ'], ['s', 'ᐢ'], ['y', 'ᐩ'],

  // Special characters
  ['h', 'ᐦ'], ['w', 'ᐤ'], ['l', 'ᓬ'], ['r', 'ᕒ'],
];

/**
 * Convert SRO text to Cree Syllabics.
 *
 * This is a greedy left-to-right scan: at each position, try the longest
 * possible match first. Characters that don't match any pattern (spaces,
 * punctuation, numbers) pass through unchanged.
 *
 * @param {string} sro - SRO text to convert
 * @returns {string} Syllabics text
 */
function sroToSyllabics(sro) {
  const input = sro.toLowerCase();
  let result = '';
  let i = 0;

  while (i < input.length) {
    let matched = false;

    // Try longest matches first (up to 3 characters)
    for (const [from, to] of SRO_TO_SYLLABICS_MAP) {
      if (input.startsWith(from, i)) {
        result += to;
        i += from.length;
        matched = true;
        break;
      }
    }

    // No match — pass character through (space, punctuation, etc.)
    if (!matched) {
      result += input[i];
      i++;
    }
  }

  return result;
}

// -----------------------------------------------------------------
// Serbian: Latin → Cyrillic
// -----------------------------------------------------------------

const LATIN_TO_CYRILLIC_SR = {
  'lj': 'љ', 'nj': 'њ', 'dž': 'џ',
  'Lj': 'Љ', 'Nj': 'Њ', 'Dž': 'Џ',
  'LJ': 'Љ', 'NJ': 'Њ', 'DŽ': 'Џ',
  'a': 'а', 'b': 'б', 'v': 'в', 'g': 'г', 'd': 'д',
  'đ': 'ђ', 'e': 'е', 'ž': 'ж', 'z': 'з', 'i': 'и',
  'j': 'ј', 'k': 'к', 'l': 'л', 'm': 'м', 'n': 'н',
  'o': 'о', 'p': 'п', 'r': 'р', 's': 'с', 't': 'т',
  'ć': 'ћ', 'u': 'у', 'f': 'ф', 'h': 'х', 'c': 'ц',
  'č': 'ч', 'š': 'ш',
  'A': 'А', 'B': 'Б', 'V': 'В', 'G': 'Г', 'D': 'Д',
  'Đ': 'Ђ', 'E': 'Е', 'Ž': 'Ж', 'Z': 'З', 'I': 'И',
  'J': 'Ј', 'K': 'К', 'L': 'Л', 'M': 'М', 'N': 'Н',
  'O': 'О', 'P': 'П', 'R': 'Р', 'S': 'С', 'T': 'Т',
  'Ć': 'Ћ', 'U': 'У', 'F': 'Ф', 'H': 'Х', 'C': 'Ц',
  'Č': 'Ч', 'Š': 'Ш',
};

/**
 * Convert Serbian Latin text to Cyrillic.
 * Digraphs (lj, nj, dž) are matched first.
 *
 * @param {string} latin - Latin text
 * @returns {string} Cyrillic text
 */
function latinToCyrillicSr(latin) {
  let result = '';
  let i = 0;

  while (i < latin.length) {
    // Try digraphs first (2 characters)
    if (i + 1 < latin.length) {
      const digraph = latin.slice(i, i + 2);
      if (LATIN_TO_CYRILLIC_SR[digraph]) {
        result += LATIN_TO_CYRILLIC_SR[digraph];
        i += 2;
        continue;
      }
    }

    // Single character
    const ch = latin[i];
    result += LATIN_TO_CYRILLIC_SR[ch] || ch;
    i++;
  }

  return result;
}

// -----------------------------------------------------------------
// Converter Registry
// -----------------------------------------------------------------

/**
 * Registry of available script converters.
 *
 * Each entry maps a locale code to its converter configuration:
 *   - from:      source script name
 *   - to:        target script name
 *   - type:      'deterministic' (pure lookup) or 'contextual' (needs LLM)
 *   - converter: function(string) → string
 */
const SCRIPT_CONVERTERS = {
  crk: {
    from: 'SRO (Standard Roman Orthography)',
    to: 'Cree Syllabics',
    type: 'deterministic',
    converter: sroToSyllabics,
  },
  sr: {
    from: 'Latin',
    to: 'Cyrillic',
    type: 'deterministic',
    converter: latinToCyrillicSr,
  },
  // Future converters can be added here:
  // hi: { from: 'Romanized', to: 'Devanagari', type: 'deterministic', converter: ... },
  // ja: { from: 'Romaji', to: 'Hiragana', type: 'deterministic', converter: ... },
};

/**
 * Convert text using the registered converter for a locale.
 *
 * @param {string} text - Text in the source script
 * @param {string} localeCode - Locale code (e.g., "crk", "sr")
 * @returns {{ converted: string, converterUsed: string|null }} Result and converter name
 */
function convertScript(text, localeCode) {
  const converter = SCRIPT_CONVERTERS[localeCode];
  if (!converter) {
    return { converted: text, converterUsed: null };
  }

  return {
    converted: converter.converter(text),
    converterUsed: `${converter.from} → ${converter.to}`,
  };
}

/**
 * Check if a locale has a registered script converter.
 *
 * @param {string} localeCode - Locale code
 * @returns {boolean}
 */
function hasScriptConverter(localeCode) {
  return localeCode in SCRIPT_CONVERTERS;
}

/**
 * Get converter info for a locale (without the function reference).
 * Safe for serialization into config/reports.
 *
 * @param {string} localeCode - Locale code
 * @returns {object|null}
 */
function getConverterInfo(localeCode) {
  const conv = SCRIPT_CONVERTERS[localeCode];
  if (!conv) return null;
  return { from: conv.from, to: conv.to, type: conv.type };
}

export {
  sroToSyllabics,
  latinToCyrillicSr,
  convertScript,
  hasScriptConverter,
  getConverterInfo,
  SCRIPT_CONVERTERS,
};
