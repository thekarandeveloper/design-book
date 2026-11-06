// The rules file, written from what the board is actually showing.
//
// A hand-written CLAUDE.md goes stale the first time a route is added, and a stale one
// is worse than none: it sends an agent to files that moved. So the part that describes
// the board's own file is generated between markers, from the same data the board draws from, and
// rewritten whenever anything changes. The part above the markers is yours.

import fs from 'node:fs';
import path from 'node:path';
import { nativeTokenLines } from './native.js';

const START = '<!-- canvas:generated start -->';
const END = '<!-- canvas:generated end -->';

// A line only the old preamble had, when the house rules were written here as well as
// in the skill and in the repo's own CLAUDE.md.
const RULES_USED_TO_BE_HERE = '**Take a component before you write one.**';

export function writeRules(file, body) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) {}
  // What is really on disk, kept for the comparison at the end: the text below may be
  // tidied before the new block goes into it, and tidying is a change like any other.
  const onDisk = text;

  // Three copies of one rule is two copies to keep true, and two to read. The copy that
  // sat above the markers goes, and the facts below them stay.
  if (text.includes(START) && text.slice(0, text.indexOf(START)).includes(RULES_USED_TO_BE_HERE)) {
    text = handwritten() + text.slice(text.indexOf(START));
  }

  const block = [START, body.trim(), END].join('\n');
  let next;
  if (text.includes(START) && text.includes(END)) {
    next = text.slice(0, text.indexOf(START)) + block + text.slice(text.indexOf(END) + END.length);
  } else {
    next = (text.trim() ? text.replace(/\s*$/, '') + '\n\n' : handwritten()) + block + '\n';
  }
  if (next === onDisk) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next);
  return true;
}

// Written once, when the file is first created. Everything in it is a decision rather
// than a fact, which is why it is not regenerated.
function handwritten() {
  return `# .designbook/

Everything this project's design board shows. The board itself is the \`.designbook\` file
beside this folder: open it in VS Code and the board opens.

This file is facts, not rules: what is on the board, the files behind it, and what this
project actually uses. The rules for working on it are in the repo's own \`CLAUDE.md\` and
in the \`design-book\` skill, which loads itself when there is designing to do.

`;
}

export function rulesBody({ projectRoot, live, pages, sections, refs, parts, components, styles, tokens, preview, palette, native, board }) {
  const L = [];
  L.push('## What is on this board right now');
  L.push('');
  L.push(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}. Do not edit between the`);
  L.push('markers: it is rewritten whenever the project changes, from whatever the board is');
  L.push('drawing.');
  L.push('');

  if (live && live.url) {
    L.push(`The board is showing the live project at \`${projectRoot}\`, served by`);
    L.push(`\`${live.command}\` on ${live.url}. Every frame is that project running, not a copy.`);
  } else {
    L.push(`The project is \`${projectRoot}\`. Its dev server is not running, so the board is`);
    L.push('showing only what `.designbook/pages` holds.');
  }
  L.push('');

  if (board) {
    L.push(`The board is \`${board}\`.`);
    L.push('');
  }

  if (sections && sections.length) {
    L.push(`### Sections (${sections.length})`);
    L.push('');
    L.push('Each one is a band on the board, its frames in a line in this order.');
    L.push('');
    for (const band of sections) {
      L.push(`- **${band.name}** (${band.frames.length}): ${band.frames.map(f => '`' + f + '`').join(', ') || 'empty'}`);
    }
    L.push('');
  }

  // The pieces the board has made for itself. Read this before writing a new one.
  if (parts && parts.length) {
    L.push(`### Pieces already made (${parts.length})`);
    L.push('');
    L.push('In `.designbook/parts/`. Import these rather than writing them again.');
    L.push('');
    for (const part of parts) {
      L.push(`- \`${part.file}\`${part.note ? `: ${part.note}` : ''}`);
    }
    L.push('');
  }

  // The moodboard, as words. A picture costs a lot to look at and still has to be
  // guessed at; the line written under it when it was added can be acted on.
  const said = (refs || []).filter(r => r.note || (r.tags && r.tags.length));
  if (said.length) {
    L.push(`### Moodboard (${said.length} with a decision on it)`);
    L.push('');
    L.push('Each line is a decision to follow, not a mood. The file is in `.designbook/refs/`.');
    L.push('');
    for (const r of said) {
      const tags = r.tags && r.tags.length ? ` _(${r.tags.join(', ')})_` : '';
      L.push(`- **${r.name}**${tags}: ${r.note || 'no line written yet'}`);
    }
    L.push('');
  }

  const routes = pages.filter(p => p.kind === 'live');
  if (routes.length) {
    L.push(`### Screens (${routes.length})`);
    L.push('');
    L.push('| On the board | Route | Edit this file |');
    L.push('|---|---|---|');
    for (const p of routes) {
      L.push(`| ${p.title} | \`${p.file}\` | \`${sourceOf(p, projectRoot)}\` |`);
    }
    L.push('');
  }

  const own = pages.filter(p => p.kind !== 'live');
  if (own.length) {
    L.push(`### Screens designed here (${own.length})`);
    L.push('');
    for (const p of own) L.push(`- ${p.title}: \`.designbook/${p.file}\``);
    L.push('');
  }

  if (styles && styles.length) {
    L.push('### Design system');
    L.push('');
    L.push(`Tokens come from \`${styles[0].file}\`, which declares ${styles[0].count} custom properties.`);
    if (styles.length > 1) {
      L.push(`Others: ${styles.slice(1).map(s => '`' + s.file + '`').join(', ')}.`);
    }
    L.push('');
    const colours = (tokens?.colours || []).slice(0, 24);
    if (colours.length) {
      L.push('Colour:');
      L.push('');
      L.push('```');
      for (const t of colours) L.push(`${t.name}: ${t.value}${t.scope ? `   (${t.scope})` : ''}`);
      L.push('```');
      L.push('');
    }
    const rest = [...(tokens?.lengths || []), ...(tokens?.fonts || []), ...(tokens?.other || [])].slice(0, 20);
    if (rest.length) {
      L.push('Everything else:');
      L.push('');
      L.push('```');
      for (const t of rest) L.push(`${t.name}: ${t.value}`);
      L.push('```');
      L.push('');
    }
  }

  // A native project's design system, read from its code: the colours the roles resolve
  // to in light and dark, the type, the spacing and the radii, with the names the code
  // uses. It is what an agent would otherwise read three or four files to find, and it is
  // read again whenever those files change, so it is never older than the code.
  if (native) {
    L.push('### The design system, read from its code');
    L.push('');
    L.push('Built from the Swift and Kotlin source as it is now. Use these values and these names,');
    L.push('not a colour or a size of your own. Where a role is written as `brand.light.level5` the');
    L.push('code refers to it by that name.');
    L.push('');
    L.push(...nativeTokenLines(native));
  }

  // A native project's hex strings are counted by the system above; counting them again as
  // "most used" would only offer a few of them as though they were all.
  if (palette && !(native && native.roles.length)) {
    L.push('### Everything the project already uses');
    L.push('');
    L.push(`Read from ${palette.files} files. Build experiments out of these rather than`);
    L.push('inventing new ones: an experiment is only useful if it could ship.');
    L.push('');
    if (palette.colours.length) {
      L.push(`Colour, most used first (${palette.colours.length}):`);
      L.push('');
      L.push('```');
      for (const c of palette.colours.slice(0, 16)) L.push(`${c.value}   x${c.count}`);
      L.push('```');
      L.push('');
    }
    if (palette.fonts.length) {
      L.push(`Fonts: ${palette.fonts.slice(0, 8).map(f => f.value).join(', ')}.`);
      L.push('');
    }
    if (palette.iconPacks.length) {
      L.push(`Icon packages already installed: ${palette.iconPacks.map(i => '`' + i.value + '`').join(', ')}.`);
      L.push('');
    }
    if (palette.svgFiles.length) {
      L.push(`SVG files: ${palette.svgFiles.slice(0, 12).map(f => '`' + f + '`').join(', ')}${palette.svgFiles.length > 12 ? ', and more' : ''}.`);
      L.push('');
    }
  }

  if (components && components.length) {
    L.push(`### Components (${components.length})`);
    L.push('');
    if (preview?.enabled && live?.url) {
      L.push(`Each one is previewed on the board at \`${live.url}${preview.route}<path without src/ and .astro>/\`,`);
      L.push(`rendered by \`${preview.file}\`. That file is dev only and is what the Components`);
      L.push('board draws. It is not part of the design system; do not edit it.');
      L.push('');
    }
    const byDir = new Map();
    for (const c of components) {
      if (!byDir.has(c.dir)) byDir.set(c.dir, []);
      byDir.get(c.dir).push(c.name);
    }
    for (const [dir, names] of byDir) {
      L.push(`- \`${dir}/\`: ${names.join(', ')}`);
    }
    L.push('');
  }

  L.push('### Experiments');
  L.push('');
  L.push('The board is where a thing is tried before it is built. An experiment is a');
  L.push('standalone file in `.designbook/pages/`, and it appears on the board the moment it is');
  L.push('saved:');
  L.push('');
  L.push('```html');
  L.push('<!doctype html>');
  L.push('<html><head><meta charset="utf-8"><title>Hero, wide type</title>');
  L.push('<meta name="designbook-width" content="1440">');
  L.push('<meta name="designbook-height" content="900">');
  L.push('<meta name="designbook-group" content="hero">');
  L.push('</head><body> ... </body></html>');
  L.push('```');
  L.push('');
  L.push('- One file per variation: `hero-a.html`, `hero-b.html`, `hero-c.html`. The group');
  L.push('  meta puts them side by side on the board.');
  L.push('- Use the colours and fonts above. An experiment nobody could ship is not an');
  L.push('  experiment, it is a drawing.');
  L.push('- Never change the live project to try something. That is what this folder is for.');
  L.push('- When a variation wins, then it is built in the project, in the files listed above.');

  return L.join('\n');
}

function sourceOf(page, projectRoot) {
  if (!page.sourceFile) return 'unknown';
  // sourceFile is relative to the board folder; the project is what matters here.
  const parts = page.sourceFile.split('/');
  const i = parts.lastIndexOf(path.basename(projectRoot));
  return i === -1 ? page.sourceFile : parts.slice(i + 1).join('/');
}
