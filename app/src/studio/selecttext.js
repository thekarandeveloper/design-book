// Selecting text in a frame, and copying it.
//
// A frame takes no pointer events of its own: that is what lets the wheel pan the board
// over it and lets a frame be dragged around. So dragging across words did nothing, and
// the only way to read a line off a screen was to go inside the frame first, or to take a
// picture of it. Both are more ceremony than "I want that sentence".
//
// The board already draws a layer over the chosen frame to outline its elements. That
// layer sees the pointer, so the selection is driven from there instead of from the page:
// a press puts the caret where it landed, a drag extends it, and the page shows its own
// native highlight. Nothing about how the board handles the pointer had to change.
//
// This works because the page is served from the board's own origin, on purpose, so its
// document can be read. `astro.js` says why at more length.
//
// A SIDE EFFECT WORTH KNOWING: a selection made this way ignores `user-select: none`. The
// browser enforces that against a person dragging, not against a Range. So text a page
// has tried to make unselectable is selectable here. On a design board that is the
// behaviour you want, since the point is to read what is drawn.

// The document inside a frame, or null when the frame is a picture rather than a live
// page, which is most of the board most of the time.
function docOf(frameId) {
  try {
    const host = document.querySelector(`.st-screen[data-frame="${CSS.escape(frameId)}"] iframe`);
    return (host && host.contentDocument) || null;
  } catch (_) {
    return null;
  }
}

// Where a point lands in the text. Chromium and Safari answer one way, Firefox another,
// and a board runs in a VS Code webview, which is Chromium, so the first is the one that
// matters and the second is there so this is not wrong elsewhere.
function caretAt(doc, x, y) {
  if (doc.caretRangeFromPoint) return doc.caretRangeFromPoint(x, y);
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    if (!p) return null;
    const r = doc.createRange();
    r.setStart(p.offsetNode, p.offset);
    r.collapse(true);
    return r;
  }
  return null;
}

export function textIn(frameId) {
  const doc = docOf(frameId);
  if (!doc) return '';
  const sel = doc.getSelection();
  return sel && !sel.isCollapsed ? sel.toString() : '';
}

export function clearText(frameId) {
  const doc = docOf(frameId);
  const sel = doc && doc.getSelection();
  if (sel) sel.removeAllRanges();
}

// A press, then a drag. `at` is in the frame's own pixels, which is also the coordinate
// space of the page's viewport, so the two need no conversion between them.
export function startText(frameId, at) {
  const doc = docOf(frameId);
  if (!doc) return false;
  const range = caretAt(doc, at.x, at.y);
  if (!range) return false;
  const sel = doc.getSelection();
  if (!sel) return false;
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

export function extendText(frameId, at) {
  const doc = docOf(frameId);
  if (!doc) return false;
  const sel = doc.getSelection();
  if (!sel || !sel.anchorNode) return false;
  const range = caretAt(doc, at.x, at.y);
  if (!range) return false;
  // `extend` keeps the anchor where the press was and moves the focus, which is what
  // dragging backwards over a line has to do. setBaseAndExtent would move both.
  try {
    sel.extend(range.startContainer, range.startOffset);
  } catch (_) {
    return false;
  }
  return !sel.isCollapsed;
}
