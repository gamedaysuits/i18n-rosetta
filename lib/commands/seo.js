/**
 * Command: seo
 *
 * Generates SEO artifacts for multilingual sites:
 *   - hreflang: <link rel="alternate" hreflang> tags
 *   - sitemap:  multilingual sitemap.xml
 *   - jsonld:   JSON-LD WebSite language schema
 */

import fs from 'node:fs';
import { resolveConfig } from '../config.js';
import { generateAllHreflangTags, generateSitemap, generateJsonLd } from '../seo.js';
import { output } from '../output.js';

async function run(args, cwd) {
  const subcommand = args._[1] || 'help';
  const config = resolveConfig(args, cwd);

  // CLI override for baseUrl
  if (args['base-url']) {
    if (!config.seo) config.seo = {};
    config.seo.baseUrl = args['base-url'];
  }

  if (subcommand === 'hreflang') {
    const result = generateAllHreflangTags(config);
    output.raw(result);
  } else if (subcommand === 'sitemap') {
    const result = generateSitemap(config);
    if (args.out) {
      fs.writeFileSync(args.out, result, 'utf-8');
      output.ok(`Sitemap written to ${args.out}`);
    } else {
      output.raw(result);
    }
  } else if (subcommand === 'jsonld') {
    const result = generateJsonLd(config);
    output.raw(result);
  } else {
    output.raw(`
  i18n-rosetta seo — Generate SEO artifacts

  SUBCOMMANDS
    hreflang      Generate <link rel="alternate" hreflang> tags
    sitemap       Generate multilingual sitemap.xml
    jsonld        Generate JSON-LD WebSite schema

  OPTIONS
    --base-url <url>   Override site base URL
    --out <path>       Write sitemap to file (sitemap subcommand only)
    `);
  }

  return 0;
}

export { run };
