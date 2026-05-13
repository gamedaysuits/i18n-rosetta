/**
 * Provenance & Licensing Registry — tracks resource dependencies per method.
 *
 * WHY: When i18n-rosetta is used commercially, users need to know if
 * their translation pipeline depends on proprietary datasets or tools.
 * This registry makes those dependencies explicit and flaggable.
 *
 * Each translation method declares its resource dependencies:
 *   - name:    Human-readable resource name
 *   - license: SPDX license identifier or "PROPRIETARY"
 *   - owner:   Organization/person that owns the resource
 *   - status:  "clear" (licensed/open), "pending-agreement", or "restricted"
 *   - url:     Link to resource or license info (optional)
 *
 * The CLI surfaces provenance warnings when a pair uses a method with
 * non-commercial resources: "[WARN] This pair uses PROPRIETARY resources"
 */

/**
 * Registry of resource dependencies per translation method.
 *
 * Methods not listed here are assumed to have no external dependencies
 * (i.e., they only use the LLM API, which is covered by the user's
 * own API key and ToS).
 */
const METHOD_PROVENANCE = {
  llm: {
    resources: [],
    commercialReady: true,
    flags: [],
  },

  'llm-coached': {
    resources: [],
    commercialReady: true,
    flags: [],
  },

  'google-translate': {
    resources: [
      {
        name: 'Google Cloud Translation API',
        license: 'Google Cloud ToS',
        owner: 'Google',
        status: 'clear',
        url: 'https://cloud.google.com/translate/docs',
      },
    ],
    commercialReady: true,
    flags: [],
  },

  api: {
    resources: [
      {
        name: 'Remote Translation API',
        license: 'Provider ToS',
        owner: 'API provider',
        status: 'clear',
        url: '',
      },
    ],
    commercialReady: true,
    flags: [],
  },

  'fst-gated': {
    resources: [
      {
        name: 'Plains Cree FST (GiellaLT)',
        license: 'LGPL-3.0',
        owner: 'ALTLab / GiellaLT',
        status: 'clear',
        url: 'https://github.com/giellalt/lang-crk',
      },
      {
        name: 'Wolvengrey Cree Dictionary',
        license: 'PROPRIETARY',
        owner: 'University of Alberta / ALTLab',
        status: 'pending-agreement',
        url: 'https://altlab.ualberta.ca/',
      },
    ],
    commercialReady: false,
    flags: ['PROPRIETARY_DATASET'],
  },

  'human-review': {
    resources: [],
    commercialReady: true,
    flags: ['REQUIRES_HUMAN'],
  },
};

/**
 * Get provenance info for a translation method.
 *
 * @param {string} methodName - Method name (e.g., "llm", "fst-gated")
 * @returns {object} Provenance info with resources, commercialReady, flags
 */
function getProvenance(methodName) {
  return METHOD_PROVENANCE[methodName] || {
    resources: [],
    commercialReady: true,
    flags: [],
  };
}

/**
 * Check if a method is cleared for commercial use.
 *
 * @param {string} methodName - Method name
 * @returns {boolean}
 */
function isCommercialReady(methodName) {
  const prov = getProvenance(methodName);
  return prov.commercialReady;
}

/**
 * Get all provenance flags for a set of pairs.
 * Aggregates flags across all methods used in the pair graph.
 *
 * Checks TWO sources per pair:
 *   1. The static METHOD_PROVENANCE registry (by method name)
 *   2. The plugin's own provenance declaration (pairConfig.pluginProvenance)
 * Either source can flag a pair as non-commercial.
 *
 * @param {Map<string, object>} pairs - Pair graph from pairs.js
 * @returns {{ flags: string[], blockedPairs: string[], allClear: boolean }}
 */
function auditProvenance(pairs) {
  const allFlags = new Set();
  const blockedPairs = [];

  for (const [pairKey, pairConfig] of pairs) {
    let isBlocked = false;

    // Check 1: static METHOD_PROVENANCE registry by method name
    const methodProv = getProvenance(pairConfig.method);
    for (const flag of methodProv.flags) {
      allFlags.add(flag);
    }
    if (!methodProv.commercialReady) {
      isBlocked = true;
    }

    // Check 2: plugin's own provenance declaration (from manifest)
    // A plugin can carry licensing info that the static registry doesn't
    // know about — e.g., a coached plugin using proprietary coaching data.
    const pluginProv = pairConfig.pluginProvenance;
    if (pluginProv && typeof pluginProv === 'object') {
      if (Array.isArray(pluginProv.flags)) {
        for (const flag of pluginProv.flags) {
          allFlags.add(flag);
        }
      }
      if (pluginProv.commercialReady === false) {
        isBlocked = true;
      }
    }

    if (isBlocked) {
      blockedPairs.push(pairKey);
    }
  }

  return {
    flags: [...allFlags],
    blockedPairs,
    allClear: blockedPairs.length === 0,
  };
}

/**
 * Format a provenance report for CLI output.
 *
 * @param {Map<string, object>} pairs - Pair graph
 * @returns {string} Formatted report
 */
function formatProvenanceReport(pairs) {
  const audit = auditProvenance(pairs);
  const lines = [];

  if (audit.allClear) {
    lines.push('[OK] All translation pairs are cleared for commercial use.\n');
    return lines.join('\n');
  }

  lines.push('[WARN] PROVENANCE WARNINGS\n');

  for (const pairKey of audit.blockedPairs) {
    const pairConfig = pairs.get(pairKey);
    const prov = getProvenance(pairConfig.method);

    lines.push(`  ${pairKey} (method: ${pairConfig.method})`);
    for (const resource of prov.resources) {
      const statusIcon = resource.status === 'clear' ? '[OK]' : '[RESTRICTED]';
      lines.push(`    ${statusIcon} ${resource.name} — ${resource.license} (${resource.status})`);
      if (resource.url) {
        lines.push(`       ${resource.url}`);
      }
    }
    lines.push('');
  }

  if (audit.flags.includes('PROPRIETARY_DATASET')) {
    lines.push('  [WARN] One or more pairs depend on PROPRIETARY datasets.');
    lines.push('     Commercial use requires licensing agreements with the resource owners.');
    lines.push('');
  }

  return lines.join('\n');
}

export {
  METHOD_PROVENANCE,
  getProvenance,
  isCommercialReady,
  auditProvenance,
  formatProvenanceReport,
};
