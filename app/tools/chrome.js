// The headless browser, shared.
//
// Measuring a frame, drawing its picture, reading what is on it and exporting it all need
// a real browser drawing the real page, and starting one is the slow part. So there is
// one, kept alive between jobs and closed when nobody has asked for a while, and every job
// borrows a page from it.
//
// Two limits, because a board of eighty frames can ask for eighty things at once:
// only a few pages are drawing at any moment (the rest wait their turn), and a page that
// is kept open on purpose, which is what a session reading one frame is, keeps the
// browser alive without taking one of those turns.

import { findBrowser } from './export.js';

const IDLE = 60000;
// Pages drawing at once. Each is a whole page with its own scripts, and a laptop that is
// also running the project's dev server and an editor has room for a few.
const MOST = 3;

let app = null;
let launching = null;
let closing = null;
let busy = 0;
let held = 0;
const waiting = [];

async function browser() {
  if (app) return app;
  if (launching) return launching;
  launching = (async () => {
    const found = findBrowser();
    if (!found) throw new Error('No Chrome, Chromium, Brave or Edge on this machine to draw the page with.');
    const { default: puppeteer } = await import('puppeteer-core');
    const opened = await puppeteer.launch({
      executablePath: found,
      headless: true,
      args: ['--hide-scrollbars', '--disable-gpu', '--no-first-run', '--no-default-browser-check']
    });
    opened.on('disconnected', () => { if (app === opened) app = null; });
    app = opened;
    return opened;
  })().finally(() => { launching = null; });
  return launching;
}

function rest() {
  clearTimeout(closing);
  if (busy > 0 || held > 0) return;
  closing = setTimeout(async () => {
    if (busy > 0 || held > 0) return;
    const open = app;
    app = null;
    if (open) await open.close().catch(() => {});
  }, IDLE);
}

const take = () => new Promise(resolve => {
  clearTimeout(closing);
  if (busy < MOST) { busy++; resolve(); } else waiting.push(resolve);
});

// A turn handed to whoever has waited longest keeps the count where it is.
const give = () => {
  const next = waiting.shift();
  if (next) next();
  else { busy--; rest(); }
};

// A page for one job, closed when it is done.
export async function withPage(options, job) {
  await take();
  try {
    const at = await browser();
    const page = await at.newPage();
    try {
      if (options && options.viewport) await page.setViewport(options.viewport);
      if (options && options.calm) await calm(page);
      return await job(page);
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    give();
  }
}

// A page that stays open until it is closed: for reading one frame again and again
// without drawing it again each time. It does not take one of the turns above, but it
// does keep the browser from closing under it.
export async function openPage(options) {
  clearTimeout(closing);
  const at = await browser();
  const page = await at.newPage();
  held++;
  let closed = false;
  try {
    if (options && options.viewport) await page.setViewport(options.viewport);
    if (options && options.calm) await calm(page);
  } catch (err) {
    held--;
    await page.close().catch(() => {});
    throw err;
  }
  return {
    page,
    async close() {
      if (closed) return;
      closed = true;
      held--;
      await page.close().catch(() => {});
      rest();
    }
  };
}

// A page that has stopped moving: animations are asked to stay still, because a frame
// drawn halfway through its entrance is a frame that is somewhere else than it will be.
//
// And a pointer is pretended: a headless browser has none, so every rule written for
// `(hover: hover)` is off, and a button's hover state is a state it cannot be in.
async function calm(page) {
  await page.emulateMediaFeatures([
    { name: 'prefers-reduced-motion', value: 'reduce' },
    { name: 'hover', value: 'hover' },
    { name: 'pointer', value: 'fine' },
    { name: 'any-hover', value: 'hover' },
    { name: 'any-pointer', value: 'fine' }
  ]).catch(() => {});
}

// Drawn, in the sense a person means: loaded, its type laid out, and a moment for what
// draws itself after that. networkidle2 rather than load, and a page that never goes
// quiet is still read, because what is on the screen by then is the answer.
export async function draw(page, url, { wait = 700, timeout = 60000, still = false } = {}) {
  const res = await page.goto(url, { waitUntil: 'networkidle2', timeout }).catch(() => null);
  await page.evaluate(() => (document.fonts ? document.fonts.ready : null)).catch(() => {});
  await new Promise(r => setTimeout(r, wait));
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(() => {});
  if (still) await settle(page);
  return res;
}

// Waiting until the page is the page, and not the thing it shows on the way there.
//
// A site with a loader, a splash or a curtain is drawn and then, a few seconds on, drawn
// again as itself, and a picture or a map of elements taken in between is of the loader.
// So: wait for the page to hold still (its height and the number of things in it
// unchanged for a while) and for nothing fixed to be laid over most of the window. A page
// that never does is read anyway after a while, because what is on it then is the answer.
export async function settle(page, { max = 12000, hold = 1400, step = 350 } = {}) {
  const began = Date.now();
  let last = '';
  let since = Date.now();
  while (Date.now() - began < max) {
    const state = await page.evaluate(() => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      let covered = 0;
      for (const el of document.body ? document.body.querySelectorAll('*') : []) {
        const s = getComputedStyle(el);
        if (s.position !== 'fixed' || s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.05) continue;
        const b = el.getBoundingClientRect();
        if (b.width * b.height >= w * h * 0.8) { covered = 1; break; }
      }
      return `${document.documentElement.scrollHeight}|${document.getElementsByTagName('*').length}|${covered}`;
    }).catch(() => '');
    const covered = state.endsWith('|1');
    if (state !== last) { last = state; since = Date.now(); }
    if (!covered && Date.now() - since >= hold) return;
    await new Promise(r => setTimeout(r, step));
  }
}

export async function stopChrome() {
  clearTimeout(closing);
  const open = app;
  app = null;
  if (open) await open.close().catch(() => {});
}
