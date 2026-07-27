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
  // Loopback control port used for CLI ↔ DevTools-process IPC (multi-site mode).
  controlPort: 47913,
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
      case '--stop': opts.stop = true; break;
      case '--daemon': opts.daemon = true; break;
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

  ${c.cyan}node serve.js <site> [<site2> ...] [options]${c.reset}

<site> is a folder name under the websites root (fuzzy matched) or a path.
Pass more than one to serve several sites at once.

DevTools runs as a single process. The first site you serve opens a
dedicated "DevTools" terminal window that stays running; every site you
serve after that (from any terminal) is picked up by that same window's
process instead of opening a new one. Ctrl+C in that window, or
${c.cyan}node serve.js --stop${c.reset}, shuts every site down together.

Options:
  -p, --port <n>    Override the port
  -t, --type <t>    Force type: static | php | nodejs | fastapi
      --host <h>    Bind host (default 127.0.0.1)
      --no-open     Don't open the browser
      --no-reload   Disable live reload (static sites)
  -l, --list        List all sites (marks the ones currently running)
      --init        Scaffold site.config.json + .gitignore into <site>, then exit
      --stop [site] Stop the whole DevTools process, or just one running site
      --daemon      Run as the DevTools process in this terminal (no new window)
  -h, --help        Show this help

Examples:
  node serve.js www.test.com
  node serve.js test                 # fuzzy match
  node serve.js hearts --port 4000
  node serve.js siteA siteB          # serve multiple sites at once
  node serve.js www.place_holder.com --type php
  node serve.js --list
  node serve.js www.test.com --init
  node serve.js --stop               # shut the whole DevTools process down
  node serve.js --stop siteA         # stop just one site, leave the rest running
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
// Single-process, multi-site daemon
//
// Only one DevTools process ever binds `controlPort`. The first `serve.js
// <site>` call becomes that process (in its own dedicated terminal window);
// every later call — for the same site or a different one — just talks to
// it over a loopback socket and the existing process starts the extra site
// itself. One Ctrl+C (or `--stop`) tears every site running under it down
// together.
// ---------------------------------------------------------------------------

function killChild(child) {
  if (!child || child.killed) return;
  if (process.platform === 'win32') {
    // npm/uvicorn spawn their own child processes; taskkill /t kills the tree.
    try { spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f']); } catch { /* best effort */ }
  } else {
    try { child.kill(); } catch { /* best effort */ }
  }
}

async function launchSiteEntry(dir, reqOpts, cfg) {
  const siteCfg = readSiteConfig(dir);
  const host = reqOpts.host || cfg.host;
  const type = reqOpts.type || siteCfg.type || detectType(dir);
  const reload = reqOpts.reload != null ? reqOpts.reload : (siteCfg.liveReload !== false && cfg.liveReload);
  const preferredPort = reqOpts.port || siteCfg.port || cfg.defaultPorts[type] || 8080;
  const port = await findFreePort(preferredPort, host);
  const url = `http://${host}:${port}/`;

  let child = null;
  let server = null;
  switch (type) {
    case 'static': server = startStatic(dir, { host, port, reload }); break;
    case 'php': child = startPhp(dir, { host, port, cfg, siteCfg }); break;
    case 'nodejs': child = startNode(dir, { port, siteCfg }); break;
    case 'fastapi': child = startFastapi(dir, { host, port, cfg, siteCfg }); break;
    default: throw new Error(`Unknown type "${type}". Use static|php|nodejs|fastapi.`);
  }

  const shouldOpen = reqOpts.open != null ? reqOpts.open : (siteCfg.openBrowser !== false && cfg.openBrowser);
  if (shouldOpen) openBrowser(url);
  if (child) {
    child.on('exit', (code) => {
      if (code && code !== 0) fail(`${path.basename(dir)} exited with code ${code}`);
    });
  }

  return { dir, type, port, url, child, server };
}

function stopEntry(entry) {
  if (entry.server) entry.server.close();
  killChild(entry.child);
}

function shutdownDaemon(ctx) {
  console.log('');
  info('Shutting down DevTools (all sites)…');
  for (const entry of ctx.sites.values()) stopEntry(entry);
  ctx.sites.clear();
  if (ctx.controlServer) ctx.controlServer.close();
  setTimeout(() => process.exit(0), 300);
}

async function handleRequest(msg, ctx) {
  switch (msg.type) {
    case 'start': {
      const dir = resolveSite(msg.site, ctx.cfg);
      const existing = ctx.sites.get(dir);
      if (existing) return { ok: true, already: true, name: path.basename(dir), url: existing.url, type: existing.type };
      const entry = await launchSiteEntry(dir, msg.opts || {}, ctx.cfg);
      ctx.sites.set(dir, entry);
      return { ok: true, name: path.basename(dir), url: entry.url, type: entry.type };
    }
    case 'query': {
      const results = [];
      for (const s of msg.sites || []) {
        try {
          const dir = resolveSite(s, ctx.cfg);
          const entry = ctx.sites.get(dir);
          if (entry) results.push({ name: path.basename(dir), url: entry.url, type: entry.type });
        } catch { /* not resolvable yet, skip */ }
      }
      return { ok: true, results };
    }
    case 'list': {
      const results = [...ctx.sites.values()].map((e) => ({ name: path.basename(e.dir), url: e.url, type: e.type }));
      return { ok: true, results };
    }
    case 'stop': {
      if (msg.site) {
        const dir = resolveSite(msg.site, ctx.cfg);
        const entry = ctx.sites.get(dir);
        if (!entry) return { ok: false, error: `${msg.site} is not currently running.` };
        stopEntry(entry);
        ctx.sites.delete(dir);
        return { ok: true, stopped: path.basename(dir) };
      }
      setTimeout(() => shutdownDaemon(ctx), 200);
      return { ok: true, stoppedAll: true };
    }
    default:
      return { ok: false, error: `Unknown request type: ${msg.type}` };
  }
}

function bindControlServer(cfg, ctx) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      let buf = '';
      socket.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        let idx;
        while ((idx = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          let msg;
          try { msg = JSON.parse(line); } catch { continue; }
          Promise.resolve(handleRequest(msg, ctx))
            .then((resp) => socket.write(JSON.stringify(resp) + '\n'))
            .catch((err) => socket.write(JSON.stringify({ ok: false, error: err.message }) + '\n'));
        }
      });
      socket.on('error', () => { /* client went away */ });
    });
    server.once('error', reject);
    server.listen(cfg.controlPort, '127.0.0.1', () => { server.off('error', reject); resolve(server); });
  });
}

function pingDaemon(cfg) {
  return new Promise((resolve) => {
    const socket = net.connect({ port: cfg.controlPort, host: '127.0.0.1' });
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 400);
    socket.once('connect', () => { clearTimeout(timer); socket.end(); resolve(true); });
    socket.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}

function sendToDaemon(cfg, msg) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ port: cfg.controlPort, host: '127.0.0.1' });
    let buf = '';
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('DevTools did not respond in time.')); }, 8000);
    socket.once('connect', () => socket.write(JSON.stringify(msg) + '\n'));
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const idx = buf.indexOf('\n');
      if (idx === -1) return;
      clearTimeout(timer);
      socket.end();
      try { resolve(JSON.parse(buf.slice(0, idx))); } catch (err) { reject(err); }
    });
    socket.once('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

async function waitForDaemon(cfg, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await pingDaemon(cfg)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function spawnDaemonWindow(rawArgs) {
  const nodeExe = process.execPath;
  const scriptPath = path.join(DEVTOOLS_DIR, 'serve.js');
  const args = [...rawArgs, '--daemon'];
  const quote = (s) => (/[\s"&|<>^]/.test(s) ? `"${String(s).replace(/"/g, '\\"')}"` : s);
  if (process.platform === 'win32') {
    const inner = [quote(nodeExe), quote(scriptPath), ...args.map(quote)].join(' ');
    spawn('cmd.exe', ['/c', `start "DevTools" cmd.exe /k ${inner}`], {
      cwd: DEVTOOLS_DIR, detached: true, stdio: 'ignore', windowsHide: false,
    }).unref();
  } else {
    spawn(nodeExe, [scriptPath, ...args], { cwd: DEVTOOLS_DIR, detached: true, stdio: 'ignore' }).unref();
  }
}

async function runDaemon(cfg, siteNames, reqOpts) {
  const ctx = { cfg, sites: new Map() };
  let controlServer;
  try {
    controlServer = await bindControlServer(cfg, ctx);
  } catch (err) {
    if (err.code !== 'EADDRINUSE') throw err;
    // Lost the race to become the daemon — forward our sites to the winner instead.
    warn('Another DevTools process just started; forwarding to it.');
    if (await pingDaemon(cfg)) {
      for (const site of siteNames) {
        const resp = await sendToDaemon(cfg, { type: 'start', site, opts: reqOpts });
        if (resp.ok) ok(`${resp.already ? 'Already running' : 'Started'} ${resp.name} → ${c.cyan}${resp.url}${c.reset}`);
        else fail(resp.error);
      }
    }
    return;
  }
  ctx.controlServer = controlServer;

  console.log(`\n${c.bold}DevTools${c.reset} ${c.dim}(control port ${cfg.controlPort})${c.reset}`);
  info(`Websites root: ${cfg.websitesRoot}`);

  for (const site of siteNames) {
    try {
      const dir = resolveSite(site, cfg);
      if (ctx.sites.has(dir)) continue;
      const entry = await launchSiteEntry(dir, reqOpts, cfg);
      ctx.sites.set(dir, entry);
      ok(`Serving ${c.bold}${path.basename(dir)}${c.reset} ${c.dim}(${entry.type})${c.reset} → ${c.cyan}${entry.url}${c.reset}`);
    } catch (err) {
      fail(`${site}: ${err.message}`);
    }
  }

  console.log(`\n${c.dim}Listening for more sites on this window's process.${c.reset}`);
  console.log(`${c.dim}Run "node serve.js <site>" from any terminal to add one, or Ctrl+C here to stop everything.${c.reset}\n`);

  process.on('SIGINT', () => shutdownDaemon(ctx));
  process.on('SIGTERM', () => shutdownDaemon(ctx));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cfg = loadConfig();

  if (opts.help) { console.log(HELP); return; }

  if (opts.stop) {
    const site = opts._[0] || null;
    if (!(await pingDaemon(cfg))) { warn('DevTools is not running.'); return; }
    try {
      const resp = await sendToDaemon(cfg, { type: 'stop', site });
      if (!resp.ok) { fail(resp.error); process.exitCode = 1; return; }
      if (resp.stoppedAll) ok('DevTools stopped (all sites).');
      else ok(`Stopped ${resp.stopped}.`);
    } catch (err) {
      fail(err.message); process.exitCode = 1;
    }
    return;
  }

  if (opts.list) {
    const sites = listSiteDirs(cfg);
    let running = [];
    if (await pingDaemon(cfg)) {
      try {
        const resp = await sendToDaemon(cfg, { type: 'list' });
        if (resp.ok) running = resp.results;
      } catch { /* best-effort */ }
    }
    console.log(`${c.bold}Sites in ${cfg.websitesRoot}${c.reset}\n`);
    for (const name of sites) {
      const dir = path.join(cfg.websitesRoot, name);
      const sc = readSiteConfig(dir);
      const type = sc.type || detectType(dir);
      const live = running.find((r) => r.name === name);
      const tag = live ? `${c.green} [running → ${live.url}]${c.reset}` : '';
      console.log(`  ${c.green}${type.padEnd(8)}${c.reset} ${name}${tag}`);
    }
    console.log(`\nServe one with: ${c.cyan}node serve.js <name>${c.reset}`);
    return;
  }

  if (opts._.length === 0) { console.log(HELP); return; }

  if (opts.init) {
    let dir;
    try {
      dir = resolveSite(opts._[0], cfg);
    } catch (err) {
      fail(err.message); process.exitCode = 1; return;
    }
    initSite(dir);
    return;
  }

  const siteNames = opts._;
  try {
    for (const s of siteNames) resolveSite(s, cfg); // fail fast on typos before touching the daemon
  } catch (err) {
    fail(err.message); process.exitCode = 1; return;
  }
  const reqOpts = { port: opts.port, type: opts.type, host: opts.host, reload: opts.reload, open: opts.open };

  if (opts.daemon) {
    await runDaemon(cfg, siteNames, reqOpts);
    return;
  }

  if (await pingDaemon(cfg)) {
    try {
      for (const site of siteNames) {
        const resp = await sendToDaemon(cfg, { type: 'start', site, opts: reqOpts });
        if (!resp.ok) { fail(resp.error); continue; }
        ok(`${resp.already ? 'Already running' : 'Started'} ${c.bold}${resp.name}${c.reset} ${c.dim}(${resp.type})${c.reset} → ${c.cyan}${resp.url}${c.reset}`);
      }
      info('Running in the existing DevTools window.');
    } catch (err) {
      fail(err.message); process.exitCode = 1;
    }
    return;
  }

  info('Starting DevTools…');
  spawnDaemonWindow(process.argv.slice(2));
  if (!(await waitForDaemon(cfg, 10000))) {
    fail('DevTools window did not start in time.'); process.exitCode = 1; return;
  }
  try {
    const resp = await sendToDaemon(cfg, { type: 'query', sites: siteNames });
    for (const r of resp.results || []) {
      ok(`${c.bold}${r.name}${c.reset} ${c.dim}(${r.type})${c.reset} → ${c.cyan}${r.url}${c.reset}`);
    }
  } catch { /* the new window already prints its own status */ }
  ok('DevTools is running in its own window.');
  info(`Close that window, press Ctrl+C in it, or run ${c.cyan}node serve.js --stop${c.reset} to shut it down.`);
}

main().catch((err) => { fail(err.stack || err.message); process.exit(1); });
