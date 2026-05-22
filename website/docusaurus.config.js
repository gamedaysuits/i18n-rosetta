// @ts-check

import {themes as prismThemes} from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'i18n-rosetta',
  tagline: 'Translate your locale files with one command',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  // Production URL — Vercel + custom domain
  url: 'https://i18n-rosetta.com',
  baseUrl: '/',
  trailingSlash: false,

  // GitHub coordinates for "Edit this page" links
  organizationName: 'gamedaysuits',
  projectName: 'i18n-rosetta',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'fr', 'es', 'de', 'ja', 'zh', 'ar', 'tlh'],
    localeConfigs: {
      en: { label: 'English' },
      fr: { label: 'Français' },
      es: { label: 'Español' },
      de: { label: 'Deutsch' },
      ja: { label: '日本語' },
      zh: { label: '简体中文' },
      ar: { label: 'العربية', direction: 'rtl' },
      tlh: { label: 'tlhIngan Hol' },
    },
  },

  // Enable Mermaid diagrams in Markdown
  markdown: {
    mermaid: true,
    format: 'detect',
  },
  themes: [
    '@docusaurus/theme-mermaid',
    ['@easyops-cn/docusaurus-search-local', {
      hashed: true,
      indexBlog: true,
      docsRouteBasePath: '/docs',
    }],
  ],

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          editUrl: 'https://github.com/gamedaysuits/i18n-rosetta/tree/main/website/',
          // Versioning — snapshot current docs as a version
          lastVersion: 'current',
          versions: {
            current: {
              label: '3.2.0',
              path: '',
            },
          },
        },
        blog: {
          showReadingTime: true,
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },
          editUrl: 'https://github.com/gamedaysuits/i18n-rosetta/tree/main/website/',
          blogTitle: 'i18n-rosetta Blog',
          blogDescription: 'Release notes, technical deep-dives, and translation engineering insights.',
          onInlineTags: 'warn',
          onInlineAuthors: 'warn',
          onUntruncatedBlogPosts: 'warn',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/rosetta-social-card.png',

      colorMode: {
        defaultMode: 'dark',
        respectPrefersColorScheme: true,
      },

      navbar: {
        title: 'i18n-rosetta',
        // logo: {
        //   alt: 'i18n-rosetta',
        //   src: 'img/logo.svg',
        // },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'docsSidebar',
            position: 'left',
            label: 'Docs',
          },
          {to: '/blog', label: 'Blog', position: 'left'},
          {to: '/docs/eval', label: 'Eval', position: 'left'},
          {to: '/leaderboard', label: 'Leaderboard', position: 'left'},
          {
            type: 'docsVersionDropdown',
            position: 'right',
          },
          {
            href: 'https://www.npmjs.com/package/i18n-rosetta',
            label: 'npm',
            position: 'right',
          },
          {
            href: 'https://github.com/gamedaysuits/i18n-rosetta',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },

      footer: {
        style: 'dark',
        links: [
          {
            title: 'Documentation',
            items: [
              {
                label: 'Getting Started',
                to: '/docs/getting-started/installation',
              },
              {
                label: 'CLI Reference',
                to: '/docs/reference/cli',
              },
              {
                label: 'Plugin Spec',
                to: '/docs/reference/plugin-spec',
              },
            ],
          },
          {
            title: 'Learn',
            items: [
              {
                label: 'Build a Plugin',
                to: '/docs/tutorials/build-a-plugin',
              },
              {
                label: 'Translate 30 Languages',
                to: '/docs/tutorials/translate-30-languages',
              },
              {
                label: 'Translation Methods',
                to: '/docs/guides/translation-methods',
              },
              {
                label: 'Troubleshooting',
                to: '/docs/guides/troubleshooting',
              },
            ],
          },
          {
            title: 'More',
            items: [
              {
                label: 'Blog',
                to: '/blog',
              },
              {
                label: 'Leaderboard',
                to: '/leaderboard',
              },
              {
                label: 'GitHub',
                href: 'https://github.com/gamedaysuits/i18n-rosetta',
              },
              {
                label: 'npm',
                href: 'https://www.npmjs.com/package/i18n-rosetta',
              },
              {
                label: 'Eval Harness',
                href: 'https://github.com/gamedaysuits/gds-mt-eval-harness',
              },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} Curtis Forbes. Built with Docusaurus.`,
      },

      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
        additionalLanguages: ['bash', 'json', 'toml', 'yaml', 'python'],
        magicComments: [
          {
            className: 'theme-code-block-highlighted-line',
            line: 'highlight-next-line',
            block: {start: 'highlight-start', end: 'highlight-end'},
          },
        ],
      },

      // Mermaid theme configuration
      mermaid: {
        theme: {light: 'neutral', dark: 'dark'},
      },
    }),
};

export default config;
