// A picture of every frame, for when the frame is too small to run.
//
// Zoomed out to see the whole board, a frame is a few hundred pixels across, and running
// eighty applications to draw eighty thumbnails is exactly what the board must not do.
// So a frame that is too small to be worth running shows a picture of itself instead:
// drawn once by the headless browser, kept on disk, and shown at once. The picture is
// also what a frame shows while its page is still loading, so waking one never flashes
// white.
//
// Where they live: outside the repo. They are a cache that can be thrown away, and a
// folder of JPEGs in somebody's project is a folder somebody commits.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withPage, draw, pictures } from './chrome.js';

export function cacheRoot(boardRoot) {
  const base = process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Caches')
    : process.platform === 'win32'
      ? (process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'))
      : (process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'));
  const which = crypto.createHash('sha1').update(String(boardRoot)).digest('hex').slice(0, 10);
  return path.join(base, 'design-book', which);
}

const stem = id => String(id).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'frame';

export function posterFiles(boardRoot, id) {
  const dir = path.join(cacheRoot(boardRoot), 'posters');
  return { dir, img: path.join(dir, stem(id) + '.jpg'), meta: path.join(dir, stem(id) + '.json') };
}

// What a picture is of.
//
// A poster is current when the frame's own file and its size are the ones it was drawn at.
// When something else in the project changed it is stale but still better than nothing,
// and it is drawn again the next time somebody has looked at the real thing and gone away.
//
// A DIFFERENT SIZE IS NOT STALE, IT IS THE WRONG PICTURE. Stretching a 393 wide picture
// across a 474 wide frame is not a slightly old board, it is a board of squashed screens,
// and that is what the day the device arrived looked like from far enough out to see
// posters rather than pages. One of those is thrown away and the frame waits for its own.
export function readPoster(boardRoot, id, want) {
  const files = posterFiles(boardRoot, id);
  try {
    const meta = JSON.parse(fs.readFileSync(files.meta, 'utf8'));
    if (!fs.existsSync(files.img)) return null;
    if (want && (meta.width !== want.width || meta.height !== want.height)) return null;
    // The device, drawn or not, is part of what the picture is of.
    //
    // Turning the phone off a frame changes what it looks like and nothing else: the
    // frame's size does not change and neither does the file's time, so the picture from
    // before was still counted as current and a board zoomed out kept showing the bezels
    // after they had been turned off, and showing none after they were turned back on.
    if (want && 'bezel' in want && !!meta.bezel !== !!want.bezel) return null;
    const fresh = !want || !want.changed || meta.changed === want.changed;
    return { file: files.img, meta, fresh };
  } catch (_) {
    return null;
  }
}

// How big the picture is: sharp enough for a thumbnail, small enough that eighty of them
// are a few megabytes. A page forty thousand pixels tall is a picture of its top, to the
// most a JPEG can be.
const ACROSS = 640;
const MOST_DOWN = 6000;
const MOST_FRAME = 16000;

async function capture({ url, width, height }) {
  const w = Math.max(200, Math.round(width));
  const h = Math.min(MOST_FRAME, Math.max(200, Math.round(height)));
  return withPage({ viewport: { width: w, height: h, deviceScaleFactor: 1 }, calm: true }, async page => {
    const res = await draw(page, url, { still: true });
    // A page that answered with an error is not a picture of the frame, and showing it
    // would read as though the design itself were broken.
    if (!res || res.status() >= 400) throw new Error(`the page answered ${res ? res.status() : 'nothing'}`);
    // How tall the page really is.
    //
    // A frame nobody has measured is the board's default height, and the picture was taken
    // at that height: a 3,185 page in a 900 frame came out as a picture of its first 900
    // and a frame of empty below it, which is what a half drawn screen on the board was.
    // The picture is of the page, so it is taken at the page's own height, and the height
    // is reported so the frame can stop being wrong.
    const tall = await page.evaluate(() => Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0
    )).catch(() => 0);
    const full = Math.min(MOST_FRAME, Math.max(h, tall || 0));
    // The viewport is made as tall as what is being captured, rather than asking the
    // screenshot to reach past it. `captureBeyondViewport` did that, and this code passed
    // it, but Puppeteer dropped the option at v22 and ignores it at the 25 installed here:
    // every clip past the viewport came back as the viewport and the rest of the frame was
    // blank. That is the half drawn screen on the board, and it would have come back
    // silently on any later upgrade too.
    if (full !== h) {
      await page.setViewport({ width: w, height: full, deviceScaleFactor: 1 });
      // A taller viewport brings more of the page into view, and anything that waited to
      // be drawn until it was in view is only now being drawn.
      await pictures(page);
      await new Promise(r => setTimeout(r, 200));
    }
    const scale = Math.min(1, ACROSS / w, MOST_DOWN / full);
    const bytes = await page.screenshot({
      type: 'jpeg',
      quality: 58,
      clip: { x: 0, y: 0, width: w, height: full, scale }
    });
    return { bytes: Buffer.from(bytes), scale, height: full };
  });
}

// One at a time, newest ask first: a board that has just been zoomed out wants the
// frames in front of you drawn before the ones off the edge, and the last thing asked for
// is the thing in front of you.
const stack = [];
const inflight = new Map();
// Two at a time: each is a page drawing, and the browser itself limits how many pages draw
// at once across everything that asks, so this only keeps it from being idle between them.
const LANES = 2;
let running = 0;

async function pump() {
  while (running < LANES && stack.length) {
    running++;
    lane().finally(() => { running--; pump(); });
  }
}

async function lane() {
  const job = stack.pop();
  try {
    const have = readPoster(job.root, job.id, job.want);
    if (have && have.fresh) { job.done({ ok: true, ...have.meta }); return; }
    if (job.ready && !(await job.ready())) { job.done({ ok: false, why: 'the page is not being served yet' }); return; }
    const { bytes, scale, height } = await capture(job.shot);
    const files = posterFiles(job.root, job.id);
    fs.mkdirSync(files.dir, { recursive: true });
    fs.writeFileSync(files.img, bytes);
    // The height the picture was really taken at, which is the page's, not the frame's.
    // `readPoster` matches on it, so a frame that then grows to fit asks for its own
    // picture rather than stretching this one.
    const meta = {
      width: job.want.width, height: height || job.want.height, changed: job.want.changed || 0,
      bezel: !!job.want.bezel,
      scale, at: Date.now()
    };
    fs.writeFileSync(files.meta, JSON.stringify(meta));
    job.done({ ok: true, ...meta });
  } catch (err) {
    job.done({ ok: false, why: err.message });
  }
}

// `ready` says whether the page is being served at all; `shot` is what to draw.
export function ensurePoster({ root, id, shot, want, ready }) {
  const key = `${root}|${id}`;
  const had = inflight.get(key);
  if (had) {
    // Asked again: it has become the newest thing asked for.
    const at = stack.indexOf(had.job);
    if (at >= 0) { stack.splice(at, 1); stack.push(had.job); }
    return had.promise;
  }
  let done;
  const promise = new Promise(resolve => { done = resolve; }).finally(() => inflight.delete(key));
  const job = { root, id, shot, want, ready, done };
  inflight.set(key, { job, promise });
  stack.push(job);
  pump();
  return promise;
}

// A frame whose page changed has a poster that is no longer a picture of it.
export function forgetPoster(boardRoot, id) {
  const files = posterFiles(boardRoot, id);
  for (const f of [files.img, files.meta]) { try { fs.unlinkSync(f); } catch (_) {} }
}
