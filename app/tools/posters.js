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
import { withPage, draw } from './chrome.js';

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

// What a picture is of. A poster is current when the frame's own file and its size are the
// ones it was drawn at; when anything else in the project changed it is stale but still
// better than nothing, and it is drawn again the next time somebody has looked at the real
// thing and gone away.
export function readPoster(boardRoot, id, want) {
  const files = posterFiles(boardRoot, id);
  try {
    const meta = JSON.parse(fs.readFileSync(files.meta, 'utf8'));
    if (!fs.existsSync(files.img)) return null;
    const fresh = !want
      || (meta.width === want.width && meta.height === want.height && (!want.changed || meta.changed === want.changed));
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
    const scale = Math.min(1, ACROSS / w, MOST_DOWN / h);
    const bytes = await page.screenshot({
      type: 'jpeg',
      quality: 58,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: w, height: h, scale }
    });
    return { bytes: Buffer.from(bytes), scale };
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
    const { bytes, scale } = await capture(job.shot);
    const files = posterFiles(job.root, job.id);
    fs.mkdirSync(files.dir, { recursive: true });
    fs.writeFileSync(files.img, bytes);
    const meta = {
      width: job.want.width, height: job.want.height, changed: job.want.changed || 0,
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
