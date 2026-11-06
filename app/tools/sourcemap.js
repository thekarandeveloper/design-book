// From a position in what the browser ran to the line of the file somebody wrote.
//
// A framework in development leaves a trail on every element it draws: React 19 keeps the
// stack of the call that made it, Astro writes the file onto the element, Svelte and Vue
// keep a location. What the React stack names is a position in a bundle, and a bundle is
// not a file anybody can open. Its source map says where that position came from, so that
// is what is read here: the standard map, which every bundler in development writes, so
// this does not care which bundler it was.
//
// Nothing is written into the project and nothing in the project needs to know.

import path from 'node:path';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DIGIT = Object.fromEntries([...B64].map((c, i) => [c, i]));

// One line of a map's `mappings`: segments of [generated column, source, line, column].
function decodeLine(text, state) {
  const segments = [];
  let col = 0;
  let i = 0;
  while (i < text.length) {
    const seg = [];
    for (let n = 0; n < 5 && i < text.length && text[i] !== ',' ; n++) {
      let shift = 0;
      let value = 0;
      let more;
      do {
        const d = DIGIT[text[i++]];
        more = d & 32;
        value += (d & 31) << shift;
        shift += 5;
      } while (more && i < text.length);
      seg.push(value & 1 ? -(value >> 1) : value >> 1);
    }
    if (text[i] === ',') i++;
    if (!seg.length) continue;
    col += seg[0];
    if (seg.length >= 4) {
      state.source += seg[1];
      state.line += seg[2];
      state.col += seg[3];
      segments.push([col, state.source, state.line, state.col]);
    }
  }
  return segments;
}

// A plain map, decoded as far as the line asked for, and kept so asking again is free.
function plain(map) {
  const lines = map.mappings.split(';');
  const state = { source: 0, line: 0, col: 0 };
  const done = [];
  return {
    sources: map.sources || [],
    at(line, column) {
      while (done.length <= line && done.length < lines.length) done.push(decodeLine(lines[done.length], state));
      const row = done[line];
      if (!row || !row.length) return null;
      let best = null;
      for (const seg of row) { if (seg[0] <= column) best = seg; else break; }
      return best ? { source: this.sources[best[1]], line: best[2], column: best[3] } : null;
    }
  };
}

// Turbopack writes an index map: a list of maps, each starting at a place in the bundle.
function open(map) {
  if (!map.sections) return plain(map);
  const parts = map.sections.map(s => ({ line: s.offset.line, column: s.offset.column, map: plain(s.map) }));
  return {
    at(line, column) {
      let part = null;
      for (const p of parts) {
        if (p.line < line || (p.line === line && p.column <= column)) part = p; else break;
      }
      if (!part) return null;
      const found = part.map.at(line - part.line, line === part.line ? column - part.column : column);
      return found;
    }
  };
}

const maps = new Map();   // bundle url -> opened map, or null when there is none
const MOST_MAPS = 12;

async function mapFor(url) {
  if (maps.has(url)) return maps.get(url);
  let opened = null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const text = await res.text();
    const tail = text.slice(-600);
    const found = /\/\/[#@]\s*sourceMappingURL=([^\s]+)\s*$/m.exec(tail);
    if (found) {
      const ref = found[1];
      let raw;
      if (ref.startsWith('data:')) {
        const body = ref.slice(ref.indexOf(',') + 1);
        raw = ref.includes(';base64') ? Buffer.from(body, 'base64').toString('utf8') : decodeURIComponent(body);
      } else {
        const mapRes = await fetch(new URL(ref, url), { signal: AbortSignal.timeout(8000) });
        raw = await mapRes.text();
      }
      opened = open(JSON.parse(raw));
    }
  } catch (_) { opened = null; }
  if (maps.size >= MOST_MAPS) maps.delete(maps.keys().next().value);
  maps.set(url, opened);
  return opened;
}

// A source path as a bundler spells it, as a path in the project.
export function projectPath(source, root) {
  let p = String(source || '');
  p = p.replace(/^webpack-internal:\/\/\/(\([^)]*\)\/)?/, '')
    .replace(/^webpack:\/\/[^/]*\//, '')
    .replace(/^turbopack:\/\/\/\[project\]\//, '')
    .replace(/^\[project\]\//, '')
    .replace(/^file:\/\//, '');
  try { p = decodeURIComponent(p); } catch (_) {}
  if (path.isAbsolute(p) && root && p.startsWith(root + path.sep)) p = path.relative(root, p);
  p = p.replace(/^\.\//, '').replace(/\?.*$/, '');
  return p;
}

// What is not the project's: a dependency, or the framework doing its own work.
export const foreign = file => /(^|\/)node_modules\//.test(file) || /^(next|react|react-dom)\//.test(file)
  || /\[project\]\/node_modules|next\/dist|react-server-dom|react-dom/.test(file);

// The first frame of a stack that is the project's own, as a file and a line.
//
// `stack` is the text of an Error as the browser wrote it. The frames at the top belong to
// React making the element, so they are passed over; the first one after them is the
// component that asked for it, and its position is where the tag is written.
export async function sourceFromStack(stack, root) {
  const frames = String(stack || '').split('\n')
    .map(l => /\(?((?:https?|webpack-internal|file):[^\s()]+?):(\d+):(\d+)\)?\s*$/.exec(l.trim()))
    .filter(Boolean)
    .map(m => ({ url: m[1], line: Number(m[2]), column: Number(m[3]) }));
  for (const f of frames) {
    if (/jsxDEV|jsx-dev-runtime|react-stack|react_stack/.test(f.url)) continue;
    const map = await mapFor(f.url.replace(/^webpack-internal:.*/, '')) ;
    if (!map) {
      // A dev server that serves modules as they are, where the address is the file.
      const direct = projectPath(new URL(f.url, 'http://x').pathname, root);
      if (/\.(jsx?|tsx?|vue|svelte|astro|mdx?)$/.test(direct) && !foreign(direct) && !direct.startsWith('_next/')) {
        return { file: direct, line: f.line, column: f.column };
      }
      continue;
    }
    const at = map.at(f.line - 1, f.column - 1);
    if (!at || !at.source) continue;
    const file = projectPath(at.source, root);
    if (!file || foreign(file)) continue;
    return { file, line: at.line + 1, column: at.column + 1 };
  }
  return null;
}
