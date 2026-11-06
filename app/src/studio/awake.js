// Which frames run, which are pictures, and which are nothing at all.
//
// A live frame is a whole application in an iframe: its own framework, its own
// animations, its own socket back to its dev server. One is nothing. Eighty, which is what
// a real repo comes to, is eighty applications at once, and the board goes from quick to
// unusable while you are looking at four of them.
//
// Three tiers, decided from where the board is looking rather than asked of the browser:
//
//   live    running. In view, big enough on screen to be worth it, and one of the few.
//   poster  a picture of the frame. In view but too small to read (zoomed out to see the
//           whole board) or beyond the few that may run. Costs an image, not an application.
//   asleep  nothing. Out of view; it is not in the page at all.
//
// This is how the tools that do this for a living do it. tldraw works out which shapes
// intersect the viewport in page space and renders none of the rest, and keeps the one
// you have selected whatever its place; its set is only handed on when it changes, so what
// reads it is cheap. Figma and Framer draw a low resolution picture of a frame until it
// is big enough to matter. Both are here: the geometry is ours, so there is no observer
// to wait on and nothing to ask the browser about a layer that is being transformed, and
// the picture is the headless browser's, kept on disk.
//
// A frame is woken a half screen early so it is drawn before you reach it, and put to
// sleep a few seconds after you have gone, so panning back and forth never reloads one.

import { createContext, useContext, useSyncExternalStore } from 'react';

// Zoom at which a frame is worth running. Below it a frame is a thumbnail and a picture
// does the job. A little lower to stay running than to start, so a zoom that sits right at
// the line does not flip it back and forth.
const RUN_AT = 0.3;
const KEEP_RUNNING_AT = 0.26;
// How many may run at once, however many are in view.
const MOST_LIVE = 6;
// Half a screen past the edge: far enough that a frame is drawn before it is reached,
// close enough that a board of a hundred keeps a handful of them awake.
const MARGIN = 0.5;
// A frame that has gone out of view is probably coming back.
const SLEEP_AFTER = 5000;

export function createSleeper() {
  let frames = [];
  let view = { x: 0, y: 0, k: 1 };
  let size = { w: 1200, h: 800 };
  let keep = new Set();
  let tiers = new Map();
  const left = new Map();
  const listeners = new Map();
  let timer = 0;

  const tell = id => { const set = listeners.get(id); if (set) for (const fn of set) fn(); };

  function compute() {
    const now = Date.now();
    const mx = size.w * MARGIN;
    const my = size.h * MARGIN;
    const next = new Map();
    const runnable = [];
    let again = 0;

    for (const f of frames) {
      const sx = view.x + f.x * view.k;
      const sy = view.y + f.y * view.k;
      const sw = f.width * view.k;
      const sh = f.height * view.k;
      const kept = keep.has(f.id);
      const inView = sx < size.w + mx && sx + sw > -mx && sy < size.h + my && sy + sh > -my;
      const was = tiers.get(f.id) || 'asleep';

      if (!inView && !kept) {
        // Gone out of view: as it was for a few seconds, then nothing.
        if (was !== 'asleep') {
          const since = left.get(f.id) ?? now;
          left.set(f.id, since);
          const wait = SLEEP_AFTER - (now - since);
          if (wait > 0) {
            next.set(f.id, was);
            again = Math.max(again, wait);
            continue;
          }
        }
        left.delete(f.id);
        next.set(f.id, 'asleep');
        continue;
      }
      left.delete(f.id);

      // Drawn by the board itself, in this document: cheap, so it is simply there.
      if (!f.running) { next.set(f.id, 'live'); continue; }

      const worth = kept || view.k >= (was === 'live' ? KEEP_RUNNING_AT : RUN_AT);
      if (!worth) { next.set(f.id, 'poster'); continue; }

      // How far the frame is from the middle of the window, as the nearest point of it:
      // a screen forty thousand pixels tall is in the middle of the window wherever its
      // own middle happens to be.
      const dx = Math.max(sx - size.w / 2, 0, size.w / 2 - (sx + sw));
      const dy = Math.max(sy - size.h / 2, 0, size.h / 2 - (sy + sh));
      runnable.push({ id: f.id, far: kept ? -1 : dx * dx + dy * dy });
    }

    runnable.sort((a, b) => a.far - b.far);
    runnable.forEach((r, i) => next.set(r.id, i < MOST_LIVE ? 'live' : 'poster'));

    const changed = [];
    for (const [id, tier] of next) if (tiers.get(id) !== tier) changed.push(id);
    for (const id of tiers.keys()) if (!next.has(id)) changed.push(id);
    tiers = next;
    for (const id of changed) tell(id);

    clearTimeout(timer);
    if (again) timer = setTimeout(compute, again + 30);
  }

  return {
    // Everything the answer depends on, in one place; anything left out keeps its value.
    update(patch) {
      if (patch.frames) frames = patch.frames;
      if (patch.view) view = patch.view;
      if (patch.size) size = patch.size;
      if (patch.keep) keep = patch.keep;
      compute();
    },
    tier: id => tiers.get(id) || 'asleep',
    // Told only when this one frame's tier changes: a pan that changes nothing for a
    // frame costs that frame nothing.
    subscribe(id, fn) {
      if (!listeners.has(id)) listeners.set(id, new Set());
      listeners.get(id).add(fn);
      return () => { const set = listeners.get(id); if (set) { set.delete(fn); if (!set.size) listeners.delete(id); } };
    },
    stop() { clearTimeout(timer); }
  };
}

export const SleeperContext = createContext(null);

export function useTier(id) {
  const sleeper = useContext(SleeperContext);
  return useSyncExternalStore(
    fn => (sleeper ? sleeper.subscribe(id, fn) : () => {}),
    () => (sleeper ? sleeper.tier(id) : 'live')
  );
}
