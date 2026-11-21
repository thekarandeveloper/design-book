// The board's own Astro, so a page can be built out of components anywhere.
//
// A page on the board used to be one HTML file holding everything: the status bar, the
// navigation bar, the tab bar, the colours, the type, written again in every file. Thirty
// screens meant thirty copies of the same chrome, each one a little different from the last,
// and a change to any of it was thirty edits. That is what this replaces: a page is now a
// screen and nothing else, and the rest comes from the kit.
//
// THE BOARD OWNS ASTRO, not the project. It is a dependency of the board's own app, so a
// native iOS project, an Android one and a plain folder all get the same thing without
// installing anything and without a file being written into them. The Astro project it runs
// is generated outside the repo, in the board's cache, and reaches the pages through a
// symlink. A `git status` in the project shows nothing from any of this.
//
// WHY THE BOARD SERVES THE PAGES INSTEAD OF POINTING A FRAME AT ASTRO. A frame on another
// origin cannot be read from the board at all: choosing an element in it would have to go
// back through the headless browser, which is seconds instead of milliseconds. So the
// document is fetched here and served from the board's own origin, and only the things the
// page loads (its styles, Vite's client) are left pointing at Astro. The page is then the
// board's own document: same origin, read in place.

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { cacheRoot } from './posters.js';

const ROUTE = '/@studio/astro';

// A free port, taken and let go. Astro would pick one itself, but then nothing here would
// know which until it printed it.
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function link(from, to) {
  try {
    const was = fs.readlinkSync(from);
    if (path.resolve(path.dirname(from), was) === to) return;
    fs.unlinkSync(from);
  } catch (_) {
    try { fs.rmSync(from, { recursive: true, force: true }); } catch (_) {}
  }
  fs.mkdirSync(path.dirname(from), { recursive: true });
  fs.symlinkSync(to, from);
}

// Everything a page may be: one of the board's own pages, drawn by the route below.
//
// The glob is written twice on purpose: `getStaticPaths` runs in a scope of its own and
// cannot see anything declared beside it.
const ROUTE_PAGE = `---
// Written by Design Book. Every page in the board's folder, at its own address.
//
// Do not edit: this file is rewritten whenever the board starts. The pages themselves are in
// the board's folder, which is where the work is.
//
// THE GLOB IS LAZY ON PURPOSE. An eager glob imports every page to answer for one, so a
// board of forty pages compiles forty to draw one, and a single page that does not compile
// answers 500 for all of them. That is the worst moment for it to happen: somebody is
// halfway through writing a page, and every other frame on the board goes blank. Lazy, the
// addresses still come from the folder, and only the page being asked for is compiled.
//
// IT IS A SERVER ROUTE, not a prerendered one. A prerendered page is built once for its
// address and has no query, so the board could not ask for the same page in another way:
// a frame that wants the screen without the device drawn round it adds ?bezel=0, and on
// a prerendered route that reaches nothing. The board only ever runs the compiler in dev,
// never builds it, so there is nothing to lose by rendering on request.
export const prerender = false;

const pages = import.meta.glob('../board/pages/**/*.astro');

// The address, as the folder spells it: everything after the root of this route.
const want = String(Astro.params.path || '').replace(/\\.astro$/, '');
const key = Object.keys(pages).find(
  (file) => file.split('/pages/').pop().replace(/\\.astro$/, '') === want
);
const Page = key ? (await pages[key]()).default : null;
// A route that renders on request matches every address, so it has to say for itself when
// there is nothing at one. Without this the board was handed a 200 holding the word
// "Nothing here", and showed it as though it were a page.
if (!Page) Astro.response.status = 404;
---

{Page ? <Page /> : (
  <html lang="en"><head><meta charset="utf-8" /><title>Nothing here</title></head>
  <body style="margin:0;padding:24px;font:13px/1.6 ui-sans-serif,system-ui,sans-serif;color:#6B6B6B">
    Nothing on the board at this path.
  </body></html>
)}
`;

// The project's own files, at `/@repo/...`.
//
// A board page that shows a photograph the project already ships asks for it by a path
// relative to the repo, so the same page works on anybody's checkout. The board's own
// server answers that path, but a page's assets are not fetched from the board: every
// root-relative `src` is rewritten to this server's origin (see `fix()` below), so the
// request lands here. Without this the picture was missing in every render and every
// export while being there on the board, which is the worst of the three.
//
// `/@fs/<absolute path>` would also reach the file, and is what Vite offers, but it only
// resolves on the machine that wrote it.
function repoFiles(repoRoot) {
  const TYPES = {
    '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.svg': 'image/svg+xml', '.avif': 'image/avif',
    '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.json': 'application/json'
  };
  const serve = (req, res, next) => {
    const asked = (req.url || '').replace(/\?.*$/, '');
    if (!asked.startsWith('/@repo/')) return next();
    const file = path.resolve(repoRoot, decodeURIComponent(asked.slice('/@repo/'.length)));
    // Inside the repo and nowhere else, so a path with `..` in it cannot reach the disk.
    if (!file.startsWith(path.resolve(repoRoot) + path.sep)) { res.statusCode = 403; return res.end(); }
    let body;
    try { body = fs.readFileSync(file); } catch (_) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Content-Length', body.length);
    res.setHeader('Cache-Control', 'no-store');
    res.end(body);
  };
  return {
    name: 'designbook-repo-files',
    configureServer(server) { server.middlewares.use(serve); }
  };
}

export class AstroSource {
  // `studioRoot` is the board's folder (`.designbook`), `appDir` the board app's own folder,
  // which is where Astro and the kit are.
  constructor({ studioRoot, appDir, log = () => {} }) {
    this.studioRoot = studioRoot;
    this.appDir = appDir;
    this.log = log;
    this.root = path.join(cacheRoot(studioRoot), 'astro');
    this.server = null;
    this.starting = null;
    this.port = 0;
    this.status = 'idle';
    this.why = '';
    this.tokens = '';            // the project's own values, injected into every page
  }

  get origin() { return this.port ? `http://127.0.0.1:${this.port}` : ''; }
  get running() { return this.status === 'running'; }

  // Where a page's file is on the board, as the address the board serves it at.
  urlFor(file) {
    const rel = String(file).replace(/^pages\//, '').replace(/\.astro$/, '');
    return `${ROUTE}/${rel.split(path.sep).join('/')}`;
  }

  // The project it runs: a folder outside the repo, with the board's pages and the kit
  // reached through symlinks, and the app's node_modules so everything resolves as if it had
  // been installed here.
  prepare() {
    fs.mkdirSync(path.join(this.root, 'src', 'pages'), { recursive: true });
    fs.writeFileSync(path.join(this.root, 'package.json'), JSON.stringify({
      name: 'design-book-pages', private: true, type: 'module'
    }, null, 1) + '\n');
    link(path.join(this.root, 'node_modules'), path.join(this.appDir, 'node_modules'));
    link(path.join(this.root, 'src', 'board'), this.studioRoot);
    link(path.join(this.root, 'src', 'kit'), path.join(this.appDir, 'astro-kit'));
    // Written again whenever it differs, so a board opened by a newer version of this gets
    // the newer route without anybody clearing a cache.
    const route = path.join(this.root, 'src', 'pages', '[...path].astro');
    let was = '';
    try { was = fs.readFileSync(route, 'utf8'); } catch (_) {}
    if (was.trim() !== ROUTE_PAGE.trim()) fs.writeFileSync(route, ROUTE_PAGE);
  }

  async start() {
    if (this.running) return this.port;
    if (this.starting) return this.starting;
    this.status = 'starting';
    this.starting = (async () => {
      try {
        this.prepare();
        const [port, hmr] = await Promise.all([freePort(), freePort()]);
        const { dev } = await import('astro');
        this.server = await dev({
          root: this.root,
          logLevel: 'error',
          server: { port, host: '127.0.0.1' },
          // On, for what it marks rather than for what it draws.
          //
          // Astro writes `data-astro-source-file` and `data-astro-source-loc` on every
          // element only while the dev toolbar is enabled, and those are the only way the
          // board can tell you which line of which file an element came from. Without them
          // choosing a heading and copying it gave a name and a CSS selector and no code
          // to go to, which is no use to somebody (or an agent) being asked to change it.
          //
          // The toolbar itself is Astro talking to somebody building a site, and a button
          // floating over a frame is not part of the screen: it is hidden in the head
          // below, so the marks arrive and the furniture does not.
          devToolbar: { enabled: true },
          vite: {
            // This board's own prebundle cache.
            //
            // This root has no node_modules of its own, so Vite walked up and landed on
            // the board app's, which every board shares. Each of these servers stamps
            // that cache with its own config hash, so two open boards threw away each
            // other's bundles and the pages they were serving answered 504: a board
            // opened while another was running came up blank, and reloading the window
            // looked like the fix because it left one board running. The root here is
            // already one per board, so the cache goes in it.
            cacheDir: path.join(this.root, '.vite'),
            // The pages are reached through a symlink out of the root, which Vite refuses to
            // serve unless it is told that is deliberate.
            server: {
              fs: { allow: [this.root, this.studioRoot, this.appDir, path.dirname(this.studioRoot)], strict: false },
              // The page is served from the board's origin, so its live-reload socket cannot
              // be found from the page's own address. It is given one.
              hmr: { host: '127.0.0.1', port: hmr, protocol: 'ws' }
            },
            resolve: {
              // The pages are reached through a symlink, and Vite resolves a module id to
              // its real path by default. Astro then compiled the page under one id and
              // asked for its <style> under the other, found no compile metadata for it,
              // and served the page with no styles of its own at all. Markup updated on
              // every save and styles never did, silently (KNOWN-ISSUES 1). Keeping the
              // symlink path means both ids are the same id.
              preserveSymlinks: true,
              alias: {
                '@kit': path.join(this.root, 'src', 'kit'),
                '@board': path.join(this.root, 'src', 'board')
              }
            },
            plugins: [repoFiles(path.dirname(this.studioRoot))]
          }
        });
        this.port = port;
        this.status = 'running';
        this.why = '';
        this.log(`[astro] the board's pages are compiled at ${this.origin}`);
        return port;
      } catch (err) {
        this.status = 'failed';
        this.why = err.message;
        this.log(`[astro] could not start: ${err.message}`);
        return 0;
      } finally {
        this.starting = null;
      }
    })();
    return this.starting;
  }

  // The project's own design system, as the variables the kit reads. Written here rather than
  // into a file in the kit, because the kit is shared by every board and these are one
  // project's values.
  setTokens(css) { this.tokens = String(css || ''); }

  // One page, as the board serves it.
  //
  // The document comes back as ours, so the board can read it; everything it loads keeps
  // pointing at Astro, because that is what compiled it. A link inside the page's own content
  // is left alone, so following one stays on this origin and lands on another frame.
  async page(rel, { host = '', query = '' } = {}) {
    if (!this.running) await this.start();
    if (!this.running) return { status: 503, html: this.card('The page compiler is not running', this.why) };
    let res;
    try {
      // The query goes through to the compiler, because a page can be asked for in more
      // than one way: `?bezel=0` is the same page without the device drawn round it, and
      // `Screen` reads it there.
      const ask = this.origin + rel + (query ? (query.startsWith('?') ? query : '?' + query) : '');
      res = await fetch(ask, { headers: { accept: 'text/html' }, signal: AbortSignal.timeout(30000) });
    } catch (err) {
      return { status: 502, html: this.card('The page compiler did not answer', err.message) };
    }
    let html = await res.text();
    // A frame must never show a framework's own error page: that page is the compiler talking
    // to a developer about its internals, and on a board it reads as though the design were
    // broken. Anything but an answer becomes the board's own card.
    if (res.status === 404) {
      return { status: 404, html: this.card('No page at this address', `Nothing on this board is served at ${rel}.`) };
    }
    if (res.status >= 500) {
      const why = (/<title>([^<]{0,200})<\/title>/.exec(html) || [])[1] || 'the page did not compile';
      return { status: res.status, html: this.card('This page did not compile', why) };
    }
    html = html
      // The dev toolbar's own client, dropped.
      //
      // It is on so that Astro writes its source marks on every element, and those are in
      // the HTML already by the time this runs. The script that draws the toolbar is not
      // wanted and cannot be fetched from the board's origin anyway, so leaving it in put
      // a failed dynamic import in the console of every frame on the board.
      .replace(/<script[^>]*type="module"[^>]*>[\s\S]*?dev-toolbar[\s\S]*?<\/script>/g, '')
      .replace(/\ssrc="\/(?!\/)/g, ` src="${this.origin}/`)
      .replace(/<link([^>]*?)href="\/(?!\/)/g, `<link$1href="${this.origin}/`);

    const head = [];
    // Astro's dev toolbar is on so that its source marks are written on every element;
    // none of its furniture belongs on a frame.
    head.push('<style data-designbook="no-toolbar">astro-dev-toolbar{display:none!important}</style>');
    if (this.tokens) head.push(`<style data-designbook="tokens">${this.tokens}</style>`);
    // A frame is a picture of a screen, and a screen has no scrollbar down its side. Last in
    // the head, so a page's own rule cannot put one back. The page still scrolls.
    head.push('<style data-designbook="bars">html{scrollbar-width:none!important}html::-webkit-scrollbar,body::-webkit-scrollbar{width:0!important;height:0!important}</style>');
    const inject = head.join('');
    html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, inject + '</head>') : inject + html;
    return { status: res.status, html };
  }

  // What a frame shows when the page could not be compiled: one line about what is wrong,
  // in the board's own colours, rather than a framework's stack trace, which on a board reads
  // as though the design itself were broken.
  card(title, detail) {
    const safe = s => String(s || '').replace(/[<&]/g, c => (c === '<' ? '&lt;' : '&amp;')).slice(0, 400);
    return `<!doctype html><html><head><meta charset="utf-8"><title>${safe(title)}</title></head>
<body style="margin:0;display:grid;place-items:center;height:100%;background:#1b1e21;color:#8b9299;font:13px/1.6 -apple-system,system-ui,sans-serif">
<div style="max-width:320px;padding:24px;text-align:center">
<b style="display:block;color:#e6e8ea;font-size:14px;margin-bottom:8px">${safe(title)}</b>
<p style="margin:0">${safe(detail)}</p></div></body></html>`;
  }

  async stop() {
    const open = this.server;
    this.server = null;
    this.port = 0;
    this.status = 'idle';
    if (open) { try { await open.stop(); } catch (_) {} }
  }
}

export const ASTRO_ROUTE = ROUTE;

// What a page says about its frame, read from the file rather than by drawing it.
//
// A page states its frame in the component it is built with (`<Screen title="Home"
// width={393}>`), which is where somebody writing one would put it, so that is read first. A
// page that says it in a comment, the way the HTML pages do, is read too, and that wins when
// both are there, because a comment is a deliberate override.
// Where the screen is inside each device photograph. The same file `Screen` reads, so a
// frame on the board is exactly the size of what is drawn in it.
const SHOTS = (() => {
  try {
    const here = path.dirname(new URL(import.meta.url).pathname);
    return JSON.parse(fs.readFileSync(path.join(here, '..', 'astro-kit', 'devices', 'devices.json'), 'utf8'));
  } catch (_) { return {}; }
})();

export function astroMeta(file) {
  // What the board needs is the `<Screen ...>` tag, and that sits after the frontmatter. A
  // page whose frontmatter is long, because the words or the rows it draws are written up
  // there, pushed the tag past a fixed first read, and the board then showed it at the
  // default size and never saw `grow`: the frame cropped a screen that was meant to scroll
  // and nothing said so. So the head is read until the tag is whole, and only then given up
  // on. A page is a few tens of kilobytes, so reading one is nothing; the cap is there only
  // so a file that is not a page cannot be read into memory whole.
  const WHOLE = /<Screen\b[^>]*>/;
  const CAP = 1024 * 1024;
  let head = '';
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      for (const want of [4096, 65536, Math.min(size, CAP)]) {
        if (want <= head.length && head.length) break;
        const buf = Buffer.alloc(Math.min(want, CAP));
        const n = fs.readSync(fd, buf, 0, buf.length, 0);
        head = buf.subarray(0, n).toString('utf8');
        if (WHOLE.test(head) || n < buf.length) break;
      }
    } finally { fs.closeSync(fd); }
  } catch (_) { return {}; }

  const meta = {};
  const screen = /<Screen\b([^>]*)>/.exec(head);
  if (screen) {
    const props = screen[1];
    const text = (name) => {
      const m = new RegExp(`${name}=(?:"([^"]*)"|'([^']*)'|\\{\\s*['"]([^'"]*)['"]\\s*\\})`).exec(props);
      return m ? (m[1] ?? m[2] ?? m[3]) : '';
    };
    const num = (name) => {
      const m = new RegExp(`${name}=(?:\\{\\s*(-?[\\d.]+)\\s*\\}|"(-?[\\d.]+)")`).exec(props);
      return m ? (m[1] ?? m[2]) : '';
    };
    const device = text('device') || 'iphone';
    const shot = SHOTS[device];
    const DEVICE = { android: [360, 800] };
    const [w, h] = shot ? shot.size : (DEVICE[device] || SHOTS.iphone.size);
    if (text('title')) meta.title = text('title');

    // The frame is the device, not the screen inside it.
    //
    // `Screen` puts the page inside a photograph of the device unless it is told not to,
    // and the board has to lay the frame out at that size or it crops the device it just
    // drew. Both read `devices.json`, so the two can never disagree: the outside is the
    // photograph scaled until its hole is the size of the screen.
    const off = /\bbezel=\{?false\b/.test(props);
    const sw = Number(num('width') || w);
    const sh = Number(num('height') || h);
    // `web` has a photograph now (the laptop, see devices.json), so it is drawn like any
    // other device rather than being the one that is never drawn.
    const drawn = !off;
    if (drawn && shot) {
      const scale = sw / shot.screen[2];
      meta.width = String(Math.round(shot.image[0] * scale));
      meta.height = String(Math.round(shot.image[1] * scale));
      meta.band = String(Math.round(shot.screen[0] * scale));
      // The screen inside the device, which is what a board written before the device was
      // drawn had saved as the frame's size. The band is not the same on both sides, so
      // this cannot be worked out from the frame and the band.
      meta.screenW = String(sw);
      meta.screenH = String(sh);
    } else {
      const band = drawn ? (device === 'android' ? 11 : 0) : 0;
      meta.width = String(sw + band * 2);
      meta.height = String(sh + band * 2);
      if (band) meta.band = String(band);
    }
    // `grow` and a device are not both possible. A page longer than the screen scrolls
    // inside the glass rather than making the phone taller, so the board frames the device
    // at its own size and never measures this one.
    const growing = /\bgrow\b(?!=)|grow=\{?true/.test(props);
    if (growing && !(drawn && shot)) meta.grow = 'yes';
    if (growing && drawn && shot) meta.rolls = 'yes';
    if (text('group')) meta.group = text('group');

    if (text('source')) meta.source = text('source');
  }

  const line = head.match(/(?:designbook|design|canvas):\s*([^\n>-]+)/);
  if (line) {
    for (const part of line[1].split('|')) {
      const [k, ...rest] = part.split('=');
      if (rest.length) meta[k.trim().toLowerCase()] = rest.join('=').trim();
    }
  }
  return meta;
}
