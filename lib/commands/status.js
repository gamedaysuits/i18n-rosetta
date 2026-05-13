/**
 * Command: status
 *
 * Shows the translation pair graph, config summary, installed plugins,
 * and benchmark scores. A diagnostic tool for understanding how the
 * project is configured before running sync.
 */

import { resolveConfig, autoDetectLanguages } from '../config.js';
import { resolvePairs, QUALITY_TIERS } from '../pairs.js';
import { loadPlugins, resolvePluginForPair } from '../plugins.js';
import { output } from '../output.js';

async function run(args, cwd) {
  const config = resolveConfig(args, cwd);

  // Auto-detect languages if not configured
  let languages = config.resolvedLanguages;
  if (Object.keys(languages).length === 0) {
    languages = autoDetectLanguages(config);
  }
  config.resolvedLanguages = languages;

  const pairs = resolvePairs(config);

  // Load installed plugins to enrich status display
  const plugins = loadPlugins(cwd);

  output.raw('\n  i18n-rosetta v3 — Translation Status\n');
  output.raw(`  Input locale:  ${config.inputLocale}`);
  output.raw(`  Locales dir:   ${config.localesDir}`);
  output.raw(`  Default model: ${config.model}`);
  output.raw(`  Config version: ${config.version || '2 (legacy)'}`);

  // Show installed plugins summary
  if (plugins.size > 0) {
    output.raw(`  Plugins:       ${plugins.size} installed`);
  }
  output.raw('');

  if (pairs.size === 0) {
    output.raw('  No translation pairs configured.');
    output.raw('  Run `i18n-rosetta init` or add languages to your config.\n');
  } else {
    output.raw(`  Translation Pairs (${pairs.size}):\n`);
    for (const [pairKey, pairConfig] of pairs) {
      const tier = QUALITY_TIERS[pairConfig.qualityTier];
      const tierLabel = tier ? tier.label : pairConfig.qualityTier;
      const dirLabel = pairConfig.dir === 'rtl' ? ' [RTL]' : '';
      const scriptLabel = pairConfig.scripts ? ` [${pairConfig.scripts}]` : '';
      // Display arrow is a UI-only semantic element, not a data separator
      output.raw(`    ${pairKey}  →  ${pairConfig.name}${dirLabel}${scriptLabel}`);

      // Base method info — show method name and model if applicable
      const modelStr = pairConfig.method === 'api' ? '' : `  |  model: ${pairConfig.model}`;

      // Show benchmarks if plugin has them; otherwise show tier as self-reported
      let qualityStr = '';
      if (pairConfig.methodPlugin) {
        const resolvedPair = resolvePluginForPair(plugins, pairConfig);
        const benchmarks = resolvedPair.pluginBenchmarks;
        if (benchmarks && benchmarks[pairConfig.target]) {
          const bm = benchmarks[pairConfig.target];
          const parts = [];
          if (bm.corpus_chrf) parts.push(`chrF++ ${bm.corpus_chrf}`);
          if (bm.exact_match_rate) parts.push(`exact ${Math.round(bm.exact_match_rate * 100)}%`);
          qualityStr = `  |  benchmarks: ${parts.join(', ')}`;
        } else {
          qualityStr = `  |  quality: ${tierLabel} (self-reported, no benchmarks)`;
        }
      } else {
        qualityStr = `  |  quality: ${tierLabel}`;
      }
      output.raw(`      method: ${pairConfig.method}${modelStr}${qualityStr}`);

      // Plugin badge — show name and version (benchmarks already shown above)
      if (pairConfig.methodPlugin) {
        const resolvedPair = resolvePluginForPair(plugins, pairConfig);
        if (resolvedPair.pluginName) {
          let pluginLine = `      [PLUGIN] ${resolvedPair.pluginName}`;
          if (resolvedPair.pluginVersion) pluginLine += ` v${resolvedPair.pluginVersion}`;
          output.raw(pluginLine);
        }
      }

      // API badge
      if (pairConfig.method === 'api') {
        output.raw('      [API] Translation runs server-side (IP protected)');
      }

      // Google Translate badge
      if (pairConfig.method === 'google-translate') {
        output.raw('      Google Cloud Translation API');
      }
    }
    output.raw('');
  }

  return 0;
}

export { run };
