// What the project itself contains.
//
// The canvas points at a real project, so its design system and its components have to
// come from that project rather than from anything shipped here. Both are read from the
// source on disk: the tokens because a stylesheet declares them in plain text, and the
// components because every framework keeps them in a folder named after what they are.

import fs from 'node:fs';
import path from 'node:path';

export const SKIP = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit',
  '.astro', '.output', '.gradle', 'DerivedData', 'Pods', '.build', 'vendor',
  'coverage', '__pycache__', '.venv', 'venv', 'target', '.turbo', '.cache'
]);

// One walk of the project, for everything here that needs to see its files.
//
// The skip list is the point: a second walk with a list of its own is a list that will
// disagree with this one the week somebody adds a build folder. `visit` is given the
// file's full path, its path relative to the root, and its name.
export function walkProject(root, visit, { depth = 8 } = {}) {
  const step = (dir, level) => {
    if (level > depth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
        step(full, level + 1);
        continue;
      }
      visit(full, path.relative(root, full).split(path.sep).join('/'), entry.name);
    }
  };
  step(root, 0);
}

const COMPONENT_DIRS = /(^|[-_.])(components?|ui|widgets|views|screens|blocks|elements|atoms|molecules|organisms|layouts|partials)$|design-?system/i;
const COMPONENT_EXT = /\.(astro|jsx|tsx|vue|svelte|swift|kt)$/;
const NOT_A_COMPONENT = /(ViewModel|Service|Services|Store|Repository|Coordinator|Manager|Provider|Client|Helper|Helpers|Util|Utils|Config|Constants|Tests?|Spec|Mock|Mocks)$/;

export function readProject(root) {
  const components = [];
  const styles = [];

  walkProject(root, (full, rel, name) => {
    // Any segment of the path, not just the folder the file is in: `components/home`
    // is still components, and that is where most of a site's real parts live.
    const inComponents = path.dirname(rel).split('/').some(seg => COMPONENT_DIRS.test(seg));
    if (COMPONENT_EXT.test(name) && inComponents) {
      const ext = path.extname(name);
      const bare = name.slice(0, -ext.length);
      if (NOT_A_COMPONENT.test(bare) || bare.includes('+') || bare.startsWith('_')) return;
      components.push({
        name: bare,
        file: rel,
        dir: path.dirname(rel),
        language: ext.slice(1),
        lines: countLines(full)
      });
      return;
    }

    if (/\.(css|scss|sass|less)$/.test(name)) {
      const properties = readCustomProperties(full);
      if (properties.length >= 3) styles.push({ file: rel, count: properties.length });
    }
  });

  components.sort((a, b) => (a.dir + a.name).localeCompare(b.dir + b.name));
  // The stylesheet that declares the most is almost always the design system.
  styles.sort((a, b) => b.count - a.count);
  return { components, styles };
}

function countLines(file) {
  try {
    const stat = fs.statSync(file);
    if (stat.size > 500000) return 0;
    return fs.readFileSync(file, 'utf8').split('\n').length;
  } catch (_) { return 0; }
}

// Every custom property a stylesheet declares, in the order it declares them, with the
// block it sits in. The block matters: `:root` and `.dark` are the same token twice.
export function readCustomProperties(file) {
  let text = '';
  try {
    const stat = fs.statSync(file);
    if (stat.size > 800000) return [];
    text = fs.readFileSync(file, 'utf8');
  } catch (_) { return []; }

  // Read as blocks rather than as lines: a stylesheet that has been written on one line,
  // or built by a tool, declares its tokens just as much as a hand-written one, and a
  // line-by-line reader finds nothing in it at all. The innermost block wins, so a
  // `:root` inside a media query keeps `:root` as its scope rather than the query.
  const out = [];
  const blocks = /([^{}]+)\{([^{}]*)\}/g;
  let block;
  while ((block = blocks.exec(text))) {
    const scope = block[1].trim().split('\n').pop().trim();
    const declarations = /(--[\w-]+)\s*:\s*([^;]+)(?:;|$)/g;
    let declaration;
    while ((declaration = declarations.exec(block[2]))) {
      out.push({ name: declaration[1], value: declaration[2].trim(), scope });
    }
  }
  return out;
}

// Tokens sorted into the shapes a design system page wants to draw.
const COLOUR = /^(#|rgb|hsl|oklch|color\()/i;
const LENGTH = /^-?[\d.]+(px|rem|em|%)$/;

export function groupTokens(properties) {
  const colours = [];
  const lengths = [];
  const fonts = [];
  const other = [];
  for (const p of properties) {
    const v = p.value;
    if (COLOUR.test(v)) colours.push(p);
    else if (LENGTH.test(v)) lengths.push(p);
    else if (/^(--)?font|["']/.test(v) && /font/i.test(p.name)) fonts.push(p);
    else other.push(p);
  }
  return { colours, lengths, fonts, other };
}

// Changing a token in the project's own stylesheet.
//
// Edited line by line rather than by parsing and reprinting the file: a CSS printer
// would reformat everything around the one value that changed, and the diff of a token
// edit should be one line. The scope matters because the same token is usually declared
// twice, once per theme.
export function writeCustomProperty(file, { scope = '', name, value }) {
  if (!/^--[\w-]+$/.test(name || '')) return { ok: false, error: 'a token is --something' };

  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return { ok: false, error: 'cannot read that file' }; }
  const lines = text.split('\n');

  let current = '';
  let blockStart = -1;
  let blockEnd = -1;
  let hit = -1;
  let indent = '  ';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const open = line.match(/^([^{}]+)\{\s*$/);
    if (open) {
      current = open[1].trim();
      if (current === scope) blockStart = i;
      continue;
    }
    if (line === '}') {
      if (current === scope && blockStart !== -1 && blockEnd === -1) blockEnd = i;
      current = '';
      continue;
    }
    if (current !== scope) continue;
    const m = lines[i].match(/^(\s*)(--[\w-]+)\s*:/);
    if (m) {
      indent = m[1] || '  ';
      if (m[2] === name) hit = i;
    }
  }

  if (value === null || value === undefined || value === '') {
    if (hit === -1) return { ok: false, error: 'no such token in that block' };
    lines.splice(hit, 1);
  } else if (hit !== -1) {
    lines[hit] = lines[hit].replace(/:\s*[^;]*;/, `: ${value};`);
  } else {
    if (blockEnd === -1) return { ok: false, error: `no ${scope || 'top level'} block in that file` };
    lines.splice(blockEnd, 0, `${indent}${name}: ${value};`);
  }

  try { fs.writeFileSync(file, lines.join('\n')); } catch (_) { return { ok: false, error: 'cannot write that file' }; }
  return { ok: true };
}
