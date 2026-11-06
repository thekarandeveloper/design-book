// What runs inside a page: reading every element on it, everything about one, and finding one
// again. Plain functions with nothing outside them, so the same text runs in two places.
//
// On the server, the headless browser runs them in a page it has opened (a project's own dev
// server, which is another origin and cannot be reached from the board). In the board, a page
// that is the board's own is on the same origin, so they run in its iframe directly, and the
// answer is there in a few milliseconds instead of after a page has been loaded a second time.
//
// Nothing here may reach for anything but the page's own globals.

// Every element that can be seen, with where it is.
export const SCAN = function scan(limit) {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD', 'NOSCRIPT', 'TEMPLATE', 'TITLE', 'BASE', 'SOURCE', 'TRACK', 'PARAM', 'DATALIST']);
  const TEXTY = new Set(['BUTTON', 'A', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LABEL', 'TH', 'TD', 'SUMMARY', 'OPTION', 'FIGCAPTION', 'LEGEND', 'DT', 'DD']);
  const els = [];
  const out = [];
  const sx = window.scrollX;
  const sy = window.scrollY;
  const rectOf = el => { const b = el.getBoundingClientRect(); return { x: b.left + sx, y: b.top + sy, w: b.width, h: b.height }; };
  const meet = (a, b) => {
    const x0 = Math.max(a.x, b.x); const y0 = Math.max(a.y, b.y);
    const x1 = Math.min(a.x + a.w, b.x + b.w); const y1 = Math.min(a.y + a.h, b.y + b.h);
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  };
  const round = n => Math.round(n * 10) / 10;
  const box = r => [round(r.x), round(r.y), round(r.w), round(r.h)];
  const everywhere = { x: 0, y: 0, w: window.innerWidth, h: Infinity };
  const fixedArea = { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };

  const words = el => {
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ').trim().replace(/\s+/g, ' ');
    if (own) return own.slice(0, 80);
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return (el.value || el.placeholder || '').slice(0, 80);
    if (el.tagName === 'IMG') return (el.alt || '').slice(0, 80);
    if (TEXTY.has(el.tagName)) return (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    return '';
  };

  const walk = (el, clip, anchor, alpha, depth, parent) => {
    if (out.length >= limit || SKIP.has(el.tagName)) return;
    const style = getComputedStyle(el);
    if (style.display === 'none') return;
    const position = style.position;
    const here = position === 'fixed' ? fixedArea : position === 'absolute' ? anchor : clip;
    const opacity = alpha * (Number.isNaN(Number(style.opacity)) ? 1 : Number(style.opacity));
    const r = rectOf(el);
    let index = parent;
    if (style.visibility === 'visible' && opacity > 0.02 && r.w >= 1 && r.h >= 1) {
      const v = meet(r, here);
      if (v) {
        index = out.length;
        els.push(el);
        const row = { t: el.tagName.toLowerCase(), r: box(r), p: parent, d: depth };
        if (v.x !== r.x || v.y !== r.y || v.w !== r.w || v.h !== r.h) row.v = box(v);
        const text = words(el);
        if (text) row.x = text;
        const cls = typeof el.className === 'string' ? el.className.trim().replace(/\s+/g, ' ') : '';
        if (cls) row.c = cls.slice(0, 160);
        if (el.id) row.id = el.id;
        const label = el.getAttribute('aria-label');
        if (label) row.a = label.slice(0, 60);
        out.push(row);
      }
    }
    const clips = style.overflowX !== 'visible' || style.overflowY !== 'visible';
    const inside = clips ? (meet(here, r) || { x: 0, y: 0, w: 0, h: 0 }) : here;
    const next = position !== 'static' ? inside : anchor;
    for (const child of el.children) walk(child, inside, next, opacity, depth + 1, index);
    if (el.shadowRoot) for (const child of el.shadowRoot.children) walk(child, inside, next, opacity, depth + 1, index);
  };

  walk(document.body, everywhere, everywhere, 1, 0, -1);

  // What a click would not reach: an element whose middle has something else on top of it.
  // The browser knows what is on top where, so it is asked, rather than worked out from
  // stacking rules. Only what is inside the window can be asked about.
  for (let n = 0; n < els.length; n++) {
    const el = els[n];
    if (el.getRootNode() !== document) continue;
    const row = out[n];
    const b = row.v || row.r;
    const cx = b[0] + b[2] / 2 - sx;
    const cy = b[1] + b[3] / 2 - sy;
    if (cx < 0 || cy < 0 || cx >= window.innerWidth || cy >= window.innerHeight) continue;
    const top = document.elementFromPoint(cx, cy);
    if (top && top !== el && !el.contains(top) && !top.contains(el)) row.o = 1;
  }
  window.__dbEls = els;
  return {
    w: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    h: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
    vw: window.innerWidth,
    vh: window.innerHeight,
    list: out,
    cut: out.length >= limit
  };
};

// Everything about one element that is too much to send for all of them.
export const DETAIL = function detail(i) {
  const el = window.__dbEls && window.__dbEls[i];
  if (!el || !el.isConnected) return { stale: true };
  const style = getComputedStyle(el);
  const sx = window.scrollX;
  const sy = window.scrollY;
  const b = el.getBoundingClientRect();

  const hex = value => {
    const m = /^rgba?\(([^)]+)\)$/.exec(String(value).trim());
    if (!m) return String(value);
    const p = m[1].split(/[,/ ]+/).filter(Boolean).map(Number);
    const to = n => Math.round(n).toString(16).padStart(2, '0');
    const a = p.length > 3 ? p[3] : 1;
    return '#' + to(p[0]) + to(p[1]) + to(p[2]) + (a < 1 ? to(a * 255) : '');
  };
  const px = value => { const n = parseFloat(value); return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0; };
  const four = (t, r, bo, l) => {
    const a = [t, r, bo, l].map(px);
    if (a.every(n => n === a[0])) return a[0] ? `${a[0]}px` : '';
    if (a[0] === a[2] && a[1] === a[3]) return `${a[0]}px ${a[1]}px`;
    return a.map(n => `${n}px`).join(' ');
  };

  // The custom properties the page declares, so a colour or a size can be named by what
  // the project calls it rather than by what it happens to be today.
  if (!window.__dbTokens) {
    const names = new Set();
    const visit = rules => {
      for (const r of rules) {
        if (r.style && r.selectorText && /(^|[\s,])(:root|html|:host|body)(?![\w-])/.test(r.selectorText)) {
          for (const n of r.style) if (n.startsWith('--') && !n.startsWith('--tw-')) names.add(n);
        }
        if (r.cssRules) visit(r.cssRules);
      }
    };
    for (const sheet of document.styleSheets) { try { visit(sheet.cssRules); } catch (_) {} }
    const root = getComputedStyle(document.documentElement);
    const probe = document.createElement('i');
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:0;height:0';
    document.documentElement.appendChild(probe);
    const colours = new Map();
    const lengths = new Map();
    // A name that ends in a step (neutral-900) is a palette; one that does not is a decision.
    const list = [...names].sort((a, c) => (/-\d{2,3}$/.test(a) ? 1 : 0) - (/-\d{2,3}$/.test(c) ? 1 : 0));
    for (const n of list) {
      const raw = root.getPropertyValue(n).trim();
      if (!raw) continue;
      if (CSS.supports('color', raw)) {
        probe.style.color = '';
        probe.style.color = raw;
        const k = getComputedStyle(probe).color;
        if (!colours.has(k)) colours.set(k, []);
        colours.get(k).push(n);
      } else if (CSS.supports('width', raw) && /[\d.]/.test(raw)) {
        probe.style.width = '';
        probe.style.width = raw;
        const k = getComputedStyle(probe).width;
        if (!lengths.has(k)) lengths.set(k, []);
        lengths.get(k).push(n);
      }
    }
    probe.remove();
    window.__dbTokens = { colours, lengths };
  }
  const tokens = {};
  const named = (map, key, label) => {
    const hit = map.get(key);
    if (hit && hit.length) tokens[label] = hit.slice(0, 2).join(' or ');
  };
  const T = window.__dbTokens;

  const st = {};
  const put = (k, v) => { if (v !== '' && v !== undefined && v !== null) st[k] = v; };
  put('font', style.fontFamily.split(',')[0].replace(/["']/g, '').trim());
  put('size', `${px(style.fontSize)}px`);
  put('weight', style.fontWeight);
  if (style.lineHeight !== 'normal') put('lineHeight', `${px(style.lineHeight)}px`);
  if (style.letterSpacing !== 'normal' && px(style.letterSpacing)) put('tracking', `${px(style.letterSpacing)}px`);
  if (style.textAlign && style.textAlign !== 'start') put('align', style.textAlign);
  put('color', hex(style.color));
  named(T.colours, style.color, 'color');
  if (!/rgba\([^)]*,\s*0\)$/.test(style.backgroundColor) && style.backgroundColor !== 'transparent') {
    put('background', hex(style.backgroundColor));
    named(T.colours, style.backgroundColor, 'background');
  }
  if (style.backgroundImage && style.backgroundImage !== 'none') put('backgroundImage', style.backgroundImage.slice(0, 80));
  if (px(style.borderTopWidth) || px(style.borderLeftWidth)) {
    put('border', `${px(style.borderTopWidth)}px ${style.borderTopStyle} ${hex(style.borderTopColor)}`);
    named(T.colours, style.borderTopColor, 'border');
  }
  const radius = four(style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius);
  put('radius', radius);
  if (style.borderTopLeftRadius === style.borderTopRightRadius) named(T.lengths, style.borderTopLeftRadius, 'radius');
  put('padding', four(style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft));
  put('margin', four(style.marginTop, style.marginRight, style.marginBottom, style.marginLeft));
  if (style.display === 'flex' || style.display === 'inline-flex' || style.display === 'grid' || style.display === 'inline-grid') {
    put('display', style.display);
    if (style.display.includes('flex')) put('direction', style.flexDirection);
    if (px(style.rowGap) || px(style.columnGap)) {
      put('gap', px(style.rowGap) === px(style.columnGap) ? `${px(style.rowGap)}px` : `${px(style.rowGap)}px ${px(style.columnGap)}px`);
      named(T.lengths, style.rowGap, 'gap');
    }
    if (style.justifyContent !== 'normal') put('justify', style.justifyContent);
    if (style.alignItems !== 'normal') put('alignItems', style.alignItems);
    if (style.display.includes('grid')) put('columns', style.gridTemplateColumns.slice(0, 60));
  } else if (style.display !== 'block' && style.display !== 'inline') {
    put('display', style.display);
  }
  if (style.position !== 'static') put('position', style.position);
  if (style.zIndex !== 'auto') put('zIndex', style.zIndex);
  if (Number(style.opacity) < 1) put('opacity', style.opacity);
  if (style.boxShadow && style.boxShadow !== 'none') put('shadow', style.boxShadow.slice(0, 80));
  if (style.transform && style.transform !== 'none') put('transform', style.transform.slice(0, 60));
  if (style.overflowX !== 'visible' || style.overflowY !== 'visible') put('overflow', `${style.overflowX}/${style.overflowY}`);
  named(T.lengths, style.fontSize, 'size');

  // A selector that names this element and no other, and the path of child positions
  // that finds it again on a page laid out the same way.
  const esc = s => (window.CSS && CSS.escape ? CSS.escape(s) : s);
  const unique = id => document.querySelectorAll('#' + esc(id)).length === 1;
  const parts = [];
  for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
    let part = n.tagName.toLowerCase();
    if (n.id && unique(n.id)) { parts.unshift('#' + esc(n.id)); break; }
    const same = n.parentElement ? [...n.parentElement.children].filter(c => c.tagName === n.tagName) : [];
    if (same.length > 1) part += `:nth-of-type(${same.indexOf(n) + 1})`;
    parts.unshift(part);
    if (n === document.body) break;
  }
  const path = [];
  for (let n = el; n && n !== document.body; n = n.parentElement) path.unshift([...n.parentElement.children].indexOf(n));

  const attrs = {};
  for (const k of ['href', 'src', 'alt', 'role', 'aria-label', 'type', 'placeholder', 'name', 'title', 'for']) {
    const v = el.getAttribute(k);
    if (v) attrs[k] = v.slice(0, 120);
  }

  const parents = [];
  for (let n = el.parentElement; n && parents.length < 5; n = n.parentElement) {
    if (n === document.documentElement) break;
    parents.push({
      tag: n.tagName.toLowerCase(),
      id: n.id || '',
      cls: typeof n.className === 'string' ? n.className.trim().split(/\s+/).slice(0, 3).join(' ') : ''
    });
  }

  // Where the code says it came from, whichever framework drew it.
  let stack = null;
  const owners = [];
  const hints = {};
  const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
  if (key) {
    const fiber = el[key];
    if (fiber._debugSource && fiber._debugSource.fileName) {
      hints.react = { file: fiber._debugSource.fileName, line: fiber._debugSource.lineNumber, column: fiber._debugSource.columnNumber || 0 };
    }
    if (fiber._debugStack && fiber._debugStack.stack) stack = String(fiber._debugStack.stack).split('\n').slice(0, 8).join('\n');
    for (let o = fiber._debugOwner, n = 0; o && n < 5; o = o._debugOwner, n++) {
      const name = o.type && (o.type.displayName || o.type.name);
      if (name && !owners.includes(name)) owners.push(name);
    }
    if (Array.isArray(fiber._debugInfo)) {
      for (const info of fiber._debugInfo) if (info && info.name && !owners.includes(info.name)) owners.push(info.name);
    }
  }
  for (let n = el; n && n.dataset; n = n.parentElement) {
    if (n.dataset.astroSourceFile) { hints.astro = { file: n.dataset.astroSourceFile, loc: n.dataset.astroSourceLoc || '' }; break; }
  }
  if (el.__svelte_meta && el.__svelte_meta.loc) hints.svelte = el.__svelte_meta.loc;
  const vue = el.__vueParentComponent;
  if (vue && vue.type && vue.type.__file) hints.vue = { file: vue.type.__file, name: vue.type.__name || vue.type.name || '' };

  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || '',
    cls: typeof el.className === 'string' ? el.className.trim().replace(/\s+/g, ' ') : '',
    text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200),
    attrs,
    selector: parts.join(' > '),
    path,
    rect: { x: Math.round((b.left + sx) * 10) / 10, y: Math.round((b.top + sy) * 10) / 10, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 },
    parents,
    children: el.children.length,
    style: st,
    tokens,
    stack,
    owners,
    hints
  };
};

// Finding an element again in a page that was drawn from scratch: by where it sat in the
// tree, failing that by the selector that named it, failing that by what it said.
export const FIND = function find(path, selector, text, tag) {
  let el = document.body;
  for (const i of path || []) { el = el && el.children[i]; if (!el) break; }
  if (el && (!tag || el.tagName.toLowerCase() === tag)) return el;
  if (selector) { try { const hit = document.querySelector(selector); if (hit) return hit; } catch (_) {} }
  if (text) {
    const want = text.slice(0, 40);
    let best = null;
    for (const n of document.body.querySelectorAll(tag || '*')) {
      const own = [...n.childNodes].filter(c => c.nodeType === 3).map(c => c.textContent).join(' ').trim().replace(/\s+/g, ' ');
      if (own && own.includes(want) && (!best || own.length < best.len)) best = { n, len: own.length };
    }
    if (best) return best.n;
  }
  return null;
};

