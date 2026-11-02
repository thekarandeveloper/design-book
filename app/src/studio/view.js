// Where the board is, how far in it is, and who is told when that changes.
//
// This used to be React state. Every wheel event set it, so every wheel event rendered
// the whole board again: a hundred renders a second for movement the screen can only
// show sixty times. The frames do not change when the board moves, only where they are
// drawn does, and that is one transform on one layer.
//
// So the view lives here instead, outside React. Whoever moves the board writes to it;
// whoever draws reads it on the next animation frame and writes a transform. React is
// told only when something it actually renders has changed, which is the zoom readout
// and the labels, and even those are told once a frame at most.

const LEAST = 0.02;
const MOST = 8;

export function createView(start = { x: 0, y: 0, k: 1 }) {
  let at = { ...start };
  const watchers = new Set();
  let waiting = 0;

  const tell = () => {
    waiting = 0;
    for (const watcher of watchers) watcher(at);
  };
  // Once a frame, however many times it is moved in between.
  const soon = () => { if (!waiting) waiting = requestAnimationFrame(tell); };

  return {
    get: () => at,

    // A move, as a whole new place or as a change to the one it is at.
    set(next) {
      const to = typeof next === 'function' ? next(at) : next;
      const k = Math.max(LEAST, Math.min(MOST, to.k ?? at.k));
      if (to.x === at.x && to.y === at.y && k === at.k) return at;
      at = { x: to.x ?? at.x, y: to.y ?? at.y, k };
      soon();
      return at;
    },

    pan(dx, dy) {
      return this.set({ x: at.x + dx, y: at.y + dy });
    },

    // Zooming around a point keeps whatever is under the pointer under the pointer.
    zoomAt(screenX, screenY, factor) {
      const k = Math.max(LEAST, Math.min(MOST, at.k * factor));
      if (k === at.k) return at;
      return this.set({
        x: screenX - (screenX - at.x) * (k / at.k),
        y: screenY - (screenY - at.y) * (k / at.k),
        k
      });
    },

    watch(fn) {
      watchers.add(fn);
      fn(at);
      return () => watchers.delete(fn);
    },

    stop() { if (waiting) cancelAnimationFrame(waiting); waiting = 0; }
  };
}

// World to screen, for anything that has to be placed by hand.
export const onScreen = (view, x, y) => ({ x: view.x + x * view.k, y: view.y + y * view.k });
export const inWorld = (view, x, y) => ({ x: (x - view.x) / view.k, y: (y - view.y) / view.k });

// The one string the board's layer is moved with. Translate before scale, so x and y
// stay in screen pixels and panning never has to be divided by the zoom.
export const transformOf = view => `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.k})`;
