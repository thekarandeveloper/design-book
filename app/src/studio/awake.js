// Which frames are awake.
//
// A live frame is a whole application running in an iframe: its own framework, its own
// animations, its own socket back to its dev server. One is nothing. Eighty, which is
// what a real repo comes to, is eighty applications running at once on one machine, and
// the board goes from quick to unusable while you are looking at four of them.
//
// So a frame is awake while it is near the viewport and asleep when it is not. It wakes
// early, a viewport and a half out, so it is drawn before you reach it, and it sleeps
// late, several seconds after it has gone, so panning back and forth never reloads
// anything. What is on the board is the same; what is running is only what you can see.

import { useEffect, useState } from 'react';

// Half a screen past the edge: far enough that a frame is drawn before it is reached,
// close enough that a board of a hundred keeps a handful of them running.
const MARGIN = '50% 50%';
// A frame that has gone out of view is probably coming back, so it is given a moment
// before it is put down.
const SLEEP_AFTER = 5000;

export function useAwake(ref, { keep = false, margin = MARGIN, sleepAfter = SLEEP_AFTER } = {}) {
  const [awake, setAwake] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Nothing to watch with: everything is awake, which is what it used to be.
    if (typeof IntersectionObserver === 'undefined') { setAwake(true); return; }

    let sleeping = 0;
    const io = new IntersectionObserver(entries => {
      const near = entries.some(entry => entry.isIntersecting);
      if (near) {
        clearTimeout(sleeping);
        setAwake(true);
      } else if (!keep) {
        clearTimeout(sleeping);
        sleeping = setTimeout(() => setAwake(false), sleepAfter);
      }
    }, { rootMargin: margin });

    io.observe(el);
    return () => { clearTimeout(sleeping); io.disconnect(); };
  }, [ref, keep, margin, sleepAfter]);

  // The frame you have selected stays awake wherever it is: you chose it, and coming
  // back to a frame that reloaded itself because you looked away is its own small insult.
  useEffect(() => { if (keep) setAwake(true); }, [keep]);

  return awake;
}
