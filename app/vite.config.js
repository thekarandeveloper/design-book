import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { studioPlugin } from './tools/studio-plugin.js';

// The app lives in the extension; the CONTENT lives in whichever repo is open, in its
// `.designbook/` folder. One server is started per board, with that folder passed in.
const appRoot = path.dirname(new URL(import.meta.url).pathname);
const studioRoot = process.env.STUDIO_ROOT || path.join(appRoot, 'example-board');
const repoRoot = process.env.REPO_ROOT || path.dirname(studioRoot);
// The board itself: the `.designbook` file next to the folder, which the extension opened.
const boardFile = process.env.CANVAS_FILE || '';

// A page of the board's can import one of the repo's own components, and that component
// imports the rest of the repo the way the repo writes it: `@/components/Button` rather
// than a path. Those spellings are declared once, in the repo's tsconfig, so they are
// read from there rather than guessed at. Without them a component that uses one does
// not compile and the frame stays empty.
// Comments are allowed in a tsconfig and JSON.parse will not have them. Taken out by
// walking the text rather than by a pattern: the commonest path in any tsconfig is
// `"@/*": ["./*"]`, and a pattern for a block comment eats it from the middle.
function withoutComments(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (ch === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue; }
    out += ch;
  }
  // A trailing comma is allowed too, and JSON.parse will not have one of those either.
  return out.replace(/,(\s*[}\]])/g, '$1');
}

function repoAliases() {
  const out = {};
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    let json;
    try {
      json = JSON.parse(withoutComments(fs.readFileSync(path.join(repoRoot, name), 'utf8')));
    } catch (_) { continue; }
    const opts = (json && json.compilerOptions) || {};
    const base = path.resolve(repoRoot, opts.baseUrl || '.');
    for (const [from, to] of Object.entries(opts.paths || {})) {
      const first = Array.isArray(to) ? to[0] : to;
      if (!first) continue;
      // Kept with the slash on both sides: `@` on its own would also match `@vitejs`
      // and every other scoped package name.
      const key = from.endsWith('/*') ? from.slice(0, -1) : from;
      const value = first.endsWith('/*') ? first.slice(0, -1) : first;
      out[key] = path.resolve(base, value) + (key.endsWith('/') ? '/' : '');
    }
    if (Object.keys(out).length) break;
  }
  return out;
}

export default defineConfig({
  root: appRoot,
  plugins: [react(), studioPlugin({ appRoot, studioRoot, repoRoot, boardFile })],
  resolve: {
    alias: { '@studio': studioRoot, ...repoAliases() },
    // One React on a page, always. A repo has its own copy, and a component drawn with
    // that one while the page is drawn with this one breaks on the first hook.
    dedupe: ['react', 'react-dom']
  },
  server: {
    port: Number(process.env.STUDIO_PORT) || 5273,
    strictPort: false,
    cors: true,
    // No error page, ever. A frame is a thing you are looking at to judge a design, and
    // a red overlay over it tells you nothing about the design. What cannot be drawn
    // says so in one line, in the frame, and the whole reason is in the log.
    hmr: { overlay: false },
    // The board folder and the repo are both outside the app root, so they are allowed.
    fs: { allow: [appRoot, studioRoot, repoRoot] }
  },
  build: { outDir: 'dist' }
});
