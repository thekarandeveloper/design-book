// The studio's dev-time server, as a Vite plugin.
//
// Everything it touches is a plain file inside the open repo's `studio/` folder: a screen
// is one file, a moodboard note is one line of JSON, the agent index is one generated
// file. Nothing lives in a database, so Claude reads and writes exactly what the editor
// reads and writes, in the repo it is already working in.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LiveSource, discoverRoutes, routeTitle, routeSource, resolveRoutes } from './live.js';
import { readProject, readCustomProperties, groupTokens, writeCustomProperty } from './project.js';
import {
  previewState, enablePreview, disablePreview, ROUTE as PREVIEW_ROUTE,
  writeExperimentRoute, removeExperimentRoute, experimentState, EXPERIMENT_ROUTE
} from './preview-route.js';
import { writeRules, rulesBody } from './rules.js';
import { shoot, findBrowser } from './export.js';
import { check } from './check.js';
import { readPalette } from './palette.js';
import { createBoard } from './board.js';
import { runSetup } from './setup.js';
import { measureHeight, stopMeasuring } from './measure.js';
import { ensurePoster, readPoster, forgetPoster, cacheRoot } from './posters.js';
import {
  session as inspectSession, forgetSessions, scan as inspectScan, detail as inspectDetail,
  shotElement, shotRect, shotStates, shotSizes, shotAgain, sheetOf, auditElement, keepPicture
} from './inspect.js';
import { snapshot as gitSnapshot, since as gitSince, restore as gitRestore } from './remember.js';
import { readNativeTokens } from './native.js';
import { createSync } from './sync.js';
import { isScreenSize } from '../src/studio/frames.js';

const JSONH = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

const IMAGE = /\.(png|jpe?g|webp|avif|gif|svg)$/i;
const VIDEO = /\.(mp4|webm|mov|m4v)$/i;
const LINK = /\.(url|webloc)$/i;

const VIRTUAL_CATALOG = 'virtual:studio-catalog';
const RESOLVED_CATALOG = '\0' + VIRTUAL_CATALOG;

export function studioPlugin({ appRoot, studioRoot, repoRoot, boardFile }) {
  const dir = (...p) => path.join(studioRoot, ...p);

  const readJson = (file, fallback) => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
  };
  const writeJson = (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
  };
  const list = (d, test) => {
    try { return fs.readdirSync(d).filter(f => !f.startsWith('.') && (!test || test.test(f))).sort(); }
    catch (_) { return []; }
  };
  const kindOf = name =>
    IMAGE.test(name) ? 'image' : VIDEO.test(name) ? 'video' : LINK.test(name) ? 'link' : 'file';
  const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'screen';

  // The board document and its sections live in their own file: it is the one thing
  // here that is a format rather than a mechanism.
  const { boardPath, readBoard, writeBoard, listSections } =
    createBoard({ studioRoot, boardFile, readJson, writeJson, slug });
  const config = readBoard;


  // A canvas can point at a project's own dev server. Everything it serves is then shown
  // live on the board, running its own framework, rather than redrawn here.
  let live = null;
  let servePort = 0;  // what this canvas server ended up listening on
  let sync = null;    // keeps the board's files on the default branch (sync.js)
  const readyCache = new Map(); // url -> the last answer, for a few seconds

  // Is this page really being served, rather than an error page about the server?
  //
  // A page that answered once answers again: asking costs a full render on the dev server,
  // and the board asks for every frame it can see. A page that did not is asked again
  // soon, because it is probably still starting up.
  async function served(url) {
    const seen = readyCache.get(url);
    const age = seen ? Date.now() - seen.at : Infinity;
    if (seen && age < (seen.value.ok ? 600000 : 2000)) return { ...seen.value, cached: true };

    let value;
    try {
      const res = await fetch(url, { headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(45000) });
      // The frame is loading the same page at the same time; this one only needs to know
      // whether it answered, so its body is thrown away unread.
      try { await res.body?.cancel(); } catch (_) {}
      value = { ok: res.ok, status: res.status, why: res.ok ? '' : `the page answered ${res.status}` };
    } catch (err) {
      value = { ok: false, status: 0, why: err.name === 'TimeoutError' ? 'still rendering' : 'nothing is answering' };
    }
    readyCache.set(url, { at: Date.now(), value });
    return value;
  }
  function liveConfig() {
    const cfg = config().live;
    if (!cfg || !cfg.command) return null;
    return {
      cwd: path.resolve(studioRoot, cfg.cwd || '..'),
      command: cfg.command,
      routes: Array.isArray(cfg.routes) ? cfg.routes : null,
      frame: cfg.frame || { width: 1440, height: 900 }
    };
  }

  const projectRoot = () => {
    const cfg = liveConfig();
    return cfg ? cfg.cwd : repoRoot;
  };

  // Walking a project costs a tree walk, and the canvas asks on every view change.
  let projectCache = { at: 0, root: '', value: null };
  // Reading every file in a project is the most expensive thing here, so it is held
  // longer than the rest and thrown away whenever a file changes.
  let paletteCache = { at: 0, root: '', value: null };
  function paletteFor(root) {
    const now = Date.now();
    if (!paletteCache.value || paletteCache.root !== root || now - paletteCache.at > 20000) {
      paletteCache = { at: now, root, value: readPalette(root) };
    }
    return paletteCache.value;
  }
  // A native project's design system, read from its Swift and Kotlin. A few seconds, because
  // reading is cheap and the file somebody is editing is the one that has to be current.
  let nativeCache = { at: 0, root: '', value: null };
  function nativeFor(root) {
    const now = Date.now();
    if (nativeCache.root !== root || now - nativeCache.at > 3000) {
      let value = null;
      try { value = readNativeTokens(root); } catch (_) {}
      nativeCache = { at: now, root, value };
    }
    return nativeCache.value;
  }
  function project() {
    const root = projectRoot();
    const now = Date.now();
    if (projectCache.value && projectCache.root === root && now - projectCache.at < 5000) {
      return projectCache.value;
    }
    projectCache = { at: now, root, value: readProject(root) };
    return projectCache.value;
  }

  // What the design system is read from.
  //
  // The project's own stylesheets when it declares tokens. When it declares none, the
  // tokens.css the setup pass wrote from what the repo actually uses, so the Design
  // system view reads something true of this repo rather than nothing at all.
  function stylesFor() {
    const found = project().styles;
    if (found.length) return found;
    const own = dir('tokens.css');
    if (!fs.existsSync(own)) return found;
    const rel = path.relative(projectRoot(), own).split(path.sep).join('/');
    if (rel.startsWith('..')) return found;
    const count = readCustomProperties(own).length;
    return count ? [{ file: rel, count }] : found;
  }

  // Setting a repo up.
  //
  // A board is a file, and a repo with no such file has not been set up: the board shows
  // one Setup button, and nothing is written into the repo until it is pressed. That is
  // why everything derived is held back while this is true: looking at a repo must not
  // change it.
  const setupNeeded = () => !fs.existsSync(boardPath());
  let settingUp = false;

  // Whether the project could render a page of ours that imports one of its components.
  // Whatever this answers is the reason a screen was left out, because the alternative to
  // leaving it out is a frame drawing a guess.
  function canCompile(file) {
    const cfg = liveConfig();
    if (!cfg) return 'no dev server in this repo to compile it';
    if (!experimentState(cfg.cwd).enabled) {
      return "the project does not serve the board's pages yet: turn previews on, then run Setup again";
    }
    const ext = path.extname(file);
    const need = ext === '.vue' ? 'vue' : ext === '.svelte' ? 'svelte' : 'react';
    const pkg = readJson(path.join(cfg.cwd, 'package.json'), {}) || {};
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (!deps[`@astrojs/${need}`]) return `this project has no @astrojs/${need} to compile ${ext} with`;
    return '';
  }

  // An experiment written as a real page of the project: it can import the project's
  // components and styles, and the project's own dev server compiles it.
  function experimentPages() {
    const cfg = liveConfig();
    if (!cfg || !live || !live.url) return [];
    const state = experimentState(cfg.cwd);
    if (!state.enabled) return [];
    return list(dir('pages'), /\.astro$/).map(file => {
      const id = file.replace(/\.astro$/, '');
      const meta = astroMeta(dir('pages', file));
      return {
        id: 'exp:' + id,
        kind: 'live',
        source: 'canvas',
        file: `pages/${file}`,
        sourceFile: `pages/${file}`,
        url: `${live.url}${state.route}${id}/`,
        title: meta.title || id.replace(/[-_]/g, ' '),
        frame: { width: Number(meta.width) || cfg.frame.width, height: Number(meta.height) || cfg.frame.height },
        sized: !!meta.height && meta.grow !== 'yes',
        group: meta.group || 'Experiments'
      };
    });
  }

  // An .astro experiment states its frame in a comment, because it has no <head> of its
  // own when it uses the project's layout.
  //   <!-- designbook: title=Hero, wide type | width=1440 | height=900 | group=hero -->
  function astroMeta(file) {
    let head = '';
    try {
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(2048);
      const n = fs.readSync(fd, buf, 0, 2048, 0);
      fs.closeSync(fd);
      head = buf.subarray(0, n).toString('utf8');
    } catch (_) { return {}; }
    const line = head.match(/(?:designbook|design|canvas):\s*([^\n>-]+)/);
    if (!line) return {};
    const meta = {};
    for (const part of line[1].split('|')) {
      const [k, ...rest] = part.split('=');
      if (rest.length) meta[k.trim().toLowerCase()] = rest.join('=').trim();
    }
    return meta;
  }

  function livePages() {
    const cfg = liveConfig();
    if (!cfg || !live || !live.url) return [];
    const routes = live.routes || cfg.routes || discoverRoutes(cfg.cwd);
    // The live folder sits outside the board, so a source path is given relative to
    // the board folder: that is what the extension resolves when opening a file.
    const toCanvas = rel => path.relative(studioRoot, path.join(cfg.cwd, rel)).split(path.sep).join('/');
    return routes.map(route => {
      const bare = route === '/' ? '/' : route.replace(/\/$/, '');
      const rel = routeSource(cfg.cwd, bare);
      return {
        id: 'live:' + route,
        kind: 'live',
        source: 'live',
        file: route,
        sourceFile: rel ? toCanvas(rel) : '',
        url: live.url + route,
        title: routeTitle(bare),
        frame: cfg.frame,
        group: 'Live'
      };
    });
  }

  // A screen is either a JSON file that the visual editor owns, or a plain .html file
  // that the repo already had. Both belong on the same board: a repo that has been
  // mocking screens in HTML should not have to convert anything to be seen.
  function listPages() {
    const out = [];
    for (const file of list(dir('pages'), /\.json$/)) {
      const doc = readJson(dir('pages', file), {});
      const id = file.replace(/\.json$/, '');
      out.push({
        id,
        kind: 'puck',
        source: 'canvas',
        file: `pages/${file}`,
        title: doc.title || id,
        frame: doc.frame || { width: 390, height: 844 },
        group: doc.group || '',
        x: typeof doc.x === 'number' ? doc.x : null,
        y: typeof doc.y === 'number' ? doc.y : null
      });
    }
    for (const file of list(dir('pages'), /\.html$/)) {
      const id = file.replace(/\.html$/, '');
      const meta = htmlMeta(dir('pages', file));
      out.push({
        id: 'canvas:' + file,
        kind: 'html',
        source: 'canvas',
        file: `pages/${file}`,
        url: `/@studio/pages/${encodeURIComponent(file)}`,
        title: meta.title || id.replace(/[-_]/g, ' '),
        frame: { width: Number(meta.width) || 390, height: Number(meta.height) || 844 },
        // A frame made at a chosen size keeps it, and what does not fit is cropped:
        // measuring would quietly turn an Instagram square into whatever its content
        // came to. A screen is the exception, because a screen scrolls.
        sized: !!meta.height && meta.grow !== 'yes',
        group: meta.group || '',
        sources: meta.source ? meta.source.split(',').map(f => f.trim()).filter(Boolean) : [],
        x: null,
        y: null
      });
    }
    out.push(...livePages());
    out.push(...experimentPages());

    // The absolute path of whatever a frame is: copied, it has to work in a terminal, in
    // another editor, in a message to somebody else.
    for (const page of out) {
      const rel = page.sourceFile || page.file;
      if (!rel) continue;
      page.path = path.resolve(studioRoot, rel);
      // When the file behind this frame last changed. A frame that measures itself does
      // it when its own page changed, not whenever anything on the board did: a board
      // where every tall frame re-measures on a timer is a board that shuffles under you.
      try { page.changed = Math.round(fs.statSync(page.path).mtimeMs); } catch (_) {}

      // A page built from code says which code (`designbook-source`), and when any of that
      // code is newer than the page the page is out of date, whatever it looks like. A copy
      // of a screen drifts from the screen the week somebody changes the screen.
      if (page.sources && page.sources.length && page.changed) {
        const root = projectRoot();
        const newer = [];
        for (const rel of page.sources) {
          try {
            const at = fs.statSync(path.resolve(root, rel)).mtimeMs;
            if (at > page.changed + 1000) newer.push(rel);
          } catch (_) {}
        }
        if (newer.length) page.stale = newer;
      }
    }

    const positions = readBoard().frames;
    for (const page of out) {
      const saved = positions[page.id];
      if (!saved) continue;
      if (typeof saved.x === 'number') { page.x = saved.x; page.y = saved.y; }
      if (typeof saved.width === 'number' || typeof saved.height === 'number') {
        page.frame = {
          width: saved.width || page.frame.width,
          height: saved.height || page.frame.height
        };
        // A height that was chosen by hand is never measured again.
        if (typeof saved.height === 'number') page.sized = true;
      }
      // Unless it is set to fit what is in it, and then the height on the board is the
      // last measurement rather than a decision, and it is taken again.
      if (saved.fit) { page.fit = true; page.sized = false; }
    }
    return out.sort((a, b) => a.title.localeCompare(b.title));
  }

  function htmlMeta(file) {
    let head = '';
    try {
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(4096);
      const n = fs.readSync(fd, buf, 0, 4096, 0);
      fs.closeSync(fd);
      head = buf.subarray(0, n).toString('utf8');
    } catch (_) { return {}; }
    const meta = {};
    const re = /<meta\s+name=["'](?:designbook|design|canvas)-([a-z]+)["']\s+content=["']([^"']*)["']/gi;
    let m;
    while ((m = re.exec(head))) meta[m[1].toLowerCase()] = m[2];
    const title = head.match(/<title>([^<]*)<\/title>/i);
    if (title && !meta.title) meta.title = title[1].trim();
    return meta;
  }

  function listRefs() {
    const meta = readJson(dir('refs.json'), { items: {} });
    return list(dir('refs')).map(name => {
      const item = (meta.items && meta.items[name]) || {};
      return {
        name,
        kind: kindOf(name),
        url: `/@studio/refs/${encodeURIComponent(name)}`,
        note: item.note || '',
        // What kind of decision this reference carries, picked when it was added.
        tags: Array.isArray(item.tags) ? item.tags : [],
        x: typeof item.x === 'number' ? item.x : null,
        y: typeof item.y === 'number' ? item.y : null,
        width: typeof item.width === 'number' ? item.width : 320
      };
    });
  }

  // A frame with nothing in it yet, at exactly the size that was asked for.
  //
  // In a project the canvas can compile experiments for, it is a page of that project,
  // so it can import the project's own layouts and components and is the real thing from
  // the first minute. Only where that is not possible is it a plain HTML file.
  // Which frames somebody is working on right now.
  //
  // An agent runs in a terminal and cannot call into the editor, but it can write a
  // file. One frame id per line in `.designbook/.working` and the board shows that frame as
  // being worked on; remove the line, or the file, and the board loads what was made.
  function working() {
    try {
      return fs.readFileSync(dir('.working'), 'utf8')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'));
    } catch (_) {
      return [];
    }
  }

  // Checking a frame, and what came of it.
  //
  // The agent asks by writing frame ids into `.designbook/.check`, one per line, because it
  // runs in a terminal and cannot call in. The canvas does the looking: it draws the
  // page and measures what is on it. While a frame is being looked at the board shows it
  // being scanned; what is found is kept in `.designbook/checks.json` and shown on the frame.
  const checking = new Set();

  function asked() {
    try {
      return fs.readFileSync(dir('.check'), 'utf8')
        .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    } catch (_) { return []; }
  }

  const readChecks = () => readJson(dir('checks.json'), {}) || {};

  // Where an exported frame lands: the Desktop, where a file you are about to use goes,
  // rather than inside the repo where it would have to be found and then moved.
  function exportsDir() {
    const desktop = path.join(os.homedir(), 'Desktop');
    try { fs.accessSync(desktop, fs.constants.W_OK); return desktop; } catch (_) {}
    return dir('exports');
  }

  async function runCheck(id) {
    const page = listPages().find(p => p.id === id);
    if (!page || !page.url) return;
    const url = page.url.startsWith('http') ? page.url : `http://localhost:${servePort}${page.url}`;
    checking.add(id);
    let issues = [];
    let failed = '';
    try {
      issues = await check({
        url,
        width: page.frame.width,
        height: page.frame.height,
        grow: !page.sized,
        // A screen scrolls, so only what is wider than it is a fault. One whose height was
        // chosen from the phone and desktop sizes is still a screen: choosing the size
        // does not turn it into a poster.
        screen: !page.sized || isScreenSize(page.frame.width, page.frame.height),
        // Tap targets are a screen's problem. A poster has no taps in it.
        touch: (!page.sized || isScreenSize(page.frame.width, page.frame.height)) && page.frame.width <= 500
      });
    } catch (err) {
      failed = err.message;
    }
    checking.delete(id);
    const all = readChecks();
    all[id] = { at: new Date().toISOString(), title: page.title, issues, failed };
    writeJson(dir('checks.json'), all);
    return all[id];
  }

  // One at a time: each one is a browser drawing a page.
  let queue = Promise.resolve();
  function queueCheck(ids) {
    for (const id of ids) {
      if (checking.has(id)) continue;
      checking.add(id);          // shown as scanning from the moment it is asked for
      queue = queue.then(() => { checking.delete(id); return runCheck(id); }).catch(() => {});
    }
    return queue;
  }

  // The pieces the board has made for itself.
  //
  // A badge, a stat block, a quote card: written once for one frame and then wanted
  // again in the next one. They live in `.designbook/parts/` and a page on the board
  // imports them, so the second post is a page of imports rather than a page of new
  // code. Listed here so whoever writes the next one can see what already exists
  // without opening anything.
  function listParts() {
    return list(dir('parts'), /\.(astro|html|jsx)$/).map(name => {
      let note = '';
      try {
        const head = fs.readFileSync(dir('parts', name), 'utf8').slice(0, 600);
        const m = /^\s*(?:\/\/|<!--|\*)\s*(.+)$/m.exec(head.replace(/^---[\s\S]*?\n/, ''));
        if (m) note = m[1].replace(/-->\s*$/, '').trim().slice(0, 120);
      } catch (_) {}
      return { name, file: `parts/${name}`, note };
    });
  }

  // Checked by itself, a moment after it stops changing.
  //
  // A design is finished in a dozen saves, not one, so this waits for the typing to
  // stop. Only the frame whose own file changed is looked at, and only once that file
  // has been still for a few seconds: a check draws the page, which is not free.
  const pending = new Map();   // frame id -> timer
  const SETTLE = 4000;

  function checkSoon(id) {
    clearTimeout(pending.get(id));
    pending.set(id, setTimeout(() => {
      pending.delete(id);
      queueCheck([id]);
    }, SETTLE));
  }

  // Which frames a changed file is behind.
  function framesFrom(file) {
    const rel = path.relative(studioRoot, file).split(path.sep).join('/');
    const inProjectFile = path.relative(projectRoot(), file).split(path.sep).join('/');
    return listPages()
      .filter(p => p.file === rel || p.sourceFile === rel || p.sourceFile === inProjectFile)
      .map(p => p.id);
  }

  // The next number for a frame made here, two digits, counting from what is already
  // in the folder.
  function nextSerial() {
    let top = 0;
    for (const f of list(dir('pages'), /\.(astro|html)$/)) {
      const m = /^(\d+)-/.exec(f);
      if (m) top = Math.max(top, Number(m[1]));
    }
    return String(top + 1).padStart(2, '0');
  }

  // What a frame on the board is called, changed in the file it comes from, with the
  // file renamed to match and every mention of it on the board moved across.
  function renameFrame(id, title) {
    const page = listPages().find(p => p.id === id);
    if (!page) return { error: 'no such frame' };
    if (page.source !== 'canvas') return { error: 'this frame is a page of the project; rename it there' };

    let clean = String(title || '').trim();
    if (!clean) return { error: 'a name is needed' };

    const was = path.basename(page.file);
    const ext = path.extname(was).slice(1);
    const serial = (/^(\d+)-/.exec(was) || [])[1] || nextSerial();
    // The number stays at the front of the name, whether or not it was typed back in.
    const bare = clean.replace(/^\d+[\s.-]+/, '');
    clean = `${serial} ${bare}`;
    let next = `${serial}-${slug(bare)}.${ext}`;
    let n = 2;
    while (next !== was && fs.existsSync(dir('pages', next))) {
      next = `${serial}-${slug(bare)}-${n++}.${ext}`;
    }

    let text = '';
    try { text = fs.readFileSync(dir('pages', was), 'utf8'); } catch (_) { return { error: 'cannot read it' }; }
    text = ext === 'astro'
      ? text.replace(/(\/\/ (?:design|canvas):[^\n]*title=)([^|\n]*)/, (_, head) => `${head}${clean} `)
      : text.replace(/<title>[^<]*<\/title>/i, `<title>${clean.replace(/</g, '&lt;')}</title>`);
    fs.writeFileSync(dir('pages', was), text);
    if (next !== was) {
      fs.renameSync(dir('pages', was), dir('pages', next));
      // The old name is gone because the board renamed it: that is a deliberate removal.
      if (sync) sync.deleted(dir('pages', was));
    }

    const newId = ext === 'astro' ? 'exp:' + next.replace(/\.astro$/, '') : 'canvas:' + next;
    if (newId !== id) {
      const doc = readBoard();
      doc.sections = (doc.sections || []).map(b => ({
        ...b,
        frames: (b.frames || []).map(f => (f === id ? newId : f))
      }));
      if (doc.frames[id]) {
        doc.frames[newId] = doc.frames[id];
        delete doc.frames[id];
      }
      writeBoard(doc);
    }
    return { ok: true, id: newId, file: `pages/${next}`, title: clean };
  }

  const blankAstro = (title, width, height, grow) => `---
// designbook: title=${title} | width=${width} | height=${height}${grow ? ' | grow=yes' : ''}
//
// ${width} x ${height}. Design to this size: it is what the frame is.
//
// Import this project's own components rather than writing new ones, and import them
// from the project's root, never relative to this file:
//   import BaseLayout from '/src/layouts/BaseLayout.astro';
// This folder may live outside the project, and a relative path would walk out of it.
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title.replace(/</g, '&lt;')}</title>
    <style>
      html, body { margin: 0; }
      html { scrollbar-width: none; }
      html::-webkit-scrollbar, body::-webkit-scrollbar { width: 0; height: 0; }
      body {
        width: ${width}px;
        ${grow ? `min-height: ${height}px;` : `height: ${height}px; overflow: hidden;`}
        display: grid;
        place-items: center;
        font: 13px/1.5 -apple-system, system-ui, sans-serif;
        color: #8b9299;
        background: #fff;
      }
    </style>
  </head>
  <body>
    ${width} &times; ${height}
  </body>
</html>
`;

  const blankHtml = (title, width, height, grow) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title.replace(/</g, '&lt;')}</title>
<meta name="designbook-width" content="${width}">
<meta name="designbook-height" content="${height}">${grow ? `\n<meta name="designbook-grow" content="yes">` : ''}
<style>
  /* ${width} x ${height}. Design to this size: it is what the frame is. */
  html, body { margin: 0; }
  html { scrollbar-width: none; }
  html::-webkit-scrollbar, body::-webkit-scrollbar { width: 0; height: 0; }
  body {
    width: ${width}px;
    ${grow ? `min-height: ${height}px;` : `height: ${height}px; overflow: hidden;`}
    display: grid;
    place-items: center;
    font: 13px/1.5 -apple-system, system-ui, sans-serif;
    color: #8b9299;
    background: #fff;
  }
</style>
</head>
<body>
  ${width} &times; ${height}
</body>
</html>
`;

  // Whether this project can see the board folder at all.
  //
  // A canvas that lives somewhere else is linked into the project as `.designbook`, and a
  // bundler resolves a link to where it points, which puts those pages outside the
  // project: their imports fail, nothing in them is watched, and every experiment frame
  // shows the project's error page. One line of config fixes it, and it is the project's
  // line to add, so this says so rather than editing it.
  function checkLink(warn) {
    const cfg = liveConfig();
    if (!cfg) return;
    const link = path.join(cfg.cwd, path.basename(studioRoot));
    let linked = false;
    try { linked = fs.lstatSync(link).isSymbolicLink(); } catch (_) { return; }
    if (!linked) return;

    const config = ['astro.config.mjs', 'astro.config.ts', 'astro.config.js', 'vite.config.js', 'vite.config.ts']
      .map(f => path.join(cfg.cwd, f))
      .find(f => fs.existsSync(f));
    if (!config) return;
    let text = '';
    try { text = fs.readFileSync(config, 'utf8'); } catch (_) { return; }
    if (text.includes('preserveSymlinks')) return;

    warn(
      `[design book] ${path.basename(config)} needs one line, or every experiment will show this ` +
      'project\'s error page:\n' +
      '    vite: { resolve: { preserveSymlinks: true } }\n' +
      `  ${path.basename(studioRoot)} in this project is a link to ${studioRoot}, and without ` +
      'that line the pages in it are resolved outside the project, where their imports do not exist.'
    );
  }

  const emptyPage = title => ({
    title,
    frame: { width: 390, height: 844 },
    group: '',
    data: {
      root: { props: { title } },
      content: [
        { type: 'NavBar', props: { id: 'nav-1', title, leading: 'close' } },
        {
          type: 'ScreenBody',
          props: {
            id: 'body-1',
            children: [
              { type: 'TitleBlock', props: { id: 'title-1', title, subtitle: 'What this screen is for, in one line.' } },
              { type: 'CardRows', props: { id: 'rows-1', context: 'system', rows: 'First | A caption | 12\nSecond |  | 4' } }
            ]
          }
        },
        { type: 'BottomPanel', props: { id: 'cta-1', label: 'Continue', variant: 'primary', disabled: false } }
      ]
    }
  });

  // What goes to Claude in one paste. It names the real files in the open repo, so there
  // is nothing to translate afterwards.
  function briefBody() {
    const found = project();
    const root = projectRoot();
    const styles = found.styles;
    const tokens = styles[0] ? groupTokens(readCustomProperties(path.join(root, styles[0].file))) : null;
    const pages = listPages();
    return rulesBody({
      palette: paletteFor(root),
      native: nativeFor(root),
      projectRoot: root,
      board: boardPath(),
      live: live && live.url ? { url: live.url, command: liveConfig().command } : null,
      pages,
      sections: listSections(pages),
      refs: listRefs(),
      parts: listParts(),
      components: found.components,
      styles,
      tokens,
      preview: previewState(root)
    });
  }

  function brief(pageId) {
    const L = [];
    L.push('# The canvas');
    L.push('');
    if (pageId) {
      L.push(`Working on: \`${pageId}\`.`);
      L.push('');
    }
    L.push(briefBody());
    L.push('');
    L.push('The same text is in `.designbook/CLAUDE.md`, rewritten whenever the project changes.');
    return L.join('\n');
  }

  return {
    name: 'studio',

    // The repo supplies its own catalog if it has one; otherwise the kit shipped with the
    // extension is used. A virtual module is the only way to decide that at resolve time
    // without the missing file breaking the build.
    resolveId(id) {
      if (id === VIRTUAL_CATALOG) return RESOLVED_CATALOG;
      return null;
    },

    // The catalog is assembled here rather than written by hand.
    //
    // The kit ships a set of components, and every .jsx in .designbook/components is added
    // to it automatically: drop a file in and it appears in the palette, in the gallery
    // and in studio.json, with nothing to register. A local component that takes the
    // name of a kit one replaces it, so a repo can override a button without forking
    // the kit.
    load(id) {
      if (id !== RESOLVED_CATALOG) return null;

      const kitPath = path.join(appRoot, 'kit', 'catalog.jsx');
      const derivePath = path.join(appRoot, 'kit', 'derive.js');
      const localDir = dir('components');
      // A file starting with _ is a helper that components share, not a component.
      const local = list(localDir, /\.jsx$/).filter(f => !f.startsWith('_'));

      const imports = local.map((file, i) => `import * as local${i} from ${JSON.stringify(path.join(localDir, file))};`);
      const entries = local.map((file, i) => `normalise(local${i}, ${JSON.stringify('components/' + file)})`);

      return [
        `import KIT from ${JSON.stringify(kitPath)};`,
        `import { buildPuckConfig, buildIndex, normalise } from ${JSON.stringify(derivePath)};`,
        ...imports,
        '',
        `const local = [${entries.join(', ')}].filter(Boolean);`,
        'const taken = new Set(local.map(c => c.name));',
        'export const CATALOG = [...KIT.filter(c => !taken.has(c.name)), ...local];',
        'export const byName = Object.fromEntries(CATALOG.map(c => [c.name, c]));',
        'export const puckConfig = buildPuckConfig(CATALOG);',
        'export const index = buildIndex(CATALOG);',
        ''
      ].join('\n');
    },

    // The repo's own tokens.css and components.css, when it has them, load after the
    // kit's so they override rather than replace. A repo with neither just uses the kit.
    transformIndexHtml() {
      const tags = [];
      for (const name of ['tokens.css', 'components.css']) {
        if (fs.existsSync(dir(name))) {
          tags.push({ tag: 'link', attrs: { rel: 'stylesheet', href: `/@studio/${name}` }, injectTo: 'head' });
        }
      }
      return tags;
    },

    configureServer(server) {
      // Everything derived, rebuilt together and announced once.
      //
      // Any session in the workspace can change a file: another window, a Claude run, a
      // teammate's pull. The board is told over the dev server's own socket, so whatever
      // changed is on screen without anybody refreshing anything.
      let refreshing = null;
      let rescan = false;
      // The last thing this server wrote into the board file when it saved a frame's
      // size. The board file is watched, so a save comes straight back as "something
      // changed", and something changed is a reason to measure a frame that fits its
      // content: one frame would measure itself for ever and the whole board would
      // shuffle every time it landed. A size the board itself just saved is already on
      // screen, so hearing it back says nothing.
      let ownSave = '';
      const textOf = file => { try { return fs.readFileSync(file, 'utf8'); } catch (_) { return ''; } };
      // `source` means a file of the project itself changed, rather than something in
      // the board folder. Only then is it worth walking the project again, re-reading
      // every colour it uses, or asking the dev server which routes it serves: those are
      // the expensive parts, and the board's own files cannot change any of them.
      const refresh = (reason, source) => {
        rescan = rescan || !!source;
        clearTimeout(refreshing);
        refreshing = setTimeout(async () => {
          const walk = rescan;
          rescan = false;
          if (walk) {
            projectCache.value = null;
            paletteCache.value = null;
            readyCache.clear();
            const cfg = liveConfig();
            if (cfg && live && live.url) {
              const wanted = cfg.routes || discoverRoutes(cfg.cwd);
              live.routes = await resolveRoutes(live.url, wanted);
            }
          }
          await writeIndex();
          writeRulesFile();
          server.ws.send({ type: 'custom', event: 'studio:changed', data: { reason } });
        }, 300);
      };

      // The rules file says what the canvas is showing, so it is written from the same
      // data the board uses and never by hand.
      const writeRulesFile = () => {
        if (setupNeeded()) return;
        try {
          const found = project();
          const root = projectRoot();
          const styles = stylesFor();
          const tokens = styles[0]
            ? groupTokens(readCustomProperties(path.join(root, styles[0].file)))
            : null;
          const pages = listPages();
          writeRules(dir('CLAUDE.md'), rulesBody({
            palette: paletteFor(root),
            native: nativeFor(root),
            projectRoot: root,
            board: boardPath(),
            live: live && live.url ? { url: live.url, command: liveConfig().command } : null,
            pages,
            sections: listSections(pages),
            refs: listRefs(),
            parts: listParts(),
            components: found.components,
            styles,
            tokens,
            preview: previewState(root)
          }));
        } catch (err) {
          server.config.logger.warn('[design book] could not write CLAUDE.md: ' + err.message);
        }
      };

      const writeIndex = async () => {
        if (setupNeeded()) return;
        try {
          const mod = await server.ssrLoadModule(VIRTUAL_CATALOG);
          writeJson(dir('studio.json'), {
            generated: new Date().toISOString(),
            note: 'Generated by the Design Studio extension. Do not edit.',
            studio: config().name || path.basename(repoRoot),
            board: boardPath(),
            repo: repoRoot,
            sections: listSections(listPages()).map(b => ({ name: b.name, frames: b.frames })),
            parts: listParts(),
            pages: listPages().map(p => ({ id: p.id, kind: p.kind, source: p.source, file: p.file })),
            components: mod.index.components
          });
        } catch (err) {
          server.config.logger.warn('[studio] could not write studio.json: ' + err.message);
        }
      };
      writeIndex();

      const cfg = liveConfig();
      if (cfg) {
        live = new LiveSource({
          cwd: cfg.cwd,
          command: cfg.command,
          log: line => server.config.logger.info(line)
        });
        live.start().then(async port => {
          // A port with nothing behind it is worse than none: every frame would point at
          // an address that answers nothing and the board would look empty for no stated
          // reason.
          if (!port || !live.url) {
            live.status = 'failed';
            server.config.logger.warn(`[live] ${cfg.command} did not leave a dev server to show. See the output above.`);
            return;
          }
          server.config.logger.info(`[live] ${cfg.command} is on ${live.url}`);
          // The board waits for "running", so it is held back until the routes are known:
          // handing it an unchecked route shows that framework's 404 page in every frame.
          live.status = 'routing';
          const wanted = cfg.routes || discoverRoutes(cfg.cwd);
          live.routes = await resolveRoutes(live.url, wanted);
          live.status = 'running';
          server.config.logger.info(`[live] ${live.routes.length} routes: ${live.routes.join(' ')}`);
          await writeIndex();
          writeRulesFile();
          watchProject(cfg.cwd);
          checkLink(line => server.config.logger.warn(line));
          server.ws.send({ type: 'custom', event: 'studio:live', data: { url: live.url } });
        });
        server.httpServer?.on('close', () => live && live.stop());
      }

      const watchProject = root => {
        const interesting = [
          'src/pages', 'src/components', 'src/layouts', 'src/styles', 'src/content',
          'app', 'pages', 'components', 'styles', 'public'
        ];
        for (const rel of interesting) {
          const full = path.join(root, rel);
          if (fs.existsSync(full)) server.watcher.add(full);
        }
        server.config.logger.info('[design book] watching the project for new routes and components');
      };

      server.httpServer?.on('listening', () => {
        const at = server.httpServer.address();
        if (at && typeof at === 'object') servePort = at.port;
        // The address this board answers on, written where anything working in this repo
        // can read it. An agent in a terminal can then ask the board to do a thing in one
        // line instead of reading its way to the same answer.
        try { fs.writeFileSync(dir('.port'), String(servePort) + '\n'); } catch (_) {}
      });

      // Gone when the board is gone, so nobody talks to a port that answers something
      // else now.
      server.httpServer?.on('close', () => {
        try { fs.unlinkSync(dir('.port')); } catch (_) {}
      });

      // An agent asks for a check by writing `.designbook/.check`. The folder is watched
      // already; this picks the ask up and starts the work.
      const takeAsk = () => {
        const ids = asked();
        if (!ids.length) return;
        try { fs.unlinkSync(dir('.check')); } catch (_) {}
        server.config.logger.info(`[design book] checking ${ids.length} frame(s)`);
        queueCheck(ids).then(() => {
          server.ws.send({ type: 'custom', event: 'studio:changed', data: { reason: 'checked' } });
        });
        server.ws.send({ type: 'custom', event: 'studio:changed', data: { reason: 'checking' } });
      };
      // Looked for, not watched for.
      //
      // These two are how an agent in a terminal talks to the board, and they are
      // dotfiles, which the dev server's watcher does not report. So they are checked a
      // second at a time: two stats, which costs nothing, and it never misses one.
      const stamp = f => { try { return String(fs.statSync(f).mtimeMs); } catch (_) { return ''; } };
      let lastWorking = stamp(dir('.working'));
      let wasWorking = working();
      const listen = setInterval(() => {
        const now = stamp(dir('.working'));
        if (now !== lastWorking) {
          const before = wasWorking;
          wasWorking = working();
          lastWorking = now;
          // Whoever was working has stopped: look over what they left.
          for (const id of before.filter(x => !wasWorking.includes(x))) checkSoon(id);
          server.ws.send({ type: 'custom', event: 'studio:changed', data: { reason: 'working' } });
        }
        if (fs.existsSync(dir('.check'))) takeAsk();
      }, 1000);
      server.httpServer?.on('close', () => clearInterval(listen));
      takeAsk();

      server.watcher.add(studioRoot);
      server.watcher.add(boardPath());
      writeRulesFile();
      const invalidateCatalog = () => {
        const mod = server.moduleGraph.getModuleById(RESOLVED_CATALOG);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
        writeIndex();
      };
      const isComponent = file => file.startsWith(dir('components') + path.sep) && file.endsWith('.jsx');
      const inProject = file => file.startsWith(projectRoot() + path.sep);
      // What this server writes itself. Watching these and rebuilding from them is a
      // loop: every rebuild writes them again, so the board would rescan the project,
      // re-probe every route and tell every window that something changed, several times
      // a second, for as long as it was open. It was the slowest thing here and the
      // reason frames would not sit still.
      const mine = file => file === dir('studio.json') || file === dir('CLAUDE.md')
        || file === dir('checks.json') || file === dir('.port') || file === dir('.sync.json');

      // Keeping the board's files on the default branch, whatever branch this checkout is on.
      // Off until somebody turns it on for this repo on this machine (see sync.js).
      sync = createSync({
        boardFile: boardPath(),
        studioRoot,
        log: line => server.config.logger.info(line),
        isWorking: () => working().length > 0,
        debounce: Number(process.env.STUDIO_SYNC_DEBOUNCE) || 8000
      });
      sync.onChange(s => { try { server.ws.send({ type: 'custom', event: 'studio:sync', data: s }); } catch (_) {} });
      server.httpServer && server.httpServer.on('close', () => sync.stop());
      server.httpServer && server.httpServer.once('listening', () => setTimeout(() => sync.start(), 1500));
      // The same thing for the board file, which is written by hand as well as by us, so
      // it is what the file says rather than which file it is that decides.
      const ourOwnSave = file => file === boardPath() && textOf(file) === ownSave;
      const matters = file =>
        !mine(file) && !ourOwnSave(file)
        && (inProject(file) || file.startsWith(studioRoot + path.sep) || file === boardPath());

      server.watcher.on('change', file => {
        sync.touched(file);
        if (file === dir('.working') && !working().length) sync.finished();
        if (isComponent(file) || file.endsWith('catalog.jsx')) return invalidateCatalog();
        if (matters(file)) {
          refresh('change', inProject(file));
          for (const id of framesFrom(file)) checkSoon(id);
        }
      });
      server.watcher.on('add', file => {
        sync.touched(file);
        if (isComponent(file)) return invalidateCatalog();
        if (matters(file)) {
          refresh('add', inProject(file));
          for (const id of framesFrom(file)) checkSoon(id);
        }
      });
      server.watcher.on('unlink', file => {
        sync.touched(file);
        if (file === dir('.working')) sync.finished();
        if (isComponent(file)) return invalidateCatalog();
        if (matters(file)) refresh('unlink', inProject(file));
      });

      server.middlewares.use('/__api', (req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        const q = url.searchParams;
        const route = url.pathname.replace(/\/+$/, '') || '/';
        const send = (value, code = 200) => { res.writeHead(code, JSONH); res.end(JSON.stringify(value)); };
        const body = () => new Promise(resolve => {
          let raw = '';
          req.on('data', c => (raw += c));
          req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch (_) { resolve({}); } });
        });

        (async () => {
          if (route === '/project') {
            const found = project();
            const root = projectRoot();
            return send({
              root,
              components: found.components,
              styles: stylesFor(),
              liveUrl: live && live.url ? live.url : '',
              preview: previewState(root)
            });
          }

          // Previews need one file in the project, so turning them on is a decision the
          // person makes, and turning them off removes it again.
          if (route === '/preview/enable' && req.method === 'POST') {
            const root = projectRoot();
            const css = project().styles[0] && project().styles[0].file;
            projectCache.value = null;
            const state = enablePreview(root, css);
            writeExperimentRoute(root, studioRoot);
            return send({ ...state, experiments: experimentState(root) });
          }
          if (route === '/preview/disable' && req.method === 'POST') {
            projectCache.value = null;
            const state = disablePreview(projectRoot());
            removeExperimentRoute(projectRoot());
            return send({ ...state, experiments: experimentState(projectRoot()) });
          }

          // Tokens are editable from the canvas as well as by Claude: both end up
          // changing the same line of the project's own stylesheet.
          // Everything the project uses, not only what it declared as a token.
          if (route === '/palette') {
            const root = projectRoot();
            return send({ root, ...paletteFor(root) });
          }

          if (route === '/tokens' && req.method === 'PUT') {
            const { file: rel, scope, name, value } = await body();
            const root = projectRoot();
            const target = path.resolve(root, rel || (stylesFor()[0] || {}).file || '');
            const withSep = root.endsWith(path.sep) ? root : root + path.sep;
            if (!target.startsWith(withSep)) return send({ error: 'outside the project' }, 403);
            const result = writeCustomProperty(target, { scope: scope || '', name, value });
            if (!result.ok) return send(result, 400);
            projectCache.value = null;
            return send({ ok: true });
          }

          if (route === '/tokens') {
            const root = projectRoot();
            const rel = q.get('file') || (stylesFor()[0] || {}).file;
            if (!rel) return send({ file: '', tokens: { colours: [], lengths: [], fonts: [], other: [] } });
            const target = path.resolve(root, rel);
            const withSep = root.endsWith(path.sep) ? root : root + path.sep;
            if (!target.startsWith(withSep)) return send({ error: 'outside the project' }, 403);
            const properties = readCustomProperties(target);
            return send({ file: rel, count: properties.length, tokens: groupTokens(properties) });
          }

          if (route === '/live') {
            const cfg = liveConfig();
            return send({
              configured: !!cfg,
              status: live ? live.status : 'idle',
              url: live ? live.url : '',
              cwd: cfg ? cfg.cwd : '',
              command: cfg ? cfg.command : '',
              output: live ? live.output.slice(-20).join('') : ''
            });
          }

          // Is this frame's page actually being served?
          //
          // A frame must never show a framework's error page. That page is the dev
          // server talking to a developer about its own internals; on a board it reads
          // as though the design is broken. So the board asks first and shows that the
          // page is coming until it is really there.
          if (route === '/ready' && q.get('page')) {
            const found = listPages().find(p => p.id === q.get('page'));
            if (!found) return send({ ok: false, status: 0, why: 'no such frame' });
            if (!found.url) return send({ ok: true, status: 200 });

            const url = found.url.startsWith('http')
              ? found.url
              : `http://${req.headers.host || 'localhost:' + servePort}${found.url}`;

            return send(await served(url));
          }


          // ── reading a frame, one element at a time ────────────────────────────
          //
          // The board cannot look inside a frame running a project's own dev server, so the
          // headless browser opens the same address at the same width and reads that. A
          // session keeps one frame open for a couple of minutes, so asking about a second
          // element does not draw the page again. See inspect.js.
          if (/^\/(scan|element|audit|shot|remember|compare|undo|redo)/.test(route) && req.method === 'POST') {
            const asked = await body();
            const found = listPages().find(p => p.id === (asked.page || ''));
            const gone = route === '/compare' || route === '/undo' || route === '/redo';
            if (!gone && (!found || !found.url)) return send({ error: 'this frame has no page to read' }, 404);
            const shots = path.join(cacheRoot(studioRoot), 'shots');
            const toUrl = f => (f.url.startsWith('http') ? f.url : `http://${req.headers.host || 'localhost:' + servePort}${f.url}`);
            const open = fresh => {
              const key = `${found.id}|${found.frame.width}x${found.frame.height}`;
              if (fresh) forgetSessions(key);
              return inspectSession({ key, url: toUrl(found), width: found.frame.width, height: found.frame.height });
            };
            const screen = found && (!found.sized || isScreenSize(found.frame.width, found.frame.height));
            // A frame that was reloaded, or taken away, closes the page that was open on it
            // while a question was still being asked of it. The question is asked again, once,
            // of a page that is open.
            const retry = async job => {
              try { return await job(); } catch (err) {
                if (!found || !/detached|closed|Session|Target|Protocol/i.test(String(err.message))) throw err;
                forgetSessions(`${found.id}|`);
                return job();
              }
            };
            try {
              if (route === '/scan') {
                return send({ ok: true, ...(await retry(async () => inspectScan(await open(asked.fresh)))) });
              }
              if (route === '/element') {
                return send(await retry(async () => inspectDetail(await open(), Number(asked.i), { root: projectRoot(), studioRoot })));
              }
              if (route === '/audit') {
                return send(await retry(async () => auditElement(await open(), Number(asked.i), { screen, touch: screen && found.frame.width <= 500 })));
              }
              if (route === '/shot') {
                const made = await retry(async () => shotElement(await open(), {
                  i: Number(asked.i), mode: asked.mode, pad: Number(asked.pad) || 8, dir: shots,
                  marks: Array.isArray(asked.marks) ? asked.marks.map(m => ({ i: Number(m.i), n: Number(m.n) || 0 })) : [],
                  label: asked.label || found.title
                }));
                return send(made.stale ? { stale: true } : { ok: true, ...made });
              }
              if (route === '/shot/rect') {
                return send({ ok: true, ...(await retry(async () => shotRect(await open(), { x: Number(asked.x), y: Number(asked.y), w: Number(asked.w), h: Number(asked.h), dir: shots, label: asked.label || found.title }))) });
              }
              if (route === '/shot/states') {
                const made = await retry(async () => shotStates(await open(), { i: Number(asked.i), dir: shots, label: asked.label || found.title }));
                return send(made.stale ? { stale: true } : { ok: true, ...made });
              }
              if (route === '/shot/sizes') {
                const widths = (Array.isArray(asked.widths) && asked.widths.length ? asked.widths : [390, 768, 1440])
                  .map(Number).filter(n => n >= 200 && n <= 4000).slice(0, 6);
                const made = await shotSizes({ url: toUrl(found), widths, find: asked.find || {}, height: found.frame.height, dir: shots, label: asked.label || found.title });
                return send(made.none ? { none: true, missing: made.missing } : { ok: true, ...made });
              }

              // Remembering how an element looked, and the files as they were.
              const remembered = path.join(cacheRoot(studioRoot), 'remembered');
              const itemFile = id => path.join(remembered, String(id).replace(/[^\w-]/g, '') + '.json');
              const readItem = id => { try { return JSON.parse(fs.readFileSync(itemFile(id), 'utf8')); } catch (_) { return null; } };
              const writeItem = item => { fs.mkdirSync(remembered, { recursive: true }); fs.writeFileSync(itemFile(item.id), JSON.stringify(item)); };

              if (route === '/remember') {
                const live = await retry(async () => open());
                const d = await inspectDetail(live, Number(asked.i), { root: projectRoot(), studioRoot });
                if (d.stale) return send({ stale: true });
                const shot = await shotElement(live, { i: Number(asked.i), mode: 'element', dir: shots, label: 'before' });
                const snap = await gitSnapshot(projectRoot());
                const item = {
                  id: Date.now().toString(36), page: found.id, label: asked.label || d.tag, at: Date.now(),
                  frame: { width: found.frame.width, height: found.frame.height },
                  find: { path: d.path, selector: d.selector, text: (d.text || '').slice(0, 60), tag: d.tag },
                  shot: { name: shot.name, file: shot.file }, git: snap, source: d.source
                };
                writeItem(item);
                return send({ ok: true, id: item.id, git: !!snap });
              }

              const item = readItem(asked.id);
              if (!item) return send({ error: 'nothing remembered under that name' }, 404);
              const there = listPages().find(p => p.id === item.page);

              if (route === '/compare') {
                if (!there || !there.url) return send({ error: 'that frame is gone' }, 404);
                const now = await shotAgain({ url: toUrl(there), width: item.frame.width, height: item.frame.height, find: item.find });
                const before = fs.readFileSync(item.shot.file);
                const sheet = await sheetOf([{ label: 'Before', bytes: before }, ...(now ? [{ label: `Now  ${now.size}`, bytes: now.bytes }] : [])]);
                const diff = item.git ? await gitSince(item.git) : null;
                return send({
                  ok: true, sheet: keepPicture(shots, 'compare', sheet), gone: !now,
                  git: !!item.git, changed: diff ? diff.changed : [], added: diff ? diff.added : [],
                  undone: item.undone || null
                });
              }
              if (route === '/undo') {
                if (!item.git) return send({ error: 'this project is not in git, so there is nothing to go back to' }, 400);
                const files = Array.isArray(asked.files) ? asked.files.map(String) : [];
                const done = await gitRestore(item.git, files);
                item.undone = { files: done.restored, redo: done.redo };
                writeItem(item);
                return send({ ok: true, restored: done.restored });
              }
              if (route === '/redo') {
                if (!item.undone || !item.undone.redo) return send({ error: 'nothing to bring back' }, 400);
                const done = await gitRestore({ root: item.git.root, hash: item.undone.redo, untracked: [] }, item.undone.files);
                item.undone = null;
                writeItem(item);
                return send({ ok: true, restored: done.restored });
              }
            } catch (err) {
              return send({ error: err.message }, 500);
            }
          }

          // A picture the board has made, to paste or to look at. Only from the folder they
          // are kept in.
          if (route === '/shotfile' && q.get('name')) {
            const file = path.join(cacheRoot(studioRoot), 'shots', path.basename(q.get('name')));
            if (!fs.existsSync(file)) { res.writeHead(404, JSONH); return res.end('{}'); }
            res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
            return res.end(fs.readFileSync(file));
          }
          // A picture made in the board itself (a note drawn on one, two put side by side) is
          // kept the same way, so it can be pasted the same way.
          if (route === '/shot/save' && req.method === 'PUT') {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const bytes = Buffer.concat(chunks);
            if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) return send({ error: 'a PNG is needed' }, 400);
            return send({ ok: true, ...keepPicture(path.join(cacheRoot(studioRoot), 'shots'), q.get('label') || 'picture', bytes) });
          }
          if (route === '/remembered' && q.get('page')) {
            const folder = path.join(cacheRoot(studioRoot), 'remembered');
            let items = [];
            try {
              items = fs.readdirSync(folder).filter(f => f.endsWith('.json'))
                .map(f => JSON.parse(fs.readFileSync(path.join(folder, f), 'utf8')))
                .filter(i => i.page === q.get('page'))
                .sort((a, b) => b.at - a.at)
                .map(i => ({ id: i.id, label: i.label, at: i.at, selector: i.find && i.find.selector, git: !!i.git, undone: !!i.undone }));
            } catch (_) {}
            return send({ items });
          }

          // Keeping the board's files on the default branch (sync.js). The state is also
          // pushed over the socket, so this is read once and then heard.
          if (route === '/sync' && req.method === 'GET') {
            return send({ ...sync.status(), ...(await sync.probe()) });
          }
          if (route === '/sync/enable' && req.method === 'POST') {
            const { on } = await body();
            return send(await sync.enable(!!on));
          }
          if (route === '/sync/now' && req.method === 'POST') {
            return send(await sync.now());
          }
          if (route === '/sync/approve' && req.method === 'POST') {
            const { action } = await body();
            return send(action === 'revert' ? await sync.revert() : await sync.approve());
          }
          if (route === '/sync/resolve' && req.method === 'POST') {
            const { path: file, take } = await body();
            if (take !== 'mine' && take !== 'theirs') return send({ error: 'mine or theirs' }, 400);
            return send(await sync.resolve(String(file || ''), take));
          }

          // A frame's picture, and asking for one to be drawn.
          //
          // GET is the picture if there is one. POST draws it if there is not (or if the
          // frame has changed since), and answers when it is done, so the board asks once
          // and then fetches. Drawing is queued, newest ask first, one page at a time.
          if (route === '/poster' && req.method === 'GET' && q.get('page')) {
            const have = readPoster(studioRoot, q.get('page'));
            if (!have) { res.writeHead(404, JSONH); return res.end('{}'); }
            res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
            return res.end(fs.readFileSync(have.file));
          }
          if (route === '/poster' && req.method === 'POST') {
            const { page: id, again } = await body();
            const found = listPages().find(p => p.id === id);
            if (!found || !found.url) return send({ ok: false, why: 'this frame has no page to draw' }, 404);
            const url = found.url.startsWith('http')
              ? found.url
              : `http://${req.headers.host || 'localhost:' + servePort}${found.url}`;
            if (again) forgetPoster(studioRoot, id);
            const want = { width: found.frame.width, height: found.frame.height, changed: found.changed || 0 };
            const have = readPoster(studioRoot, id, want);
            if (have && have.fresh) return send({ ok: true, ...have.meta });

            // Answered at once, and told over the socket when it is drawn. A browser keeps six
            // connections to one address, and a board of eighty frames asking for eighty
            // pictures that each take seconds would hold every one of them, with everything
            // else the board asks for waiting behind.
            ensurePoster({
              root: studioRoot,
              id,
              shot: { url, width: found.frame.width, height: found.frame.height },
              want,
              ready: () => served(url).then(v => v.ok)
            }).then(answer => {
              server.ws.send({ type: 'custom', event: 'studio:poster', data: { id, ok: !!answer.ok, at: answer.at || 0 } });
            }).catch(() => {});
            return send({ queued: true });
          }

          if (route === '/studio') {
            const pages = listPages();
            return send({
              root: studioRoot,
              repo: repoRoot,
              board: boardPath(),
              name: config().name || path.basename(repoRoot),
              setup: { needed: setupNeeded(), running: settingUp, repo: repoRoot },
              working: working(),
              checking: [...checking],
              checks: readChecks(),
              // `poster` is when its picture was drawn, so a frame asks for the picture
              // only if there is one, and draws one if there is not.
              pages: pages.map(p => {
                if (!p.url) return p;
                const have = readPoster(studioRoot, p.id);
                return have ? { ...p, poster: have.meta.at } : p;
              }),
              sections: listSections(pages).map(({ id, name, frames }) => ({ id, name, frames })),
              refs: listRefs().length,
              live: {
                configured: !!liveConfig(),
                status: live ? live.status : 'idle',
                url: live ? live.url : ''
              }
            });
          }

          // Looking for something across the whole board.
          //
          // The name of a frame first, because that is what somebody remembers. Then
          // what is written inside one: the file behind each frame is read and the
          // matching lines come back with it, so a word from a headline finds the screen
          // it is on. Reading is capped on every side, because this runs on every
          // keystroke.
          if (route === '/find') {
            const asked = String(q.get('q') || '').trim();
            if (asked.length < 2) return send({ titles: [], inside: [] });
            const needle = asked.toLowerCase();
            const pages = listPages();

            const titles = pages
              .filter(page => String(page.title || '').toLowerCase().includes(needle))
              .slice(0, 12)
              .map(page => ({ id: page.id, title: page.title, where: page.sourceFile || page.file || '' }));

            const named = new Set(titles.map(t => t.id));
            const inside = [];
            let read = 0;
            for (const page of pages) {
              if (inside.length >= 12 || read >= 200) break;
              const rel = page.sourceFile || page.file;
              if (!rel) continue;
              const file = path.resolve(studioRoot, rel);
              let text = '';
              try {
                if (fs.statSync(file).size > 300000) continue;
                text = fs.readFileSync(file, 'utf8');
              } catch (_) { continue; }
              read++;
              if (!text.toLowerCase().includes(needle)) continue;

              const hits = [];
              const lines = text.split('\n');
              for (let i = 0; i < lines.length && hits.length < 3; i++) {
                if (!lines[i].toLowerCase().includes(needle)) continue;
                hits.push({ line: i + 1, text: lines[i].trim().slice(0, 120) });
              }
              if (hits.length) {
                inside.push({ id: page.id, title: page.title, where: rel, named: named.has(page.id), hits });
              }
            }
            return send({ titles, inside });
          }

          // How tall a frame's page really is, drawn and measured in a real browser.
          // A page of the board's own is at this server's address; a page of the
          // project's is at its dev server's.
          if (route === '/measure' && req.method === 'POST') {
            const asked = await body();
            const url = String(asked.url || '');
            const full = url.startsWith('/') ? `http://localhost:${servePort}${url}` : url;
            if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+\//.test(full)) {
              return send({ error: 'a local address is needed' }, 400);
            }
            try {
              const found = await measureHeight({
                url: full,
                width: Number(asked.width) || 1440,
                viewport: Number(asked.viewport) || 900
              });
              return send(found);
            } catch (err) {
              server.config.logger.warn('[studio] could not measure ' + full + ': ' + err.message);
              return send({ error: err.message }, 500);
            }
          }

          // The setup pass, with its progress coming from the work rather than from a
          // timer: every step the walk, the conversions and the reading actually take is
          // sent as it happens, over the same socket the board hears about changes on.
          if (route === '/setup' && req.method === 'POST') {
            if (settingUp) return send({ error: 'it is already running' }, 409);
            settingUp = true;
            const tell = data => server.ws.send({ type: 'custom', event: 'studio:setup', data });
            try {
              const summary = await runSetup({
                repoRoot,
                studioRoot,
                boardFile: boardPath(),
                name: path.basename(repoRoot).replace(/^\d+-/, ''),
                canCompile,
                say: tell
              });
              // The board file exists now, so everything derived from it can be written:
              // the rules an agent reads, and the index it reads instead of the files.
              tell({ step: 6, steps: 6, message: 'writing the rules and the index' });
              projectCache.value = null;
              paletteCache.value = null;
              // Both were added before they existed, which a watcher cannot follow, so
              // the board's own folder is watched from here on.
              try { server.watcher.add([studioRoot, boardPath()]); } catch (_) {}
              await writeIndex();
              writeRulesFile();
              tell({ step: 6, steps: 6, message: 'the board is ready', summary });
              server.ws.send({ type: 'custom', event: 'studio:changed', data: { reason: 'setup' } });
              return send({ ok: true, ...summary });
            } catch (err) {
              tell({ error: err.message });
              return send({ error: err.message }, 500);
            } finally {
              settingUp = false;
            }
          }

          // What the repo holds, where it holds it: written by the setup pass, so the
          // moodboard can show a project's own pictures without a copy of any of them.
          if (route === '/assets') {
            const doc = readJson(dir('assets.json'), null);
            if (!doc) return send({ images: [], icons: [], logos: [], fonts: [] });
            return send(doc);
          }

          if (route === '/page' && q.get('page')) {
            const file = dir('pages', q.get('page') + '.json');
            if (req.method === 'GET') {
              const doc = readJson(file, null);
              return doc ? send(doc) : send({ error: 'no such screen' }, 404);
            }
            if (req.method === 'PUT') {
              const incoming = await body();
              writeJson(file, { ...readJson(file, emptyPage(q.get('page'))), ...incoming });
              return send({ ok: true });
            }
          }

          // A frame made here, at the size that was asked for.
          //
          // It is an ordinary HTML file in .designbook/pages, which works in any repo
          // whatever it is written in, and it declares its own size, so a 1080 x 1920
          // story stays 1080 x 1920 and whatever is designed in it is designed to that.
          if (route === '/frame/new' && req.method === 'POST') {
            const { title, width, height, section, after, grow } = await body();
            const w = Math.max(40, Math.round(Number(width) || 390));
            const h = Math.max(40, Math.round(Number(height) || 844));
            if (!title) return send({ error: 'a name is needed' }, 400);

            // A page of the project when the project can serve one, a plain file when not.
            const asAstro = !!liveConfig() && experimentState(projectRoot()).enabled;
            const ext = asAstro ? 'astro' : 'html';
            // Numbered, so the frames you made read in the order you made them and can
            // be spoken about: "the third one". The number stays with the frame when it
            // is renamed.
            const serial = nextSerial();
            const named = `${serial} ${title}`;
            const id = `${serial}-${slug(title)}`;
            let file = `${id}.${ext}`;
            let n = 2;
            while (fs.existsSync(dir('pages', file))) file = `${id}-${n++}.${ext}`;
            fs.mkdirSync(dir('pages'), { recursive: true });
            fs.writeFileSync(
              dir('pages', file),
              asAstro ? blankAstro(named, w, h, grow) : blankHtml(named, w, h, grow)
            );

            // Where a new frame lands.
            //
            // Next to the frame you were looking at when you made it, because that is
            // what you are comparing it with. Nothing selected, and it goes last on the
            // board, where new work goes. Never among the pages at the front, which is
            // where the automatic placement would otherwise put it.
            const frameId = asAstro ? 'exp:' + file.replace(/\.astro$/, '') : 'canvas:' + file;
            const doc = readBoard();
            const bands = listSections(listPages())
              .map(({ id: bandId, name, frames }) => ({
                id: bandId,
                name,
                frames: frames.filter(f => f !== frameId)
              }));

            const beside = after ? bands.find(b => b.frames.includes(after)) : null;
            if (beside) {
              beside.frames.splice(beside.frames.indexOf(after) + 1, 0, frameId);
            } else {
              const into = bands.find(b => b.id === section) || bands[bands.length - 1];
              if (into) into.frames.push(frameId);
            }
            doc.sections = bands;
            writeBoard(doc);
            return send({ ok: true, id: frameId, file: `pages/${file}`, width: w, height: h });
          }

          // A frame as a picture, for anything that leaves the board: a post, a slide, a
          // message to somebody who does not have this open.
          // Thrown away, not destroyed: the file goes to .designbook/.trash, where it can be
          // fished back out. A page of the project is not ours to delete.
          if (route === '/frame/delete' && req.method === 'POST') {
            const { page } = await body();
            const found = listPages().find(p => p.id === page);
            if (!found) return send({ error: 'no such frame' }, 404);
            if (found.source !== 'canvas') {
              return send({ error: 'this frame is a page of the project; delete it there' }, 400);
            }
            const from = dir(found.file);
            const name = `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${path.basename(found.file)}`;
            fs.mkdirSync(dir('.trash'), { recursive: true });
            try { fs.renameSync(from, dir('.trash', name)); }
            catch (err) { return send({ error: err.message }, 500); }
            // The board deleted it, so it is deleted for everybody: the only kind of delete that is shared.
            sync.deleted(from);

            const doc = readBoard();
            doc.sections = (doc.sections || []).map(b => ({
              ...b,
              frames: (b.frames || []).filter(f => f !== page)
            }));
            delete doc.frames[page];
            writeBoard(doc);
            return send({ ok: true, trashed: `.trash/${name}` });
          }

          if (route === '/check' && req.method === 'POST') {
            const { page, pages } = await body();
            const ids = Array.isArray(pages) ? pages : [page].filter(Boolean);
            if (!ids.length) return send({ error: 'which frame?' }, 400);
            await queueCheck(ids);
            const all = readChecks();
            return send({ ok: true, checks: Object.fromEntries(ids.map(i => [i, all[i]])) });
          }

          if (route === '/working') {
            if (req.method === 'GET') return send({ working: working() });
            if (req.method === 'PUT') {
              const { ids } = await body();
              const list = Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
              if (list.length) fs.writeFileSync(dir('.working'), list.join('\n') + '\n');
              else { try { fs.unlinkSync(dir('.working')); } catch (_) {} }
              return send({ ok: true, working: list });
            }
          }

          // Moving a frame: into another section, or to another place in the one it is in.
          //
          // One call, rather than reading every section, editing the list and putting the
          // whole thing back. That round trip is the expensive part when an agent is the
          // one moving frames, and the list it would have to carry grows with the board.
          if (route === '/frame/move' && req.method === 'POST') {
            const { page, section, after, to } = await body();
            const pages = listPages();
            if (!pages.some(p => p.id === page)) return send({ error: 'no such frame' }, 404);
            if (section === undefined && after === undefined && to === undefined) {
              return send({ error: 'say where: a section, a frame to land after, or a place' }, 400);
            }

            const bands = listSections(pages)
              .map(({ id, name, frames, saved }) => ({ id, name, saved, frames: [...frames] }));
            const from = bands.find(b => b.frames.includes(page));

            const asked = section === undefined || section === null || section === '' ? null : String(section);
            let into = asked === null
              ? from
              : bands.find(b => b.id === asked)
                || bands.find(b => b.name.toLowerCase() === asked.toLowerCase());
            if (asked !== null && !into) {
              // A section nobody has made yet is made here, rather than the move failing
              // and asking for a second call to make it first.
              let id = slug(asked) || 'section';
              while (bands.some(b => b.id === id)) id += '-2';
              into = { id, name: asked.slice(0, 60), saved: true, frames: [] };
              bands.push(into);
            }
            if (!into) return send({ error: 'no such section' }, 404);

            if (from) from.frames = from.frames.filter(f => f !== page);
            into.frames = into.frames.filter(f => f !== page);

            // Where it lands: behind a named frame, at a place counted from the left, or
            // at the end, which is where something moved without a place belongs.
            let index = into.frames.length;
            if (after !== undefined && after !== null) {
              if (after === '' || after === 'start') index = 0;
              else {
                const at = into.frames.indexOf(String(after));
                index = at < 0 ? into.frames.length : at + 1;
              }
            } else if (to === 'start') {
              index = 0;
            } else if (to !== undefined && to !== null && to !== 'end') {
              const n = Number(to);
              if (Number.isFinite(n)) index = Math.max(0, Math.min(into.frames.length, Math.round(n)));
            }
            into.frames.splice(index, 0, page);

            const doc = readBoard();
            // A section somebody made stays even when the last frame leaves it; one that
            // was never asked for goes with its frames.
            doc.sections = bands
              .filter(b => b.frames.length || b.saved)
              .map(({ id, name, frames }) => ({ id, name, frames }));
            writeBoard(doc);
            return send({ ok: true, section: into.id, index, sections: listSections(pages) });
          }

          if (route === '/frame/rename' && req.method === 'POST') {
            const { page, title } = await body();
            const done = renameFrame(page, title);
            return send(done, done.error ? 400 : 200);
          }

          if (route === '/export' && req.method === 'POST') {
            const asked = await body();
            const found = listPages().find(p => p.id === asked.page);
            if (!found) return send({ error: 'no such frame' }, 404);
            if (!found.url) return send({ error: 'this frame is drawn by the canvas and has no page to shoot' }, 400);
            // A live route is already an absolute URL on its own dev server; a page this
            // server serves is shot through the address the board itself is talking to.
            const url = found.url.startsWith('http')
              ? found.url
              : `http://${req.headers.host || 'localhost:' + servePort}${found.url}`;
            try {
              const made = await shoot({
                url,
                width: found.frame.width,
                height: found.frame.height,
                dir: exportsDir(),
                name: slug(found.title),
                format: asked.format,
                scale: asked.scale,
                quality: asked.quality,
                background: asked.background,
                whole: asked.whole
              });
              return send({ ok: true, ...made });
            } catch (err) {
              return send({ error: err.message }, 500);
            }
          }

          if (route === '/export/can') {
            return send({ browser: findBrowser() });
          }

          if (route === '/page/new' && req.method === 'POST') {
            const { title } = await body();
            if (!title) return send({ error: 'a title is needed' }, 400);
            const id = slug(title);
            const file = dir('pages', id + '.json');
            if (!fs.existsSync(file)) writeJson(file, emptyPage(title));
            return send({ ok: true, id });
          }

          // How big a frame is, and which band it sits in, belong to the board file in
          // the repo, not to this machine: open it anywhere and it is the same board.
          if (route === '/positions' && req.method === 'PUT') {
            const incoming = await body();
            const doc = readBoard();
            for (const [id, patch] of Object.entries(incoming.frames || {})) {
              const keep = { ...(doc.frames[id] || {}) };
              if (typeof patch.width === 'number') keep.width = patch.width;
              if (typeof patch.height === 'number') keep.height = patch.height;
              // Whether this frame is as tall as what is in it. Kept, because it is a
              // standing choice: the height beside it is only the last measurement.
              if (typeof patch.fit === 'boolean') {
                if (patch.fit) keep.fit = true;
                else delete keep.fit;
              }
              doc.frames[id] = keep;
            }
            writeBoard(doc);
            // Remembered, so the watcher knows this change for the board's own and does
            // not hand it back as a reason to measure the frame again.
            ownSave = textOf(boardPath());
            return send({ ok: true });
          }

          if (route === '/sections') {
            const pages = listPages();
            if (req.method === 'GET') return send({ sections: listSections(pages) });
            if (req.method === 'PUT') {
              const incoming = await body();
              if (!Array.isArray(incoming.sections)) return send({ error: 'sections must be a list' }, 400);
              const doc = readBoard();
              const seen = new Set();
              doc.sections = incoming.sections.map((band, i) => {
                let id = String(band.id || slug(band.name || 'section')) || 'section';
                while (seen.has(id)) id += '-' + (i + 1);
                seen.add(id);
                return {
                  id,
                  name: String(band.name || 'Section').slice(0, 60),
                  frames: (band.frames || []).map(String)
                };
              });
              writeBoard(doc);
              return send({ ok: true, sections: listSections(pages) });
            }
          }

          if (route === '/board') {
            if (req.method === 'GET') return send(readBoard());
            if (req.method === 'PUT') {
              const incoming = await body();
              const doc = readBoard();
              for (const key of ['name', 'note', 'frame', 'live']) {
                if (key in incoming) doc[key] = incoming[key];
              }
              writeBoard(doc);
              return send({ ok: true });
            }
          }

          if (route === '/refs') {
            if (req.method === 'GET') return send({ refs: listRefs() });
            if (req.method === 'PUT') {
              const incoming = await body();
              const file = dir('refs.json');
              const doc = readJson(file, { items: {} });
              doc.items = doc.items || {};
              for (const [name, patch] of Object.entries(incoming.items || {})) {
                doc.items[name] = { ...(doc.items[name] || {}), ...patch };
              }
              writeJson(file, doc);
              return send({ ok: true });
            }
          }

          // Anything dropped on the moodboard becomes a file in this repo's studio/refs/.
          if (route === '/upload' && req.method === 'POST') {
            const name = path.basename(q.get('name') || '');
            if (!name) return send({ error: 'a name is needed' }, 400);
            fs.mkdirSync(dir('refs'), { recursive: true });
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            let target = dir('refs', name);
            if (fs.existsSync(target)) {
              const ext = path.extname(name);
              const stem = name.slice(0, name.length - ext.length);
              let n = 2;
              while (fs.existsSync(dir('refs', `${stem}-${n}${ext}`))) n++;
              target = dir('refs', `${stem}-${n}${ext}`);
            }
            fs.writeFileSync(target, Buffer.concat(chunks));
            return send({ ok: true, name: path.basename(target) });
          }

          if (route === '/brief') {
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
            return res.end(brief(q.get('page') || ''));
          }

          next();
        })().catch(err => send({ error: err.message }, 500));
      });

      // Anything under one folder, served as it is.
      const serveFrom = (base) => (req, res, next) => {
        let rel;
        try { rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
        catch (_) { return next(); }
        const target = path.resolve(base, '.' + rel);
        const withSep = base.endsWith(path.sep) ? base : base + path.sep;
        if (!target.startsWith(withSep)) { res.statusCode = 403; return res.end('outside the folder'); }
        if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) return next();
        const types = {
          '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
          '.json': 'application/json; charset=utf-8',
          '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon',
          '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
          '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
          '.pdf': 'application/pdf', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8'
        };
        res.writeHead(200, {
          'Content-Type': types[path.extname(target).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-store'
        });
        res.end(fs.readFileSync(target));
      };

      // A screen the repo already had is served from where it is, so its own relative
      // stylesheets and images keep working without being copied anywhere.
      server.middlewares.use('/@repo', serveFrom(repoRoot));

      // The browser kept alive for measuring goes when this server does.
      server.httpServer && server.httpServer.on('close', () => { stopMeasuring(); });

      // The board folder's own files.
      server.middlewares.use('/@studio', async (req, res, next) => {
        let rel;
        try { rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
        catch (_) { return next(); }
        const target = path.resolve(studioRoot, '.' + rel);
        const withSep = studioRoot.endsWith(path.sep) ? studioRoot : studioRoot + path.sep;
        if (!target.startsWith(withSep)) { res.statusCode = 403; return res.end('outside the studio folder'); }
        if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) return next();

        // A page of the board's own goes through Vite before it is served, which is what
        // lets it import one of the repo's components by path: Vite compiles the tsx, jsx
        // or ts it finds there on the way through, and reloads the frame when it is saved.
        // Without this a page could only ever hold plain markup.
        if (target.endsWith('.html')) {
          try {
            const raw = fs.readFileSync(target, 'utf8');
            let html = await server.transformIndexHtml(req.originalUrl || req.url, raw);
            // A frame is a picture of a screen, and a screen has no scrollbar down its side.
            // A page of the board that is as wide as its frame gets one anyway the moment it
            // is a pixel taller, and the bar takes its own width out of the page, which then
            // scrolls sideways as well. So the bars are taken away, last in the head so a
            // page's own rule cannot put them back; the page still scrolls.
            if (rel.startsWith('/pages/')) {
              const bars = '<style data-designbook>html{scrollbar-width:none!important}html::-webkit-scrollbar,body::-webkit-scrollbar{width:0!important;height:0!important}</style>';
              html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, bars + '</head>') : bars + html;
            }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            return res.end(html);
          } catch (err) {
            server.config.logger.warn('[studio] could not transform ' + rel + ': ' + err.message);
          }
        }

        const types = {
          '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
          '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
          '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
          '.pdf': 'application/pdf', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8'
        };
        res.writeHead(200, {
          'Content-Type': types[path.extname(target).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-store'
        });
        res.end(fs.readFileSync(target));
      });
    }
  };
}
