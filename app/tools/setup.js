// Setting a repo up as a board.
//
// Somebody installs this in a repo that has never had a board. There is nothing to show,
// no design system to read from, and a template copied in would be a board about nothing.
// So the repo itself is read, once and properly, and what is found becomes the board:
// every screen it already has is a frame, every colour, font and spacing step it actually
// uses is its design system, and the pictures it holds are recorded where they lie.
//
// Two rules hold the whole file together. Nothing of the project is moved or rewritten:
// everything written goes into the `.designbook` folder beside it. And a page is only made
// when it can be made faithfully: a screen nothing here can compile is left out and said
// so, because a frame drawing the wrong thing is worse than a frame that is not there.
//
// Every step reports as it happens, because the work is the progress. A bar that moves
// because a timer said so says nothing about a repo with four hundred files in it.

import fs from 'node:fs';
import path from 'node:path';
import { walkProject, readCustomProperties } from './project.js';
import { readPalette } from './palette.js';
import { writeNextRoute, NEXT_ROUTE, appDir } from './next-route.js';

// What a frame can be made of. An .astro page of the project is already a frame through
// the project's own dev server, so it is not converted into anything.
const SCREEN = /\.html?$/i;
const COMPONENT = /\.(jsx|tsx|vue|svelte)$/;
const REACT = /\.(jsx|tsx)$/;
// Not a screen whatever folder it is in: a test, a story, a type file, a barrel that
// re-exports other files, a config. Each one would draw a frame with nothing in it.
const NOT_A_SCREEN = /(\.test\.|\.spec\.|\.stories\.|\.d\.ts$|\.config\.[jt]sx?$|^_|^index\.[jt]sx?$|^layout\.[jt]sx?$|^loading\.[jt]sx?$|^error\.[jt]sx?$|^not-found\.[jt]sx?$|^middleware\.[jt]sx?$|^route\.[jt]s$)/;
// Folders that hold what a screen is made of rather than screens.
const NOT_SCREEN_DIR = /^(tests?|__tests__|__mocks__|__snapshots__|hooks|utils?|helpers|lib|libs|types|typings|constants|config|api|server|store|stores|context|providers|styles|fonts|assets|scripts|public|static|locales|i18n|generated)$/i;
// A screen rather than a piece of one, when the repo says so in a name. Used for the
// order they are converted in, so the screens come first and a cap never cuts them off.
const SCREEN_DIR = /^(pages|screens|views|routes|app|screen|mocks?|prototypes?|examples?|stories)$/i;
const SCREEN_NAME = /(Page|Screen|View)$/;
// A repo of four hundred components is a real repo. Every one of them as a frame is not a
// board anybody can read, so the screens are taken first and the rest up to this. It is
// high because a screen the project draws itself costs this board nothing: it is the
// project's dev server doing the work, one frame at a time, as you reach them.
const MOST_FRAMES = 150;
// Frameworks that serve their own pages. In one of these, a screen is a page it serves
// and a frame of it is the real thing, drawn by the project. Its components are pieces
// of those pages: they are in the Components view, where you go to take one, and a
// hundred frames of them would bury the screens the board is for.
const SERVES_PAGES = new Set(['astro', 'next', 'nuxt', 'sveltekit', 'remix']);
// Where a framework keeps what it serves. A file in here is the project's own to draw:
// if it is not at an address we can open, it is not a frame at all.
const ROUTE_DIR = /^(app|pages|routes)$/;

const IMAGE = /\.(png|jpe?g|webp|avif|gif)$/i;
const VECTOR = /\.svg$/i;
const FONT = /\.(woff2?|ttf|otf)$/i;
const LOGO = /(logo|wordmark|brand)/i;
const ICON = /(icon|favicon|glyph)/i;

// Six steps, five of them here. The sixth is the rules file and the index, which are
// written by the server that called this, because only it can read the catalog.
const STEPS = 6;
const DEFAULT_FRAME = { width: 1440, height: 900 };

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'screen';
const readJson = (file, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
};

// The whole pass. `say` is given one object per piece of real work done, which is what
// the board draws its bar from.
export async function runSetup({ repoRoot, studioRoot, boardFile, name, canCompile, say = () => {} }) {
  const inStudio = (...p) => path.join(studioRoot, ...p);
  const tell = (step, message, extra) => say({ step, steps: STEPS, message, ...extra });

  // ── 1. what the repo has ────────────────────────────────────────────────

  // How this project is built, which decides who draws what. A page the project serves
  // itself is shown live, by the project; everything else is drawn by whichever compiler
  // can do it faithfully.
  const framework = frameworkOf(repoRoot);
  const routes = new Set();
  // A single page app has no routes in its files: it has one address and a router inside
  // it. That one address is worth a frame.
  if (framework === 'vite') routes.add('/');

  const screens = [];
  const components = [];
  const styles = [];
  const assets = { images: [], icons: [], fonts: [], logos: [] };
  const left = [];   // what was found and not converted, with the reason
  let kotlin = '';   // a DesignTokens.kt, which is a better source than anything counted
  let files = 0;

  tell(1, 'reading the repo');
  walkProject(repoRoot, (full, rel, base) => {
    files++;
    if (files % 25 === 0) tell(1, 'reading the repo', { found: `${files} files read` });

    // The project serves this one itself, at a real address. Drawing our own copy of it
    // would be a second answer to the same question, and the worse one.
    const route = routeFor(rel, framework);
    if (route) { routes.add(route); return; }

    // Inside the folder a framework serves from, but not at an address anybody can open:
    // a page behind a dynamic segment, an icon, an opengraph image, a handler. The
    // project owns these, and drawing one here would draw the wrong thing.
    if (framework && insideRoutes(rel)) return;

    if (SCREEN.test(base)) {
      const why = notAPage(full);
      if (why) left.push({ file: rel, why });
      else screens.push({ file: rel, full });
      return;
    }
    if (COMPONENT.test(base)) {
      if (NOT_A_SCREEN.test(base)) return;
      if (path.dirname(rel).split('/').some(seg => NOT_SCREEN_DIR.test(seg))) return;
      if (!drawsSomething(full)) return;
      // In a project that serves its own pages, only that project can draw one of its
      // screens as it really looks. Next is asked to: a route of ours in its own app
      // draws any of them, with its Tailwind build, its fonts and its root layout.
      if (SERVES_PAGES.has(framework) && !(framework === 'next' && REACT.test(base))) return;
      components.push({ file: rel, full, screen: looksLikeScreen(rel, base) });
      return;
    }
    if (base === 'DesignTokens.kt') { kotlin = rel; return; }
    if (/\.(css|scss|sass|less)$/i.test(base)) {
      const count = readCustomProperties(full).length;
      styles.push({ file: rel, count });
      return;
    }
    const where =
      LOGO.test(base) ? 'logos'
      : ICON.test(base) || VECTOR.test(base) ? 'icons'
      : IMAGE.test(base) ? 'images'
      : FONT.test(base) ? 'fonts'
      : '';
    if (where && assets[where].length < 200) assets[where].push({ file: rel, bytes: sizeOf(full) });
  });
  tell(1, 'read the repo', {
    found: `${files} files read, ${screens.length + components.length} screens found`
      + (routes.size ? `, ${routes.size} served by the project` : '')
  });

  // ── 2. a frame for every screen ─────────────────────────────────────────

  fs.mkdirSync(inStudio('pages'), { recursive: true });
  const already = fromMarkers(inStudio('pages'));
  const made = [];
  const drawn = [];   // screens the project draws itself, each at an address of ours
  // The whole screen before the pieces it is made of, so a repo bigger than the cap
  // loses its buttons rather than its screens.
  const byName = (a, b) => a.file.localeCompare(b.file);
  const ranked = [
    ...screens.sort(byName),
    ...components.filter(c => c.screen).sort(byName),
    ...components.filter(c => !c.screen).sort(byName)
  ];
  const todo = ranked.slice(0, MOST_FRAMES);
  // What this run still wants on the board, by the repo file behind it.
  const converted = new Set(todo.map(item => item.file));
  for (const over of ranked.slice(MOST_FRAMES)) {
    left.push({ file: over.file, why: `over ${MOST_FRAMES} frames: add it by hand if you want it` });
  }

  const globalCss = globalStyles(repoRoot, styles);
  const tailwind = usesTailwind(repoRoot);
  let serial = highestSerial(inStudio('pages'));

  // Next draws its own screens, through one route of ours in its own app. Written from
  // the screens found just now, so a screen added since the last scan is in it.
  const drawnByNext = new Map();   // the repo file -> the address the project draws it at
  if (framework === 'next' && appDir(repoRoot)) {
    const wanted = todo
      .filter(item => REACT.test(item.file) && !SCREEN.test(item.file))
      .map(item => ({ key: item.file.replace(/\.\w+$/, ''), file: item.file }));
    if (wanted.length) {
      const made = writeNextRoute(repoRoot, wanted);
      if (made.written) {
        for (const screen of wanted) {
          drawnByNext.set(screen.file, `/${NEXT_ROUTE}/${screen.key}`);
          // Its page here, if it has one, is not wanted any more: the project draws it
          // now, and two frames of one screen is one too many.
          converted.delete(screen.file);
        }
        tell(2, 'asking the project to draw its own screens', {
          found: `${wanted.length} screens for ${path.relative(repoRoot, appDir(repoRoot))}/${NEXT_ROUTE}/`
        });
      }
    }
  }

  tell(2, `converting ${todo.length} screens`, { done: 0, total: todo.length });
  for (const [i, screen] of todo.entries()) {
    // Safe to run twice: a page made from this file already exists, so it is left exactly
    // as it is, edits and all.
    const byProject = drawnByNext.get(screen.file);
    if (byProject) {
      routes.add(byProject);
      drawn.push({ id: 'live:' + byProject, from: screen.file, dir: path.dirname(screen.file) });
    } else if (already.has(screen.file)) {
      left.push({ file: screen.file, why: 'already on the board' });
    } else {
      const next = String(Number(serial) + 1).padStart(2, '0');
      const page = pageFor(screen, { serial: next, repoRoot, canCompile, globalCss, tailwind });
      if (page.why) {
        left.push({ file: screen.file, why: page.why });
      } else {
        const file = freeName(inStudio('pages'), page.file);
        fs.writeFileSync(inStudio('pages', file), page.text);
        serial = next;
        made.push({
          id: page.ext === 'astro' ? 'exp:' + file.replace(/\.astro$/, '') : 'canvas:' + file,
          from: screen.file,
          dir: path.dirname(screen.file),
          file: `pages/${file}`
        });
      }
    }
    tell(2, `converting ${path.basename(screen.file)}`, {
      done: i + 1, total: todo.length,
      found: `${made.length} converted, ${routes.size} served live`
    });
  }

  // ── 2b. what is on the board and should not be ──────────────────────────

  // A page this made from a file that is gone, or from a file this would not make a page
  // from any more, is taken off the board. Without this a run under an older rule leaves
  // its frames behind for good, and the board fills up with frames that draw nothing.
  // Thrown away, not destroyed: the file goes to `.designbook/.trash`.
  const retired = [];
  for (const [from, file] of already) {
    if (converted.has(from)) continue;
    const why = drawnByNext.has(from)
      ? 'the project draws it itself now, at its own address'
      : whyNotAnyMore(from, { repoRoot, framework });
    if (!why) continue;
    const page = path.join(inStudio('pages'), file);
    try {
      fs.mkdirSync(inStudio('.trash'), { recursive: true });
      fs.renameSync(page, inStudio('.trash', file));
      retired.push({ file: `pages/${file}`, from, why });
    } catch (_) {}
  }
  if (retired.length) {
    tell(2, `taking ${retired.length} off the board`, {
      done: todo.length, total: todo.length,
      found: `${made.length} converted, ${routes.size} served live, ${retired.length} retired`
    });
  }

  // ── 3. the design system ────────────────────────────────────────────────

  tell(3, 'reading every colour, font and spacing step');
  const palette = readPalette(repoRoot);
  const declared = styles.filter(s => s.count >= 3).sort((a, b) => b.count - a.count);
  let tokens = declared.length
    ? { written: false, file: declared[0].file, count: declared[0].count }
    : { written: false, file: '', count: 0 };

  // A repo that declares nothing has no design system to show, and the board's Design
  // system view would be an empty page in a repo full of colour. So what it uses becomes
  // what it declares, in a file of ours, and the view has something true to read.
  // A repo whose tokens are generated from Kotlin has a real scale already, and counting
  // the colours out of its screens would write a worse one over it. The command that
  // reads that file is the one that should write tokens.css, so this says so and stops.
  if (!declared.length && !kotlin) {
    const css = tokensCss(palette);
    if (css.count && !fs.existsSync(inStudio('tokens.css'))) {
      fs.writeFileSync(inStudio('tokens.css'), css.text);
      tokens = { written: true, file: 'tokens.css', count: css.count };
    }
  }
  tell(3, 'read the design system', {
    found: `${palette.colours.length} colours, ${palette.fonts.length} fonts, ${palette.spacing.length} spacing steps`
  });

  // ── 4. the pictures, where they are ─────────────────────────────────────

  // Recorded, not collected. A copy of a repo's images inside `.designbook` is a second set
  // of the same files, and the day the real one changes the board starts lying. Every
  // path here is the file in the repo, which the board serves at `/@repo/<path>`.
  tell(4, 'organising the pictures');
  const counts = Object.fromEntries(Object.entries(assets).map(([k, v]) => [k, v.length]));
  fs.writeFileSync(inStudio('assets.json'), JSON.stringify({
    generated: new Date().toISOString(),
    note: 'Generated by the setup pass. Nothing was copied: each path is the file in the repo, served on the board at /@repo/<path>.',
    repo: repoRoot,
    ...Object.fromEntries(Object.entries(assets).map(([k, v]) => [k, v.sort((a, b) => a.file.localeCompare(b.file))]))
  }, null, 2) + '\n');
  tell(4, 'organised the pictures', {
    found: `${counts.images} images, ${counts.icons} icons, ${counts.logos} logos, ${counts.fonts} fonts`
  });

  // ── 5. the board ────────────────────────────────────────────────────────

  tell(5, 'writing the board');
  const live = liveFor(repoRoot, [...routes]);
  const doc = writeBoard({
    boardFile, name, live, studioRoot, retired,
    made: [...made, ...drawn],
    // The project's own pages go in the first band. A screen of its that it is drawing
    // for us belongs with its own kind, in the band its folder makes.
    routes: [...routes].filter(route => !route.startsWith(`/${NEXT_ROUTE}/`))
  });
  // The warehouse's own two folders, so a reference can be dropped in and a piece written
  // the moment the board opens.
  fs.mkdirSync(inStudio('refs'), { recursive: true });
  if (!fs.existsSync(inStudio('refs.json'))) {
    fs.writeFileSync(inStudio('refs.json'), JSON.stringify({ items: {} }, null, 2) + '\n');
  }
  tell(5, 'wrote the board', { found: `${doc.sections.length} sections` });

  return {
    board: boardFile,
    files,
    pages: made.length + drawn.length,
    drawnByProject: drawn.length,
    routes: [...routes],
    framework,
    retired: retired.length,
    nextRoute: drawnByNext.size ? `${path.relative(repoRoot, appDir(repoRoot))}/${NEXT_ROUTE}/` : '',
    sections: doc.sections.map(s => ({ name: s.name, frames: s.frames.length })),
    tokens,
    kotlin,
    colours: palette.colours.length,
    fonts: palette.fonts.length,
    spacing: palette.spacing.length,
    assets: counts,
    live: live ? live.command : '',
    left
  };
}

// ── who draws what ───────────────────────────────────────────────────────

// How the project is built, from what it depends on. It decides which of its files it
// serves itself and which compiler can draw the rest.
function frameworkOf(root) {
  const pkg = readJson(path.join(root, 'package.json'), {}) || {};
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  if (deps.astro) return 'astro';
  if (deps.next) return 'next';
  if (deps.nuxt || deps['nuxt3']) return 'nuxt';
  if (deps['@sveltejs/kit']) return 'sveltekit';
  if (deps['@remix-run/react'] || deps['@react-router/dev']) return 'remix';
  if (deps['react-native'] || deps.expo) return 'native';
  if (deps.vite) return 'vite';
  return '';
}

// The address the project itself serves a file at, or nothing when it does not serve it.
// Every framework worth the name puts its routes in the filesystem, which is why this can
// be answered without running anything.
function routeFor(rel, framework) {
  const parts = rel.split('/');
  const base = parts[parts.length - 1];
  const inside = (...names) => {
    for (const name of names) {
      const at = parts.indexOf(name);
      // `src/pages` and `pages` both count, but a `pages` folder six levels down does not.
      if (at === 0 || (at === 1 && parts[0] === 'src')) return parts.slice(at + 1);
      if (at > -1 && names.length === 1 && at <= 1) return parts.slice(at + 1);
    }
    return null;
  };
  const clean = segs => {
    if (!segs) return '';
    // An api folder holds answers, not pages: a frame of one would be a frame of JSON.
    if (segs.some(seg => seg === 'api')) return '';
    const kept = segs.filter(seg => !/^\(.*\)$/.test(seg) && !seg.startsWith('_') && !seg.startsWith('@'));
    // A dynamic segment cannot be opened without a value, so it is not an address.
    if (kept.some(seg => seg.includes('[') || seg.includes(':'))) return '';
    const last = kept[kept.length - 1].replace(/\.\w+$/, '');
    const head = kept.slice(0, -1);
    const tail = /^(index|page|\+page)$/.test(last) ? [] : [last];
    return '/' + [...head, ...tail].join('/');
  };

  if (framework === 'astro') {
    if (!/\.(astro|md|mdx|html)$/.test(base)) return '';
    return clean(inside('pages'));
  }
  if (framework === 'next') {
    if (!/^(page|index)\.[jt]sx?$/.test(base) && !/\.[jt]sx?$/.test(base)) return '';
    const app = inside('app');
    if (app && /^page\.[jt]sx?$/.test(base)) return clean(app);
    const pages = inside('pages');
    if (pages && /\.[jt]sx?$/.test(base)) return clean(pages);
    return '';
  }
  if (framework === 'nuxt') {
    if (!/\.vue$/.test(base)) return '';
    return clean(inside('pages'));
  }
  if (framework === 'sveltekit') {
    if (!/^\+page\.(svelte|[jt]s)$/.test(base)) return '';
    return clean(inside('routes'));
  }
  if (framework === 'remix') {
    const at = inside('routes');
    if (!at || !/\.[jt]sx?$/.test(base)) return '';
    const flat = base.replace(/\.[jt]sx?$/, '');
    if (flat === '_index') return '/';
    if (flat.includes('$') || flat.startsWith('_')) return '';
    return '/' + flat.split('.').filter(seg => seg !== '_index').join('/');
  }
  return '';
}

// What the project puts behind every one of its own screens, so a screen drawn here is
// drawn in the project's own design and not on a white page.
//
// Read from where the project says it, which is its entry file: the stylesheets it
// imports there are the ones that are on every page. A project with no entry to read
// falls back to the stylesheet that declares the most, which is the one a project calls
// global.
const ENTRIES = [
  'src/main.tsx', 'src/main.jsx', 'src/main.ts', 'src/main.js',
  'src/index.tsx', 'src/index.jsx',
  'src/App.tsx', 'src/App.jsx',
  'app/layout.tsx', 'src/app/layout.tsx', 'app/layout.jsx'
];

function globalStyles(repoRoot, styles) {
  const found = [];
  for (const entry of ENTRIES) {
    const full = path.join(repoRoot, entry);
    let text = '';
    try { text = fs.readFileSync(full, 'utf8'); } catch (_) { continue; }
    const imports = text.matchAll(/import\s+(?:[^'"]*from\s*)?['"]([^'"]+\.(?:css|scss|sass|less))['"]/g);
    for (const [, spec] of imports) {
      // A path of its own. An aliased one is left for the stylesheet the project
      // declares the most in, below, because the alias is the repo's and not ours.
      if (!spec.startsWith('.')) continue;
      const file = path.resolve(path.dirname(full), spec);
      if (fs.existsSync(file) && !found.includes(file)) found.push(file);
    }
    if (found.length) break;
  }
  if (found.length) return found;

  const best = [...styles].sort((a, b) => b.count - a.count)[0];
  return best && best.count ? [path.join(repoRoot, best.file)] : [];
}

// Why a file that already has a page on the board would not get one today. Nothing to
// say means it is still wanted and its page stays exactly as it is, edits and all.
function whyNotAnyMore(rel, { repoRoot, framework }) {
  const full = path.join(repoRoot, rel);
  if (!fs.existsSync(full)) return 'the file it was made from is gone';
  const base = path.basename(rel);
  if (SCREEN.test(base)) return '';
  if (!COMPONENT.test(base)) return 'not something a frame is made of any more';
  if (routeFor(rel, framework)) return 'the project serves it live now';
  if (framework && insideRoutes(rel)) return 'the project draws it itself';
  if (SERVES_PAGES.has(framework) && !(framework === 'next' && REACT.test(base))) {
    return 'a piece of a page this project draws itself, not a screen';
  }
  if (NOT_A_SCREEN.test(base)) return 'not a screen';
  if (path.dirname(rel).split('/').some(seg => NOT_SCREEN_DIR.test(seg))) return 'not in a folder of screens';
  if (!drawsSomething(full)) return 'nothing in it to draw';
  return '';
}

// A file the framework keeps in the folder it serves from.
function insideRoutes(rel) {
  const parts = rel.split('/');
  const head = parts[0] === 'src' ? parts.slice(1) : parts;
  return ROUTE_DIR.test(head[0] || '');
}

// Something with markup in it, long enough to be a screen rather than a wrapper. A file
// that sets up analytics or hands back a tag of metadata is a real part of a project and
// nothing to look at, and a frame of it is an empty frame.
function drawsSomething(file) {
  let text = '';
  try {
    if (fs.statSync(file).size > 400000) return false;
    text = fs.readFileSync(file, 'utf8');
  } catch (_) { return false; }
  if (text.split('\n').length < 10) return false;
  // Markup of its own, not only other components passed straight through.
  return /<[a-z][\w-]*[\s/>]/.test(text) || /<[A-Z]\w*[\s/>]/.test(text);
}

function usesTailwind(root) {
  const pkg = readJson(path.join(root, 'package.json'), {}) || {};
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  return !!(deps.tailwindcss || deps['@tailwindcss/vite'] || deps['@tailwindcss/postcss']);
}

// The page for one screen, by whoever can draw it best. The project's own compiler first,
// because only it has the project's layouts and its stylesheet pipeline; the board's own
// server after that, because a React screen drawn here is still the real screen; and
// nothing at all last, with the reason, because a frame drawing a guess is worse than a
// frame that is not there.
function pageFor(screen, { serial, repoRoot, canCompile, globalCss, tailwind }) {
  if (SCREEN.test(screen.file)) return htmlPage(screen, { serial, repoRoot });
  const byProject = componentPage(screen, { serial, canCompile });
  if (!byProject.why) return byProject;
  if (REACT.test(screen.file)) return mountPage(screen, { serial, globalCss, tailwind });
  return { why: `a ${path.extname(screen.file)} screen can only be drawn by the project itself, and ${byProject.why}` };
}

// A React screen this project's own compiler will not take: no dev server, or no Astro
// integration to render it with. The board's own server draws it instead. The page
// imports the file where it lies, so nothing is copied and saving the file redraws the
// frame; Vite compiles the tsx on the way through.
//
// A screen that needs data says so in one quiet line rather than throwing an error page
// at a board: it is a real screen that wants props, and that is worth knowing.
function mountPage(screen, { serial, globalCss, tailwind }) {
  const name = titleFor(screen.file, '');
  const title = `${serial} ${name}`;
  // Tailwind writes its own stylesheet out of the classes it finds, with its own build
  // step. That step is the project's, not ours, so the utilities come from Tailwind's
  // own build and the project's theme is not in them: a colour of its own comes out as
  // Tailwind's. Its stylesheet is still imported below, for the fonts, the custom
  // properties and the base rules it holds.
  const styles = tailwind ? '<script src="https://cdn.tailwindcss.com"></script>' : '';

  // What to draw, and what to draw it in, as data in the page. Not as a query on the
  // script: a path ending in .css at the end of one makes the dev server read the module
  // itself as a stylesheet. The project's own stylesheets go through the same compiler
  // the screen does, so a css module, an @import and a preprocessor all behave as they
  // do in the project.
  const asked = JSON.stringify({ screen: screen.full, name, css: globalCss })
    .replace(/</g, '\\u003c');
  const text = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escape(title)}</title>
    <!-- design-from: ${screen.file} -->
    <meta name="designbook-width" content="${DEFAULT_FRAME.width}">
    <meta name="designbook-height" content="${DEFAULT_FRAME.height}">
    <meta name="designbook-grow" content="yes">
    ${styles}
    <style>
      html, body { margin: 0; }
      .designbook-needs { margin: 0; padding: 24px; font: 14px/1.5 system-ui, sans-serif; color: #5C5C66; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>window.__designbook = ${asked};</script>
    <script type="module" src="/src/mount.js"></script>
  </body>
</html>
`;
  return { file: `${serial}-${slug(name)}.html`, ext: 'html', text };
}

// ── what a screen is ──────────────────────────────────────────────────────

// An .html file that is not a page: a verification file, a fragment, a template with
// nothing around it. Converting one gives a frame with a line of text in it.
function notAPage(file) {
  let head = '';
  try {
    if (fs.statSync(file).size > 1000000) return 'over a megabyte, so not a screen';
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, 4096, 0);
    fs.closeSync(fd);
    head = buf.subarray(0, n).toString('utf8');
  } catch (_) { return 'cannot be read'; }
  return /<html|<body/i.test(head) ? '' : 'not a page: no html or body tag';
}

const looksLikeScreen = (rel, base) => {
  const name = base.replace(/\.\w+$/, '');
  if (SCREEN_NAME.test(name)) return true;
  return path.dirname(rel).split('/').some(seg => SCREEN_DIR.test(seg));
};

const sizeOf = file => { try { return fs.statSync(file).size; } catch (_) { return 0; } };

// ── an .html screen, as a page of the board ───────────────────────────────

// Its markup, its own <style> and its size, kept as they are. The only things added are
// the three meta tags the board reads, a <base> so its relative stylesheets and images
// still come from where they live, and one line saying where it came from. A root
// absolute path is rewritten to the same place: `/logo.svg` on a dev server means the
// folder that is served at the root, and here that folder is reached through `/@repo`.
function htmlPage(screen, { serial, repoRoot }) {
  let text;
  try { text = fs.readFileSync(screen.full, 'utf8'); } catch (_) { return { why: 'cannot be read' }; }

  const meta = htmlMeta(text);
  const title = `${serial} ${titleFor(screen.file, meta.title)}`;
  const width = Number(meta.width) || DEFAULT_FRAME.width;
  const height = Number(meta.height) || DEFAULT_FRAME.height;
  const from = screen.file;
  const base = `/@repo/${path.dirname(from) === '.' ? '' : path.dirname(from) + '/'}`;
  const atRoot = servedAtRoot(repoRoot);

  let body = text;
  body = body.replace(/\s(src|href|poster)=("|')\/(?!\/|@repo)([^"']*)\2/gi,
    (whole, attr, quote, rest) => {
      const found = atRoot(rest);
      return found ? ` ${attr}=${quote}${found}${quote}` : whole;
    });
  body = body.replace(/url\(\s*(["']?)\/(?!\/|@repo)([^)"']*)\1\s*\)/gi,
    (whole, quote, rest) => {
      const found = atRoot(rest);
      return found ? `url(${quote}${found}${quote})` : whole;
    });

  const block = [
    `<!-- design-from: ${from} -->`,
    `<meta name="designbook-width" content="${width}">`,
    `<meta name="designbook-height" content="${height}">`,
    '<meta name="designbook-grow" content="yes">',
    // A screen the repo wrote has no <base> of its own to lose; one that does keeps it,
    // because it already says where its files are.
    ...(/<base\s/i.test(text) ? [] : [`<base href="${base}">`]),
    ...(meta.title ? [] : [`<title>${escape(title)}</title>`])
  ].join('\n');

  const head = body.match(/<head[^>]*>/i);
  if (head) {
    body = body.replace(head[0], head[0] + '\n' + block);
  } else {
    const html = body.match(/<html[^>]*>/i);
    if (!html) return { why: 'not a page: no html or head tag' };
    body = body.replace(html[0], html[0] + `\n<head>\n${block}\n</head>`);
  }
  if (meta.title) {
    body = body.replace(/<title>[^<]*<\/title>/i, `<title>${escape(title)}</title>`);
  }

  return { file: `${serial}-${slug(titleFor(screen.file, meta.title))}.html`, ext: 'html', text: body };
}

// Where a root absolute url lands, looked up rather than guessed. A framework serves one
// folder at `/` and a plain repo of html serves itself, so the file is looked for in each
// of those in turn and the one that is really there wins. Nothing is found: the url is
// left exactly as it was, because a rewritten path that points at nothing is a worse
// answer than the path the project wrote.
function servedAtRoot(repoRoot) {
  const roots = ['', 'public/', 'static/']
    .filter(dir => !dir || isDir(path.join(repoRoot, dir)));
  return rest => {
    const clean = rest.split(/[?#]/)[0];
    if (!clean) return '';
    for (const dir of roots) {
      if (fs.existsSync(path.join(repoRoot, dir, clean))) return `/@repo/${dir}${rest}`;
    }
    return '';
  };
}

const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } };

function htmlMeta(text) {
  const head = text.slice(0, 4096);
  const meta = {};
  const re = /<meta\s+name=["'](?:design|canvas)-([a-z]+)["']\s+content=["']([^"']*)["']/gi;
  let m;
  while ((m = re.exec(head))) meta[m[1].toLowerCase()] = m[2];
  const title = head.match(/<title>([^<]*)<\/title>/i);
  if (title && !meta.title) meta.title = title[1].trim();
  return meta;
}

// What the frame is called: the page's own title, or the file, or the folder when the
// file is an index and the folder is the name a person would say.
function titleFor(rel, title) {
  if (title) return title.slice(0, 48);
  const bare = path.basename(rel).replace(/\.\w+$/, '');
  if (!/^index$/i.test(bare)) return bare.replace(/[-_]/g, ' ');
  const dir = path.dirname(rel);
  return dir === '.' ? 'index' : path.basename(dir).replace(/[-_]/g, ' ');
}

// ── a React, Vue or Svelte screen ─────────────────────────────────────────

// Rendered by the project, or not at all.
//
// Only the project can compile its own components, with its own aliases, its own styles
// and its own integrations. So the page imports the component from the project's root and
// the project's dev server renders it exactly as it renders its own pages. Where the
// project cannot serve a page of ours, or has nothing installed that compiles this kind
// of component, there is nothing faithful to draw and the file is left out.
function componentPage(screen, { serial, canCompile }) {
  const why = canCompile(screen.file);
  if (why) return { why };

  const name = path.basename(screen.file).replace(/\.\w+$/, '');
  const title = `${serial} ${name}`;
  const client = screen.file.endsWith('.jsx') || screen.file.endsWith('.tsx') ? ' client:load' : '';
  const text = `---
// designbook: title=${title} | width=${DEFAULT_FRAME.width} | height=${DEFAULT_FRAME.height} | grow=yes
// design-from: ${screen.file}
//
// This project's own screen, rendered by this project. Imported from the project's root
// rather than relative to this file: this folder may live outside the project, and a
// relative path would walk out of it.
import Screen from '/${screen.file}';
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escape(title)}</title>
    <style>
      html, body { margin: 0; }
      body { width: ${DEFAULT_FRAME.width}px; min-height: ${DEFAULT_FRAME.height}px; }
    </style>
  </head>
  <body>
    <Screen${client} />
  </body>
</html>
`;
  return { file: `${serial}-${slug(name)}.astro`, ext: 'astro', text };
}

// ── the design system, when the repo declares none ────────────────────────

function tokensCss(palette) {
  // The colours it writes more than once, which in a repo of any size is its palette and
  // not its accidents. A small repo writes each of its colours once, and dropping them
  // all would leave a token file with a font in it, so there they are the palette.
  const repeated = palette.colours.filter(c => c.count > 1);
  const colours = (repeated.length >= 3 ? repeated : palette.colours).slice(0, 24);
  const fonts = palette.fonts.slice(0, 4);
  const spacing = palette.spacing.slice(0, 12);
  const count = colours.length + fonts.length + spacing.length;
  if (!count) return { count: 0, text: '' };

  const L = [
    '/* The tokens this repo actually uses, written by the setup pass.',
    ' *',
    ' * Nothing here was chosen: these are the values counted across the repo itself, the',
    ' * colours it writes most often, the fonts it loads and the spacing steps it repeats.',
    ' * They are a true picture of the project rather than a design system somebody picked.',
    ' * Change a value here and the board follows; declare them in the project instead and',
    ' * this file can go.',
    ' */',
    ':root {'
  ];
  colours.forEach((c, i) => L.push(`  --colour-${i + 1}: ${c.value};   /* ${c.count} times */`));
  if (fonts.length && colours.length) L.push('');
  fonts.forEach((f, i) => L.push(`  --font-${i + 1}: '${f.value}';`));
  if (spacing.length) L.push('');
  spacing.forEach((s, i) => L.push(`  --space-${i + 1}: ${s.value};`));
  L.push('}');
  L.push('');
  return { count, text: L.join('\n') };
}

// ── the board file ────────────────────────────────────────────────────────

// One section per folder the pages came from, so the board opens laid out rather than as
// one endless line. A board that already exists keeps its sections and its frame sizes:
// setup can be run again and it adds, it never rearranges what somebody has arranged.
function writeBoard({ boardFile, name, made, live, studioRoot, routes = [], retired = [] }) {
  const existing = readJson(boardFile);
  const doc = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  doc.designbook = 1;
  doc.name = doc.name || name;
  doc.resources = path.basename(studioRoot);
  doc.frame = doc.frame || { ...DEFAULT_FRAME };
  doc.frames = doc.frames && typeof doc.frames === 'object' ? doc.frames : {};
  doc.sections = Array.isArray(doc.sections) ? doc.sections : [];
  if (live && !doc.live) doc.live = live.config;
  // The list of addresses is this scan's, every time: a screen added since the last one
  // is in it, and one whose file is gone is not.
  if (live && doc.live && live.config.routes) doc.live.routes = live.config.routes;

  // A frame that has just been taken off the board goes out of its band and out of the
  // sizes, so nothing is left pointing at a page that is in the trash.
  const gone = new Set(retired.map(page => {
    const file = path.basename(page.file);
    return file.endsWith('.astro') ? 'exp:' + file.replace(/\.astro$/, '') : 'canvas:' + file;
  }));
  if (gone.size) {
    for (const band of doc.sections) band.frames = (band.frames || []).filter(id => !gone.has(id));
    doc.sections = doc.sections.filter(band => (band.frames || []).length || band.id === 'live');
    for (const id of gone) delete doc.frames[id];
  }

  const placed = new Set(doc.sections.flatMap(s => s.frames || []));
  const band = (id, bandName) => {
    let hit = doc.sections.find(s => s.id === id);
    if (!hit) { hit = { id, name: bandName, frames: [] }; doc.sections.push(hit); }
    return hit;
  };

  // The project's own pages land in the first band, which is also where a frame nobody
  // has placed goes, so the band it lands in is the one that says what it is.
  if (live || routes.length) {
    const first = band('live', 'The project, live');
    for (const route of routes) {
      const id = 'live:' + route;
      if (!placed.has(id)) { first.frames.push(id); placed.add(id); }
    }
  }

  // One band per folder the screens came from, because that is the grouping the repo
  // already has and the one a person holds in their head. A folder with a single screen
  // in it is not a group: it joins its parent, and a screen with no group at all joins
  // the one band at the end. Twenty bands of one frame is not a board.
  const fresh = made.filter(page => !placed.has(page.id));
  const byDir = new Map();
  for (const page of fresh) {
    const dir = page.dir === '.' ? '' : page.dir;
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(page);
  }
  // Which band a folder's screens belong in: the deepest folder that collects more than
  // one frame, counting the folders under it. A folder that collects one frame is not a
  // group, so it rises to the folder above; one that never collects two joins the single
  // band at the end. The alternative is twenty bands of one frame, which is a list, not
  // a board.
  const total = at => [...byDir]
    .filter(([dir]) => dir === at || dir.startsWith(at + '/'))
    .reduce((n, [, pages]) => n + pages.length, 0);
  const bandDir = dir => {
    const parts = dir ? dir.split('/') : [];
    for (let depth = parts.length; depth > 0; depth--) {
      const at = parts.slice(0, depth).join('/');
      // A band this folder already has on the board is the band, however few frames came
      // in this time: a second scan that finds one new screen puts it with its own kind.
      if (doc.sections.some(band => band.id === slug(at))) return at;
      if (total(at) > 1) return at;
    }
    return '';
  };

  const groups = new Map();
  for (const [dir, pages] of byDir) {
    const where = bandDir(dir);
    if (!groups.has(where)) groups.set(where, []);
    groups.get(where).push(...pages);
  }
  for (const [dir, pages] of [...groups].sort((a, b) => (a[0] ? 0 : 1) - (b[0] ? 0 : 1) || a[0].localeCompare(b[0]))) {
    const hit = dir ? band(slug(dir), dir) : band('screens', 'Screens');
    for (const page of pages) hit.frames.push(page.id);
  }

  fs.mkdirSync(path.dirname(boardFile), { recursive: true });
  fs.writeFileSync(boardFile, JSON.stringify(doc, null, 2) + '\n');
  return doc;
}

// Whether the project can serve itself.
//
// A repo with a dev script already knows how to draw its own pages, and a board showing
// those is a board of the real thing rather than of copies of it. Only the board file is
// written for this: the project is untouched, and nothing runs until the board is opened.
function liveFor(root, routes) {
  const pkg = readJson(path.join(root, 'package.json'));
  if (!pkg || !pkg.scripts || !pkg.scripts.dev) return null;
  const run =
    fs.existsSync(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm dev'
    : fs.existsSync(path.join(root, 'yarn.lock')) ? 'yarn dev'
    : fs.existsSync(path.join(root, 'bun.lockb')) ? 'bun run dev'
    : 'npm run dev';
  const config = { cwd: '..', command: run };
  // Written down rather than discovered: the addresses this board asks for include the
  // ones the project draws for us, which nothing could find by looking at the files.
  if (routes && routes.length) config.routes = routes;
  return { command: run, config };
}

// ── running it twice ──────────────────────────────────────────────────────

// Which project files the pages here were made from. A page says so in its first lines,
// so a second run knows what it already did without keeping a list of its own that could
// disagree with the folder.
// Which page was made from which of the repo's files, read from the line each one
// carries. A page with no such line was written by hand and is nobody's to touch.
function fromMarkers(dir) {
  const out = new Map();
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return out; }
  for (const file of names) {
    if (!/\.(html|astro)$/.test(file)) continue;
    let head = '';
    try { head = fs.readFileSync(path.join(dir, file), 'utf8').slice(0, 2048); } catch (_) { continue; }
    const m = head.match(/design-from:\s*([^\s*>]+)/);
    if (m) out.set(m[1], file);
  }
  return out;
}

function highestSerial(dir) {
  let top = 0;
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return '00'; }
  for (const file of names) {
    const m = /^(\d+)-/.exec(file);
    if (m && /\.(html|astro)$/.test(file)) top = Math.max(top, Number(m[1]));
  }
  return String(top).padStart(2, '0');
}

function freeName(dir, file) {
  const ext = path.extname(file);
  const stem = file.slice(0, -ext.length);
  let out = file;
  let n = 2;
  while (fs.existsSync(path.join(dir, out))) out = `${stem}-${n++}${ext}`;
  return out;
}

const escape = s => String(s).replace(/</g, '&lt;');
