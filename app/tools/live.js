// A live source: the project's own dev server, shown on the canvas.
//
// Re-drawing somebody's site as canvas components only ever produces an approximation,
// and an approximation is worse than nothing because it looks authoritative while being
// wrong. So the canvas runs the real thing instead: the project's own dev server, with
// its own framework and its own styles, and puts each of its routes in a frame.
//
// Editing the source hot-reloads the frame, because it is that dev server doing the
// reloading and not us.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { NEXT_ROUTE } from './next-route.js';

export class LiveSource {
  constructor({ cwd, command, port, log }) {
    this.cwd = cwd;
    this.command = command;
    this.wantedPort = port || 0;
    this.log = log || (() => {});
    this.proc = null;
    this.port = 0;
    this.printedPort = 0;
    this.status = 'idle';
    this.external = false;
    this.output = [];
  }

  get url() { return this.port ? `http://localhost:${this.port}` : ''; }

  start() {
    if (this.proc || !this.command) return Promise.resolve(this.port);
    if (!fs.existsSync(this.cwd)) {
      this.status = 'missing';
      this.log(`[live] no such folder: ${this.cwd}`);
      return Promise.resolve(0);
    }
    if (!fs.existsSync(path.join(this.cwd, 'node_modules'))) {
      this.status = 'no-install';
      this.log(`[live] ${this.cwd} has no node_modules. Run its install first.`);
      return Promise.resolve(0);
    }

    this.status = 'starting';
    this.log(`[live] ${this.command} in ${this.cwd}`);

    return new Promise(resolve => {
      // The same widened PATH, so `npm run dev` works however the editor was launched.
      const extra = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
      const PATH = [...new Set([...(process.env.PATH || '').split(':').filter(Boolean), ...extra])].join(':');
      // The board itself runs as node inside the editor's binary, and that is ours alone:
      // the project's dev server is started as a plain command and never told it.
      const env = { ...process.env, PATH };
      delete env.ELECTRON_RUN_AS_NODE;
      const proc = spawn(this.command, { cwd: this.cwd, shell: true, env });
      this.proc = proc;

      let settled = false;
      const done = port => {
        if (settled) return;
        settled = true;
        this.port = port;
        this.status = port ? 'running' : 'failed';
        resolve(port);
      };

      const onData = chunk => {
        const text = String(chunk);
        this.output.push(text);
        if (this.output.length > 200) this.output.shift();
        this.log(text.replace(/\s+$/, ''));
        // Every dev server announces itself with a localhost URL sooner or later.
        const m = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/);
        // Kept whether or not this is the first answer: the port it printed is the one
        // to attach to even when the process then exits.
        if (m) { this.printedPort = Number(m[1]); done(this.printedPort); }
      };
      proc.stdout.on('data', onData);
      proc.stderr.on('data', onData);
      // Exiting does not always mean gone. Several dev servers (Astro among them) detect
      // that one is already running, print its URL and exit straight away. The port it
      // printed is the right answer, so it is kept whenever something still answers on
      // it, and this canvas simply attaches to the server that was already there.
      proc.on('exit', async code => {
        this.proc = null;
        const port = this.port || this.printedPort || 0;
        if (port && await answersSoon(port)) {
          this.external = true;
          this.port = port;
          this.status = 'running';
          this.log(`[live] attached to the dev server already on ${this.url}`);
          return done(port);
        }
        this.log(`[live] exited with ${code}`);
        this.port = 0;
        this.status = 'stopped';
        done(0);
      });

      setTimeout(() => {
        if (!settled) {
          this.status = 'slow';
          this.log('[live] no URL printed after 60s');
          done(this.wantedPort || 0);
        }
      }, 60000);
    });
  }

  stop() {
    // A server that was already running is not ours to stop.
    if (this.external) { this.proc = null; return; }
    if (this.proc) { try { this.proc.kill(); } catch (_) {} }
    this.proc = null;
    this.port = 0;
    this.status = 'stopped';
  }
}

// What the project serves, read from how it is laid out. Every framework worth
// supporting puts its routes in the filesystem, which is the only reason this is
// possible without running it.
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.astro', '.output']);

export function discoverRoutes(cwd) {
  const found = [];

  // Astro and SvelteKit-style: src/pages
  found.push(...fromDir(path.join(cwd, 'src', 'pages'), /\.(astro|md|mdx|html)$/, name =>
    name.replace(/\.(astro|md|mdx|html)$/, '')));

  // Next, app router: a folder with a page file is a route.
  found.push(...fromDir(path.join(cwd, 'app'), /^page\.(jsx?|tsx?|mdx)$/, () => ''));

  // Next, pages router.
  found.push(...fromDir(path.join(cwd, 'pages'), /\.(jsx?|tsx?|mdx)$/, name =>
    name.replace(/\.(jsx?|tsx?|mdx)$/, '')));

  const routes = [...new Set(found)]
    // A dynamic segment cannot be opened without a value, and a private file is not a
    // route at all.
    .filter(r => !r.includes('[') && !r.includes('(') && !r.split('/').some(s => s.startsWith('_')))
    // An error page is not somewhere you navigate to: in dev it answers with the
    // framework's own overlay rather than the site's, so it only ever shows the wrong
    // thing on the board.
    .filter(r => !/^\/(404|500)$/.test(r))
    .sort((a, b) => (a === '/' ? -1 : b === '/' ? 1 : a.localeCompare(b)));

  return routes;
}

function fromDir(root, filePattern, toSlug) {
  if (!exists(root)) return [];
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
        walk(full, depth + 1);
        continue;
      }
      if (!filePattern.test(entry.name)) continue;
      const rel = path.relative(root, full).split(path.sep).join('/');
      const slug = toSlug(rel);
      const parts = slug.split('/').filter(Boolean).filter(p => p !== 'index');
      out.push('/' + parts.join('/'));
    }
  };
  walk(root, 0);
  return out;
}

const exists = p => { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } };

// Asked more than once, and patiently. A dev server that has just been handed a cold
// page compiles it before it answers, and a single short probe times out on a big one:
// the port is then thrown away and the board comes up empty with nothing to say why.
async function answersSoon(port, tries = 4) {
  for (let i = 0; i < tries; i++) {
    if (await answers(port)) return true;
    await new Promise(r => setTimeout(r, 600));
  }
  return false;
}

// GET rather than HEAD, and every address family: several dev servers answer GET and
// ignore HEAD, and a few (Astro among them) bind IPv6 only, so 127.0.0.1 is refused
// while localhost works.
function answers(port) {
  return Promise.all(['localhost', '127.0.0.1', '::1'].map(host => try1(host, port)))
    .then(results => results.some(Boolean));
}

function try1(host, port) {
  return new Promise(resolve => {
    let req;
    try {
      req = http.request({ host, port, path: '/', method: 'GET', timeout: 12000 }, res => {
        res.resume();
        resolve(true);
      });
    } catch (_) { return resolve(false); }
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.end();
  });
}

// A route reads better as a name than as a path.
export function routeTitle(route) {
  if (route === '/') return 'Home';
  return route
    .split('/')
    .filter(Boolean)
    .pop()
    .replace(/[-_]/g, ' ')
    .replace(/^\w/, c => c.toUpperCase());
}

// The file behind a route, so the canvas can open the right thing to edit and hand the
// right thing to Claude. Probed rather than parsed: the layouts differ per framework but
// the candidates are few.
export function routeSource(cwd, route) {
  const slug = route === '/' ? 'index' : route.replace(/^\/|\/$/g, '');
  const candidates = [
    ...['astro', 'md', 'mdx', 'html'].map(e => `src/pages/${slug}.${e}`),
    ...['astro', 'md', 'mdx', 'html'].map(e => `src/pages/${slug}/index.${e}`),
    ...['tsx', 'jsx', 'ts', 'js'].map(e => `app/${slug === 'index' ? '' : slug + '/'}page.${e}`),
    ...['tsx', 'jsx', 'ts', 'js'].map(e => `pages/${slug}.${e}`),
    ...['tsx', 'jsx', 'ts', 'js'].map(e => `pages/${slug}/index.${e}`),
    ...['vue', 'svelte'].map(e => `src/pages/${slug}.${e}`),
    `${slug}.html`,
    'index.html'
  ];
  for (const rel of candidates) {
    const full = path.join(cwd, rel);
    try { if (fs.statSync(full).isFile()) return rel; } catch (_) {}
  }
  return '';
}

// Which spelling of a route the project actually serves.
//
// Trailing slashes are a per-project decision (`trailingSlash: 'always'` in Astro,
// `trailingSlash: true` in Next, neither by default in most others) and getting it wrong
// turns every frame into that framework's 404 page. Rather than reading four different
// config formats and still being wrong, each route is asked for both ways once and the
// one that answers is kept.
export async function resolveRoutes(baseUrl, routes) {
  const out = new Array(routes.length);

  const settle = async (route, at) => {
    // Our own route needs no asking: this board wrote it, at that spelling, and asking
    // for it means making the project render a whole screen to answer. On a board of a
    // hundred of them that is a minute of waiting to learn what we already know.
    if (route.startsWith(`/${NEXT_ROUTE}/`)) { out[at] = route; return; }
    const variants = route === '/' ? ['/'] : [route, route + '/'];
    for (const variant of variants) {
      if (await ok(baseUrl + variant)) { out[at] = variant; return; }
    }
    // Neither answered: the route is kept as it was written. A dev server that was busy
    // for six seconds is a slow dev server, not a missing page, and dropping the frame
    // would be the wrong answer to it.
    out[at] = route;
  };

  // A few at a time. One at a time is a minute on a big board; all at once is a hundred
  // cold renders at a dev server that then answers none of them in time.
  const queue = routes.map((route, at) => () => settle(route, at));
  const runners = Array.from({ length: Math.min(6, queue.length) }, async () => {
    let next;
    while ((next = queue.shift())) await next();
  });
  await Promise.all(runners);
  return out;
}

function ok(url) {
  return new Promise(resolve => {
    let req;
    try {
      req = http.get(url, { timeout: 6000 }, res => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 400);
      });
    } catch (_) { return resolve(false); }
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}
