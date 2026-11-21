// Draw one of a board's pages and say what came out.
//
// A page is written to be looked at, so the only honest check is to look at it. This starts
// the board's own Astro, draws the pages named (or all of them), writes a PNG for each, and
// prints anything the page complained about: a component that did not compile, a request that
// failed, a page taller or wider than its frame.
//
// It is the board's own compiler and the board's own tokens, so what comes out is what the
// board shows. Nothing is written into the project: the PNGs go to the board's cache.
//
//   node tools/render-page.mjs <board folder> [page ...]
//
// The board folder is the one holding `.designbook`, for example a repo root.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { AstroSource } from './astro.js';
import { readNativeTokens, tokenCss, readFontFiles, fontCss } from './native.js';
import { cacheRoot } from './posters.js';
import { findBrowser } from './export.js';
import { astroMeta } from './astro.js';

const root = path.resolve(process.argv[2] || '.');
const only = process.argv.slice(3);
const studioRoot = path.join(root, '.designbook');
if (!fs.existsSync(studioRoot)) {
  console.error(`No .designbook in ${root}`);
  process.exit(1);
}

const appDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const astro = new AstroSource({ studioRoot, appDir, log: () => {} });

const pagesDir = path.join(studioRoot, 'pages');
const names = fs.existsSync(pagesDir)
  ? fs.readdirSync(pagesDir).filter(f => f.endsWith('.astro')).sort()
  : [];
const wanted = only.length
  ? names.filter(n => only.some(o => n.includes(o.replace(/\.astro$/, ''))))
  : names;

if (!wanted.length) {
  console.error(names.length ? `No page matches ${only.join(' ')}` : 'No .astro pages on this board');
  process.exit(1);
}

const native = (() => { try { return readNativeTokens(root); } catch (_) { return null; } })();
astro.setTokens([tokenCss(native), fontCss(readFontFiles(root))].filter(Boolean).join('\n'));
if (!await astro.start()) {
  console.error('The page compiler did not start:', astro.why);
  process.exit(1);
}

// Served the way the board serves it, which is what puts the project's own design system on
// the page. Drawing straight from Astro would be a page with the kit's fallback colours, and
// every screen would come out in the wrong palette.
const serve = http.createServer(async (req, res) => {
  const made = await astro.page(req.url.replace(/\?.*$/, ''));
  res.writeHead(made.status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(made.html);
});
await new Promise(r => serve.listen(0, '127.0.0.1', r));
const port = serve.address().port;

const browser = findBrowser();
if (!browser) {
  console.error('No Chrome, Chromium, Brave or Edge on this machine to draw with.');
  process.exit(1);
}
const { default: puppeteer } = await import('puppeteer-core');
const app = await puppeteer.launch({
  executablePath: browser,
  headless: true,
  args: ['--hide-scrollbars', '--disable-gpu', '--no-first-run', '--no-default-browser-check']
});

const out = path.join(cacheRoot(studioRoot), 'renders');
fs.mkdirSync(out, { recursive: true });
let bad = 0;

for (const name of wanted) {
  const meta = astroMeta(path.join(pagesDir, name));
  const width = Number(meta.width) || 393;
  const height = Number(meta.height) || 852;
  const page = await app.newPage();
  const said = [];
  // A browser asks every page for a favicon and no screen has one, so that one is not a
  // fault of the page. Its console line says nothing about which request it was, which is why
  // the responses are watched rather than the console.
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource/.test(m.text())) return;
    said.push('console: ' + m.text().slice(0, 140));
  });
  page.on('pageerror', e => said.push('page error: ' + String(e.message).slice(0, 140)));
  page.on('requestfailed', r => { if (!r.url().endsWith('/favicon.ico')) said.push('did not load: ' + r.url().split('/').pop()); });
  page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) said.push(`${r.status()} ${r.url().split('/').pop()}`); });
  await page.setViewport({ width, height, deviceScaleFactor: 2 });

  const url = `http://127.0.0.1:${port}/${name.replace(/\.astro$/, '')}`;
  let answered = 0;
  try {
    const res = await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    answered = res ? res.status() : 0;
    await page.evaluate(() => (document.fonts ? document.fonts.ready : null)).catch(() => {});
  } catch (err) {
    said.push('did not draw: ' + err.message.split('\n')[0]);
  }

  const size = await page.evaluate(() => {
    const body = document.body;
    // How far the content really reaches.
    //
    // A screen that does not grow is a box of exactly its frame's height, so `scrollHeight`
    // is that height whatever is inside it, and a page whose last rows fall off the bottom
    // measures as though it fitted. What is asked instead is where the content ends, which
    // is the furthest bottom edge of anything on the page.
    //
    // Content inside something that clips does not count. A page that draws a scroll
    // region the way the device shows it gives that region a fixed box and
    // `overflow: hidden`, and what runs past the edge of it is meant to be cut: that is
    // the screen, not a fault. So the walk stops at the first ancestor that clips, and
    // the clipping box itself is what is measured.
    const clips = el => {
      const s = getComputedStyle(el);
      return s.overflow !== 'visible' || s.overflowY !== 'visible' || s.overflowX !== 'visible';
    };
    let reaches = 0;
    for (const el of body ? body.querySelectorAll('*') : []) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.position === 'fixed') continue;
      let cut = false;
      for (let up = el.parentElement; up && up !== body; up = up.parentElement) {
        if (clips(up)) { cut = true; break; }
      }
      if (cut) continue;
      const box = el.getBoundingClientRect();
      if (box.height === 0) continue;
      reaches = Math.max(reaches, box.bottom + window.scrollY);
    }
    // A symbol the kit has no drawing for comes out as a small square with a dot in it.
    // It reads as a real icon at a glance, so nobody notices, and the screen ships with a
    // placeholder on it. The component says which ones those were.
    const unknown = [...new Set(
      [...document.querySelectorAll('[data-unknown="true"]')].map(el => el.getAttribute('data-symbol'))
    )];
    return {
      w: Math.max(document.documentElement.scrollWidth, body ? body.scrollWidth : 0),
      h: Math.max(document.documentElement.scrollHeight, body ? body.scrollHeight : 0),
      reaches: Math.round(reaches),
      unknown,
      text: (body ? body.innerText : '').replace(/\s+/g, ' ').trim().slice(0, 70)
    };
  }).catch(() => ({ w: 0, h: 0, reaches: 0, unknown: [], text: '' }));

  const file = path.join(out, name.replace(/\.astro$/, '') + '.png');
  await page.screenshot({ path: file }).catch(() => {});
  await page.close();

  // What is worth saying about a drawn screen, and nothing else: a page wider than its frame
  // is a fault on any device, a page much taller than its frame is one unless it is meant to
  // grow, and an empty page is one however cleanly it compiled.
  const notes = [...said];
  if (answered !== 200) notes.push(`answered ${answered}`);
  if (size.w > width + 1) notes.push(`${size.w - width}px wider than its frame`);
  if (!meta.grow && size.h > height + 8) notes.push(`${size.h - height}px taller than its frame`);
  // A screen whose content runs past the bottom of a frame that does not grow loses it: the
  // frame crops what is there and nothing says so. A screen that scrolls says `grow` and the
  // board measures it; one that does not scroll has something too long in it.
  if (!meta.grow && size.reaches > height + 8) {
    notes.push(`content reaches ${size.reaches} in an ${height} frame, so ${size.reaches - height}px is cut off: say grow on Screen if it scrolls`);
  }
  // The other way round, and the one nothing was catching: a growing page whose box is far
  // taller than anything in it. The board measures a frame off this number, so the frame
  // comes out as a tall white rectangle with the screen in a strip at the top, which is
  // what a person sees before anybody looks at a render. It is nearly always one element
  // with a viewport height (`min-h-svh`, `100vh`) inside a page that also grows.
  if (meta.grow && size.reaches && size.h - size.reaches > 160) {
    notes.push(`the box is ${size.h} but nothing on it reaches past ${size.reaches}, so ${size.h - size.reaches}px of the frame is empty: find the element with a viewport height in it`);
  }
  if (size.unknown && size.unknown.length) {
    notes.push(`the kit has no shape for ${size.unknown.join(', ')}, so each is a placeholder square`);
  }
  if (!size.text) notes.push('nothing on it');
  if (notes.length) bad++;
  console.log(`${name.padEnd(34)} ${size.w}x${size.h}  ${notes.length ? 'LOOK: ' + notes.join('; ') : 'ok'}`);
  if (!notes.length) console.log(`${''.padEnd(34)} ${file}`);
}

await app.close();
serve.close();
await astro.stop();
console.log(`\n${wanted.length} drawn, ${bad} to look at. Pictures in ${out}`);
process.exit(bad ? 1 : 0);
