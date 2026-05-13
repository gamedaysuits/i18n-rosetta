/**
 * Default language registers — tone/style instructions for the LLM.
 *
 * Users can override any register in their config. These defaults
 * cover 35+ languages with sensible professional tones.
 *
 * WHY: Different languages have culturally appropriate registers.
 * A German business site needs formal Sie-form, while a Taglish
 * site needs the English-Tagalog code-switching that educated
 * Manila speakers actually use. The register instruction steers
 * the LLM toward natural, culturally-appropriate output.
 *
 * ORDER: Languages are listed in the order the project recommends
 * for accessibility and global reach, not alphabetically.
 */

const DEFAULT_REGISTERS = {
  // --- Priority languages (accessibility-first order) ---
  ar: { name: 'Arabic', dir: 'rtl', register: 'Modern Standard Arabic (فصحى). Right-to-left script. Formal professional register. Ensure text reads naturally in RTL layout contexts.' },
  tl: { name: 'Filipino (Taglish)', register: 'Educated Manila Taglish. Use Tagalog as the primary language but keep technical terms, UI labels, and business terminology in English. This code-switching style reflects how educated Filipino professionals actually communicate in digital products. Professional but approachable.' },
  fr: { name: 'French', register: 'Formal French. Use vous-form. Professional/academic register. When gender is unknown, prefer inclusive forms (e.g., "Connecté·e" over "Connecté").' },
  es: { name: 'Spanish', register: 'Neutral Latin American Spanish. Professional register. Avoid region-specific slang. When gender is unknown, prefer gender-neutral alternatives (e.g., "usuario/a" or rephrase to avoid gendered forms).' },
  de: { name: 'German', register: 'Standard professional register. Use Sie-form for formal address. When gender is unknown, prefer gender-inclusive forms (e.g., Benutzer:innen) or neutral rephrasing.' },
  ja: { name: 'Japanese', register: 'Polite professional register (です/ます form) for body text and descriptions. For short UI elements like button labels and navigation items, plain form (する) is acceptable. Use appropriate kanji with furigana consideration.' },
  zh: { name: 'Chinese (Simplified)', register: 'Simplified Chinese (简体中文). Professional register. Use concise phrasing appropriate for UI contexts.' },
  it: { name: 'Italian', register: 'Standard Italian. Professional register with Lei-form. When gender is unknown, prefer inclusive alternatives or rephrase to avoid gendered forms.' },
  pt: { name: 'Portuguese', register: 'Brazilian Portuguese. Professional register. When gender is unknown, prefer gender-neutral alternatives.' },
  ko: { name: 'Korean', register: 'Formal Korean (합쇼체). Professional register.' },

  // --- Major world languages ---
  bn: { name: 'Bengali', register: 'Standard Bangla. Professional register with শুদ্ধ ভাষা preference.' },
  bg: { name: 'Bulgarian', register: 'Standard Bulgarian. Professional register.' },
  crk: { name: 'Plains Cree', scripts: 'crk', register: 'nêhiyawêwin (Plains Cree). Use SRO (Standard Roman Orthography) as the working script. Output will be converted to Syllabics via deterministic converter. Professional register appropriate for educational and community contexts.' },
  cs: { name: 'Czech', register: 'Standard Czech. Professional register with vykání (vy-form).' },
  da: { name: 'Danish', register: 'Standard Danish. Professional register with De-form where appropriate.' },
  el: { name: 'Greek', register: 'Modern Greek (Δημοτική). Professional register.' },
  fa: { name: 'Persian', dir: 'rtl', register: 'Formal Persian (فارسی). Right-to-left script. Professional register. Ensure text reads naturally in RTL layout contexts.' },
  fi: { name: 'Finnish', register: 'Standard Finnish. Professional register. Finnish has no grammatical gender — use naturally.' },
  he: { name: 'Hebrew', dir: 'rtl', register: 'Modern Hebrew. Right-to-left script. Professional register. Ensure text reads naturally in RTL layout contexts. When gender is unknown, prefer masculine-default or rephrase neutrally.' },
  hi: { name: 'Hindi', register: 'Formal Hindi (शुद्ध हिन्दी). Professional register. Minimize English loanwords.' },
  hu: { name: 'Hungarian', register: 'Standard Hungarian. Professional register with ön-form.' },
  id: { name: 'Indonesian', register: 'Formal Bahasa Indonesia. Professional register.' },
  ms: { name: 'Malay', register: 'Formal Bahasa Melayu. Professional register.' },
  nl: { name: 'Dutch', register: 'Standard Dutch. Professional register with u-form.' },
  no: { name: 'Norwegian', register: 'Bokmål. Professional register.' },
  pl: { name: 'Polish', register: 'Standard Polish. Professional register with Pan/Pani form.' },
  'pt-PT': { name: 'European Portuguese', register: 'European Portuguese. Professional register.' },
  ro: { name: 'Romanian', register: 'Standard Romanian. Professional register.' },
  ru: { name: 'Russian', register: 'Standard Russian. Professional register with вы-form.' },
  sk: { name: 'Slovak', register: 'Standard Slovak. Professional register with vykanie (vy-form).' },
  sr: { name: 'Serbian', scripts: 'sr', register: 'Standard Serbian. Professional register. Output in Latin script (converted to Cyrillic via deterministic converter when needed).' },
  sv: { name: 'Swedish', register: 'Standard Swedish. Professional register.' },
  sw: { name: 'Swahili', register: 'Standard Swahili. Professional register.' },
  th: { name: 'Thai', register: 'Formal Thai. Professional register with ครับ/ค่ะ politeness particles.' },
  tr: { name: 'Turkish', register: 'Standard Turkish. Professional register with siz-form.' },
  uk: { name: 'Ukrainian', register: 'Standard Ukrainian. Professional register with ви-form.' },
  ur: { name: 'Urdu', dir: 'rtl', register: 'Formal Urdu. Right-to-left script. Professional register with آپ form. Ensure text reads naturally in RTL layout contexts.' },
  vi: { name: 'Vietnamese', register: 'Formal Vietnamese. Professional register.' },
  'zh-TW': { name: 'Chinese (Traditional)', register: 'Traditional Chinese (繁體中文). Professional register.' },

  // --- Regional / code-switching variants ---
  'es-MX': { name: 'Mexican Spanish', register: 'Mexican Spanish. Professional but warm register. Use tú-form.' },
  'fr-CA': { name: 'Canadian French', register: 'Québécois French. Professional register with local idioms.' },

  // --- Constructed / novelty languages ---
  tlh: { name: 'Klingon', register: "Warrior's honor. OVS grammar. Use Marc Okrand vocabulary from The Klingon Dictionary. No weakness." },
  'x-elvish-s': { name: 'Sindarin (Tolkien Elvish)', register: 'Wise, ancient, Grey-elven register. Use Tolkien Sindarin vocabulary. Elegant compound words.' },
  'x-pirate': { name: 'Pirate English', register: 'Nautical metaphors. "Arr", "ye", "matey". money→doubloons, boss→captain, website→ship.' },
  'x-kryptonian': { name: 'Kryptonian', register: 'Formal Kryptonian. Use established fan lexicon where possible. Scientific/noble tone.' },
  'x-shakespeare': { name: 'Shakespearean English', register: 'Early Modern English. Thee/thou, -eth/-est verb forms. Poetic and dramatic.' },
  'x-yoda': { name: 'Yoda-speak', register: 'Invert to OSV word order. Wise and cryptic. "Strong with this one, the Force is."' },
};

export { DEFAULT_REGISTERS };
