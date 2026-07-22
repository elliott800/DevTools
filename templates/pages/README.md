# Page templates

Drop-in, **self-contained** page templates. Each is a single HTML file with all
CSS and JS inline — zero dependencies, no build step, works offline (webfonts
enhance when online and fall back to system serifs/sans otherwise). They share
one design language (warm editorial: cream canvas, ink type, terracotta accent,
Fraunces display serif) so they read as a set.

| File | What it is |
|------|------------|
| [landing-page.html](landing-page.html) | Marketing landing page — sticky nav, hero, ticker, features, case-study split, stats, CTA band, footer. Staggered load animation. |
| [product-tiles.html](product-tiles.html) | Product / icon tile grid driven by a **mark LUT** (see below), with category filtering. |

## Preview them

From `DevTools/`, point the launcher at a template (or the folder):

```powershell
node serve.js templates/pages --no-reload        # directory listing → pick a file
node serve.js templates/pages/landing-page.html  # (serve the pages folder, open the file)
```

Or copy one into a site as its `index.html`:

```powershell
copy templates\pages\landing-page.html ..\www.example.com\index.html
node serve.js www.example.com
```

## The "mark LUT" (product-tiles.html)

A **mark LUT** (look-up table) maps each category to its *mark* — the visual
encoding a tile uses: an accent **colour**, an **icon**, and a display **label**.
Tiles never hard-code their look; they read it from the table. Change the table,
and every tile in that category re-skins at once.

```js
const MARK_LUT = {
  analytics: { label:'Analytics', color:'#c0553d', icon:'<path d="M4 20V10 …"/>' },
  security:  { label:'Security',  color:'#2f6f5e', icon:'<path d="M12 3l7 3 …"/>' },
  // add a category = add an entry (icons are 24×24 stroke SVG innards)
};

const PRODUCTS = [
  { name:'Pulse', cat:'analytics', meta:'$12/mo', desc:'Real-time dashboards …' },
  // cat must be a key in MARK_LUT
];
```

Everything else derives automatically:

- the **filter chips** are generated from `MARK_LUT` keys,
- each tile's accent bar, icon tint, and tag colour come from its category's `color`,
- the icon comes from the category's `icon`.

To repurpose: replace the two blocks at the top of the `<script>`. To rebrand
the palette globally, edit the `:root` CSS variables at the top of the file.
