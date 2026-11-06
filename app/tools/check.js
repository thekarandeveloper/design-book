// Looking at a frame the way a designer looks at it.
//
// Not a linter for the code: a check on what the thing looks like once it is drawn. Can
// the words be read against what is behind them, is anything cut off at the edge, is
// something too small to tap, did an image fail to arrive. The page is drawn by the same
// browser that drew it on the board, and then measured in place, so what is reported is
// what is there rather than what the markup suggests.

import { findBrowser } from './export.js';

// Everything below runs inside the page.
export const AUDIT = function audit(frame, scope) {
  const issues = [];
  const seen = new Set();
  const add = (kind, severity, what, el, detail) => {
    const key = kind + '|' + what + '|' + detail;
    if (seen.has(key) || issues.length >= 24) return;
    seen.add(key);
    const r = el ? el.getBoundingClientRect() : null;
    issues.push({
      kind, severity, what, detail,
      where: el ? describe(el) : '',
      box: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null
    });
  };

  const describe = el => {
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' && el.className.trim()
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
      : '';
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  };

  const words = el => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 56);

  // ── colour ──────────────────────────────────────────────────────────────
  const rgb = value => {
    const m = /rgba?\(([^)]+)\)/.exec(value || '');
    if (!m) return null;
    const p = m[1].split(',').map(n => parseFloat(n));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (top, bottom) => {
    const a = top.a;
    return { r: top.r * a + bottom.r * (1 - a), g: top.g * a + bottom.g * (1 - a), b: top.b * a + bottom.b * (1 - a), a: 1 };
  };
  const lum = c => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const behind = el => {
    let node = el;
    let acc = null;
    while (node && node !== document.documentElement) {
      const bg = rgb(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0) acc = acc ? over(acc, bg) : bg;
      if (acc && acc.a >= 0.95) return acc;
      node = node.parentElement;
    }
    const page = rgb(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    return acc ? over(acc, page) : page;
  };

  // ── what the words say ──────────────────────────────────────────────────
  //
  // A shape that runs off the edge is a decision somebody made. A sentence nobody can
  // read, a dash we do not use, a line of filler left in, a claim that would have to be
  // defended: those are mistakes, and they are what this looks for.

  const FILLER = /\b(lorem ipsum|dolor sit amet|placeholder|your text here|sample text|tbd|todo|fixme|xxx+|coming soon\.{3})\b/i;
  const CLAIM = /(\b(no\.?\s?1|#1|number one|the best|world'?s (best|first|largest)|guaranteed|100% (safe|secure|accurate)|fastest|cheapest|unlimited)\b)/i;
  const LEGAL = /\b(free forever|no risk|money back guarantee|clinically proven|certified by|patented)\b/i;

  const visible = el => {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  // One element and what is inside it, or the whole page.
  const all = scope ? [scope, ...scope.querySelectorAll('*')] : [...document.body.querySelectorAll('*')];
  for (const el of all) {
    if (!visible(el)) continue;
    const style = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    const size = parseFloat(style.fontSize) || 16;

    if (own) {
      const text = words(el);
      const ink = rgb(style.color);
      if (ink && ink.a > 0.1) {
        const bg = behind(el);
        const got = ratio(ink.a < 1 ? over(ink, bg) : ink, bg);
        const big = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
        const need = big ? 3 : 4.5;
        if (got < need) {
          add('cannot be read', got < need - 1.5 ? 'bad' : 'warn', text, el,
              `${got.toFixed(1)}:1 against what is behind it, ${need}:1 is the floor`);
        }
      }
      if (size < 11) add('too small to read', 'warn', text, el, `${size.toFixed(0)}px`);

      const raw = el.textContent || '';
      if (/\u2014/.test(raw)) add('em dash', 'bad', text, el, 'we do not use them; a comma or a full stop');
      if (/\s\u2013\s/.test(raw)) add('en dash as a pause', 'warn', text, el, 'an en dash is for ranges, not for a pause');
      const filler = FILLER.exec(raw);
      if (filler) add('filler left in', 'bad', text, el, `"${filler[0]}"`);
      const claim = CLAIM.exec(raw);
      if (claim) add('a claim to stand behind', 'warn', text, el, `"${claim[0]}" needs to be true and provable`);
      const legal = LEGAL.exec(raw);
      if (legal) add('a promise with legal weight', 'warn', text, el, `"${legal[0]}"`);

      // Text clipped by its own box: the sentence is there but nobody can finish it.
      if (style.overflow !== 'visible' && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
        add('text cut short', 'warn', text, el, `${el.scrollWidth - el.clientWidth}px of it is hidden`);
      }
      // Text past the right edge is a mistake; a shape past it is a decision. Text below
      // the bottom is not reported here: a page longer than its frame is one fact, said
      // once at the end, not once per line of the footer.
      if (Math.round(r.right - frame.width) > 2 && r.width < frame.width) {
        add('text past the edge', 'bad', text, el, `${Math.round(r.right - frame.width)}px outside the frame`);
      }
    }

    if (el.tagName === 'IMG' && el.complete && el.naturalWidth === 0) {
      add('a picture did not load', 'bad', el.getAttribute('src') || '', el, 'the file is missing or the path is wrong');
    }

    if (frame.touch && (el.tagName === 'A' || el.tagName === 'BUTTON') && r.height && r.height < 44) {
      add('hard to tap', 'warn', words(el) || describe(el), el, `${Math.round(r.height)}px tall, 44 is the floor`);
    }

    // What is worth saying about a single element, and not worth saying about eighty.
    if (scope) {
      const tappable = el.tagName === 'A' || el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.tagName === 'SELECT'
        || el.getAttribute('role') === 'button' || el.hasAttribute('onclick');
      if (tappable && (r.width < 24 || r.height < 24) && r.width && r.height && !(frame.touch && r.height < 44)) {
        add('too small to hit', 'warn', words(el) || describe(el), el, `${Math.round(r.width)} x ${Math.round(r.height)}px, 24 is the floor`);
      }
      if (el.tagName === 'IMG') {
        if (!el.hasAttribute('alt')) add('picture has no alt text', 'warn', el.getAttribute('src') || describe(el), el, 'a screen reader says nothing for it');
        if (el.complete && el.naturalWidth > 0 && r.width > el.naturalWidth * 1.15) {
          add('picture is blurry', 'warn', el.getAttribute('src') || describe(el), el,
              `drawn ${Math.round(r.width)}px wide, the file is ${el.naturalWidth}px`);
        }
      }
      if (Math.round(r.right - frame.width) > 2 && r.width <= frame.width * 1.5) {
        add('past the edge', 'bad', words(el) || describe(el), el, `${Math.round(r.right - frame.width)}px outside the frame`);
      }
      const parent = el.parentElement;
      if (el !== scope && parent && getComputedStyle(parent).overflow !== 'visible') {
        const p = parent.getBoundingClientRect();
        if (r.right > p.right + 2 || r.bottom > p.bottom + 2 || r.left < p.left - 2 || r.top < p.top - 2) {
          add('cut off by its parent', 'warn', words(el) || describe(el), el, `${describe(parent)} hides the part of it outside its box`);
        }
      }
      if (own && size >= 12) {
        const lines = Math.round(r.height / (parseFloat(style.lineHeight) || size * 1.2));
        const chars = (el.textContent || '').length;
        if (lines >= 1 && chars / Math.max(1, lines) > 95) {
          add('lines too long to read', 'warn', words(el), el, `about ${Math.round(chars / lines)} characters a line, 45 to 90 reads well`);
        }
      }
    }
  }

  // A year that has gone by, next to a copyright line.
  const year = new Date().getFullYear();
  const body = document.body.innerText || '';
  const old = scope ? null : /(?:©|\(c\)|copyright)[^\n]{0,24}?((?:19|20)\d{2})/i.exec(body);
  if (old && Number(old[1]) < year) {
    add('last year', 'warn', old[0].trim(), null, `it says ${old[1]}, this is ${year}`);
  }

  // Wider than the frame is a mistake on a screen, on any device: it is a horizontal
  // scrollbar for whoever is looking, or, when the page hides it, something cut off at the
  // side that they will never know was there. Taller is what a screen is for, so nothing is
  // said about it. A poster is the other way about: cropped on purpose, so what runs past
  // its edge is a decision, and what runs past its bottom is the only thing worth saying.
  if (!scope && frame.screen) {
    const root = document.documentElement;
    const limit = root.clientWidth;
    const mode = getComputedStyle(root).overflowX !== 'visible'
      ? getComputedStyle(root).overflowX
      : getComputedStyle(document.body).overflowX;
    const wide = Math.round(Math.max(root.scrollWidth, document.body.scrollWidth) - limit);
    if (wide > 2) {
      // What is wider. Anything whose right edge is past the frame, unless something
      // around it clips it inside the frame; and of those, only the ones whose own parent
      // is not past the edge too, because a wide box takes everything in it with it and the
      // box is the thing to fix.
      const out = new Map();
      for (const el of all) {
        if (getComputedStyle(el).position === 'fixed') continue;
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.right <= limit + 1) continue;
        let held = false;
        for (let up = el.parentElement; up && up !== document.body && up !== root; up = up.parentElement) {
          if (getComputedStyle(up).overflowX !== 'visible' && up.getBoundingClientRect().right <= limit + 1) { held = true; break; }
        }
        if (!held) out.set(el, Math.round(box.right - limit));
      }
      const origins = [...out.entries()]
        .filter(([el]) => !out.has(el.parentElement))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([el, by]) => `${describe(el)} by ${by}px`);
      const hidden = mode === 'hidden' || mode === 'clip';
      add(hidden ? 'cut off at the side' : 'scrolls sideways', hidden ? 'warn' : 'bad', 'the page', null,
          `${wide}px wider than the frame${origins.length ? `: ${origins.join(', ')}` : ''}`);
    }
  } else if (!scope) {
    const tall = Math.round(document.documentElement.scrollHeight - frame.height);
    if (tall > 4) {
      add('longer than its frame', 'warn', 'the page', null,
          `${tall}px of it is below the bottom edge and is cropped`);
    }
  }

  if (!scope && body.trim().length < 3) add('nothing in it', 'warn', 'the frame', null, 'no words at all');

  // The same fault in eight places is one fault. Said once, with what it happened to,
  // so the list is something a person can read and act on.
  const folded = [];
  const by = new Map();
  for (const i of issues) {
    const key = i.kind + '|' + i.detail;
    const had = by.get(key);
    if (!had) {
      const copy = { ...i, count: 1, also: [] };
      by.set(key, copy);
      folded.push(copy);
      continue;
    }
    had.count += 1;
    if (had.also.length < 3 && i.what && i.what !== had.what) had.also.push(i.what);
  }
  return folded;
};

export async function check({ url, width, height, grow, touch, screen }) {
  const browser = findBrowser();
  if (!browser) throw new Error('No Chrome, Chromium, Brave or Edge on this machine to draw the page.');

  const { default: puppeteer } = await import('puppeteer-core');
  const app = await puppeteer.launch({
    executablePath: browser,
    headless: true,
    args: ['--hide-scrollbars', '--disable-gpu', '--no-first-run', '--no-default-browser-check']
  });
  try {
    const page = await app.newPage();
    await page.setViewport({ width: Math.round(width), height: Math.round(height), deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.evaluate(() => (document.fonts ? document.fonts.ready : null)).catch(() => {});
    const issues = await page.evaluate(AUDIT, { width, height, grow: !!grow, touch: !!touch, screen: screen === undefined ? !!grow : !!screen });
    return issues;
  } finally {
    await app.close().catch(() => {});
  }
}
