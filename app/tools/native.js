// What a native project's design system says, read from its code.
//
// A web project keeps its tokens in a stylesheet, and the board reads them from there. A
// SwiftUI or Compose project keeps them in Swift and Kotlin, and until now the board saw
// none of it: it counted hex strings and offered the three it found. What an agent needs
// is what the code decides: that `primary` is this blue in light and that blue in dark,
// that the screen margin is 24, that body is 17pt at regular weight. So that is what is read.
//
// Nothing here runs the code. Colours in a design system are written as constructors with
// named arguments (`ColorPair(light = brand.light.level5, dark = brand.dark.level8)`), so
// the constructors are read as a tree, and a name that points at another is followed to the
// hex it ends at. Sizes and type are read as the lines they are written on.
//
// It is for reading a design system, not for compiling one. A file it cannot make sense of
// is skipped, and what it reports is only what it could follow all the way to a value.

import fs from 'node:fs';
import path from 'node:path';

const SKIP = new Set(['node_modules', '.git', 'build', 'Pods', 'DerivedData', '.gradle', '.next', 'dist',
  '.designbook', '.idea', '.build', 'Carthage', 'xcuserdata', '.swiftpm', 'out', 'target']);
// Where a design system lives, by what its files and folders are called.
const WHERE = /(design|token|theme|colou?r|typograph|spacing|constant|animation|palette|style)/i;
const MOST_FILES = 90;
const MOST_BYTES = 400000;
const MOST_WALK = 30000;

function walk(root) {
  const code = [];
  const sets = [];
  let seen = 0;
  const visit = (dir, depth) => {
    if (depth > 10 || seen > MOST_WALK) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      seen++;
      if (e.name.startsWith('.') && e.name !== '.') { if (e.isDirectory()) continue; }
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP.has(e.name)) continue;
        if (e.name.endsWith('.colorset')) { sets.push(full); continue; }
        visit(full, depth + 1);
      } else if (/\.(kt|swift)$/.test(e.name) && (WHERE.test(e.name) || WHERE.test(path.relative(root, dir)))) {
        code.push(full);
      }
    }
  };
  visit(root, 0);
  // A file called what a design system file is called comes before one that is only in a
  // folder with such a name, so the limit never cuts the typography file for a component.
  const named = f => WHERE.test(path.basename(f));
  code.sort((a, b) => Number(named(b)) - Number(named(a)));
  return { code, sets };
}

// ── comments and tokens ──────────────────────────────────────────────────────

// The text without its comments, and with every string kept whole.
function bare(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') { if (text[j] === '\\') j++; j++; }
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop - 1;
    } else out += c;
  }
  return out;
}

function tokens(text) {
  const out = [];
  const re = /"(?:\\.|[^"\\])*"|0x[0-9A-Fa-f_]+|-?\d+(?:\.\d+)?[fFdD]?(?:\.(?:dp|sp))?|[A-Za-z_][\w]*(?:\.[A-Za-z_]\w*)*|[(){},=]/g;
  let m;
  while ((m = re.exec(text))) out.push({ t: m[0], at: m.index });
  return out;
}

const hexOf = t => {
  if (/^"#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?"$/.test(t)) return t.slice(1, -1).toUpperCase();
  const m = /^0x([0-9A-Fa-f]{8})$/.exec(t);          // Color(0xFF2E7BF6): alpha first
  if (m) return ('#' + m[1].slice(2)).toUpperCase();
  return '';
};

// ── colours: constructors read as a tree ─────────────────────────────────────

// `val name = Ctor(arg = value, ...)` anywhere in the file, with the objects around it.
function readTree(text) {
  const toks = tokens(bare(text));
  const leaves = new Map();       // dotted path -> a hex, or a reference still to follow
  const pairs = [];               // nodes that are a light and a dark
  const scales = [];              // nodes that are a run of hex values
  let i = 0;

  const call = (path, scope) => {
    // toks[i] is '(' on entry. Returns the node: its named values by name.
    i++;
    const node = { args: {}, order: [] };
    let pos = 0;
    while (i < toks.length && toks[i].t !== ')') {
      let name = '';
      if (toks[i + 1] && toks[i + 1].t === '=' && /^[A-Za-z_]\w*$/.test(toks[i].t)) { name = toks[i].t; i += 2; }
      else name = '#' + pos;
      pos++;
      const sub = `${path}.${name}`;
      const t = toks[i] && toks[i].t;
      if (!t) break;
      if (/^[A-Za-z_]/.test(t) && toks[i + 1] && toks[i + 1].t === '(') {
        // Color(0xFF...) is a value; anything else is a node of its own.
        if (/^Color$/.test(t) && toks[i + 2] && hexOf(toks[i + 2].t) && toks[i + 3] && toks[i + 3].t === ')') {
          leaves.set(sub, { hex: hexOf(toks[i + 2].t) });
          node.args[name] = { leaf: sub };
          i += 4;
        } else {
          i++;
          node.args[name] = { node: call(sub, scope), path: sub };
        }
      } else if (hexOf(t)) {
        leaves.set(sub, { hex: hexOf(t) });
        node.args[name] = { leaf: sub };
        i++;
      } else if (/^[A-Za-z_][\w.]*$/.test(t) && !/^(true|false|null)$/.test(t)) {
        leaves.set(sub, { ref: t, scope });
        node.args[name] = { leaf: sub };
        i++;
      } else {
        i++;
      }
      node.order.push(name);
      if (toks[i] && toks[i].t === ',') i++;
    }
    i++;                           // the ')'
    return node;
  };

  const scopeStack = [];
  const braces = [];
  while (i < toks.length) {
    const t = toks[i].t;
    if ((t === 'object' || t === 'struct' || t === 'enum' || t === 'class') && toks[i + 1] && /^[A-Z]\w*$/.test(toks[i + 1].t)) {
      let j = i + 2;
      while (j < toks.length && toks[j].t !== '{' && j < i + 12) j++;
      if (toks[j] && toks[j].t === '{') { scopeStack.push(toks[i + 1].t); braces.push('scope'); i = j + 1; continue; }
    }
    if (t === '{') { braces.push('other'); i++; continue; }
    if (t === '}') { if (braces.pop() === 'scope') scopeStack.pop(); i++; continue; }
    if ((t === 'val' || t === 'let' || t === 'var') && toks[i + 1] && /^[A-Za-z_]\w*$/.test(toks[i + 1].t) && toks[i + 2] && toks[i + 2].t === '=') {
      const name = toks[i + 1].t;
      const base = [...scopeStack, name].join('.');
      const val = toks[i + 3];
      if (val && /^[A-Z]\w*$/.test(val.t) && toks[i + 4] && toks[i + 4].t === '(') {
        i += 4;
        const node = call(base, scopeStack.join('.'));
        record(base, node);
        continue;
      }
      if (val && hexOf(val.t)) { leaves.set(base, { hex: hexOf(val.t) }); i += 4; continue; }
      if (val && val.t === 'Color' && toks[i + 4] && toks[i + 4].t === '(' && toks[i + 5] && hexOf(toks[i + 5].t)) {
        leaves.set(base, { hex: hexOf(toks[i + 5].t) }); i += 7; continue;
      }
    }
    i++;
  }

  function record(base, node) {
    const names = Object.keys(node.args);
    const leafOf = n => node.args[n] && node.args[n].leaf;
    if (names.includes('light') && names.includes('dark') && leafOf('light') && leafOf('dark')) {
      pairs.push({ path: base, light: leafOf('light'), dark: leafOf('dark') });
    }
    if (names.length >= 6 && names.every(n => leafOf(n))) scales.push({ path: base, levels: names.map(n => leafOf(n)) });
    for (const n of names) if (node.args[n].node) record(`${base}.${n}`, node.args[n].node);
  }
  return { leaves, pairs, scales };
}

// Following a name to the hex it ends at, from inside the objects it was written in.
function follow(ref, scope, leaves, depth = 0) {
  if (depth > 6) return '';
  const parts = scope ? scope.split('.') : [];
  for (let n = parts.length; n >= 0; n--) {
    const key = [...parts.slice(0, n), ref].join('.');
    const hit = leaves.get(key);
    if (!hit) continue;
    if (hit.hex) return hit.hex;
    if (hit.ref) return follow(hit.ref, hit.scope, leaves, depth + 1);
  }
  return '';
}

const valueOf = (leafPath, leaves) => {
  const leaf = leaves.get(leafPath);
  if (!leaf) return '';
  return leaf.hex || follow(leaf.ref, leaf.scope, leaves);
};

// ── sizes and type, as the lines they are written on ─────────────────────────

const SECTION = /^\s*\/\/\s*[─\-=]{2,}\s*(.+?)\s*[─\-=]*\s*$/;
const NUMBER = /^\s*(?:@\w+\s+)?(?:(?:public|private|internal|static|const|final|override|open)\s+)*(?:val|let|var)\s+([A-Za-z_]\w*)\s*(?::\s*[\w.<>?]+)?\s*=\s*(-?\d+(?:\.\d+)?)\s*([fFdD]|\.dp|\.sp)?\s*(?:\/\/\s*(.*))?$/;
const SWIFT_FONT = /(?:let|var)\s+([A-Za-z_]\w*)\s*=\s*Font\.system\(\s*size:\s*([\d.]+)(?:\s*,\s*weight:\s*\.(\w+))?(?:\s*,\s*design:\s*\.(\w+))?/;
const KT_STYLE = /(?:val)\s+([A-Za-z_]\w*)\s*=\s*TextStyle\(/;
const SCOPE = /^\s*(?:(?:public|private|internal|open|final)\s+)*(?:object|struct|enum|class)\s+([A-Z]\w*)/;

// `static let cardHorizontal: CGFloat = CGFloat(DesignTokens.shared.CARD_HORIZONTAL)`: the
// name the app's own code uses, whose value is another constant's.
const POINTS_AT = /(?:let|var)\s+([A-Za-z_]\w*)\s*(?::\s*CGFloat)?\s*=\s*CGFloat\(\s*[\w.]*?\.([A-Z][A-Z0-9_]+)\s*\)/;

function readLines(text, file) {
  const constants = [];
  const fonts = [];
  const refs = [];
  let section = '';
  let scope = '';
  const lines = text.split('\n');
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    const s = SECTION.exec(line);
    if (s) { section = s[1].replace(/\s*\(.*$/, '').trim(); continue; }
    const sc = SCOPE.exec(line);
    if (sc) { scope = sc[1]; section = ''; continue; }
    const at = POINTS_AT.exec(line);
    if (at) { refs.push({ name: at[1], to: at[2], group: section || scope, file, line: n + 1 }); continue; }
    const num = NUMBER.exec(line);
    if (num) {
      constants.push({
        name: num[1], value: Number(num[2]), unit: (num[3] || '').replace(/^[fFdD]$/, ''),
        group: section || scope, note: (num[4] || '').trim(), file, line: n + 1
      });
      continue;
    }
    const f = SWIFT_FONT.exec(line);
    if (f) { fonts.push({ name: f[1], size: Number(f[2]), weight: f[3] || 'regular', design: f[4] || '', group: scope, file, line: n + 1 }); continue; }
    const k = KT_STYLE.exec(line);
    if (k) {
      const block = lines.slice(n, n + 8).join(' ');
      const size = /fontSize\s*=\s*([\d.]+)\.sp/.exec(block);
      const weight = /FontWeight\.(\w+)/.exec(block);
      if (size) fonts.push({ name: k[1], size: Number(size[1]), weight: (weight ? weight[1] : 'Normal').toLowerCase(), design: '', group: scope, file, line: n + 1 });
    }
  }
  return { constants, fonts, refs };
}

// ── asset catalogue colours ──────────────────────────────────────────────────

function readColorset(dir) {
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(dir, 'Contents.json'), 'utf8'));
    const out = { name: path.basename(dir, '.colorset'), light: '', dark: '' };
    const channel = v => {
      const n = String(v).startsWith('0x') ? parseInt(v, 16) : Number(v);
      return Math.round(n <= 1 && !String(v).startsWith('0x') && String(v).includes('.') ? n * 255 : n);
    };
    for (const c of doc.colors || []) {
      const comp = c.color && c.color.components;
      if (!comp) continue;
      const to = n => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
      const hex = ('#' + to(channel(comp.red)) + to(channel(comp.green)) + to(channel(comp.blue))).toUpperCase();
      const dark = (c.appearances || []).some(a => a.value === 'dark');
      if (dark) out.dark = hex; else if (!out.light) out.light = hex;
    }
    return out.light || out.dark ? out : null;
  } catch (_) { return null; }
}

// ── the whole read ───────────────────────────────────────────────────────────

export function readNativeTokens(root) {
  const { code, sets } = walk(root);
  if (!code.length && !sets.length) return null;

  const roles = [];
  const scales = [];
  const others = [];
  const constants = [];
  const fonts = [];
  const refs = [];
  const files = [];

  for (const file of code.slice(0, MOST_FILES)) {
    let text;
    try { if (fs.statSync(file).size > MOST_BYTES) continue; text = fs.readFileSync(file, 'utf8'); } catch (_) { continue; }
    const rel = path.relative(root, file);
    let used = false;

    const tree = readTree(text);
    for (const p of tree.pairs) {
      const light = valueOf(p.light, tree.leaves);
      const dark = valueOf(p.dark, tree.leaves);
      if (light && dark) {
        // Where the pair points, for a name that says what it is made of.
        const lref = tree.leaves.get(p.light);
        const dref = tree.leaves.get(p.dark);
        roles.push({
          name: p.path, light, dark, file: rel,
          from: lref && lref.ref && dref && dref.ref ? `${lref.ref} / ${dref.ref}` : ''
        });
        used = true;
      }
    }
    for (const s of tree.scales) {
      const levels = s.levels.map(l => valueOf(l, tree.leaves)).filter(Boolean);
      if (levels.length >= 6) { scales.push({ name: s.path, levels, file: rel }); used = true; }
    }
    // A colour written on its own, which is not part of any of the above.
    const inside = new Set([...tree.pairs.flatMap(p => [p.light, p.dark]), ...tree.scales.flatMap(s => s.levels)]);
    for (const [leafPath, leaf] of tree.leaves) {
      if (!leaf.hex || inside.has(leafPath)) continue;
      if (/\.(light|dark)\./.test(leafPath) || /\.level\d+$/.test(leafPath)) continue;
      others.push({ name: leafPath, hex: leaf.hex, file: rel });
      used = true;
    }

    // Plain values are a token only in a file that is named like one. A component's own
    // `height = 200` is a decision about that component and not part of the system.
    if (WHERE.test(path.basename(file))) {
      const lines = readLines(text, rel);
      if (lines.constants.length || lines.fonts.length || lines.refs.length) used = true;
      constants.push(...lines.constants);
      fonts.push(...lines.fonts);
      refs.push(...lines.refs);
    }
    if (used) files.push({ file: rel, at: Math.round(fs.statSync(file).mtimeMs) });
  }

  const byName = new Map(constants.map(c => [c.name, c]));
  for (const r of refs) {
    const target = byName.get(r.to);
    if (target) constants.push({ name: r.name, value: target.value, unit: target.unit, group: r.group, note: `= ${r.to}`, file: r.file, line: r.line });
  }

  const colorsets = sets.map(readColorset).filter(Boolean);
  for (const s of sets) {
    try { files.push({ file: path.relative(root, path.join(s, 'Contents.json')), at: Math.round(fs.statSync(path.join(s, 'Contents.json')).mtimeMs) }); } catch (_) {}
  }

  if (!roles.length && !scales.length && !constants.length && !fonts.length && !colorsets.length) return null;
  return { roles, scales, others, constants, fonts, colorsets, files };
}

// The same in words and numbers an agent reads once, as little of it as will do.
export function nativeTokenLines(n) {
  const L = [];
  const label = { px: '' };
  if (n.roles.length) {
    L.push('Colour roles, light / dark (resolved to hex):');
    L.push('');
    L.push('```');
    for (const r of n.roles.slice(0, 60)) L.push(`${r.name.replace(/^[A-Z]\w*\./, '').padEnd(24)} ${r.light}  ${r.dark}${r.from ? `   ${r.from}` : ''}`);
    L.push('```');
    L.push('');
  }
  if (n.scales.length) {
    L.push('Colour scales, level 1 to the last (light and dark are separate scales, not one inverted):');
    L.push('');
    L.push('```');
    // The tonal levels. Anything past the thirteenth is an extended slot the code names itself.
    for (const s of n.scales.slice(0, 30)) L.push(`${s.name.replace(/^[A-Z]\w*\./, '')}: ${s.levels.slice(0, 13).map(h => h.replace('#', '')).join(' ')}`);
    L.push('```');
    L.push('');
  }
  const singles = n.others.filter(o => !/\.#\d+$/.test(o.name)).slice(0, 14);
  if (singles.length) {
    L.push(`Other colours: ${singles.map(o => `${o.name.replace(/^[A-Z]\w*\./, '')} ${o.hex}`).join(', ')}.`);
    L.push('');
  }
  if (n.colorsets.length) {
    L.push(`Asset catalogue colours: ${n.colorsets.map(c => `${c.name} ${c.light || '-'}${c.dark ? ' / ' + c.dark : ''}`).join(', ')}.`);
    L.push('');
  }
  if (n.fonts.length) {
    L.push('Type, as the code sets it:');
    L.push('');
    L.push('```');
    for (const f of n.fonts.slice(0, 40)) L.push(`${f.name.padEnd(16)} ${f.size}${f.design ? ' ' + f.design : ''} ${f.weight}`);
    L.push('```');
    L.push('');
  }
  // What looks like a size, a space, a curve or a timing. A design system file also holds
  // timeouts, retry counts and page sizes, which are not anything to draw.
  const VISUAL = /(space|spacing|gap|margin|padding|inset|radius|radii|corner|size|width|height|stroke|hairline|border|opacity|elevation|shadow|blur|duration|delay|stiffness|damping|tracking|icon|avatar|layout|slot|card|screen|sheet|tile|glyph|dot|ring|bar|pill)/i;
  const drawn = n.constants.filter(c => !/^(int|bumped)$/.test(c.name) && !/PAGE_SIZE|TIMEOUT|RETR|ATTEMPT|DAYS|MB$/i.test(c.name)
    && !(c.value === 0 && !/opacity|offset|inset|padding/i.test(c.name)) && VISUAL.test(`${c.group} ${c.name}`));
  if (drawn.length) {
    // Grouped under the heading the code gave them, one line a group.
    // A group of the same name in two files (the phone's Spacing and the watch's) is two
    // groups, told apart by the file.
    const filesOf = new Map();
    for (const c of drawn) {
      const g = c.group || 'Values';
      if (!filesOf.has(g)) filesOf.set(g, new Set());
      filesOf.get(g).add(c.file);
    }
    const by = new Map();
    for (const c of drawn) {
      const g = c.group || 'Values';
      const key = filesOf.get(g).size > 1 ? `${g} [${path.basename(c.file).replace(/\.\w+$/, '')}]` : g;
      if (!by.has(key)) by.set(key, []);
      by.get(key).push(c);
    }
    L.push('Sizes and other values, as written (dp and pt are the same number on the board):');
    L.push('');
    L.push('```');
    let shown = 0;
    for (const [group, list] of by) {
      if (shown++ > 14) break;
      const tag = group.includes('[') ? '' : ` (${path.basename(list[0].file)})`;
      L.push(`${group}${tag}: ${list.slice(0, 24).map(c => `${c.name}=${c.value}${c.unit}`).join(' ')}`);
    }
    L.push('```');
    L.push('');
  }
  return L;
}
