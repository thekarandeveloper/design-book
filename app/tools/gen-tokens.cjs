// tokens.css, generated from the Kotlin that both apps already read.
//
// DesignTokens.kt and ColorSystem.kt are the source of truth for spacing, radii and
// colour on iOS and Android. An HTML mock is only worth drawing if it uses the same
// numbers, so they are parsed rather than copied: a hand-written tokens.css would drift
// within a week and the mock would start lying.

const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['build', 'node_modules', '.git', '.gradle', 'DerivedData', 'Pods', '.build']);

function findDesignTokensKt(roots) {
  for (const root of roots) {
    const hit = walkFor(root, 'DesignTokens.kt', 0);
    if (hit) return hit;
  }
  // The kit sits beside the products, so look one level up from each root too.
  for (const root of roots) {
    const hit = walkFor(path.dirname(root), 'DesignTokens.kt', 0);
    if (hit) return hit;
  }
  return null;
}

function walkFor(dir, filename, depth) {
  if (depth > 9) return null;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return null; }
  for (const e of entries) {
    if (e.isFile() && e.name === filename) return path.join(dir, e.name);
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const hit = walkFor(path.join(dir, e.name), filename, depth + 1);
    if (hit) return hit;
  }
  return null;
}

const kebab = name => name.toLowerCase().replace(/_/g, '-');

// ── DesignTokens.kt ───────────────────────────────────────────────────────

function parseTokens(text) {
  const out = [];
  const re = /const\s+val\s+([A-Z0-9_]+)\s*=\s*(-?[\d.]+)f?/g;
  let m;
  while ((m = re.exec(text))) out.push({ name: m[1], value: Number(m[2]) });
  return out;
}

function unitFor(name) {
  if (/OPACITY/.test(name)) return '';
  if (/TRACKING/.test(name)) return 'em';
  return 'px';
}

function tokenSections(tokens) {
  const bucket = {
    'Spacing grid': t => /^SPACE_/.test(t.name),
    'Layout slots': t => /^(SCREEN|CARD|BETWEEN|TITLE_TO|SUBTITLE_TO|CONTENT_TO|PANEL|ICON_TO|SECTION)/.test(t.name),
    'Radii': t => /^RADIUS_/.test(t.name),
    'Plate': t => /^(PLATE_|HAIRLINE|LABEL_TRACKING)/.test(t.name),
    'Opacity': t => /^OPACITY_/.test(t.name),
    'Elevation': t => /^ELEVATION_/.test(t.name)
  };
  const used = new Set();
  const sections = [];
  for (const [title, test] of Object.entries(bucket)) {
    const rows = tokens.filter(t => !used.has(t.name) && test(t));
    rows.forEach(t => used.add(t.name));
    if (rows.length) sections.push({ title, rows });
  }
  const rest = tokens.filter(t => !used.has(t.name));
  if (rest.length) sections.push({ title: 'Other', rows: rest });
  return sections;
}

// ── ColorSystem.kt ────────────────────────────────────────────────────────

// Groups are read line by line rather than with one big regex, because the file nests
// `ColorScale(` inside `ColorGroup(` and puts four levels on a line.
function parseColors(text) {
  const groups = {};
  const theme = {};
  let group = null;
  let scale = null;
  let inTheme = false;

  for (const line of text.split(/\r?\n/)) {
    const g = line.match(/val\s+(\w+)\s*=\s*ColorGroup\s*\(/);
    if (g) { group = g[1]; groups[group] = { light: {}, dark: {} }; scale = null; inTheme = false; continue; }

    if (/val\s+theme\s*=\s*ThemeColorBundle\s*\(/.test(line)) { inTheme = true; group = null; continue; }

    if (group) {
      if (/\blight\s*=\s*ColorScale\s*\(/.test(line)) { scale = 'light'; }
      else if (/\bdark\s*=\s*ColorScale\s*\(/.test(line)) { scale = 'dark'; }
      if (scale) {
        const re = /level(\d+)\s*=\s*"(#[0-9A-Fa-f]{3,8})"/g;
        let m;
        while ((m = re.exec(line))) groups[group][scale][Number(m[1])] = m[2];
      }
      if (/^\s*\)\s*$/.test(line)) { group = null; scale = null; }
      continue;
    }

    if (inTheme) {
      if (/^\s*\)\s*$/.test(line)) { inTheme = false; continue; }
      const m = line.match(/(\w+)\s*=\s*ColorPair\s*\(\s*light\s*=\s*([^,]+),\s*dark\s*=\s*([^)]+)\)/);
      if (m) theme[m[1]] = { light: m[2].trim(), dark: m[3].trim() };
    }
  }
  return { groups, theme };
}

// `brand.light.level5` becomes `var(--brand-5)`; a bare "#hex" stays a hex.
function resolveRef(ref, groups, mode) {
  const quoted = ref.match(/^"(#[0-9A-Fa-f]{3,8})"$/);
  if (quoted) return quoted[1];
  const m = ref.match(/^(\w+)\.(light|dark)\.level(\d+)$/);
  if (!m) return null;
  const [, group, , level] = m;
  if (!groups[group]) return null;
  return `var(--${kebab(group)}-${level})`;
}

// ── output ────────────────────────────────────────────────────────────────

function generateTokensCss(designTokensPath) {
  const dir = path.dirname(designTokensPath);
  const tokensText = fs.readFileSync(designTokensPath, 'utf8');
  const colorsPath = path.join(dir, 'ColorSystem.kt');
  const colorsText = fs.existsSync(colorsPath) ? fs.readFileSync(colorsPath, 'utf8') : '';

  const tokens = parseTokens(tokensText);
  if (!tokens.length) throw new Error(`no "const val NAME = <number>f" lines in ${designTokensPath}`);
  const { groups, theme } = colorsText ? parseColors(colorsText) : { groups: {}, theme: {} };

  const L = [];
  L.push('/* GENERATED by 03-Tools/canvas/gen-tokens.js. Do not edit. */');
  L.push(`/* Source: ${path.basename(designTokensPath)}${colorsText ? ' + ColorSystem.kt' : ''} */`);
  L.push('/*');
  L.push(' * These are the same numbers the iOS and Android apps read. A mock drawn with');
  L.push(' * them translates to DS.* one for one: --space-4 is DS.Spacing.m, and so on.');
  L.push(' */');
  L.push('');
  L.push(':root {');

  for (const section of tokenSections(tokens)) {
    L.push(`  /* ${section.title} */`);
    for (const t of section.rows) {
      L.push(`  --${kebab(t.name)}: ${t.value}${unitFor(t.name)};`);
    }
    L.push('');
  }

  const groupNames = Object.keys(groups);
  if (groupNames.length) {
    L.push('  /* Colour scales, light */');
    for (const g of groupNames) {
      const levels = Object.keys(groups[g].light).map(Number).sort((a, b) => a - b);
      for (const n of levels) L.push(`  --${kebab(g)}-${n}: ${groups[g].light[n]};`);
    }
    L.push('');
  }

  const themeNames = Object.keys(theme);
  if (themeNames.length) {
    L.push('  /* Semantic, light */');
    for (const name of themeNames) {
      const v = resolveRef(theme[name].light, groups, 'light');
      if (v) L.push(`  --${kebab(camelToSnake(name))}: ${v};`);
    }
  }
  L.push('}');
  L.push('');

  const darkBody = [];
  for (const g of groupNames) {
    const levels = Object.keys(groups[g].dark).map(Number).sort((a, b) => a - b);
    for (const n of levels) darkBody.push(`    --${kebab(g)}-${n}: ${groups[g].dark[n]};`);
  }
  for (const name of themeNames) {
    const v = resolveRef(theme[name].dark, groups, 'dark');
    if (v) darkBody.push(`    --${kebab(camelToSnake(name))}: ${v};`);
  }

  if (darkBody.length) {
    L.push('@media (prefers-color-scheme: dark) {');
    L.push('  :root:not([data-theme="light"]) {');
    L.push(...darkBody);
    L.push('  }');
    L.push('}');
    L.push('');
    L.push(':root[data-theme="dark"] {');
    L.push(...darkBody.map(l => l.replace(/^ {4}/, '  ')));
    L.push('}');
    L.push('');
  }

  return L.join('\n');
}

const camelToSnake = s => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2');

module.exports = { generateTokensCss, findDesignTokensKt };

// Also runnable on its own: node gen-tokens.js <DesignTokens.kt> <out.css>
if (require.main === module) {
  const [ktArg, outArg] = process.argv.slice(2);
  const kt = ktArg || findDesignTokensKt([process.cwd()]);
  if (!kt) { console.error('DesignTokens.kt not found. Pass its path.'); process.exit(1); }
  const css = generateTokensCss(kt);
  if (outArg) { fs.writeFileSync(outArg, css); console.error(`wrote ${outArg} from ${kt}`); }
  else process.stdout.write(css);
}
