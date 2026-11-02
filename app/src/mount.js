// Drawing one of the repo's own React screens in a frame.
//
// A page of the board says what it wants drawn, and then asks for this:
//
//   <script>window.__designbook = { screen: "/abs/path/Basket.tsx", name: "Basket", css: [] };</script>
//   <script type="module" src="/src/mount.js"></script>
//
// The screen is imported from where it lies, which is why nothing is copied and saving
// the file redraws the frame: the board's own dev server compiles the tsx on the way
// through. One module for every such page, rather than a script inside each one.
import React from 'react';
import { createRoot } from 'react-dom/client';

const asked = (typeof window !== 'undefined' && window.__designbook) || {};
const screen = asked.screen || '';
const name = asked.name || 'This screen';
// The stylesheets the project puts behind every one of its own screens. Imported rather
// than linked, so the dev server compiles them the way the project does: a css module
// keeps its names, an @import is followed, a preprocessor runs.
const styles = Array.isArray(asked.css) ? asked.css : [];
const root = createRoot(document.getElementById('root') || document.body);

// A file is given by where it is on disk. The dev server serves anything outside its own
// folder under `/@fs`, so that is the address to ask for it at.
const served = file => (file.startsWith('/@fs') || file.startsWith('http') ? file : '/@fs' + file);

// What a screen cannot draw is said in one line, because a board full of error pages
// tells you nothing about the design and a quiet line tells you what is missing.
const quiet = line => root.render(React.createElement('p', { className: 'designbook-needs' }, line));

class Boundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: '' };
  }
  static getDerivedStateFromError(err) {
    return { failed: (err && err.message) || 'it did not draw' };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return React.createElement('p', { className: 'designbook-needs' },
      `${name} needs data to draw: ${this.state.failed}`);
  }
}

// The default export, or the one component it does export. A screen is written either
// way and the frame should not care which.
function componentIn(mod) {
  if (!mod) return null;
  if (typeof mod.default === 'function') return mod.default;
  if (mod.default && typeof mod.default === 'object' && mod.default.$$typeof) return mod.default;
  const named = Object.entries(mod)
    .filter(([key, value]) => typeof value === 'function' && /^[A-Z]/.test(key));
  return named.length ? named[0][1] : null;
}

// The design first, so the screen never draws once unstyled and then again with its
// stylesheet, which on a board reads as a flicker in a frame.
const dressed = Promise.all(styles.map(file => import(/* @vite-ignore */ served(file)).catch(() => {})));

if (!screen) {
  quiet('No screen was named for this frame.');
} else {
  // The path is read from the page, so Vite cannot know it ahead of time and does not
  // need to: the browser asks for it and the dev server compiles it then.
  dressed
    .then(() => import(/* @vite-ignore */ served(screen)))
    .then(mod => {
      const Screen = componentIn(mod);
      if (!Screen) return quiet(`${name} exports nothing this can draw.`);
      root.render(React.createElement(Boundary, null, React.createElement(Screen)));
    })
    .catch(err => quiet(`${name} could not be read: ${(err && err.message) || err}`));
}
