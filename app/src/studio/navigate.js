// Moving the board: what a wheel, a trackpad or a pinch means, and when to act on it.
//
// Two things were wrong with doing this by hand. A trackpad sends around a hundred wheel
// events a second and the board drew on every one of them, so the work was done five
// times for one frame of movement. And a wheel notch, a two finger swipe and a pinch all
// arrive as the same event, so one rule for all three made the board crawl under a mouse
// and bolt under a trackpad.
//
// The numbers below are OpenPencil's (MIT, github.com/open-pencil/open-pencil), which
// measured them against Figma: every wheel event pans twice its delta, at most 120px; a
// pinch, which Chromium reports as ctrl and a wheel, zooms by 2^(-dy/50); a mouse wheel
// zooms by e^(-0.005 dy); and a Windows notch accelerates while it keeps turning.

// Pan.
const PAN_SCALE = 2;
const MOST_PAN = 120;
// Zoom.
const PINCH_PER_DELTA = Math.LN2 / 50;
const WHEEL_PER_DELTA = 0.005;
const MOST_ZOOM_STEP = Math.log(10);
// A Windows mouse reports each notch as 120, and a notch that follows the last one
// quickly means somebody is spinning the wheel, so it moves further.
const NOTCH = 120;
const LEAST_NOTCH = 99;
const NOTCH_STEP = 8;
const NOTCH_FASTER = 2.5;
const NOTCH_WINDOW = 50;
const MOST_NOTCH_PAN = 120;
const MOST_NOTCH_ZOOM = 40;

// A line or a page of scrolling, in pixels.
const LINE = 40;
const PAGE = 800;

export const platformOf = () => {
  if (typeof navigator === 'undefined') return 'other';
  const what = navigator.userAgentData?.platform || navigator.platform || '';
  if (/Mac|iPhone|iPad|iPod/.test(what)) return 'mac';
  return /Win/.test(what) ? 'windows' : 'other';
};

const inPixels = event => {
  const by = event.deltaMode === 1 ? LINE : event.deltaMode === 2 ? PAGE : 1;
  return { dx: event.deltaX * by, dy: event.deltaY * by };
};

// A notch is a mouse wheel: one step of a fixed size, not a smooth stream.
const isNotch = event => {
  const raw = Math.abs(event.wheelDeltaY || 0);
  return raw >= LEAST_NOTCH && raw % NOTCH === 0;
};

// What one wheel event means. `held` is the state this keeps between events, so a spin
// of the wheel speeds up; make one with `holdWheel()` and keep it.
export function wheelStep(event, held, platform = platformOf()) {
  const zooming = event.ctrlKey || event.metaKey;
  const { dx, dy } = inPixels(event);

  if (zooming) {
    // A pinch is ctrl and a wheel without a notch. A notch with ctrl is a mouse.
    const pinching = event.ctrlKey && !isNotch(event);
    let delta = dy;
    if (!pinching && platform === 'windows' && isNotch(event)) {
      delta = notchDelta(event, held, MOST_NOTCH_ZOOM);
    }
    const per = pinching ? PINCH_PER_DELTA : WHEEL_PER_DELTA;
    const step = Math.max(-MOST_ZOOM_STEP, Math.min(MOST_ZOOM_STEP, -delta * per));
    return { kind: 'zoom', scale: Math.exp(step) };
  }

  if (platform === 'windows' && isNotch(event)) {
    const moved = notchDelta(event, held, MOST_NOTCH_PAN);
    return event.shiftKey ? { kind: 'pan', dx: moved, dy: 0 } : { kind: 'pan', dx: 0, dy: moved };
  }

  const cap = value => Math.max(-MOST_PAN, Math.min(MOST_PAN, value * PAN_SCALE));
  // Shift turns a vertical wheel sideways, which is how a mouse pans across a board.
  if (event.shiftKey && !dx) return { kind: 'pan', dx: cap(dy), dy: 0 };
  return { kind: 'pan', dx: cap(dx), dy: cap(dy) };
}

export const holdWheel = () => ({ at: 0, step: NOTCH_STEP, way: 0 });

function notchDelta(event, held, most) {
  const { dy } = inPixels(event);
  const way = Math.sign(dy) || 1;
  const soon = event.timeStamp - held.at < NOTCH_WINDOW && way === held.way;
  held.step = soon ? Math.min(most, held.step * NOTCH_FASTER) : NOTCH_STEP;
  held.at = event.timeStamp;
  held.way = way;
  return way * held.step;
}

// Do it once a frame, however many times it is asked for.
//
// The board moves as fast as the screen draws and no faster: a hundred wheel events a
// second asking for a hundred redraws is ninety of them nobody ever sees.
export function onEachFrame(flush) {
  let waiting = 0;
  const run = () => { waiting = 0; flush(); };
  return {
    ask() { if (!waiting) waiting = requestAnimationFrame(run); },
    stop() { if (waiting) cancelAnimationFrame(waiting); waiting = 0; }
  };
}
