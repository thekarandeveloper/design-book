// Exporting a frame as a picture.
//
// The frame is a page a dev server is already serving, so the honest way to turn it into
// a file is to let a browser draw it: the same engine that drew what is on the board,
// rather than a second renderer that would disagree with it.
//
// puppeteer-core drives the Chrome that is already on this machine, so nothing is
// downloaded and every setting a person would want is one option: the pixel density, the
// format, the background, the quality, and whether to take the frame or the whole page.

import fs from 'node:fs';
import path from 'node:path';

const BROWSERS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
];

export function findBrowser() {
  return BROWSERS.find(b => {
    try { fs.accessSync(b, fs.constants.X_OK); return true; } catch (_) { return false; }
  }) || '';
}

export const FORMATS = ['png', 'jpeg', 'webp', 'pdf'];

const clamp = (n, lo, hi, fallback) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
};

// Everything the caller may choose, with what it falls back to.
export function settings(given = {}) {
  const format = FORMATS.includes(given.format) ? given.format : 'png';
  return {
    format,
    scale: clamp(given.scale, 1, 4, 2),
    quality: clamp(given.quality, 10, 100, 92),
    // 'page' keeps what the page itself draws, 'white' puts white behind it, and
    // 'transparent' keeps nothing behind it, which only png and webp can carry.
    background: ['page', 'white', 'transparent'].includes(given.background) ? given.background : 'page',
    whole: !!given.whole,
    name: String(given.name || 'frame').replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '') || 'frame'
  };
}

export async function shoot({ url, width, height, dir, ...given }) {
  const browser = findBrowser();
  if (!browser) throw new Error('No Chrome, Chromium, Brave or Edge on this machine to draw the picture.');

  const o = settings(given);
  const { default: puppeteer } = await import('puppeteer-core');

  const w = Math.max(16, Math.round(width));
  const h = Math.max(16, Math.round(height));
  const ext = o.format === 'jpeg' ? 'jpg' : o.format;
  const stem = `${o.name}-${w}x${h}${o.scale > 1 ? `@${o.scale}x` : ''}`;
  fs.mkdirSync(dir, { recursive: true });
  // The same frame exported again is the next version of it, not a file with a number
  // stuck on the end: v2, v3, so the newest one is obvious in a folder.
  let out = path.join(dir, `${stem}.${ext}`);
  let v = 2;
  while (fs.existsSync(out)) out = path.join(dir, `${stem}-v${v++}.${ext}`);

  const app = await puppeteer.launch({
    executablePath: browser,
    headless: true,
    args: ['--hide-scrollbars', '--disable-gpu', '--no-first-run', '--no-default-browser-check']
  });

  try {
    const page = await app.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: o.scale });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
    // A page that is still laying its type out is a page that exports wrong.
    await page.evaluate(() => (document.fonts ? document.fonts.ready : null)).catch(() => {});
    if (o.background === 'white') {
      await page.addStyleTag({ content: 'html,body{background:#fff !important}' });
    }

    if (o.format === 'pdf') {
      await page.pdf({
        path: out,
        width: `${w}px`,
        height: `${o.whole ? await fullHeight(page) : h}px`,
        printBackground: o.background !== 'transparent',
        pageRanges: '1'
      });
    } else {
      await page.screenshot({
        path: out,
        type: o.format,
        fullPage: o.whole,
        omitBackground: o.background === 'transparent' && o.format !== 'jpeg',
        ...(o.format === 'png' ? {} : { quality: Math.round(o.quality) })
      });
    }
  } finally {
    await app.close().catch(() => {});
  }

  const { size } = fs.statSync(out);
  return { file: out, bytes: size, ...o, width: w, height: h };
}

const fullHeight = page =>
  page.evaluate(() => Math.ceil(document.documentElement.scrollHeight)).catch(() => 0);
