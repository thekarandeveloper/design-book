// Everything the project actually uses: colours, fonts, icons.
//
// A design system page that only reads one stylesheet's custom properties shows the
// tokens somebody remembered to declare. What an experiment needs is the real set: the
// colour that was typed into one component, the font that arrived through an import, the
// icon pack that is already a dependency. So the whole project is read and everything is
// counted, with the most used first.

import fs from 'node:fs';
import path from 'node:path';

const SKIP = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit',
  '.astro', '.output', '.gradle', 'DerivedData', 'Pods', '.build', 'vendor',
  'coverage', '__pycache__', '.venv', 'venv', 'target', '.turbo', '.cache', '.designbook'
]);

const READABLE = /\.(css|scss|sass|less|astro|jsx|tsx|vue|svelte|html|js|mjs|ts|json|md|mdx)$/;
const MAX_BYTES = 400000;

const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|lab|color)\(\s*[^)]{3,60}\)/g;
const FONT_FAMILY = /font-family\s*:\s*([^;{}]+)[;}]/gi;
const FONT_FACE = /@font-face[^{]*\{[^}]*font-family\s*:\s*([^;]+);/gi;
const FONTSOURCE = /@fontsource[^'"\s]*\/([\w-]+)/g;
const GOOGLE_FONTS = /fonts\.googleapis\.com\/css2?\?([^"'\s)]+)/g;

const ICON_IMPORT = /from\s+['"](lucide-[\w-]+|@?[\w/-]*icons?[\w/-]*)['"]/g;
const ICON_COMPONENT = /<Icon\s+name=['"]([\w:-]+)['"]/g;

// Spacing is read from the declarations that are spacing and nowhere else: a width or a
// font size in pixels is not a step on a scale, and counting those would bury the few
// numbers a project really repeats under every number it happens to contain.
const SPACING = /(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|inline|block))?\s*:\s*([^;{}"']+)/gi;
const STEP = /(?<![\w.-])(\d{1,4}(?:\.\d+)?)(px|rem)(?![\w-])/g;

export function readPalette(root) {
  const colours = new Map();
  const fonts = new Map();
  const spacing = new Map();
  const iconPacks = new Map();
  const iconNames = new Map();
  const svgFiles = [];
  let files = 0;

  const note = (map, key, file) => {
    if (!key) return;
    const entry = map.get(key) || { value: key, count: 0, files: [] };
    entry.count++;
    if (entry.files.length < 4 && !entry.files.includes(file)) entry.files.push(file);
    map.set(key, entry);
  };

  const walk = (dir, depth) => {
    if (depth > 9 || files > 4000) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
        walk(full, depth + 1);
        continue;
      }
      const rel = path.relative(root, full).split(path.sep).join('/');

      if (entry.name.endsWith('.svg')) {
        if (svgFiles.length < 400) svgFiles.push(rel);
        continue;
      }
      if (!READABLE.test(entry.name)) continue;

      let text;
      try {
        if (fs.statSync(full).size > MAX_BYTES) continue;
        text = fs.readFileSync(full, 'utf8');
      } catch (_) { continue; }
      files++;

      for (const m of text.matchAll(COLOUR)) note(colours, normaliseColour(m[0]), rel);
      for (const m of text.matchAll(FONT_FACE)) note(fonts, cleanFont(m[1]), rel);
      for (const m of text.matchAll(FONT_FAMILY)) {
        for (const part of m[1].split(',')) note(fonts, cleanFont(part), rel);
      }
      for (const m of text.matchAll(FONTSOURCE)) note(fonts, titleCase(m[1]), rel);
      for (const m of text.matchAll(GOOGLE_FONTS)) {
        for (const fam of m[1].matchAll(/family=([^&:]+)/g)) {
          note(fonts, decodeURIComponent(fam[1]).replace(/\+/g, ' '), rel);
        }
      }
      for (const m of text.matchAll(SPACING)) {
        for (const step of m[1].matchAll(STEP)) note(spacing, step[1] + step[2], rel);
      }
      for (const m of text.matchAll(ICON_IMPORT)) note(iconPacks, m[1], rel);
      for (const m of text.matchAll(ICON_COMPONENT)) note(iconNames, m[1], rel);
    }
  };
  walk(root, 0);

  const byCount = map => [...map.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  // Spacing reads as a scale, so it is given in order of size rather than of use, and a
  // step written once is a one off rather than a step.
  const bySize = [...spacing.values()]
    .filter(s => s.count > 1)
    .sort((a, b) => px(a.value) - px(b.value));

  return {
    files,
    colours: byCount(colours).slice(0, 160),
    fonts: byCount(fonts).filter(f => !GENERIC.has(f.value.toLowerCase())).slice(0, 40),
    spacing: bySize.slice(0, 24),
    iconPacks: byCount(iconPacks).slice(0, 20),
    iconNames: byCount(iconNames).slice(0, 120),
    svgFiles: svgFiles.sort()
  };
}

// A generic family is a fallback, not a decision, so it is not part of the system.
const GENERIC = new Set([
  'sans-serif', 'serif', 'monospace', 'system-ui', 'ui-sans-serif', 'ui-serif',
  'ui-monospace', 'ui-rounded', 'inherit', 'initial', 'unset', 'cursive', 'fantasy',
  'emoji', 'math', 'fangsong', '-apple-system', 'blinkmacsystemfont'
]);

const cleanFont = s => (s || '').trim().replace(/^["']|["']$/g, '').replace(/\s+/g, ' ');
// rem against px, so one scale can be sorted. 16 is the root size unless a project says
// otherwise, and a project that says otherwise still wants its steps in order.
const px = value => parseFloat(value) * (value.endsWith('rem') ? 16 : 1);
const titleCase = s => s.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

// #FFF and #ffffff are the same decision, and so are the same colour written twice.
function normaliseColour(raw) {
  let v = raw.trim().toLowerCase();
  if (v.startsWith('#')) {
    const hex = v.slice(1);
    if (hex.length === 3) v = '#' + hex.split('').map(c => c + c).join('');
    else if (hex.length === 4) v = '#' + hex.slice(0, 3).split('').map(c => c + c).join('');
    else v = '#' + hex;
    if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(v)) return '';
    return v.toUpperCase();
  }
  return v.replace(/\s+/g, ' ');
}
