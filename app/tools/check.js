// Looking at a frame the way a designer looks at it.
//
// Not a linter for the code: a check on what the thing looks like once it is drawn. Can
// the words be read against what is behind them, is anything cut off at the edge, is
// something too small to tap, did an image fail to arrive. The page is drawn by the same
// browser that drew it on the board, and then measured in place, so what is reported is
// what is there rather than what the markup suggests.

import { findBrowser } from './export.js';

import { AUDIT } from './audit-fn.js';
export { AUDIT };

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
