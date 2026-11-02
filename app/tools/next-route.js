// A dev-only route written into a Next project, so that project can draw its own screens.
//
// A component of a Next app is only itself inside that app: its Tailwind build, its
// fonts, its root layout, its aliases and its providers are all the project's. Compiling
// one anywhere else gives an approximation, and an approximation looks authoritative
// while being wrong. So the project is asked to draw it, through one route of ours:
//
//   /designbook/components/home/HeroSection
//
// The screens it can draw are written into the file as a plain map, rather than looked up
// by a path at run time: a dynamic import of a variable is a different thing in webpack,
// in Turbopack and in a build, and a map is the same thing in all three.
//
// It is dev only in effect (a build never links to it), it is removed by deleting the
// folder, and nothing else in the project is touched.

import fs from 'node:fs';
import path from 'node:path';

export const NEXT_ROUTE = 'designbook';
const MARK = 'Added by Design Book';

const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } };

// Where this project keeps its app router. Nothing to write into if it has none.
export function appDir(cwd) {
  return [path.join(cwd, 'app'), path.join(cwd, 'src', 'app')].find(isDir) || '';
}

export function nextRouteDir(cwd) {
  const app = appDir(cwd);
  return app ? path.join(app, NEXT_ROUTE) : '';
}

export function nextRouteFile(cwd) {
  const dir = nextRouteDir(cwd);
  return dir ? path.join(dir, '[...path]', 'page.tsx') : '';
}

export function nextRouteState(cwd) {
  const file = nextRouteFile(cwd);
  let enabled = false;
  try { enabled = fs.readFileSync(file, 'utf8').includes(MARK); } catch (_) {}
  return { enabled, route: `/${NEXT_ROUTE}/`, file: file ? path.relative(cwd, file) : '' };
}

// `screens` is [{ key, file }]: the address to ask for it at, and the file it is in,
// both relative to the project.
export function writeNextRoute(cwd, screens) {
  const file = nextRouteFile(cwd);
  if (!file) return { written: false, routes: [] };

  const here = path.dirname(file);
  const lines = screens.map(({ key, file: rel }) => {
    const from = path.relative(here, path.join(cwd, rel)).split(path.sep).join('/').replace(/\.\w+$/, '');
    return `  ${JSON.stringify(key)}: () => import(${JSON.stringify(from.startsWith('.') ? from : './' + from)}),`;
  });

  const page = `// ${MARK}. Dev only: a frame on the board asks for one of this project's own
// screens by path, and this draws it with the project's own compiler, styles and fonts.
// Delete this folder to turn it off; the board writes it again when it next scans.
import { notFound } from 'next/navigation';

// No scrollbar in a frame, ever.
//
// A frame is as tall as its page, so there is nothing to scroll; but a page that takes
// the scrollbar away and gives it back, which anything with a preloader or a lock does,
// makes the frame jump every time it does. The bar is taken away here for good, and the
// page keeps its own scrolling.
const NO_BARS = [
  'html { scrollbar-width: none !important; }',
  'html::-webkit-scrollbar, body::-webkit-scrollbar { width: 0 !important; height: 0 !important; }',
  'body { overflow-x: hidden !important; }'
].join('\\n');

const screens: Record<string, () => Promise<any>> = {
${lines.join('\n')}
};

export default async function DesignBookScreen({ params }: any) {
  const asked: any = await params;
  const key = Array.isArray(asked?.path) ? asked.path.join('/') : String(asked?.path || '');
  const load = screens[key];
  if (!load) notFound();
  const mod: any = await load();
  const Screen: any = mod?.default || Object.values(mod || {}).find((v: any) => typeof v === 'function');
  if (!Screen) notFound();
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: NO_BARS }} />
      <Screen />
    </>
  );
}
`;

  // A screen that needs data to draw says so in one line. A board full of error pages
  // says nothing about the design, and the whole point of the frame is to be looked at.
  const boundary = `'use client';

// ${MARK}. What a screen leaves when it cannot draw itself, instead of an error page.
export default function DesignBookError({ error }: any) {
  return (
    <p style={{ margin: 0, padding: 24, font: '14px/1.5 system-ui, sans-serif', color: '#5C5C66' }}>
      This screen needs data to draw: {String(error?.message || 'it did not draw')}
    </p>
  );
}
`;

  try {
    fs.mkdirSync(here, { recursive: true });
    fs.writeFileSync(file, page);
    fs.writeFileSync(path.join(nextRouteDir(cwd), 'error.tsx'), boundary);
    ignore(cwd);
    return { written: true, routes: screens.map(s => `/${NEXT_ROUTE}/${s.key}`) };
  } catch (_) {
    return { written: false, routes: [] };
  }
}

export function removeNextRoute(cwd) {
  const dir = nextRouteDir(cwd);
  const file = nextRouteFile(cwd);
  try {
    if (!fs.readFileSync(file, 'utf8').includes(MARK)) return false;
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } catch (_) { return false; }
}

// The project keeps its own files in git; this one is ours and dev only, so it is kept
// out of the way rather than showing up as something somebody forgot to commit.
function ignore(cwd) {
  const file = path.join(cwd, '.gitignore');
  const line = `${path.relative(cwd, nextRouteDir(cwd)).split(path.sep).join('/')}/`;
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return; }
  if (text.split('\n').some(l => l.trim() === line)) return;
  try {
    fs.writeFileSync(file, text.replace(/\s*$/, '') + `\n\n# ${MARK}. A dev only route, written again whenever the board scans.\n${line}\n`);
  } catch (_) {}
}
