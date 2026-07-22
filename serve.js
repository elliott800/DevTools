#!/usr/bin/env node
'use strict';

/*
 * DevTools — zero-dependency local dev server launcher.
 *
 * One command to serve any website in the parent folder, auto-detecting how it
 * should be served. Nothing here needs `npm install`: it uses only Node
 * built-ins and shells out to `php` / `python -m uvicorn` for those stacks.
 *
 *   node serve.js <site> [options]
 *
 * Site types (auto-detected, override with site.config.json "type" or --type):
 *   static   — plain HTML/CSS/JS         → built-in file server (+ live reload)
 *   php      — has *.php / index.php      → php -S ...
 *   nodejs   — has package.json           → npm start / node <main>
 *   fastapi  — has requirements.txt/main.py with FastAPI → python -m uvicorn
 *
 * See README.md for full usage.
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');

const DEVTOOLS_DIR = __dirname;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = {
  // Root folder that holds all the site folders. Defaults to DevTools' parent.
  websitesRoot: path.resolve(DEVTOOLS_DIR, '..'),
  host: '127.0.0.1',
  openBrowser: true,
  liveReload: true,
  defaultPorts: { static: 5500, php: 8080, nodejs: 3000, fastapi: 8000 },
  // Explicit binary paths (leave null to auto-detect from PATH / common spots).
  phpPath: null,
  pythonPath: null,
  // Folder names to skip when listing sites.
  ignoreDirs: ['DevTools', 'node_modules', '.git'],
};

function loadConfig() {
  const cfgPath = path.join(DEVTOOLS_DIR, 'config.json');
  let fileCfg = {};
  if (fs.existsSync(cfgPath)) {
    try {
      fileCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    } catch (err) {
      warn(`config.json is not valid JSON, ignoring it: ${err.message}`);
    }
  }
  const cfg = { ...DEFAULT_CONFIG, ...fileCfg };
  cfg.defaultPorts = { ...DEFAULT_CONFIG.defaultPorts, ...(fileCfg.defaultPorts || {}) };
  if (fileCfg.websitesRoot) cfg.websitesRoot = path.resolve(DEVTOOLS_DIR, fileCfg.websitesRoot);
  return cfg;
}

// ---------------------------------------------------------------------------
// Small logging helpers
// ---------------------------------------------------------------------------

const c = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', cyan: '\x1b[36m',
};
const info = (m) => console.log(`${c.cyan}›${c.reset} ${m}`);
const ok = (m) => console.log(`${c.green}✓${c.reset} ${m}`);
const warn = (m) => console.warn(`${c.yellow}!${c.reset} ${m}`);
const fail = (m) => console.error(`${c.red}✗${c.reset} ${m}`);

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { _: [], open: null, reload: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-h': case '--help': opts.help = true; break;
      case '-l': case '--list': opts.list = true; break;
      case '--init': opts.init = true; break;
      case '--no-open': opts.open = false; break;
      case '--no-reload': opts.reload = false; break;
      case '-p': case '--port': opts.port = Number(argv[++i]); break;
      case '-t': case '--type': opts.type = argv[++i]; break;
      case '--host': opts.host = argv[++i]; break;
      default:
        if (a.startsWith('--port=')) opts.port = Number(a.slice(7));
        else if (a.startsWith('--type=')) opts.type = a.slice(7);
        else if (a.startsWith('--host=')) opts.host = a.slice(7);
        else if (a.startsWith('-')) warn(`Unknown option: ${a}`);
        else opts._.push(a);
    }
  }
  return opts;
}

const HELP = `${c.bold}DevTools — local dev server launcher${c.reset}

  ${c.cyan}node serve.js <site> [options]${c.reset}

<site> is a folder name under the websites root (fuzzy matched) or a path.

Options:
  -p, --port <n>    Override the port
  -t, --type <t>    Force type: static | php | nodejs | fastapi
      --host <h>    Bind host (default 127.0.0.1)
      --no-open     Don't open the browser
      --no-reload   Disable live reload (static sites)
  -l, --list        List all sites and their detected types
      --init        Scaffold site.config.json + .gitignore into <site>, then exit
  -h, --help        Show this help

Examples:
  node serve.js www.test.com
  node serve.js test                 # fuzzy match
  node serve.js hearts --port 4000
  node serve.js www.place_holder.com --type php
  node serve.js --list
  node serve.js www.test.com --init
`;

// ---------------------------------------------------------------------------
// Site resolution & type detection
// ---------------------------------------------------------------------------

function listSiteDirs(cfg) {
  return fs.readdirSync(cfg.websitesRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !cfg.ignoreDirs.includes(d.name))
    .map((d) => d.name);
}

function resolveSite(arg, cfg) {
  // 1. Direct path (absolute or relative to cwd).
  const asPath = path.resolve(arg);
  if (fs.existsSync(asPath) && fs.statSync(asPath).isDirectory()) return asPath;

  // 2. Exact folder name under the websites root.
  const exact = path.join(cfg.websitesRoot, arg);
  if (fs.existsSync(exact) && fs.statSync(exact).isDirectory()) return exact;

  // 3. Fuzzy: unique case-insensitive substring match.
  const needle = arg.toLowerCase();
  const matches = listSiteDirs(cfg).filter((n) => n.toLowerCase().includes(needle));
  if (matches.length === 1) return path.join(cfg.websitesRoot, matches[0]);
  if (matches.length > 1) {
    throw new Error(`"${arg}" matches multiple sites: ${matches.join(', ')}. Be more specific.`);
  }
  throw new Error(`No site found for "${arg}". Try: node serve.js --list`);
}

function readSiteConfig(dir) {
  const p = path.join(dir, 'site.config.json');
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    warn(`site.config.json in ${path.basename(dir)} is invalid JSON, ignoring: ${err.message}`);
    return {};
  }
}

function hasFile(dir, name) {
  return fs.existsSync(path.join(dir, name));
}

function dirHasExt(dir, ext) {
  try {
    return fs.readdirSync(dir).some((f) => f.toLowerCase().endsWith(ext));
  } catch { return false; }
}

function detectType(dir) {
  if (hasFile(dir, 'requirements.txt') || hasFile(dir, 'main.py') || hasFile(dir, 'app.py')) {
    // Only call it fastapi if it looks ASGI-ish; otherwise still try uvicorn.
    return 'fastapi';
  }
  if (hasFile(dir, 'package.json')) return 'nodejs';
  if (hasFile(dir, 'index.php') || dirHasExt(dir, '.php')) return 'php';
  return 'static';
}

// ---------------------------------------------------------------------------
// Binary detection
// ---------------------------------------------------------------------------

function which(cmd) {
  const res = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' });
  if (res.status === 0 && res.stdout) return res.stdout.split(/\r?\n/)[0].trim();
  return null;
}

function findPhp(cfg) {
  if (cfg.phpPath && fs.existsSync(cfg.phpPath)) return cfg.phpPath;
  const onPath = which('php');
  if (onPath) return onPath;
  const candidates = ['C:\\xampp\\php\\php.exe', 'C:\\php\\php.exe', 'C:\\wamp64\\bin\\php\\php.exe'];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return null;
}

function findPython(cfg) {
  if (cfg.pythonPath && fs.existsSync(cfg.pythonPath)) return cfg.pythonPath;
  return which('python') || which('py') || 'python';
}

// ---------------------------------------------------------------------------
// Port helpers
// ---------------------------------------------------------------------------

function isPortFree(port, host) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}

async function findFreePort(preferred, host) {
  for (let port = preferred; port < preferred + 50; port++) {
    if (await isPortFree(port, host)) return port;
  }
  throw new Error(`No free port found near ${preferred}`);
}

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------

function openBrowser(url) {
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch { /* opening the browser is best-effort */ }
}

// ---------------------------------------------------------------------------
// Static file server (with live reload)
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject', '.pdf': 'application/pdf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.wasm': 'application/wasm', '.xml': 'application/xml; charset=utf-8',
};
const mimeFor = (p) => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';

const LIVERELOAD_SNIPPET =
  '<script>(function(){try{var s=new EventSource("/__livereload");' +
  's.onmessage=function(e){if(e.data==="reload")location.reload();};}catch(_){} })();</script>';

function startStatic(dir, { host, port, reload }) {
  const clients = new Set();

  const server = http.createServer(async (req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, `http://${host}`).pathname);
    } catch {
      res.writeHead(400); return res.end('Bad request');
    }

    if (reload && pathname === '/__livereload') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive',
      });
      res.write('retry: 1000\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    // Resolve target path, guarding against traversal outside the root.
    let filePath = path.join(dir, pathname);
    const rel = path.relative(dir, filePath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      res.writeHead(403); return res.end('Forbidden');
    }

    try {
      let stat = await fsp.stat(filePath).catch(() => null);

      // Directory → index.html.
      if (stat && stat.isDirectory()) {
        const idx = path.join(filePath, 'index.html');
        if (fs.existsSync(idx)) { filePath = idx; stat = await fsp.stat(filePath); }
        else return sendDirListing(res, dir, filePath, pathname);
      }

      // Clean URL: /about → /about.html
      if (!stat) {
        const withHtml = filePath + '.html';
        if (fs.existsSync(withHtml)) { filePath = withHtml; stat = await fsp.stat(filePath); }
      }

      if (!stat) return send404(res, dir);

      const type = mimeFor(filePath);
      if (reload && type.startsWith('text/html')) {
        let html = await fsp.readFile(filePath, 'utf8');
        html = html.includes('</body>')
          ? html.replace('</body>', LIVERELOAD_SNIPPET + '</body>')
          : html + LIVERELOAD_SNIPPET;
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
        return res.end(html);
      }

      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'Content-Length': stat.size });
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      fail(`Error serving ${pathname}: ${err.message}`);
      res.writeHead(500); res.end('Internal server error');
    }
  });

  if (reload) setupWatch(dir, clients);
  server.listen(port, host);
  return server;
}

function setupWatch(dir, clients) {
  let timer = null;
  const notify = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const res of clients) res.write('data: reload\n\n');
    }, 60);
  };
  try {
    fs.watch(dir, { recursive: true }, notify);
  } catch (err) {
    warn(`Live reload unavailable (fs.watch failed): ${err.message}`);
  }
}

async function sendDirListing(res, root, dir, urlPath) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const rows = entries
    .sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name))
    .map((e) => {
      const name = e.name + (e.isDirectory() ? '/' : '');
      const href = path.posix.join(urlPath, name);
      return `<li><a href="${href}">${name}</a></li>`;
    }).join('');
  const up = urlPath !== '/' ? `<li><a href="${path.posix.join(urlPath, '..')}">../</a></li>` : '';
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><title>Index of ${urlPath}</title>
<style>body{font:14px/1.6 system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem}
a{text-decoration:none;color:#2563eb}li{list-style:none}h1{font-size:1rem;color:#555}</style>
<h1>Index of ${urlPath}</h1><ul>${up}${rows}</ul>`);
}

function send404(res, dir) {
  const custom = path.join(dir, '404.html');
  if (fs.existsSync(custom)) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(custom).pipe(res);
  }
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><meta charset="utf-8"><title>404</title><h1>404 — Not found</h1>');
}

// ---------------------------------------------------------------------------
// Child-process backends (php / node / fastapi)
// ---------------------------------------------------------------------------

function runChild(cmd, args, cwd, extraEnv = {}) {
  const child = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
    shell: false,
  });
  child.on('error', (err) => fail(`Failed to start "${cmd}": ${err.message}`));
  return child;
}

function startPhp(dir, { host, port, cfg, siteCfg }) {
  const php = findPhp(cfg);
  if (!php) {
    throw new Error('PHP not found. Install PHP (e.g. XAMPP) or set "phpPath" in DevTools/config.json.');
  }
  const args = ['-S', `${host}:${port}`, '-t', dir];
  const router = siteCfg.router || (hasFile(dir, 'router.php') ? path.join(dir, 'router.php') : null);
  if (router) args.push(router);
  info(`php -S ${host}:${port} (${path.basename(php)})`);
  return runChild(php, args, dir, siteCfg.env || {});
}

function startNode(dir, { port, siteCfg }) {
  const env = { PORT: String(port), ...(siteCfg.env || {}) };
  if (siteCfg.start_command) {
    info(`sh -c "${siteCfg.start_command}"`);
    return spawn(siteCfg.start_command, { cwd: dir, env: { ...process.env, ...env }, stdio: 'inherit', shell: true });
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const hasDeps = pkg.dependencies && Object.keys(pkg.dependencies).length > 0;
  if (hasDeps && !fs.existsSync(path.join(dir, 'node_modules'))) {
    warn('package.json lists dependencies but node_modules is missing.');
    warn('If this site is meant to be zero-dependency, remove them; otherwise run `npm install` in the site.');
  }
  if (pkg.scripts && pkg.scripts.start) {
    info(`npm start (PORT=${port})`);
    // npm is a .cmd shim on Windows; run through a shell (single command string
    // avoids Node's EINVAL for .cmd and the DEP0190 shell-args warning).
    const child = spawn('npm start', { cwd: dir, env: { ...process.env, ...env }, stdio: 'inherit', shell: true });
    child.on('error', (err) => fail(`Failed to start npm: ${err.message}`));
    return child;
  }
  const main = pkg.main || 'index.js';
  info(`node --watch ${main} (PORT=${port})`);
  return runChild(process.execPath, ['--watch', main], dir, env);
}

function startFastapi(dir, { host, port, cfg, siteCfg }) {
  const python = findPython(cfg);
  const env = { ...(siteCfg.env || {}) };
  if (siteCfg.start_command) {
    info(`sh -c "${siteCfg.start_command}"`);
    return spawn(siteCfg.start_command, { cwd: dir, env: { ...process.env, ...env }, stdio: 'inherit', shell: true });
  }
  // Verify uvicorn is importable so we can give a clean error early.
  const check = spawnSync(python, ['-c', 'import uvicorn'], { encoding: 'utf8' });
  if (check.status !== 0) {
    throw new Error(`uvicorn is not installed for ${python}. Run: ${python} -m pip install uvicorn`);
  }
  const target = siteCfg.app || detectAsgiApp(dir);
  if (!target) {
    throw new Error('Could not find an ASGI app. Set "app" in site.config.json (e.g. "main:app").');
  }
  const args = ['-m', 'uvicorn', target, '--host', host, '--port', String(port), '--reload', '--app-dir', dir];
  info(`${path.basename(python)} -m uvicorn ${target} --reload`);
  return runChild(python, args, dir, env);
}

function detectAsgiApp(dir) {
  const modules = ['main', 'app', 'asgi', 'server', 'application'];
  const varNames = ['app', 'application', 'api'];
  for (const m of modules) {
    const file = path.join(dir, `${m}.py`);
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    for (const v of varNames) {
      // Match `app = FastAPI(` / `app: FastAPI` / `app=Starlette(` etc.
      if (new RegExp(`^${v}\\s*[:=]`, 'm').test(src)) return `${m}:${v}`;
    }
    // Fall back to module:app if the file exists but we couldn't parse a var.
    if (m === 'main') return 'main:app';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scaffolding (--init)
// ---------------------------------------------------------------------------

function initSite(dir) {
  const type = detectType(dir);

  const cfgPath = path.join(dir, 'site.config.json');
  if (fs.existsSync(cfgPath)) {
    warn(`site.config.json already exists in ${path.basename(dir)} — leaving it as is.`);
  } else {
    const sample = {
      _readme: 'Optional overrides for DevTools. type auto-detects: package.json=nodejs, requirements.txt/main.py=fastapi, *.php=php, else static.',
      type,
      port: null,
      env: {},
      app: type === 'fastapi' ? 'main:app' : null,
      router: null,
      start_command: null,
    };
    fs.writeFileSync(cfgPath, JSON.stringify(sample, null, 2) + '\n');
    ok(`Wrote ${path.relative(process.cwd(), cfgPath)} (type: ${type})`);
  }

  const giPath = path.join(dir, '.gitignore');
  const template = path.join(DEVTOOLS_DIR, 'templates', 'site.gitignore');
  if (fs.existsSync(giPath)) {
    warn(`.gitignore already exists in ${path.basename(dir)} — leaving it as is.`);
  } else if (fs.existsSync(template)) {
    fs.copyFileSync(template, giPath);
    ok(`Wrote ${path.relative(process.cwd(), giPath)}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cfg = loadConfig();

  if (opts.help) { console.log(HELP); return; }

  if (opts.list) {
    const sites = listSiteDirs(cfg);
    console.log(`${c.bold}Sites in ${cfg.websitesRoot}${c.reset}\n`);
    for (const name of sites) {
      const dir = path.join(cfg.websitesRoot, name);
      const sc = readSiteConfig(dir);
      const type = sc.type || detectType(dir);
      console.log(`  ${c.green}${type.padEnd(8)}${c.reset} ${name}`);
    }
    console.log(`\nServe one with: ${c.cyan}node serve.js <name>${c.reset}`);
    return;
  }

  if (opts._.length === 0) { console.log(HELP); return; }

  let dir;
  try {
    dir = resolveSite(opts._[0], cfg);
  } catch (err) {
    fail(err.message); process.exitCode = 1; return;
  }

  if (opts.init) { initSite(dir); return; }

  const siteCfg = readSiteConfig(dir);
  const host = opts.host || cfg.host;
  const type = opts.type || siteCfg.type || detectType(dir);
  const reload = opts.reload !== null ? opts.reload : (siteCfg.liveReload !== false && cfg.liveReload);
  const preferredPort = opts.port || siteCfg.port || cfg.defaultPorts[type] || 8080;

  let port;
  try {
    port = await findFreePort(preferredPort, host);
    if (port !== preferredPort) info(`Port ${preferredPort} busy, using ${port}`);
  } catch (err) {
    fail(err.message); process.exitCode = 1; return;
  }

  const url = `http://${host}:${port}/`;
  console.log(`\n${c.bold}${path.basename(dir)}${c.reset}  ${c.dim}(${type})${c.reset}`);
  info(dir);

  let child = null;
  let server = null;
  try {
    switch (type) {
      case 'static':
        server = startStatic(dir, { host, port, reload });
        ok(`Static server ready${reload ? ' (live reload on)' : ''}`);
        break;
      case 'php':
        child = startPhp(dir, { host, port, cfg, siteCfg });
        break;
      case 'nodejs':
        child = startNode(dir, { port, siteCfg });
        break;
      case 'fastapi':
        child = startFastapi(dir, { host, port, cfg, siteCfg });
        break;
      default:
        throw new Error(`Unknown type "${type}". Use static|php|nodejs|fastapi.`);
    }
  } catch (err) {
    fail(err.message); process.exitCode = 1; return;
  }

  ok(`Serving ${c.cyan}${url}${c.reset}`);
  console.log(`${c.dim}  Press Ctrl+C to stop${c.reset}\n`);

  const shouldOpen = opts.open !== null ? opts.open : (siteCfg.openBrowser !== false && cfg.openBrowser);
  if (shouldOpen) openBrowser(url);

  // Clean shutdown.
  const shutdown = () => {
    console.log('');
    info('Shutting down…');
    if (server) server.close();
    if (child && !child.killed) child.kill();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (child) {
    child.on('exit', (code) => {
      if (code && code !== 0) fail(`Server exited with code ${code}`);
      process.exit(code || 0);
    });
  }
}

main().catch((err) => { fail(err.stack || err.message); process.exit(1); });
