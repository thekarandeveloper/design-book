// Reading a frame, one element at a time.
//
// The board cannot look inside a live frame: it is another origin, and nothing in a page
// on another origin can be read from outside it. But the page is a page a dev server is
// already serving, and the headless browser that measures and exports frames can open the
// very same address at the very same width and read it. What it finds is what is on the
// board, because it is the same engine drawing the same page, and it needs nothing
// written into the project to do it.
//
// A session is one frame, open in a headless page and kept for a couple of minutes, so
// asking about another element costs a few milliseconds instead of loading the page
// again. A scan reads every element that is on screen: where it is, how big, what it says.
// Everything heavier (its styles, where it came from in the code, a picture of it) is
// asked for only about the one element somebody chose.

import fs from 'node:fs';
import path from 'node:path';
import { openPage, withPage, draw } from './chrome.js';
import { sourceFromStack, projectPath } from './sourcemap.js';
import { AUDIT } from './check.js';
import { SCAN, DETAIL, FIND } from './page-fns.js';

const IDLE = 150000;
const MOST_ELEMENTS = 3500;
const sessions = new Map();

// ── what runs inside the page ─────────────────────────────────────────────

// Boxes drawn over the page for the length of one picture, and taken away after.
const MARK = function mark(boxes) {
  const old = document.getElementById('__db_marks');
  if (old) old.remove();
  if (!boxes || !boxes.length) return;
  const layer = document.createElement('div');
  layer.id = '__db_marks';
  layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none';
  for (const b of boxes) {
    const el = document.createElement('div');
    el.style.cssText = `position:absolute;left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;box-sizing:border-box;border:2px solid #ff3b30;background:rgba(255,59,48,0.10);border-radius:2px`;
    if (b.n) {
      const tag = document.createElement('b');
      tag.textContent = String(b.n);
      tag.style.cssText = 'position:absolute;left:-2px;top:-22px;min-width:20px;height:20px;padding:0 5px;box-sizing:border-box;border-radius:10px;background:#ff3b30;color:#fff;font:700 12px/20px -apple-system,system-ui,sans-serif;text-align:center';
      el.appendChild(tag);
    }
    layer.appendChild(el);
  }
  document.documentElement.appendChild(layer);
};

// ── what runs here ────────────────────────────────────────────────────────

// One session per frame. A question asked while the page is still being drawn waits for that
// drawing rather than starting another, and a session only exists once its page is drawn, so
// nothing is ever asked of a page that is not there yet.
const opening = new Map();

export function session(spec) {
  const have = sessions.get(spec.key);
  if (have) { have.touch(); return Promise.resolve(have); }
  if (opening.has(spec.key)) return opening.get(spec.key).promise;
  const entry = {};
  entry.promise = create(spec, entry).finally(() => { if (opening.get(spec.key) === entry) opening.delete(spec.key); });
  opening.set(spec.key, entry);
  return entry.promise;
}

async function create({ key, url, width, height }, entry) {
  const w = Math.max(200, Math.round(width));
  const h = Math.min(16000, Math.max(200, Math.round(height)));
  const lease = await openPage({ viewport: { width: w, height: h, deviceScaleFactor: 1 }, calm: true });
  const s = {
    key, url, width: w, height: h, page: lease.page, scanned: null, queue: Promise.resolve(), timer: 0,
    touch() { clearTimeout(s.timer); s.timer = setTimeout(() => s.close(), IDLE); },
    // One thing at a time on a page: a picture with boxes drawn over it must not have
    // another question asked in the middle.
    run(fn) {
      const next = s.queue.then(() => { s.touch(); return fn(s.page); });
      s.queue = next.catch(() => {});
      return next;
    },
    async close() {
      clearTimeout(s.timer);
      if (sessions.get(key) === s) sessions.delete(key);
      await lease.close();
    }
  };
  try {
    const res = await draw(s.page, url, { wait: 150, still: true });
    if (!res || res.status() >= 400) throw new Error(`the page answered ${res ? res.status() : 'nothing'}`);
    // Closed while it was being drawn: this one is not wanted any more.
    if (opening.get(key) !== entry) throw new Error('the page was closed while it was loading');
  } catch (err) {
    await s.close();
    throw err;
  }
  sessions.set(key, s);
  s.touch();
  return s;
}

export function forgetSessions(prefix) {
  for (const [key, s] of sessions) if (!prefix || key.startsWith(prefix)) s.close();
  // And any that are still being drawn: they will find they are not wanted.
  for (const key of [...opening.keys()]) if (!prefix || key.startsWith(prefix)) opening.delete(key);
}

// An element, found by where it sits in the tree (and failing that by its selector or its
// words), and kept in the same list the scan makes, so every tool that takes an index takes
// this too. Used when the board read the page itself and so does not share the server's
// numbering: it says where the thing is, not which number it was.
const LOCATE = new Function('path', 'selector', 'text', 'tag', `
  const find = ${FIND.toString()};
  const el = find(path, selector, text, tag);
  if (!el) return -1;
  if (!window.__dbEls || window.__dbEls.length > 300) window.__dbEls = [];
  window.__dbEls.push(el);
  return window.__dbEls.length - 1;`);

export async function locate(s, find) {
  if (!find || !Array.isArray(find.path)) return -1;
  return s.run(page => page.evaluate(LOCATE, find.path, find.selector || '', find.text || '', find.tag || ''));
}

export async function scan(s) {
  const found = await s.run(page => page.evaluate(SCAN, MOST_ELEMENTS));
  s.scanned = found;
  return found;
}

// Everything about one element, with where it came from in the project's code worked out.
export async function detail(s, i, { root, studioRoot }) {
  const d = await s.run(page => page.evaluate(DETAIL, i));
  if (!d || d.stale) return { stale: true };

  // The file and line: the framework's own word where it gave one, and failing that the
  // position in the bundle, turned into the file somebody wrote by its source map.
  let source = null;
  const h = d.hints || {};
  if (h.react && h.react.file) {
    source = { file: projectPath(h.react.file, root), line: h.react.line, column: h.react.column, via: 'react' };
  } else if (h.astro) {
    source = { file: projectPath(h.astro.file, root), line: Number(String(h.astro.loc).split(':')[0]) || 0, column: Number(String(h.astro.loc).split(':')[1]) || 0, via: 'astro' };
  } else if (h.svelte) {
    source = { file: projectPath(h.svelte.file, root), line: h.svelte.line, column: h.svelte.column, via: 'svelte' };
  } else if (d.stack) {
    const found = await sourceFromStack(d.stack, root).catch(() => null);
    if (found) source = { ...found, via: 'react' };
  } else if (h.vue) {
    source = { file: projectPath(h.vue.file, root), line: 0, column: 0, via: 'vue' };
  }
  // For the editor, a path from the board folder, which is what it opens files from.
  if (source && source.file && root) {
    source.open = path.relative(studioRoot, path.resolve(root, source.file)).split(path.sep).join('/');
  }
  const { stack, hints, ...rest } = d;
  return { ...rest, source, components: d.owners };
}

// ── pictures ──────────────────────────────────────────────────────────────

// A picture is never bigger than the biggest a model will look at, or it costs more than
// it shows; a small one is drawn at twice the size so the type in it is sharp.
const MOST_SIDE = 1568;
const MOST_DOWN = 8000;

export function pngSize(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

async function clipShot(page, area, { side = MOST_SIDE } = {}) {
  const dims = await page.evaluate(() => ({
    w: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    h: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)
  }));
  const x = Math.max(0, Math.floor(area.x));
  const y = Math.max(0, Math.floor(area.y));
  const width = Math.max(1, Math.min(Math.ceil(area.w), dims.w - x));
  const full = Math.max(1, Math.min(Math.ceil(area.h), dims.h - y));
  const height = Math.min(full, MOST_DOWN);
  const scale = Math.min(2, Math.max(0.1, side / Math.max(width, height)));
  const bytes = Buffer.from(await page.screenshot({
    type: 'png',
    captureBeyondViewport: true,
    clip: { x, y, width, height, scale }
  }));
  return { bytes, cut: full > height, area: { x, y, w: width, h: height } };
}

export const keepPicture = (dir, label, bytes) => keep(dir, label, bytes);

const stem = s => String(s || 'shot').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'shot';

function keep(dir, label, bytes) {
  fs.mkdirSync(dir, { recursive: true });
  // Old pictures go: these are for pasting once, and a folder of them is a folder that grows.
  try {
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (Date.now() - fs.statSync(full).mtimeMs > 86400000) fs.unlinkSync(full);
    }
  } catch (_) {}
  const name = `${Date.now().toString(36)}-${stem(label)}.png`;
  const file = path.join(dir, name);
  fs.writeFileSync(file, bytes);
  const size = pngSize(bytes);
  return { name, file, w: size.w, h: size.h, bytes: bytes.length };
}

// The element alone, or the frame around it with it boxed.
//
// `marks` are the elements to draw a box and a number on, for the picture in context and
// for several chosen at once; `i` is the one the picture is about.
export async function shotElement(s, { i, mode = 'element', pad = 8, marks = [], dir, label }) {
  return s.run(async page => {
    const rect = await page.evaluate(n => {
      const el = window.__dbEls && window.__dbEls[n];
      if (!el || !el.isConnected) return null;
      const b = el.getBoundingClientRect();
      return { x: b.left + window.scrollX, y: b.top + window.scrollY, w: b.width, h: b.height };
    }, i);
    if (!rect) return { stale: true };

    let area;
    let boxes = [];
    if (mode === 'context') {
      // The frame's width, and as much above and below as shows where it is.
      const around = 260;
      const y0 = Math.max(0, rect.y - around);
      const y1 = Math.max(rect.y + rect.h + around, y0 + 640);
      area = { x: 0, y: y0, w: s.width, h: Math.min(2200, y1 - y0) };
      const rects = await page.evaluate(list => list.map(n => {
        const el = window.__dbEls && window.__dbEls[n.i];
        if (!el || !el.isConnected) return null;
        const b = el.getBoundingClientRect();
        return { x: b.left + window.scrollX, y: b.top + window.scrollY, w: b.width, h: b.height, n: n.n };
      }), marks.length ? marks : [{ i, n: 0 }]);
      boxes = rects.filter(Boolean).map(b => ({ ...b, n: b.n || undefined }));
    } else if (mode === 'marked') {
      // Several elements at once: the smallest frame that holds all of them.
      const rects = await page.evaluate(list => list.map(n => {
        const el = window.__dbEls && window.__dbEls[n.i];
        if (!el || !el.isConnected) return null;
        const b = el.getBoundingClientRect();
        return { x: b.left + window.scrollX, y: b.top + window.scrollY, w: b.width, h: b.height, n: n.n };
      }), marks);
      boxes = rects.filter(Boolean);
      const x0 = Math.min(...boxes.map(b => b.x)); const y0 = Math.min(...boxes.map(b => b.y));
      const x1 = Math.max(...boxes.map(b => b.x + b.w)); const y1 = Math.max(...boxes.map(b => b.y + b.h));
      area = { x: x0 - 24, y: y0 - 32, w: x1 - x0 + 48, h: y1 - y0 + 56 };
    } else {
      area = { x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 };
    }

    try {
      if (boxes.length) await page.evaluate(MARK, boxes);
      const shot = await clipShot(page, area);
      return { ...keep(dir, label || mode, shot.bytes), cut: shot.cut, rect };
    } finally {
      await page.evaluate(MARK, []).catch(() => {});
    }
  });
}

// A part of the page, from where it is on the frame.
export async function shotRect(s, { x, y, w, h, dir, label }) {
  return s.run(async page => {
    const shot = await clipShot(page, { x, y, w, h });
    return { ...keep(dir, label || 'region', shot.bytes), cut: shot.cut, rect: { x, y, w, h } };
  });
}

// Forcing a state on an element the way the browser's own inspector does, so `:hover` and
// `:focus` rules apply without a pointer being anywhere near it.
//
// The element is found through this session's own view of the document: an object handle
// belongs to the session that made it, so it is marked for a moment and looked up by the mark.
async function force(page, handle, states) {
  const cdp = await page.createCDPSession();
  try {
    await handle.evaluate(e => e.setAttribute('data-db-force', '1'));
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-db-force="1"]' });
    if (!nodeId) throw new Error('the element could not be found to force a state on');
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: states });
    return async () => {
      await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] }).catch(() => {});
      await handle.evaluate(e => e.removeAttribute('data-db-force')).catch(() => {});
      await cdp.detach().catch(() => {});
    };
  } catch (err) {
    await handle.evaluate(e => e.removeAttribute('data-db-force')).catch(() => {});
    await cdp.detach().catch(() => {});
    throw err;
  }
}

// The same element in the states a person would meet it in. States that look exactly like
// the plain one are left out of the picture and named in the answer, so the picture only
// carries what differs.
export async function shotStates(s, { i, pad = 8, dir, label }) {
  return s.run(async page => {
    const handle = await page.evaluateHandle(n => (window.__dbEls && window.__dbEls[n]) || null, i);
    const el = handle.asElement();
    if (!el) return { stale: true };
    const rect = await page.evaluate(e => {
      const b = e.getBoundingClientRect();
      return { x: b.left + window.scrollX, y: b.top + window.scrollY, w: b.width, h: b.height, tag: e.tagName.toLowerCase(), form: /^(button|input|select|textarea)$/i.test(e.tagName) };
    }, el);
    const area = { x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 };
    const side = 700;

    const plain = await clipShot(page, area, { side });
    const frames = [{ label: 'Default', bytes: plain.bytes }];
    const same = [];
    const tries = [
      ['Hover', ['hover']],
      ['Focus', ['focus', 'focus-visible']],
      ['Pressed', ['hover', 'active']]
    ];
    for (const [name, forced] of tries) {
      let undo = null;
      try {
        undo = await force(page, handle, forced);
        const shot = await clipShot(page, area, { side });
        if (shot.bytes.equals(plain.bytes)) same.push(name); else frames.push({ label: name, bytes: shot.bytes });
      } catch (_) {
        same.push(name);
      } finally {
        if (undo) await undo();
      }
    }
    if (rect.form) {
      const was = await page.evaluate(e => e.disabled, el);
      await page.evaluate(e => { e.disabled = true; }, el);
      const shot = await clipShot(page, area, { side });
      await page.evaluate((e, d) => { e.disabled = d; }, el, was);
      if (shot.bytes.equals(plain.bytes)) same.push('Disabled'); else frames.push({ label: 'Disabled', bytes: shot.bytes });
    }
    await handle.dispose().catch(() => {});

    const sheet = await sheetOf(frames);
    return { ...keep(dir, label || 'states', sheet), states: frames.map(f => f.label), same };
  });
}

// The same element at other widths: the page drawn again at each, and the element found
// again in it, because a layout that holds at one width says nothing about another.
export async function shotSizes({ url, widths, find, height = 900, dir, label }) {
  // All the widths at once: each is a page drawing, and the browser lets a few draw together.
  const got = await Promise.all(widths.map(width => withPage({ viewport: { width, height, deviceScaleFactor: 1 }, calm: true }, async page => {
    const res = await draw(page, url, { wait: 600, still: true });
    if (!res || res.status() >= 400) return null;
    const handle = await page.evaluateHandle(FIND, find.path || [], find.selector || '', find.text || '', find.tag || '');
    const el = handle.asElement();
    if (!el) return { absent: true };
    const rect = await page.evaluate(e => {
      const b = e.getBoundingClientRect();
      const style = getComputedStyle(e);
      return { x: b.left + window.scrollX, y: b.top + window.scrollY, w: b.width, h: b.height, hidden: style.display === 'none' || b.width === 0 || b.height === 0 };
    }, el);
    if (rect.hidden) return { absent: true };
    const shot = await clipShot(page, { x: rect.x - 8, y: rect.y - 8, w: rect.w + 16, h: rect.h + 16 }, { side: 760 });
    return { bytes: shot.bytes, size: `${Math.round(rect.w)} x ${Math.round(rect.h)}` };
  }).catch(() => null)));

  const frames = [];
  const missing = [];
  widths.forEach((width, n) => {
    const one = got[n];
    if (one && one.bytes) frames.push({ label: `${width}px  ${one.size}`, bytes: one.bytes });
    else missing.push(width);
  });
  if (!frames.length) return { none: true, missing };
  const sheet = await sheetOf(frames);
  return { ...keep(dir, label || 'sizes', sheet), widths: widths.filter(w => !missing.includes(w)), missing };
}

// The element as it is now, found again in a page drawn from scratch at the width it was
// remembered at. For setting beside how it was.
export async function shotAgain({ url, width, height = 900, find }) {
  return withPage({ viewport: { width, height, deviceScaleFactor: 1 }, calm: true }, async page => {
    const res = await draw(page, url, { wait: 600, still: true });
    if (!res || res.status() >= 400) throw new Error(`the page answered ${res ? res.status() : 'nothing'}`);
    const handle = await page.evaluateHandle(FIND, find.path || [], find.selector || '', find.text || '', find.tag || '');
    const el = handle.asElement();
    if (!el) return null;
    const rect = await page.evaluate(e => {
      const b = e.getBoundingClientRect();
      return { x: b.left + window.scrollX, y: b.top + window.scrollY, w: b.width, h: b.height };
    }, el);
    const shot = await clipShot(page, { x: rect.x - 8, y: rect.y - 8, w: rect.w + 16, h: rect.h + 16 }, { side: 760 });
    return { bytes: shot.bytes, size: `${Math.round(rect.w)} x ${Math.round(rect.h)}` };
  });
}

// Pictures side by side on one sheet, each with its name, as one picture to paste.
export async function sheetOf(frames, { side = MOST_SIDE } = {}) {
  const gap = 20;
  const sizes = frames.map(f => pngSize(f.bytes));
  const natural = sizes.reduce((sum, z) => sum + z.w, 0) + gap * (frames.length + 1);
  const fit = natural > side ? side / natural : 1;
  const cells = frames.map((f, n) => `<figure><img src="data:image/png;base64,${f.bytes.toString('base64')}" style="width:${Math.max(24, Math.round(sizes[n].w * fit))}px;height:auto;display:block;box-shadow:0 0 0 1px #0002"><figcaption>${String(f.label).replace(/</g, '&lt;')}</figcaption></figure>`).join('');
  const html = `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;background:#eef0f3}
    #sheet{display:inline-flex;align-items:flex-start;gap:${gap}px;padding:${gap}px;background:#eef0f3;font:600 13px/1.3 -apple-system,system-ui,sans-serif;color:#222}
    figure{margin:0;display:grid;gap:8px;justify-items:start}
    figcaption{padding-left:2px}
  </style><div id="sheet">${cells}</div>`;
  return withPage({ viewport: { width: Math.max(400, Math.min(2400, natural)), height: 600, deviceScaleFactor: 1 } }, async page => {
    await page.setContent(html, { waitUntil: 'load' });
    const box = await (await page.$('#sheet')).boundingBox();
    return Buffer.from(await page.screenshot({ type: 'png', clip: { x: box.x, y: box.y, width: Math.ceil(box.width), height: Math.ceil(box.height) } }));
  });
}

// ── looking it over ───────────────────────────────────────────────────────

// The same eye as a frame's check, over one element and what is inside it.
export async function auditElement(s, i, { screen, touch }) {
  return s.run(async page => {
    const handle = await page.evaluateHandle(n => (window.__dbEls && window.__dbEls[n]) || null, i);
    const el = handle.asElement();
    if (!el) return { stale: true };
    const issues = await page.evaluate(AUDIT, { width: s.width, height: s.height, grow: true, screen: !!screen, touch: !!touch }, el);
    await handle.dispose().catch(() => {});
    return { issues };
  });
}

// What an element looks like to find it with later: by place in the tree, by selector, by
// what it says.
export async function locator(s, i) {
  return s.run(page => page.evaluate(n => {
    const el = window.__dbEls && window.__dbEls[n];
    if (!el) return null;
    return { tag: el.tagName.toLowerCase() };
  }, i));
}

export { FIND };
