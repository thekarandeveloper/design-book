// Reading a page of the board's own, from inside the board.
//
// A page that is the board's own is served from the board's origin, so the board can run
// the same functions the headless browser runs, in the page's own window, and have the answer
// in a few milliseconds. The headless browser is for the other kind: a project's dev server
// is another origin, and nothing in a page can reach into one.
//
// The functions are the very ones the server runs (tools/page-fns.js and audit-fn.js), as
// text evaluated in the iframe's window, so they see the page's document and not this one.

import { SCAN, DETAIL } from '../../tools/page-fns.js';
import { AUDIT } from '../../tools/audit-fn.js';

const MOST_ELEMENTS = 3500;

// The window of a frame's page, when it can be reached: it is on this origin and loaded.
export function windowOf(frameId) {
  const node = document.querySelector(`.st-world > .st-frame[data-id="${CSS.escape(frameId)}"] iframe`);
  if (!node) return null;
  try {
    const win = node.contentWindow;
    if (!win || !win.document || win.document.readyState !== 'complete' || !win.document.body) return null;
    return win;
  } catch (_) {
    return null;                       // another origin
  }
}

const run = (win, fn, ...args) => win.eval(`(${fn.toString()})`)(...args);

export const scanLocal = win => run(win, SCAN, MOST_ELEMENTS);

// One element in full. Where it came from is the frame's own file, which the panel already
// names; a page of the board is not built by a framework that keeps a trail.
export function detailLocal(win, i) {
  const d = run(win, DETAIL, i);
  if (!d || d.stale) return d;
  const { stack, hints, ...rest } = d;
  return { ...rest, source: null, components: d.owners || [] };
}

// The same eye as a frame's check, over one element and what is inside it.
export function auditLocal(win, i, { width, height, screen, touch }) {
  const el = win.__dbEls && win.__dbEls[i];
  if (!el || !el.isConnected) return { stale: true };
  return { issues: run(win, AUDIT, { width, height, grow: true, screen: !!screen, touch: !!touch }, el) };
}
