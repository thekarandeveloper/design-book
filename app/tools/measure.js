// How tall a page really is.
//
// The board needs this to give a frame the height of what is in it. It used to be done
// by copying the page into a hidden iframe and asking it, which cannot work for a page
// that draws itself after it loads: served from another address its own scripts never
// settle, and the answer comes back as one screenful.
//
// So the page is drawn, in the same headless browser that checks and exports a frame,
// at the address the board shows it at. What that browser says is what a person would
// see, because it is the same engine drawing the same page.
//
// One browser is kept alive between measurements and closed when nobody has asked for a
// while: starting Chrome once per frame on a board of eighty is a minute of starting
// Chrome.

import { findBrowser } from './export.js';

let app = null;
let closing = null;
const IDLE = 60000;

async function browser() {
  if (app) return app;
  const found = findBrowser();
  if (!found) throw new Error('No Chrome, Chromium, Brave or Edge on this machine to measure with.');
  const { default: puppeteer } = await import('puppeteer-core');
  app = await puppeteer.launch({
    executablePath: found,
    headless: true,
    args: ['--hide-scrollbars', '--disable-gpu', '--no-first-run', '--no-default-browser-check']
  });
  app.on('disconnected', () => { app = null; });
  return app;
}

function keepOrClose() {
  clearTimeout(closing);
  closing = setTimeout(async () => {
    const open = app;
    app = null;
    if (open) await open.close().catch(() => {});
  }, IDLE);
}

export async function measureHeight({ url, width = 1440, viewport = 900 }) {
  const at = await browser();
  const page = await at.newPage();
  try {
    await page.setViewport({
      width: Math.max(200, Math.round(width)),
      height: Math.max(400, Math.round(viewport)),
      deviceScaleFactor: 1
    });
    // networkidle2 rather than load: a page that fetches what it draws is not finished
    // when it says it is loaded, and a frame measured then is a frame cut in half.
    //
    // A page that never goes quiet, which is most pages with an animation on them, still
    // gets measured: what is on the screen by then is the answer, and it is a better one
    // than leaving the frame at a height nobody chose.
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
    await page.evaluate(() => (document.fonts ? document.fonts.ready : null)).catch(() => {});

    const read = () => page.evaluate(() => Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0
    ));

    // Twice, because a page that animates itself in is shorter while it is doing it, and
    // the taller answer is the one that holds.
    let height = await read();
    await new Promise(r => setTimeout(r, 900));
    height = Math.max(height, await read());
    return Math.round(height);
  } finally {
    await page.close().catch(() => {});
    keepOrClose();
  }
}

export async function stopMeasuring() {
  clearTimeout(closing);
  const open = app;
  app = null;
  if (open) await open.close().catch(() => {});
}
