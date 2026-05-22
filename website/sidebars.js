// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docsSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: [
        'getting-started/installation',
        'getting-started/quick-start',
        'getting-started/configuration',
      ],
    },
    {
      type: 'category',
      label: 'Tutorials & Cookbooks',
      items: [
        'tutorials/build-a-plugin',
        'tutorials/translate-30-languages',
        'tutorials/hugo-multilingual-site',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      items: [
        'guides/translation-methods',
        'guides/framework-integration',
        'guides/ci-cd',
        'guides/low-resource-languages',
        'guides/content-translation',
        'guides/comparison',
        'guides/troubleshooting',
      ],
    },
    {
      type: 'category',
      label: 'Concepts',
      items: [
        'concepts/architecture',
        'concepts/how-sync-works',
        'concepts/quality-gate',
        'concepts/security',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        'reference/cli',
        'reference/plugin-spec',
      ],
    },
    {
      type: 'category',
      label: 'Evaluation',
      items: [
        'eval/index',
        'eval/harness',
        'eval/datasets',
        'eval/run-card',
      ],
    },
  ],
};

export default sidebars;
