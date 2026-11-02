// A preview route, written into the project so its own dev server can render one
// component on its own.
//
// There is no other way to see an Astro or Vue component as it really looks: only that
// project can render it, with its own compiler and its own styles. Redrawing it here
// would be a reimplementation, and a reimplementation looks authoritative while being
// wrong.
//
// So the board offers to add one file, and says so. It is dev-only (a build serves a
// 404), it renders nothing but the component asked for, and removing it removes every
// trace.

import fs from 'node:fs';
import path from 'node:path';

export const ROUTE = 'designbook-preview';
export const EXPERIMENT_ROUTE = 'designbook';
const MARK = 'Added by Design Book';
// The same two routes under the names they had before, and the mark they were written
// with. A project set up by an older version has them; they are recognised so that
// previews do not read as off, and removed as the new ones are written, because two
// folders serving the same pages is one folder too many.
const MARKS = [MARK, 'Added by Design Studio'];
const WAS = { [ROUTE]: ['canvas-preview'], [EXPERIMENT_ROUTE]: ['canvas'] };
const ours = text => MARKS.some(m => text.includes(m));

function routeFile(cwd, route) {
  return path.join(cwd, 'src', 'pages', route, '[...path].astro');
}

// A route folder of ours under an older name, taken away. Somebody else's folder of the
// same name is left exactly as it is: it is only ours if the file inside says so.
function dropOldRoutes(cwd, route) {
  for (const was of WAS[route] || []) {
    const file = routeFile(cwd, was);
    try {
      if (!ours(fs.readFileSync(file, 'utf8'))) continue;
      fs.unlinkSync(file);
      const dir = path.dirname(file);
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch (_) {}
  }
}

// Which folder a route is really in: the one it uses now, or the one it used before.
function liveRouteFile(cwd, route) {
  const now = routeFile(cwd, route);
  try { if (ours(fs.readFileSync(now, 'utf8'))) return now; } catch (_) {}
  for (const was of WAS[route] || []) {
    const old = routeFile(cwd, was);
    try { if (ours(fs.readFileSync(old, 'utf8'))) return old; } catch (_) {}
  }
  return now;
}

// A dynamic route rather than a query string: Astro builds statically by default, and a
// statically built page is handed no search params even in dev. A path parameter is
// enumerated by getStaticPaths, so it works in either mode.
export function previewFile(cwd) {
  return routeFile(cwd, ROUTE);
}

// The experiments route.
//
// An experiment is only worth anything if it could ship, which means it has to be able
// to import the project's real components, its real layout and its real stylesheet. So
// experiments are written in the project's own language, kept in `.designbook/pages`, and
// served through a route that reaches into that folder. The project's dev server
// compiles them exactly as it compiles its own pages, with hot reload, and a build
// produces none of them.
export function experimentFile(cwd) {
  return routeFile(cwd, EXPERIMENT_ROUTE);
}

export function writeExperimentRoute(cwd, canvasDir) {
  const file = experimentFile(cwd);
  dropOldRoutes(cwd, EXPERIMENT_ROUTE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // From src/pages/designbook/ back out to the board folder's pages.
  const rel = path.relative(path.dirname(file), path.join(canvasDir, 'pages'))
    .split(path.sep).join('/');

  fs.writeFileSync(file, `---
// ${MARK}. Serves the experiments in ${path.basename(canvasDir)}/pages as real pages of
// this project, so they can import its components, its layout and its styles.
//
// Dev only: a build generates nothing from here. Delete this folder to turn it off.
//
// The glob is written twice on purpose: getStaticPaths runs in its own scope and cannot
// see anything declared beside it.

export function getStaticPaths() {
  if (!import.meta.env.DEV) return [];
  const pages = import.meta.glob('${rel}/**/*.astro', { eager: true });
  return Object.keys(pages).map((file) => ({
    params: { path: file.split('/pages/').pop().replace(/\\.astro$/, '') },
    props: { file },
  }));
}

const pages = import.meta.glob('${rel}/**/*.astro', { eager: true });
const { file } = Astro.props;
const Experiment = file && pages[file] ? pages[file].default : null;
---

{Experiment ? <Experiment /> : (
  <html><head><meta charset="utf-8" /><title>Nothing here</title></head>
  <body style="margin:0;padding:24px;font:13px/1.6 ui-sans-serif,system-ui,sans-serif;color:#6B6B6B">
    Nothing on the board at this path.
  </body></html>
)}

<script is:inline>
  // Alt-click anything on a frame and the board opens the line of the file it came
  // from. Astro writes the file and the position onto every element it renders in dev,
  // so this needs nothing of its own; it only has to be read and passed out.
  document.addEventListener('click', (ev) => {
    if (!ev.altKey) return;
    let el = ev.target;
    while (el && el.dataset && !el.dataset.astroSourceFile) el = el.parentElement;
    if (!el || !el.dataset) return;
    ev.preventDefault();
    ev.stopPropagation();
    parent.postMessage({
      type: 'canvas:source',
      file: el.dataset.astroSourceFile,
      loc: el.dataset.astroSourceLoc,
      what: (el.textContent || '').trim().slice(0, 40)
    }, '*');
  }, true);
</script>

<style is:global>
  /* A frame is a picture of a page, not a window with a scrollbar down its side. What
     does not fit is cropped by the frame, which is what it is for. The page still
     scrolls when the frame is selected; only the bar is gone. */
  html { scrollbar-width: none; }
  html::-webkit-scrollbar, body::-webkit-scrollbar { width: 0; height: 0; }
</style>
`);
}

export function removeExperimentRoute(cwd) {
  const file = liveRouteFile(cwd, EXPERIMENT_ROUTE);
  try {
    if (ours(fs.readFileSync(file, 'utf8'))) {
      fs.unlinkSync(file);
      const dir = path.dirname(file);
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    }
  } catch (_) {}
}

export function experimentState(cwd) {
  const file = liveRouteFile(cwd, EXPERIMENT_ROUTE);
  let enabled = false;
  try { enabled = ours(fs.readFileSync(file, 'utf8')); } catch (_) {}
  const route = path.basename(path.dirname(file));
  return { enabled, route: `/${route}/`, file: path.relative(cwd, file).split(path.sep).join('/') };
}

export function previewState(cwd) {
  const file = liveRouteFile(cwd, ROUTE);
  const pagesDir = path.join(cwd, 'src', 'pages');
  let enabled = false;
  try { enabled = ours(fs.readFileSync(file, 'utf8')); } catch (_) {}
  return {
    supported: fs.existsSync(pagesDir),
    enabled,
    route: `/${path.basename(path.dirname(file))}/`,
    file: path.relative(cwd, file).split(path.sep).join('/')
  };
}

export function enablePreview(cwd, globalCss) {
  const file = previewFile(cwd);
  dropOldRoutes(cwd, ROUTE);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  // The project's own stylesheet, so a component looks the way it does on the site.
  const styleImport = globalCss
    ? `import ${JSON.stringify(path.relative(path.dirname(file), path.join(cwd, globalCss)).split(path.sep).join('/').replace(/^(?!\.)/, './'))};`
    : '';

  fs.writeFileSync(file, `---
// ${MARK}. Renders one component on its own, for the board's Components board.
//
// Delete this folder to turn previews off, or use the button on the board.
//
// The glob is written twice on purpose: getStaticPaths runs in its own scope and cannot
// see anything declared beside it in the frontmatter.
${styleImport}

export function getStaticPaths() {
  // Nothing is generated in a build, so these pages never reach production.
  if (!import.meta.env.DEV) return [];
  const modules = {
    ...import.meta.glob('../../components/**/*.astro', { eager: true }),
    ...import.meta.glob('../../layouts/**/*.astro', { eager: true }),
  };
  return Object.keys(modules).map((file) => ({
    params: { path: file.replace(/^\\.\\.\\/\\.\\.\\//, '').replace(/\\.astro$/, '') },
    props: { file },
  }));
}

const modules = {
  ...import.meta.glob('../../components/**/*.astro', { eager: true }),
  ...import.meta.glob('../../layouts/**/*.astro', { eager: true }),
};

const { file } = Astro.props;
const Component = file && modules[file] ? modules[file].default : null;
---

<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{file}</title>
    <style>
      html, body { margin: 0; background: #fff; }
      .canvas-preview-missing { padding: 24px; font: 13px/1.6 ui-sans-serif, system-ui, sans-serif; color: #6B6B6B; }
    </style>
  </head>
  <body>
    {Component ? <Component /> : <p class="canvas-preview-missing">Nothing to preview here.</p>}
  </body>
</html>
`);
  return previewState(cwd);
}

export function disablePreview(cwd) {
  const file = previewFile(cwd);
  try {
    if (fs.readFileSync(file, 'utf8').includes(MARK)) {
      fs.unlinkSync(file);
      // The folder was ours, so it goes too, unless something else landed in it.
      const dir = path.dirname(file);
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    }
  } catch (_) {}
  return previewState(cwd);
}

// Where a component is previewed: src/components/home/Hero.astro is served at
// /canvas-preview/components/home/Hero/.
export function previewPath(file) {
  return file.replace(/^src\//, '').replace(/\.astro$/, '');
}
