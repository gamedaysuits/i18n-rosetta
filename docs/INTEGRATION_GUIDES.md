# Integration Guides

Step-by-step setup for i18n-rosetta with popular frameworks.

---

## Hugo (TOML / YAML / Markdown)

### Project structure

Hugo uses `i18n/` for string translations and `content/` for page content:

```
my-hugo-site/
├── i18n/
│   ├── en.toml             ← source of truth
│   ├── fr.toml
│   └── ja.toml
├── content/
│   ├── posts/
│   │   ├── hello.md        ← source (English)
│   │   ├── hello.fr.md
│   │   └── hello.ja.md
│   └── about.md
└── .env.local
```

### Setup

```bash
npm install --save-dev i18n-rosetta
```

```bash
# .env.local
OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

Create `i18n-rosetta.config.json`:

```json
{
  "version": 3,
  "inputLocale": "en",
  "localesDir": "./i18n",
  "contentDir": "./content",
  "format": "auto",
  "languages": ["fr", "de", "ja", "es", "ko", "zh"]
}
```

```bash
i18n-rosetta sync           # sync i18n string files + content files
i18n-rosetta sync --dry     # preview changes without writing
```

### Content translation details

**Front matter**: Supports both YAML (`---`) and TOML (`+++`) delimiters. Translates `title`, `description`, `summary`, `subtitle`, `caption`, and `linkTitle` by default. All other fields (date, draft, tags, weight, slug, etc.) are preserved. Customize with `translatableFields` in your config.

**Block protection**: Code blocks, Hugo shortcodes (`{{< >}}`, `{{% %}}`), inline code, and raw HTML are automatically shielded using Unicode sentinel placeholders. They pass through untouched.

**Filename convention**: Follows Hugo's translation-by-filename pattern:
- `my-post.md` → `my-post.fr.md`
- `my-post.en.md` → `my-post.fr.md` (strips source suffix)

**Skip existing**: Existing translated files are never overwritten. Delete a target file to force re-translation.

### Plural forms

TOML and YAML locales support CLDR plural forms:

```toml
[items]
one = "{{ .Count }} item"
other = "{{ .Count }} items"
```

Internally represented as `items.one` and `items.other` for diffing, then re-serialized to the correct sectioned format on write.

---

## next-intl (JSON)

### Project structure

```
my-app/
├── messages/
│   └── en.json        ← source of truth
├── src/
│   ├── i18n/
│   │   ├── routing.ts
│   │   └── request.ts
│   └── middleware.ts
└── .env.local
```

### Setup

```bash
npm install --save-dev i18n-rosetta
```

Create `i18n-rosetta.config.json`:

```json
{
  "version": 3,
  "inputLocale": "en",
  "localesDir": "./messages",
  "languages": ["fr", "de", "ja", "es", "ko", "zh", "pt", "ar"]
}
```

```bash
npx i18n-rosetta sync
```

Creates `messages/fr.json`, `messages/ja.json`, etc. — fully translated, preserving your nested key structure. next-intl picks them up automatically.

### Development workflow

```json
{
  "scripts": {
    "dev": "i18n-rosetta watch & next dev",
    "i18n:sync": "i18n-rosetta sync",
    "i18n:audit": "i18n-rosetta audit"
  }
}
```

---

## react-i18next (JSON)

### Flat file structure (recommended)

```
locales/
├── en.json
├── fr.json
└── ja.json
```

```json
{
  "version": 3,
  "inputLocale": "en",
  "localesDir": "./locales",
  "languages": ["fr", "de", "ja"]
}
```

### Nested directory structure

If you use the `{locale}/{namespace}.json` structure, create a sync script to flatten → translate → unflatten. See the [react-i18next docs](https://react.i18next.com/) for details.
