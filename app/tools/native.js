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
    // A nested object's name is not always capitalised. `object groupF { const val brand1 }`
    // is where an app keeps its brand hexes, and holding out for a capital put `brand1` in
    // its parent's scope, so a name pointing at `SakhiColors.groupF.brand1` found nothing.
    if ((t === 'object' || t === 'struct' || t === 'enum' || t === 'class') && toks[i + 1] && /^[A-Za-z_]\w*$/.test(toks[i + 1].t)) {
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

// ── the modes an app can open in ─────────────────────────────────────────────
//
// A native app often opens on different screens depending on a flag or a missing key: a
// catalogue when the backend is not configured, onboarding when nobody is signed in, a demo
// when a launch argument says so. Which of them a person is looking at when they say "the
// app" is the first thing to settle, and it is written in the code as a condition on a
// launch argument, an environment variable or a build setting. So those are listed with
// where they are read, and what the screen is called is for whoever reads that line.

function walkSwift(root) {
  const out = [];
  let seen = 0;
  const visit = (dir, depth) => {
    if (depth > 12 || seen > MOST_WALK) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      seen++;
      if (e.isDirectory()) {
        if (SKIP.has(e.name) || e.name.startsWith('.') || /Tests?$/.test(e.name) || /^(build-logic|buildSrc|bin|gradle)$/.test(e.name)) continue;
        visit(path.join(dir, e.name), depth + 1);
      } else if (/\.(swift|kt)$/.test(e.name)) out.push(path.join(dir, e.name));
    }
  };
  visit(root, 0);
  return out;
}

const FLAG = [
  /arguments\.contains\(\s*"([A-Za-z0-9_\-]+)"\s*\)/g,
  /environment\[\s*"([A-Za-z0-9_]+)"\s*\]/g,
  /getenv\(\s*"([A-Za-z0-9_]+)"\s*\)/g,
  /launchArgument\s*=\s*"([A-Za-z0-9_\-]+)"/g
];

export function readModes(root) {
  const flags = new Map();
  for (const file of walkSwift(root).slice(0, 4000)) {
    let text;
    try { if (fs.statSync(file).size > MOST_BYTES) continue; text = fs.readFileSync(file, 'utf8'); } catch (_) { continue; }
    if (!/arguments|environment|getenv|launchArgument/.test(text)) continue;
    const rel = path.relative(root, file);
    for (const re of FLAG) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        const name = m[1];
        // Test plumbing and Apple's own switches are not modes of the app.
        if (/^(UI_TESTING|-AppleLanguages|-AppleLocale|PATH|HOME|USER|TMPDIR)$/.test(name) || name.startsWith('-Apple')) continue;
        const line = text.slice(0, m.index).split('\n').length;
        if (!flags.has(name)) flags.set(name, `${rel}:${line}`);
      }
    }
  }
  return [...flags].map(([name, at]) => ({ name, at }));
}

// ── the whole read ───────────────────────────────────────────────────────────

// A shared module beside the app rather than inside it.
//
// A Kotlin Multiplatform product is often laid out as `01-iOS` and `00-Shared` side by side,
// each its own repo. The colours and the spacing are then in the shared one, and a read of the
// app alone finds the type and nothing else. So a sibling that is plainly the shared module is
// read too, and only that: nothing else outside the project is touched.
const SHARED = /^(00-shared|shared|core|common|kmm|kmp)$/i;

function siblings(root) {
  const up = path.dirname(root);
  if (up === root) return [];
  let names;
  try { names = fs.readdirSync(up, { withFileTypes: true }); } catch (_) { return []; }
  return names
    .filter(e => e.isDirectory() && SHARED.test(e.name) && path.join(up, e.name) !== root)
    .map(e => path.join(up, e.name));
}

// ── the app's own chrome, which is not one of its palettes ───────────────────
//
// An app whose palette changes still has one set of colours that does not: the brand, the
// page it is drawn on, the colour of a card. In a Kotlin Multiplatform product those live
// in an object of their own beside the palettes, written as plain constants or as names
// that point into a hue group:
//
//   object SakhiUIColors {
//     val BRAND_PINK             get() = SakhiColors.groupF.brand1
//     const val BRAND_BG_DARK         = "#000000"
//   }
//
// The tree reader does not see these, because `val NAME get() = ...` does not have its
// value where `val NAME = ...` does, and because a lone constant in a group is not a pair.
// Missing them is what made every settings screen in Sakhi come out in the menstrual pink
// rather than in the brand pink the app really draws: the phase palette was the only thing
// the board had, so it was used for everything.
//
// A name ending `_LIGHT` or `_DARK` is one half of a pair and is joined back up with the
// other, so `BRAND_BG_LIGHT` and `BRAND_BG_DARK` come out as one `BRAND_BG`.
const BRAND_OBJECT = /\b(?:object|enum|struct)\s+(\w*(?:UIColors|BrandColors|BrandTokens|UITokens)\w*)\b/;
const BRAND_CONST = /(?:const\s+)?val\s+([A-Z][A-Z0-9_]*)\s*(?:get\(\)\s*)?=\s*("#[0-9A-Fa-f]{3,8}"|[A-Za-z_][\w.]*)/g;

// A colour the design system computes rather than stores.
//
// `readableSecondaryLabel` is the label at 62% in light and 68% in dark, and it is written
// as a computed property with no `=` in it, so the tree parser above never sees it:
//
//     static var readableSecondaryLabel: Color {
//         Color(UIColor { $0.userInterfaceStyle == .dark
//             ? UIColor.white.withAlphaComponent(0.68)
//             : UIColor.black.withAlphaComponent(0.62) })
//     }
//
// That shape is the standard SwiftUI way to write one colour for both schemes, and a page
// that cannot read it mixes the percentage by hand, which is right on white and wrong on
// everything else. The ternary names the dark branch first, so the first value read is the
// dark one.
const COMPUTED_COLOR = /static\s+var\s+(\w+)\s*:\s*Color\s*\{/g;
const ALPHA_OF = /UIColor\.(white|black)\.withAlphaComponent\(\s*([0-9.]+)\s*\)/g;

function readComputed(text) {
  const out = [];
  let m;
  COMPUTED_COLOR.lastIndex = 0;
  while ((m = COMPUTED_COLOR.exec(text))) {
    // To the brace that closes this property and no further. A property written on one line
    // has no newline before its `}`, so a regex ending at one ran on into the next property
    // and gave `quaternaryLabel` the values of the card fill below it.
    let depth = 0, end = -1;
    for (let i = m.index + m[0].length - 1; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) continue;
    const body = text.slice(m.index + m[0].length, end);
    COMPUTED_COLOR.lastIndex = end;
    const halves = [];
    ALPHA_OF.lastIndex = 0;
    let a;
    while ((a = ALPHA_OF.exec(body))) halves.push(`rgba(${a[1] === 'white' ? '255, 255, 255' : '0, 0, 0'}, ${a[2]})`);
    if (!halves.length) continue;
    // The ternary names the dark branch first, so the first value read is the dark one.
    const darkFirst = /userInterfaceStyle\s*==\s*\.dark/.test(body);
    // A two-branch colour with only one alpha in it has a branch written some other way:
    // `profileCardBackground` is `systemBackground` in light and white at 6% in dark, and
    // taking the 6% for both would paint a white card grey. Half a colour is not a colour.
    if (darkFirst && halves.length < 2) continue;
    const dark = halves.length > 1 ? (darkFirst ? halves[0] : halves[1]) : halves[0];
    const light = halves.length > 1 ? (darkFirst ? halves[1] : halves[0]) : halves[0];
    out.push({ name: name_of(m[1]), light, dark });
  }
  return out;
}

const name_of = n => n.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();

// How tall this project draws its main button.
//
// `IOSButton` at large is 50, which is iOS's own, and an app that has decided otherwise is
// not using iOS's: `DS.Buttons.Primary` is `.frame(height: 56)`. Twenty-four pages were
// each writing `--db-ios-btn-large: 56px` on their footer to say so, which is the project's
// design system being retyped on every page instead of read once.
function readButtonHeight(text) {
  const at = /\bstruct\s+Primary\b/.exec(text);
  if (!at) return 0;
  const body = text.slice(at.index, at.index + 1600);
  const h = /\.frame\(\s*height:\s*(\d+(?:\.\d+)?)\s*\)/.exec(body);
  return h ? Number(h[1]) : 0;
}

function readBrand(text, leaves, scope) {
  const found = BRAND_OBJECT.exec(text);
  if (!found) return [];
  // Only the body of that object, so a constant somewhere else in the file is not swept up.
  const from = text.indexOf(found[0]);
  let depth = 0, end = text.length, started = false;
  for (let i = from; i < text.length; i++) {
    if (text[i] === '{') { depth++; started = true; }
    else if (text[i] === '}') { depth--; if (started && depth === 0) { end = i; break; } }
  }
  const body = bare(text.slice(from, end));

  const raw = new Map();
  let m;
  BRAND_CONST.lastIndex = 0;
  while ((m = BRAND_CONST.exec(body))) {
    const [, name, value] = m;
    // `SakhiColors.groupF.brand1` is a whole path into the tree, so it is looked up whole
    // first and then with its leading parts dropped one at a time, which is how the same
    // name is found when the object it names is the one being read.
    let hex = '';
    if (value.startsWith('"')) hex = hexOf(value);   // hexOf wants the quotes on
    else {
      const parts = value.split('.');
      for (let n = 0; n < parts.length && !hex; n++) {
        const leaf = leaves.get(parts.slice(n).join('.'));
        if (leaf) hex = leaf.hex || follow(leaf.ref, leaf.scope, leaves);
      }
      if (!hex) hex = follow(parts[parts.length - 1], scope, leaves);
    }
    if (hex) raw.set(name, hex);
  }

  // `X_LIGHT` and `X_DARK` are one colour written twice; anything else is the same in both.
  const out = new Map();
  for (const [name, hex] of raw) {
    const half = /^(.*)_(LIGHT|DARK)$/.exec(name);
    const key = half ? half[1] : name;
    const which = half ? half[2].toLowerCase() : 'both';
    const row = out.get(key) || { name: key };
    if (which === 'both') { row.light = hex; row.dark = hex; }
    else row[which] = hex;
    out.set(key, row);
  }
  return [...out.values()]
    .map(r => ({ name: r.name, light: r.light || r.dark, dark: r.dark || r.light }))
    .filter(r => r.light);
}

export function readNativeTokens(root) {
  const { code, sets } = walk(root);
  for (const near of siblings(root)) {
    const more = walk(near);
    code.push(...more.code);
    sets.push(...more.sets);
  }
  if (!code.length && !sets.length) return null;

  const roles = [];
  const brand = [];
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
    for (const b of readBrand(text, tree.leaves, '')) {
      if (!brand.some(x => x.name === b.name)) { brand.push({ ...b, file: rel }); used = true; }
    }
    // And one the design system works out rather than writes down.
    for (const b of readComputed(text)) {
      if (!brand.some(x => x.name === b.name)) { brand.push({ ...b, file: rel }); used = true; }
    }
    const btn = readButtonHeight(text);
    if (btn && !constants.some(c => c.name === 'PRIMARY_BUTTON_HEIGHT')) {
      constants.push({ name: 'PRIMARY_BUTTON_HEIGHT', value: btn, file: rel });
      used = true;
    }
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
  const modes = readModes(root);
  return { roles, brand, scales, others, constants, fonts, colorsets, files, modes };
}

// The same in words and numbers an agent reads once, as little of it as will do.
export function nativeTokenLines(n) {
  const L = [];
  if (n.modes && n.modes.length) {
    L.push('Modes the app opens in (launch arguments and variables it reads, and where). Which of');
    L.push('these is the default decides which screen is "the app", so read the first one before');
    L.push('drawing anything:');
    L.push('');
    L.push('```');
    for (const f of n.modes.slice(0, 24)) L.push(`${f.name.padEnd(26)} ${f.at}`);
    L.push('```');
    L.push('');
  }
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

// The project's own design system, as the variables the kit reads.
//
// The kit is written against one small set of names (`--db-primary`, `--db-space-4`), so a
// component never has to know what a project calls anything. This is the one place the two
// meet: what the code calls a role, and what the kit calls it. A role the project does not
// have is left out, and the kit's own fallback stands.
const ROLE = {
  primary: '--db-primary', onPrimary: '--db-on-primary', surface: '--db-surface',
  surfaceRaised: '--db-surface-raised', border: '--db-border', textPrimary: '--db-text',
  textSecondary: '--db-text-secondary', textMuted: '--db-text-muted', accent: '--db-accent',
  // `bgTop/bgMid/bgBot` are the gradient a phase screen is painted on, not the page colour:
  // mapping one of them onto the background made every screen a flat saturated sheet with the
  // action colour on top of itself. They stay their own variables, for a screen that wants
  // the gradient deliberately.
  secondary: '--db-secondary', ring: '--db-ring',
  chart: '--db-chart', bgTop: '--db-bg-top', bgMid: '--db-bg-mid', bgBot: '--db-bg-bot',
  gradTop: '--db-grad-top', gradBot: '--db-grad-bot',
  cardGradTop: '--db-card-grad-top', cardGradBot: '--db-card-grad-bot',
  tileFill: '--db-tile-fill', tileStroke: '--db-tile-stroke'
};
const SPACE = {
  SPACE_1: 1, SPACE_2: 2, SPACE_3: 3, SPACE_4: 4, SPACE_5: 5, SPACE_6: 6, SPACE_7: 7,
  SPACE_8: 8, SPACE_10: 10, SPACE_12: 12, SPACE_16: 16
};
const RADIUS = {
  RADIUS_SM: 'sm', RADIUS_MD: 'md', RADIUS_LG: 'lg', RADIUS_XL: 'xl', RADIUS_2XL: '2xl',
  RADIUS_FULL: 'full', RADIUS_BOTTOM_SHEET: 'bottom-sheet'
};

// Which of those constants are the app's chrome.
//
// Most of what is in such an object is a colour for one thing: a toast, a calendar day, an
// icon in one list. Those are not roles, and reading `TOAST_DARK_BG` as the app's
// background or `TOAST_SUCCESS` as its success colour is worse than not reading it at all.
// What is the chrome says so in its name, so only those are mapped.
const IS_CHROME = /^(BRAND_|PRIMARY|SECONDARY|ACCENT|BACKGROUND|SURFACE|SUCCESS|ERROR|DANGER|WARNING)/;

// What a brand constant is, by what it is called. First match wins, so the longer name
// comes before the shorter one it ends with: `BRAND_LIGHT_PINK` is a card fill, not the
// brand pink. A name that matches nothing is left alone; it is still in the read, and a
// page that wants it names the colour it found.
const BRAND_ROLE = [
  [/(CARD_?FILL|LIGHT_PINK)$/, '--db-surface-raised'],
  [/BUTTON_?FILL$/, '--db-fill'],
  [/(DEEP_\w+|SECONDARY)$/, '--db-accent'],
  [/(PRIMARY|PINK|BRAND|ACCENT)$/, '--db-primary'],
  [/(BG|BACKGROUND)$/, '--db-background'],
  [/(CONFIRM|SUCCESS)$/, '--db-success'],
  [/(ERROR|DANGER)$/, '--db-danger'],
  [/WARNING$/, '--db-warning']
];

// What the platform draws when the app does not say.
//
// An iOS app that never defines a text colour is not undecided: it is using Apple's, and
// `DS.Colors.label` is `UIColor.label`. Letting the kit's own blue-grey stand in put every
// settings screen in a navy that is nowhere in the app. These are iOS's own values, used
// only for a role the project's design system does not fill itself.
const IOS_SYSTEM = [
  ['--db-text', '#000000', '#FFFFFF'],
  ['--db-text-secondary', 'rgba(60, 60, 67, 0.6)', 'rgba(235, 235, 245, 0.6)'],
  ['--db-text-muted', 'rgba(60, 60, 67, 0.3)', 'rgba(235, 235, 245, 0.3)'],
  ['--db-border', 'rgba(60, 60, 67, 0.29)', 'rgba(84, 84, 88, 0.65)'],
  ['--db-surface', '#FFFFFF', '#1C1C1E'],
  ['--db-surface-raised', '#FFFFFF', '#2C2C2E'],
  ['--db-background', '#F2F2F7', '#000000'],
  ['--db-fill', 'rgba(120, 120, 128, 0.2)', 'rgba(120, 120, 128, 0.36)'],
  ['--db-on-primary', '#FFFFFF', '#FFFFFF'],
  // `Color(UIColor.systemRed)` is what a destructive row in a settings list is drawn in.
  ['--db-danger', '#FF3B30', '#FF453A'],
  ['--db-success', '#34C759', '#30D158'],
  ['--db-warning', '#FF9500', '#FF9F0A'],
  // The greys a list and a sheet are built out of.
  ['--db-gray3', '#C7C7CC', '#48484A'],
  // `opaqueSeparator`, for a rule that has to be seen over a tint where `separator`, which
  // is translucent, reads as almost nothing.
  ['--db-border-opaque', '#C6C6C8', '#38383A'],
  ['--db-gray5', '#E5E5EA', '#2C2C2E'],
  ['--db-gray6', '#F2F2F7', '#1C1C1E'],
  // What is behind a sheet, which a frame has to draw because the frame is one screen and
  // the app under it is another.
  ['--db-scrim', 'rgba(0, 0, 0, 0.4)', 'rgba(0, 0, 0, 0.48)'],
  // SwiftUI's named colours, for a view that reaches for `.teal` or `.indigo` rather than
  // for anything of the app's own. A notification's category icon is one of these.
  ['--db-ios-red', '#FF3B30', '#FF453A'],
  ['--db-ios-orange', '#FF9500', '#FF9F0A'],
  ['--db-ios-yellow', '#FFCC00', '#FFD60A'],
  ['--db-ios-green', '#34C759', '#30D158'],
  ['--db-ios-mint', '#00C7BE', '#63E6E2'],
  ['--db-ios-teal', '#30B0C7', '#40C8E0'],
  ['--db-ios-cyan', '#32ADE6', '#64D2FF'],
  ['--db-ios-blue', '#007AFF', '#0A84FF'],
  ['--db-ios-indigo', '#5856D6', '#5E5CE6'],
  ['--db-ios-purple', '#AF52DE', '#BF5AF2'],
  ['--db-ios-pink', '#FF2D55', '#FF375F'],
  ['--db-ios-brown', '#A2845E', '#AC8E68']
];

// The faces the app itself ships.
//
// `--db-font` fell back to the system face, so every page on a Sakhi board was drawn in SF
// Pro while the app is Lato everywhere: the letterfit and the line breaks were a little
// wrong on all seventy-six of them. The app's own `.ttf` files are in its resources, so the
// board draws in them rather than guessing.
//
// They are referenced through Vite's `/@fs/`, which is how the board already reaches every
// other file in the project, so neither server needs a route of its own. And by URL rather
// than inlined: three Lato faces are 1.9 MB, and base64 of that in every page's stylesheet
// costs more than it buys. The renderer waits on `document.fonts.ready` before it takes the
// picture, so a URL is in time.
const FONT_FILE = /\.(ttf|otf|woff2?)$/i;
const WEIGHT = [
  [/thin|hairline/i, 100], [/extra-?light|ultra-?light/i, 200], [/light/i, 300],
  [/regular|normal|book/i, 400], [/medium/i, 500], [/semi-?bold|demi-?bold/i, 600],
  [/extra-?bold|ultra-?bold/i, 800], [/black|heavy/i, 900], [/bold/i, 700]
];

export function readFontFiles(root) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 5 || out.length > 24) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
        walk(path.join(dir, e.name), depth + 1);
        continue;
      }
      if (!FONT_FILE.test(e.name)) continue;
      const stem = e.name.replace(FONT_FILE, '');
      // `Lato-Bold` is the Lato family at 700. A name with no style part is the regular.
      const cut = stem.indexOf('-');
      const family = (cut > 0 ? stem.slice(0, cut) : stem).replace(/([a-z])([A-Z])/g, '$1 $2');
      const style = cut > 0 ? stem.slice(cut + 1) : '';
      const hit = WEIGHT.find(([re]) => re.test(style));
      out.push({
        family,
        weight: hit ? hit[1] : 400,
        italic: /italic|oblique/i.test(style),
        file: path.join(dir, e.name),
        name: e.name
      });
    }
  };
  walk(root, 0);
  // One file per family, weight and slant: an app and its watch extension ship the same
  // three faces, and declaring each twice only makes the browser fetch it twice.
  const seen = new Set();
  return out.filter(f => {
    const key = `${f.family}/${f.weight}/${f.italic}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function fontCss(fonts) {
  if (!fonts || !fonts.length) return '';
  const faces = fonts.map(f => [
    '@font-face {',
    `  font-family: '${f.family}';`,
    `  font-weight: ${f.weight};`,
    `  font-style: ${f.italic ? 'italic' : 'normal'};`,
    '  font-display: block;',
    `  src: url('/@fs${f.file.split(path.sep).map(encodeURIComponent).join('/')}');`,
    '}'
  ].join('\n'));
  // The family with the most faces is the one the app is written in.
  const count = new Map();
  for (const f of fonts) count.set(f.family, (count.get(f.family) || 0) + 1);
  const main = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
  faces.push(`:root { --db-font: '${main}', -apple-system, BlinkMacSystemFont, sans-serif; }`);
  return faces.join('\n');
}

export function tokenCss(native) {
  if (!native) return '';
  const light = [];
  const dark = [];
  const extra = [];
  // The role is the last word of its path: `theme.primary` and `menstrual.primary` are both
  // the primary of something.
  const role = r => r.name.split('.').pop();
  // What it is the primary OF. An app whose whole palette changes with something, which for
  // one of these is the phase of a cycle, has several of these; most have one.
  const bundle = r => (r.name.split('.').slice(-2)[0] || '').replace(/^[A-Z]\w*$/, '');

  const bundles = [...new Set((native.roles || []).map(bundle).filter(Boolean))];
  const first = bundles[0] || '';

  // An app whose palette changes is tinting, not rebuilding its chrome.
  //
  // A palette per phase of a cycle gives `surface` and `textPrimary` for each one, and those
  // are the tinted surface of that phase, not the white of a card or the near black of a
  // label. Letting them through made every card in the kit that colour and a page of settings
  // came out pink on pink. So where there are several palettes only the tints are taken, and
  // the chrome keeps the kit's own neutrals. An app with one theme has no such problem and
  // everything is taken as it is written.
  const TINT_ONLY = /^(--db-primary|--db-secondary|--db-accent|--db-ring|--db-chart|--db-bg-|--db-grad-|--db-card-grad-|--db-tile-)/;
  const changes = bundles.length > 1;

  // The app's own chrome comes first, so a palette cannot write over it.
  //
  // An app that has both a brand and a set of palettes draws most of itself in the brand:
  // settings, onboarding, every list. Only the screens that are about the cycle are painted
  // in a palette, and those say which one. So the brand holds `:root` and a palette reaches
  // a page only through `Screen`'s `palette`. Before this the first palette held `:root`,
  // and every screen in Sakhi that is not Home came out in the menstrual pink instead of
  // the brand pink, which is a different colour.
  const branded = new Set();
  for (const b of native.brand || []) {
    // Every one of them by its own name, whether it is a role or not. Most are a colour
    // for one thing, and a screen that draws that thing should name it rather than write
    // its hex: `var(--db-brand-period-red)` is the calendar's period day, and it stays
    // right when the app changes it.
    const own = '--db-brand-' + b.name.replace(/^BRAND_/, '').toLowerCase().replace(/_/g, '-');
    light.push(`  ${own}: ${b.light};`);
    dark.push(`  ${own}: ${b.dark};`);

    if (!IS_CHROME.test(b.name)) continue;
    const hit = BRAND_ROLE.find(([re]) => re.test(b.name));
    if (!hit || branded.has(hit[1])) continue;
    branded.add(hit[1]);
    light.push(`  ${hit[1]}: ${b.light};`);
    dark.push(`  ${hit[1]}: ${b.dark};`);
  }
  const hasBrand = branded.size > 0;

  // The chrome of a palette, under a name of its own.
  //
  // Holding `surface` and `textPrimary` back keeps a page of settings from coming out pink
  // on pink, but a screen the app really does paint in the palette, like a home screen on a
  // period day, needs the tinted surface the app uses there. Taking the nearest tint instead
  // is a card in the wrong colour. So the held-back roles are published beside the kit's
  // neutrals as `--db-tinted-*`, and a screen that is painted asks for those by name.
  const tinted = key => key.replace('--db-', '--db-tinted-');

  for (const r of native.roles || []) {
    const key = ROLE[role(r)];
    if (!key) continue;
    const which = bundle(r);
    const chrome = changes && !TINT_ONLY.test(key);
    // One palette, or the first of several: that is what a screen gets unless it asks. An
    // app with a brand of its own is the exception: there `:root` is the brand, and a
    // palette is only ever what a screen asks for by name.
    if ((!which || which === first) && !(hasBrand && which)) {
      const name = chrome ? tinted(key) : key;
      light.push(`  ${name}: ${r.light};`);
      dark.push(`  ${name}: ${r.dark};`);
    }
    // The first palette is still published under the tinted names, so a screen the app
    // paints without naming a phase, which is the phase it opens on, has them.
    if (hasBrand && which === first && chrome) {
      light.push(`  ${tinted(key)}: ${r.light};`);
      dark.push(`  ${tinted(key)}: ${r.dark};`);
    }
    // Every palette is also there by name, so a screen can show the app as it looks in any
    // of them by setting one attribute rather than by writing other colours.
    if (which) extra.push({ which, key: chrome ? tinted(key) : key, light: r.light, dark: r.dark });
    // And every palette's roles are at the root under their own names, because one screen
    // can only be in one palette at a time but some screens draw all of them at once: the
    // ring on the empty home screen is the four phases side by side, and it had the four
    // hexes written into its own stylesheet because there was no other way to name them.
    if (which) {
      const own = `--db-${which.replace(/_/g, '-').toLowerCase()}-${role(r).replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`;
      light.push(`  ${own}: ${r.light};`);
      dark.push(`  ${own}: ${r.dark};`);
    }
  }
  // A status colour is rarely a named role, but every design system has the scale. Level 5 is
  // the one a filled control uses, which is what these are for.
  for (const [hue, key] of [['success', '--db-success'], ['warning', '--db-warning'], ['danger', '--db-danger']]) {
    const l = (native.scales || []).find(s => new RegExp(`${hue}\\.light$`).test(s.name));
    const d = (native.scales || []).find(s => new RegExp(`${hue}\\.dark$`).test(s.name));
    if (l && l.levels[4]) light.push(`  ${key}: ${l.levels[4]};`);
    if (d && d.levels[5]) dark.push(`  ${key}: ${d.levels[5]};`);
  }

  const seen = new Set();
  for (const c of native.constants || []) {
    const step = SPACE[c.name];
    if (step && !seen.has('s' + step)) { seen.add('s' + step); light.push(`  --db-space-${step}: ${c.value}px;`); }
    const radius = RADIUS[c.name];
    if (radius && !seen.has('r' + radius)) { seen.add('r' + radius); light.push(`  --db-radius-${radius}: ${c.value}px;`); }
    if (/^(SCREEN_HORIZONTAL|screenHorizontal)$/.test(c.name) && !seen.has('x')) { seen.add('x'); light.push(`  --db-screen-x: ${c.value}px;`); }
    if (c.name === 'PRIMARY_BUTTON_HEIGHT' && !seen.has('btn')) { seen.add('btn'); light.push(`  --db-ios-btn-large: ${c.value}px;`); }
  }

  // Whatever neither the brand nor the design system filled is the platform's own.
  if (light.length || dark.length) {
    const written = new Set(light.map(l => l.trim().split(':')[0]));
    const swift = (native.files || []).some(f => /\.swift$/.test(f.file || f));
    if (swift) {
      for (const [key, l, d] of IOS_SYSTEM) {
        if (written.has(key)) continue;
        light.push(`  ${key}: ${l};`);
        dark.push(`  ${key}: ${d};`);
      }
    }
  }

  if (!light.length && !dark.length) return '';
  const out = [`:root {`, ...light, `}`];
  if (dark.length) out.push(`:root[data-scheme="dark"] {`, ...dark, `}`);
  if (bundles.length > 1) {
    for (const which of bundles) {
      const mine = extra.filter(e => e.which === which);
      if (!mine.length) continue;
      out.push(`:root[data-phase="${which}"] {`, ...mine.map(e => `  ${e.key}: ${e.light};`), `}`);
      out.push(`:root[data-phase="${which}"][data-scheme="dark"] {`, ...mine.map(e => `  ${e.key}: ${e.dark};`), `}`);
    }
  }
  return out.join('\n');
}
