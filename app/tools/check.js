// Looking at a frame the way a designer looks at it.
//
// Not a linter for the code: a check on what the thing looks like once it is drawn. Can
// the words be read against what is behind them, is anything cut off at the edge, is
// something too small to tap, did an image fail to arrive. The page is drawn by the same
// browser that drew it on the board, and then measured in place, so what is reported is
// what is there rather than what the markup suggests.

import { findBrowser } from './export.js';

// Everything below runs inside the page.
const AUDIT = function audit(frame) {
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

  const all = [...document.body.querySelectorAll('*')];
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
  }

  // A year that has gone by, next to a copyright line.
  const year = new Date().getFullYear();
  const body = document.body.innerText || '';
  const old = /(?:©|\(c\)|copyright)[^\n]{0,24}?((?:19|20)\d{2})/i.exec(body);
  if (old && Number(old[1]) < year) {
    add('last year', 'warn', old[0].trim(), null, `it says ${old[1]}, this is ${year}`);
  }

  // A screen that scrolls sideways is a mistake. A poster is cropped on purpose.
  if (frame.grow) {
    const wide = Math.round(document.documentElement.scrollWidth - frame.width);
    if (wide > 2) add('scrolls sideways', 'bad', 'the page', null, `${wide}px wider than the frame`);
  }

  if (!frame.grow) {
    const tall = Math.round(document.documentElement.scrollHeight - frame.height);
    if (tall > 4) {
      add('longer than its frame', 'warn', 'the page', null,
          `${tall}px of it is below the bottom edge and is cropped`);
    }
  }

  if (body.trim().length < 3) add('nothing in it', 'warn', 'the frame', null, 'no words at all');

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

export async function check({ url, width, height, grow, touch }) {
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
    const issues = await page.evaluate(AUDIT, { width, height, grow: !!grow, touch: !!touch });
    return issues;
  } finally {
    await app.close().catch(() => {});
  }
}
