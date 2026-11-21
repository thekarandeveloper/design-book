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


// What the board's own frames use, folded into the design system as one list.
//
// Karan asked for one list rather than two, so a colour that only exists on a frame sits
// with the ones the code declares. The source is on every line because of what that
// means: a value invented on a frame is now in the design system, and the next person to
// read this file cannot tell an agent's invention from the app's real token unless the
// line says so. `(board)` is the warning, and a long run of them is the thing to fix.
// Every colour the native system already resolves to, so a value the board uses is only
// called new when it really is.
function nativeHexes(native) {
  const out = [];
  for (const r of (native && native.roles) || []) {
    for (const v of Object.values(r)) {
      if (typeof v === 'string' && /^#[0-9a-fA-F]{6,8}$/.test(v)) out.push(v);
    }
  }
  return out;
}

function boardLines(boardUses, known) {
  if (!boardUses || !boardUses.colours || !boardUses.colours.length) return [];
  const seen = new Set((known || []).map(v => String(v).toLowerCase()));
  const extra = boardUses.colours.filter(c => !seen.has(String(c.value).toLowerCase()));
  if (!extra.length) return [];
  const L = [];
  for (const c of extra.slice(0, 24)) L.push(`${c.value}   x${c.count}   (board)`);
  return L;
}

export function rulesBody({ projectRoot, live, pages, sections, refs, parts, components, styles, tokens, preview, palette, native, board, boardUses }) {
  const L = [];
  // Whether the board's own colours have been folded into a design system block already.
  let boardShown = false;
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
    const fromBoard = boardLines(boardUses, (tokens?.colours || []).map(t => t.value));
    boardShown = boardShown || fromBoard.length > 0;
    if (colours.length || fromBoard.length) {
      L.push('Colour. `(code)` is declared by the project, `(board)` is used by a frame on');
      L.push('this board and is not in the project. Reach for a `(code)` value first.');
      L.push('');
      L.push('```');
      for (const t of colours) L.push(`${t.name}: ${t.value}   (code)${t.scope ? `   ${t.scope}` : ''}`);
      for (const line of fromBoard) L.push(line);
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
    L.push('**This is a native app. Build the page from its code: do not build or run the app, open a');
    L.push('simulator or take screenshots, even for an "exact replica".** The code is the reference, and');
    L.push('what follows is the code with every value resolved. A page is an `.astro` file written');
    L.push('from it, out of the kit (`@kit/base/*`, `@kit/ios/*`, `@kit/android/*`): the board');
    L.push('compiles it with its own server, so nothing has to be set up in this project.');
    L.push('');
    L.push('Built from the Swift and Kotlin source as it is now. Use these values and these names,');
    L.push('not a colour or a size of your own. Where a role is written as `brand.light.level5` the');
    L.push('code refers to it by that name.');
    L.push('');
    L.push(...nativeTokenLines(native));
    const fromBoard = boardLines(boardUses, nativeHexes(native));
    boardShown = boardShown || fromBoard.length > 0;
    if (fromBoard.length) {
      L.push('');
      L.push('And these, used by a frame on this board and declared nowhere in the code. They');
      L.push('are part of the system now because they are on a screen, which is the problem');
      L.push('with them: each one is either a value that should be named in the code, or a');
      L.push('frame that should have used a role above instead.');
      L.push('');
      L.push('```');
      L.push(...fromBoard);
      L.push('```');
    }
    if (boardUses && boardUses.fonts && boardUses.fonts.length) {
      L.push('');
      L.push(`Fonts on the board: ${boardUses.fonts.slice(0, 8).map(f => f.value).join(', ')}.`);
    }
    L.push('');
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

  // A repo with no declared design system at all: no stylesheet of custom properties and
  // no Swift or Kotlin to read. Then nothing above printed, and the only colours anybody
  // has chosen are the ones on the frames. They are the design system so far, and saying
  // nothing would be the one case where this file is silent about the thing it is for.
  if (!boardShown) {
    const only = boardLines(boardUses, []);
    if (only.length) {
      L.push('### Design system, so far');
      L.push('');
      L.push('This project declares none: no stylesheet of custom properties, no Swift or');
      L.push('Kotlin to read. So these are the colours the frames on this board have chosen,');
      L.push('most used first. Reuse them rather than adding a tenth near-black.');
      L.push('');
      L.push('```');
      L.push(...only);
      L.push('```');
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
  L.push('The board is where a thing is tried before it is built. An experiment is an `.astro`');
  L.push('file in `.designbook/pages/`, and it appears on the board the moment it is saved. The');
  L.push('board compiles it itself, in every project, native or web, so a project needs no Astro');
  L.push('of its own:');
  L.push('');
  L.push('```astro');
  L.push('---');
  L.push("import Screen from '@kit/base/Screen.astro';");
  L.push("import Text from '@kit/base/Text.astro';");
  L.push('---');
  L.push('<Screen title="Hero, wide type" width={1440} height={900} group="hero">');
  L.push('  <Text size={16}>...</Text>');
  L.push('</Screen>');
  L.push('```');
  L.push('');
  L.push('- One file per variation: `hero-a.astro`, `hero-b.astro`, `hero-c.astro`. The `group`');
  L.push('  prop puts them side by side on the board.');
  L.push('- Anything written twice becomes a part in `.designbook/parts/`, imported as');
  L.push('  `@board/parts/Name.astro`, so a set of options shares one file and differs in one prop.');
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
