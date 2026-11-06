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

import { withPage, draw, stopChrome } from './chrome.js';

export async function measureHeight({ url, width = 1440, viewport = 900 }) {
  return withPage({
    viewport: {
      width: Math.max(200, Math.round(width)),
      height: Math.max(400, Math.round(viewport)),
      deviceScaleFactor: 1
    }
  }, async page => {
    await draw(page, url, { wait: 0 });

    const read = () => page.evaluate(() => Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0
    ));

    // Twice, because a page that animates itself in is shorter while it is doing it, and
    // the taller answer is the one that holds.
    let height = await read();
    await new Promise(r => setTimeout(r, 900));
    height = Math.max(height, await read());

    // Whether the page is wider than the frame it sits in, which is a horizontal scrollbar
    // for anybody looking at it. Taller than the frame is what a screen is for; wider is
    // something that does not fit. `clipped` says the page hides it rather than scrolls it,
    // which is the same mistake with the evidence removed.
    const across = await page.evaluate(() => {
      const root = document.documentElement;
      const body = document.body;
      const mode = getComputedStyle(root).overflowX !== 'visible'
        ? getComputedStyle(root).overflowX
        : (body ? getComputedStyle(body).overflowX : 'visible');
      const by = Math.max(root.scrollWidth, body ? body.scrollWidth : 0) - root.clientWidth;
      return { by: Math.round(by), clipped: mode === 'hidden' || mode === 'clip' };
    }).catch(() => ({ by: 0, clipped: false }));

    return { height: Math.round(height), wide: across.by > 1 ? across.by : 0, clipped: across.clipped };
  });
}

export const stopMeasuring = stopChrome;
