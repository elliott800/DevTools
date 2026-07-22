# Vendored libraries

Local copies of common front-end libraries so sites can use them **without npm,
without a CDN, and fully offline** — the same clean-repo goal as the rest of
DevTools. Reference them with a plain `<script>` / `<link>`; there is no build
step and nothing to install.

## What's here

| Library | Version | Files | License |
|---------|---------|-------|---------|
| **Bootstrap** | 5.3.3 | `bootstrap/bootstrap.min.css`, `bootstrap/bootstrap.bundle.min.js` | MIT |
| **jQuery** | 3.7.1 | `jquery/jquery.min.js` | MIT |
| **React** | 18.3.1 | `react/react.production.min.js`, `react/react-dom.production.min.js` (UMD) | MIT |
| **Babel standalone** | 7.26.4 | `react/babel.min.js` (in-browser JSX, dev only) | MIT |
| **Chart.js** | 4.4.3 | `chartjs/chart.umd.min.js` | MIT |

All MIT-licensed and safe to redistribute. React 18 UMD builds are used on
purpose — they work from a `<script>` tag (React 19 dropped UMD).

## Starters

Working examples live in [`../starters/`](../starters/), one per library:
`bootstrap-starter.html`, `jquery-starter.html`, `react-starter.html`,
`chartjs-starter.html`. They reference these files via `../vendor/…`.

Preview them from `DevTools/` — **serve the `templates/` folder** so both
`starters/` and `vendor/` sit under the server root:

```powershell
node serve.js templates          # then open /starters/bootstrap-starter.html
```

## Using a library in your own site

```html
<!-- Bootstrap -->
<link rel="stylesheet" href="vendor/bootstrap/bootstrap.min.css">
<script src="vendor/bootstrap/bootstrap.bundle.min.js"></script>

<!-- jQuery -->
<script src="vendor/jquery/jquery.min.js"></script>

<!-- Chart.js -->
<script src="vendor/chartjs/chart.umd.min.js"></script>

<!-- React (no build; JSX compiled in-browser by Babel — prototyping only) -->
<script src="vendor/react/react.production.min.js"></script>
<script src="vendor/react/react-dom.production.min.js"></script>
<script src="vendor/react/babel.min.js"></script>
<script type="text/babel"> /* your JSX */ </script>
```

Copy the `vendor/` folder into your site and adjust the paths (drop the `../`),
or serve everything under a shared root. Since these files are committed once
here, your individual site repos stay lean.

### On React + Babel

`babel.min.js` (~2.9 MB) compiles JSX in the browser. That's perfect for quick
prototypes but **not** for production — for a real React app, use a proper build
(Vite/esbuild) and drop Babel-standalone. The React runtime files themselves are
tiny and production-fine.

## Updating a library

Re-download the single file from a CDN, e.g.:

```bash
curl -Lf -o jquery/jquery.min.js https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js
curl -Lf -o chartjs/chart.umd.min.js https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js
```

Then bump the version in the table above.
