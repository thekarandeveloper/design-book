// An app's own springs, in CSS.
//
// A screen's motion is written in the app as a spring: `.spring(response: 0.28,
// dampingFraction: 0.55)` or `.interpolatingSpring(stiffness: 340, damping: 34)`. A copy of
// that screen that eases with `ease-out` is a copy that moves wrongly, and nobody can say why:
// a spring overshoots a little and settles, an ease never does.
//
// CSS cannot be given a spring, but it can be given the curve of one. `linear()` takes a list
// of points and walks between them, so the spring is solved here and handed over as its own
// shape. The result moves the way the app moves, because it is the same equation with the same
// numbers.
//
// What the two forms mean, both with a mass of 1:
//
//   spring(response, dampingFraction)      w0 = 2 pi / response,  zeta = dampingFraction
//   interpolatingSpring(stiffness, damping) w0 = sqrt(stiffness), zeta = damping / (2 sqrt(k))
//
// `response` is the time the spring would take to swing once if nothing damped it, which is
// why it is not the duration: a spring with a response of 0.28 is still moving at 0.28.

export interface Spring {
  /** The curve, as a CSS easing function. */
  easing: string;
  /** How long until it has settled, in milliseconds, which is what CSS needs as a duration. */
  ms: number;
}

/** How close to the end counts as arrived. A tenth of a per cent is past what anybody sees. */
const SETTLED = 0.001;
/** Points on the curve. Enough that the overshoot is smooth, few enough to read in a file. */
const STEPS = 64;
/** Nothing in an interface runs longer than this, so a badly damped spring cannot hang. */
const LONGEST = 4000;

// Where the spring is, as a share of the distance, at a time in seconds. 0 at the start, 1 at
// rest, and above 1 while it is overshooting.
function at(t: number, w0: number, zeta: number): number {
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  }
  if (zeta === 1) {
    return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  }
  // Overdamped: two decays, no overshoot at all.
  const r = w0 * Math.sqrt(zeta * zeta - 1);
  const a = -zeta * w0 + r;
  const b = -zeta * w0 - r;
  return 1 - (b * Math.exp(a * t) - a * Math.exp(b * t)) / (b - a);
}

function curve(w0: number, zeta: number): Spring {
  // When it has settled. The envelope of a spring decays as e^(-zeta w0 t), so the time to
  // fall inside the tolerance follows from it directly rather than from walking the curve.
  const settle = Math.min(LONGEST / 1000, -Math.log(SETTLED) / (zeta * w0));
  const points: string[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = (i / STEPS) * settle;
    const value = i === STEPS ? 1 : at(t, w0, zeta);
    points.push(Math.round(value * 10000) / 10000 + '');
  }
  return { easing: `linear(${points.join(',')})`, ms: Math.round(settle * 1000) };
}

/** SwiftUI's `.spring(response:dampingFraction:)`. */
export function spring(response: number, dampingFraction: number): Spring {
  return curve((2 * Math.PI) / response, Math.max(0.05, dampingFraction));
}

/** SwiftUI's `.interpolatingSpring(stiffness:damping:)`, which is the same spring written the
 *  other way round. */
export function interpolatingSpring(stiffness: number, damping: number): Spring {
  const w0 = Math.sqrt(stiffness);
  return curve(w0, Math.max(0.05, damping / (2 * Math.sqrt(stiffness))));
}

/** One line to put in a style attribute or a rule: `transition: transform 280ms linear(...)`. */
export function transition(property: string, s: Spring): string {
  return `${property} ${s.ms}ms ${s.easing}`;
}
