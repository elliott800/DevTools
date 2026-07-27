# DevTools — one local server for every site

A **zero-dependency** launcher that serves any website in this folder for local
testing. It auto-detects how each site should run and starts the right server —
so your site repos stay clean (no `node_modules`, no per-project dev tooling).

DevTools itself installs nothing: `serve.js` uses only Node built-ins and shells
out to `php` / `python -m uvicorn` when a site needs them.

```
websites/
├── DevTools/            ← this folder (the tools)
│   ├── serve.js         ← the launcher (zero deps)
│   ├── serve.ps1        ← PowerShell wrapper
│   ├── serve.cmd        ← cmd wrapper
│   ├── config.json      ← machine config (php path, ports, …)
│   └── templates/       ← .gitignore + site.config.json samples
├── www.test.com/        ← a site
├── www.place_holder.com/
└── …
```

## Quick start

From inside `DevTools/`:

```powershell
node serve.js www.test.com        # serve a site (auto-detects type, opens browser)
node serve.js test                # fuzzy match — same thing
node serve.js --list              # list every site and its detected type
```

Or use the wrappers so you can drop the `node`:

```powershell
.\serve.ps1 www.test.com          # PowerShell
serve www.test.com                # cmd  (serve.cmd)
```

## One process, many sites

DevTools serves every site out of a **single process**. The first site you
serve opens a dedicated "DevTools" terminal window and stays running there;
every site you serve after that — from any terminal, at any time — is
handed to that same window's process instead of starting a new one:

```powershell
node serve.js www.test.com          # opens the DevTools window, serves this site
node serve.js www.place_holder.com  # picked up by the same window, no new process
node serve.js siteA siteB           # serve several sites in one call
node serve.js --list                # shows which sites are currently running + their URLs
node serve.js --stop                # stop everything (or Ctrl+C in the DevTools window)
node serve.js --stop siteA          # stop just one site, leave the rest running
```

Under the hood, invocations talk to the running DevTools process over a
loopback control port (`controlPort` in `config.json`, default `47913`).

## Supported site types (auto-detected)

| Type      | Detected when the folder has…            | Runs                              |
|-----------|------------------------------------------|-----------------------------------|
| `static`  | (anything else — plain HTML/CSS/JS)      | built-in file server + live reload |
| `php`     | `index.php` or any `*.php`               | `php -S` (uses `router.php` if present) |
| `nodejs`  | `package.json`                           | `npm start`, else `node --watch <main>` |
| `fastapi` | `requirements.txt`, `main.py`, or `app.py` | `python -m uvicorn <app> --reload` |

Detection is overridable — see **Per-site config** below, or pass `--type`.

## Options

```
node serve.js <site> [options]

  -p, --port <n>    Override the port
  -t, --type <t>    Force type: static | php | nodejs | fastapi
      --host <h>    Bind host (default 127.0.0.1)
      --no-open     Don't open the browser
      --no-reload   Disable live reload (static sites)
  -l, --list        List all sites and their detected types
      --init        Scaffold site.config.json + .gitignore into <site>, then exit
  -h, --help        Show help
```

`<site>` may be a folder name (fuzzy-matched under the websites root) or a path.
If the default port is busy, the next free port is chosen automatically.

### Default ports

`static` → 5500 · `php` → 8080 · `nodejs` → 3000 · `fastapi` → 8000
(change them in `config.json`).

## Keeping repos clean

Before committing a new site, scaffold a good ignore file and (optional) config:

```powershell
node serve.js my-site --init
```

This drops a `.gitignore` (ignoring `node_modules/`, `.venv/`, build output,
`*.db-wal`, deploy zips, logs, secrets…) and a `site.config.json` into the site.
The template lives in [templates/site.gitignore](templates/site.gitignore).

## Per-site config (optional)

Drop a `site.config.json` in a site folder to override anything. All keys are
optional — see [templates/site.config.sample.json](templates/site.config.sample.json).

```json
{
  "type": "fastapi",
  "port": 8100,
  "env": { "SECRET_KEY": "dev-only" },
  "app": "main:app",
  "start_command": null
}
```

- **type** — force the site type instead of auto-detecting.
- **port** — preferred port for this site.
- **env** — environment variables passed to the server process.
- **app** — FastAPI/ASGI target (e.g. `main:app`). Auto-detected if omitted.
- **router** — PHP router script. Auto-uses `router.php` if present.
- **start_command** — nodejs/fastapi: run this exact command instead of the default.

## Machine config — `config.json`

Set once per machine if auto-detection needs help:

```json
{
  "websitesRoot": "..",
  "phpPath": "C:\\xampp\\php\\php.exe",
  "pythonPath": null,
  "defaultPorts": { "static": 5500, "php": 8080, "nodejs": 3000, "fastapi": 8000 }
}
```

`phpPath` / `pythonPath` are only needed if the binaries aren't on `PATH`.
PHP is auto-found at `C:\xampp\php\php.exe` and similar common spots.

## Notes on dependencies

- **static / php** need nothing beyond the runtime — truly zero project deps.
- **nodejs** works dependency-free when a site uses only Node built-ins
  (`node:http`, `node:sqlite`, `node:crypto`, …). If a site lists real npm
  dependencies you'll still `npm install` in *that* site, but DevTools never
  adds tooling of its own.
- **fastapi** uses the Python on your `PATH`; `uvicorn` must be installed there
  (`pip install uvicorn`). Extra requirements install into your Python env.

## PostgreSQL

PostgreSQL 17 is installed natively (via winget) as the `postgresql-x64-17`
Windows service, listening on `127.0.0.1:5432`. It starts automatically with
Windows, so it's always up whenever DevTools needs it.

Local credentials live in `DevTools/.pg-credentials.json` (git-ignored, never
committed):

- `postgres` — superuser, for admin tasks (creating roles/databases).
- `devtools` / database `devtools_dev` — a regular, low-privilege role
  (with `CREATEDB`) meant for day-to-day site development.
- `connectionString` — a ready-to-use `postgresql://…` URL for the `devtools` role.

To give a site its own database, connect as `postgres` and `CREATE DATABASE
<name> OWNER devtools`, then point that site's `site.config.json` `env` at it:

```json
{ "env": { "DATABASE_URL": "postgresql://devtools:<devPassword>@127.0.0.1:5432/<name>" } }
```

`psql` isn't on `PATH` — run it as `"C:\Program Files\PostgreSQL\17\bin\psql.exe"`,
or add that folder to `PATH` yourself if you want it available everywhere.

## Requirements

- Node.js ≥ 18 (tested on v26)
- PHP — only for PHP sites (XAMPP is fine)
- Python + uvicorn — only for FastAPI sites
- PostgreSQL 17 — installed and running as a Windows service; see above
