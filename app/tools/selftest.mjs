// What has to be true for a board to work, checked without opening one.
//
// The slow faults here are the ones nobody sees until a board is open: a kit component that
// does not compile, a page that cannot find the kit, the project's own colours not reaching
// the page, a frame whose size the board reads wrongly out of the file. Each of those is one
// line below, and each runs in a throwaway folder, never in anybody's repo.
//
//   node tools/selftest.mjs
//
// It says what passed, what failed, and ends with how many. Anything that fails is printed
// with what was expected, because a test that only says "failed" is a test somebody has to
// rerun by hand to learn anything.

import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { AstroSource, astroMeta } from './astro.js';
import { runSetup } from './setup.js';
import { createHistory } from './history.js';
import { readNativeTokens, tokenCss } from './native.js';

const appDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let passed = 0;
let failed = 0;
const ok = (what, good, detail = '') => {
  if (good) { passed++; console.log(`  ok    ${what}`); }
  else { failed++; console.log(`  FAIL  ${what}${detail ? `\n          ${detail}` : ''}`); }
};

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'db-selftest-'));
const clean = () => { try { fs.rmSync(temp, { recursive: true, force: true }); } catch (_) {} };
process.on('exit', clean);

// ── the kit compiles ────────────────────────────────────────────────────────

console.log('\nThe kit');
const { parse } = await import('@astrojs/compiler');
let components = 0;
for (const folder of ['base', 'ios', 'android']) {
  const dir = path.join(appDir, 'astro-kit', folder);
  for (const name of fs.readdirSync(dir).filter(f => f.endsWith('.astro'))) {
    components++;
    const found = await parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    if (found.diagnostics && found.diagnostics.length) {
      ok(`${folder}/${name}`, false, JSON.stringify(found.diagnostics).slice(0, 200));
    }
  }
}
ok(`${components} components compile`, components > 20);

// Every value a component uses has to be a variable with a fallback, or a project without a
// design system gets a page of missing colours.
let bareHex = [];
for (const folder of ['base', 'ios', 'android']) {
  const dir = path.join(appDir, 'astro-kit', folder);
  for (const name of fs.readdirSync(dir).filter(f => f.endsWith('.astro'))) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    for (const line of text.split('\n')) {
      // A hex inside `var(--x, #fff)` is the fallback and is meant to be there.
      const without = line.replace(/var\([^)]*\)/g, '');
      if (/:\s*#[0-9a-fA-F]{3,8}\b/.test(without) && !/^\s*(\/\/|\*|<!--)/.test(line)) {
        bareHex.push(`${folder}/${name}: ${line.trim().slice(0, 70)}`);
      }
    }
  }
}
ok('no colour is written outside a variable', bareHex.length === 0, bareHex.slice(0, 3).join('\n          '));

// ── what a page says about its frame ────────────────────────────────────────

console.log('\nReading a page');
const pages = path.join(temp, 'board', '.designbook', 'pages');
fs.mkdirSync(pages, { recursive: true });
fs.writeFileSync(path.join(pages, '01-one.astro'), `---
import Screen from '@kit/base/Screen.astro';
import Stack from '@kit/base/Stack.astro';
import Text from '@kit/base/Text.astro';
import Card from '@kit/base/Card.astro';
import Icon from '@kit/base/Icon.astro';
import IOSNavBar from '@kit/ios/IOSNavBar.astro';
import IOSTabBar from '@kit/ios/IOSTabBar.astro';
import IOSGroupedList from '@kit/ios/IOSGroupedList.astro';
import IOSListRow from '@kit/ios/IOSListRow.astro';
import IOSButton from '@kit/ios/IOSButton.astro';
---
<Screen title="One" width={393} height={852} group="tests">
  <IOSNavBar title="One" />
  <Stack padding="16px" gap={12}>
    <Card padding="16px"><Text size={17}>A card</Text></Card>
    <IOSGroupedList header="Group"><IOSListRow title="A row" icon="gear" first last /></IOSGroupedList>
    <IOSButton label="Go" variant="filled" full />
    <Icon name="chevron.right" size={16} />
  </Stack>
  <IOSTabBar tabs={[{ icon: 'house.fill', label: 'Home', active: true }]} />
</Screen>
`);
fs.writeFileSync(path.join(pages, '02-android.astro'), `---
import Screen from '@kit/base/Screen.astro';
import AndroidTopAppBar from '@kit/android/AndroidTopAppBar.astro';
import AndroidBottomBar from '@kit/android/AndroidBottomBar.astro';
import AndroidNavBar from '@kit/android/AndroidNavBar.astro';
---
<Screen title="Two" device="android" width={360} height={800}>
  <AndroidTopAppBar title="Two" />
  <AndroidBottomBar items={[{ icon: 'home', label: 'Home', active: true }]} />
  <AndroidNavBar />
</Screen>
`);
const meta = astroMeta(path.join(pages, '01-one.astro'));
ok('a page states its frame, as the device it is in', meta.width === '474' && meta.height === '934', JSON.stringify(meta));
ok('and its group', meta.group === 'tests', JSON.stringify(meta.group));
const android = astroMeta(path.join(pages, '02-android.astro'));
ok('a device sets the frame when no size is given', android.width === '382' && android.height === '822', JSON.stringify(android));

// ── the project's own design system ─────────────────────────────────────────

console.log('\nThe project\'s own values');
const kotlin = path.join(temp, 'board', 'shared', 'design');
fs.mkdirSync(kotlin, { recursive: true });
fs.writeFileSync(path.join(kotlin, 'ColorSystem.kt'), `
object AppColors {
  val brand = ColorGroup(
    light = ColorScale(level1 = "#001122", level2 = "#112233", level3 = "#223344", level4 = "#334455",
      level5 = "#2E7BF6", level6 = "#4A8EF8", level7 = "#6BA4FA", level8 = "#8FBAFB",
      level9 = "#B3CFFC", level10 = "#CBDEFD", level11 = "#DDE9FE", level12 = "#EDF3FF", level13 = "#F7FAFF"),
    dark = ColorScale(level1 = "#000000", level2 = "#0A1222", level3 = "#0F1B33", level4 = "#152747",
      level5 = "#1C345E", level6 = "#24457A", level7 = "#2F5A9C", level8 = "#4A82D6",
      level9 = "#6FA0E4", level10 = "#94BCEE", level11 = "#B8D3F5", level12 = "#D8E7FA", level13 = "#EFF5FD")
  )
  val theme = ThemeColorBundle(
    primary = ColorPair(light = brand.light.level5, dark = brand.dark.level8),
    surface = ColorPair(light = brand.light.level13, dark = brand.dark.level2)
  )
}
`);
fs.writeFileSync(path.join(kotlin, 'DesignTokens.kt'), `
object DesignTokens {
  const val SPACE_4 = 16f
  const val SCREEN_HORIZONTAL = 24f
  const val RADIUS_XL = 16f
}
`);
const native = readNativeTokens(path.join(temp, 'board'));
ok('a colour role is followed to its hex', !!native && native.roles.some(r => r.light === '#2E7BF6'),
  native ? JSON.stringify(native.roles.slice(0, 2)) : 'nothing read');
const css = tokenCss(native);
ok('and comes out as the kit reads it', /--db-primary: #2E7BF6/.test(css), css.slice(0, 120));
ok('a size comes with it', /--db-screen-x: 24px/.test(css));

// ── setting up a board that is already set up ──────────────────────────────
//
// Running setup again is the normal case: the board is opened, the repo is read, and a
// board whose frames were all written by hand has no route to convert. That used to be
// read as "this board is empty" and earned a starter page, dropped unlisted among real
// work (KNOWN-ISSUES.md 8).

console.log('\nSetting up again');
const setupSays = () => {};
await runSetup({
  repoRoot: path.join(temp, 'board'),
  studioRoot: path.join(temp, 'board', '.designbook'),
  boardFile: path.join(temp, 'board', 'Board.designbook'),
  name: 'Board',
  canCompile: true,
  say: setupSays
});
ok('a board that already has pages gets no starter page',
  !fs.existsSync(path.join(pages, '01-screen.astro')),
  fs.readdirSync(pages).join(' '));
ok('and keeps the pages it had', fs.existsSync(path.join(pages, '01-one.astro')));

const bare = path.join(temp, 'bare');
fs.mkdirSync(path.join(bare, '.designbook'), { recursive: true });
await runSetup({
  repoRoot: bare,
  studioRoot: path.join(bare, '.designbook'),
  boardFile: path.join(bare, 'Board.designbook'),
  name: 'Bare',
  canCompile: true,
  say: setupSays
});
ok('a board with no pages at all still gets one to look at',
  fs.existsSync(path.join(bare, '.designbook', 'pages', '01-screen.astro')));

// ── a converted screen is an Astro page ───────────────────────────────────
//
// Every frame should go through one compiler. A `.html` page does not: it is served raw
// from a side route, so it gets no kit, no tokens and no rebuild on save. Setup writes
// `.astro` now. Somebody else's markup is still theirs, though, and Astro reads `{` as an
// expression, so a document the compiler will not take stays `.html` rather than becoming
// a frame that shows a compile error.

console.log('\nConverting a screen');
const conv = path.join(temp, 'convert');
fs.mkdirSync(path.join(conv, '.designbook'), { recursive: true });
fs.writeFileSync(path.join(conv, 'plain.html'), `<!doctype html>
<html><head><meta charset="utf-8"><title>Plain</title></head>
<body><div class="card">a screen the repo already had</div></body></html>
`);
fs.writeFileSync(path.join(conv, 'braces.html'), `<!doctype html>
<html><head><meta charset="utf-8"><title>Braces</title></head>
<body><p>a price of {49} and a { dangling brace</p></body></html>
`);
await runSetup({
  repoRoot: conv,
  studioRoot: path.join(conv, '.designbook'),
  boardFile: path.join(conv, 'Board.designbook'),
  name: 'Convert',
  canCompile: true,
  say: () => {}
});
const convPages = fs.readdirSync(path.join(conv, '.designbook', 'pages'));
ok('a screen the repo had becomes an Astro page',
  convPages.some(f => /plain\.astro$/.test(f)), convPages.join(' '));
ok('and nothing is left as .html that Astro would take',
  !convPages.some(f => /plain\.html$/.test(f)), convPages.join(' '));
ok('a document Astro will not take stays .html',
  convPages.some(f => /braces\.html$/.test(f)), convPages.join(' '));

// ── the board's own history, and the switch that turns it off ─────────────
//
// The board commits its files as you draw. That is the point of the feature and a
// surprise to anybody who did not ask for it, so `designbook.saveHistory` governs it and
// off has to mean no commit at all, not a quieter one.

console.log('\nThe board\'s history');
const run = (args, cwd) => new Promise(done => {
  const p = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', d => { out += d; });
  p.on('close', () => done(out.trim()));
  p.on('error', () => done(''));
});

const hrepo = path.join(temp, 'history');
fs.mkdirSync(path.join(hrepo, '.designbook', 'pages'), { recursive: true });
await run(['init', '-q', '-b', 'main'], hrepo);
await run(['config', 'user.email', 'selftest@example.com'], hrepo);
await run(['config', 'user.name', 'selftest'], hrepo);
fs.writeFileSync(path.join(hrepo, 'README.md'), 'a repo\n');
await run(['add', '-A'], hrepo);
await run(['commit', '-qm', 'first'], hrepo);
const before = await run(['rev-list', '--count', 'HEAD'], hrepo);

const board = path.join(hrepo, 'Board.designbook');
const makeChange = n => {
  fs.writeFileSync(board, JSON.stringify({ sections: [], n }));
  fs.writeFileSync(path.join(hrepo, '.designbook', 'pages', '01-a.html'), `<p>${n}</p>`);
};

makeChange(1);
const off = createHistory({ boardFile: board, studioRoot: path.join(hrepo, '.designbook'), saving: false });
await off.start();
ok('off: the board commits nothing', (await run(['rev-list', '--count', 'HEAD'], hrepo)) === before,
  `was ${before}, now ${await run(['rev-list', '--count', 'HEAD'], hrepo)}`);
ok('off: and says why', /off in settings/.test(off.state.why), off.state.why);
ok('off: the work is still on disk', fs.existsSync(path.join(hrepo, '.designbook', 'pages', '01-a.html')));
off.stop();

const on = createHistory({ boardFile: board, studioRoot: path.join(hrepo, '.designbook'), saving: true, debounce: 30 });
await on.start();
ok('on: opening the board is the first commit', (await run(['rev-list', '--count', 'HEAD'], hrepo)) === String(Number(before) + 1),
  `was ${before}, now ${await run(['rev-list', '--count', 'HEAD'], hrepo)}`);

// The promise at the top of history.js: only the board's own files, named explicitly.
// An empty pathspec means "everything" to git, so a board that cannot work out its own
// paths used to answer with the whole repo and sweep up work that was not its own.
fs.writeFileSync(path.join(hrepo, 'README.md'), 'somebody else was working here\n');
makeChange(2);
on.touched();
await new Promise(r => setTimeout(r, 900));
const touched = await run(['show', '--name-only', '--pretty=format:', 'HEAD'], hrepo);
ok('on: and never commits a file that is not the board\'s', !/README/.test(touched), touched.replace(/\n/g, ' '));
ok('on: while still committing its own', /01-a\.html/.test(touched), touched.replace(/\n/g, ' '));
// Unstaged and uncommitted: `git diff` names a file only when the working tree differs
// from the index, so naming it proves the board neither staged nor committed it.
ok('the other work is left where it was, unstaged',
  (await run(['diff', '--name-only', '--', 'README.md'], hrepo)) === 'README.md',
  await run(['diff', '--name-only', '--', 'README.md'], hrepo));
on.stop();

// ── a page, compiled and served the way the board serves it ────────────────

console.log('\nCompiling and serving');
const studioRoot = path.join(temp, 'board', '.designbook');
const astro = new AstroSource({ studioRoot, appDir, log: () => {} });
astro.setTokens(css);
const started = await astro.start();
ok('the compiler starts', !!started, astro.why);

if (started) {
  const serve = http.createServer(async (req, res) => {
    const made = await astro.page(req.url.replace(/\?.*$/, ''));
    res.writeHead(made.status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(made.html);
  });
  await new Promise(r => serve.listen(0, '127.0.0.1', r));
  const port = serve.address().port;
  const get = async p => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`);
    return { status: res.status, html: await res.text() };
  };

  const one = await get('/01-one');
  ok('a page answers', one.status === 200, `answered ${one.status}`);
  ok('with what is on it', /A card/.test(one.html) && /A row/.test(one.html));
  ok('with the chrome the kit draws', /9:41/.test(one.html), 'the navigation bar draws the status bar above it');
  // 393 is the screen; 417 is the phone it is in. The board frames the device, because the
  // island over the top of a page and the corners that cut it are part of the screen.
  // 393 is the screen; 474 is the phone it is in, which is what the board frames.
  ok('with the frame the board reads', /designbook-width" content="474"/.test(one.html),
    (one.html.match(/designbook-width" content="\d+"/) || [''])[0]);
  ok('and the device round it', /class="db-shot"/.test(one.html) && /data-bezel/.test(one.html));
  ok('with the project\'s own values on it', /--db-primary: #2E7BF6/.test(one.html));
  ok('and no scrollbar', /scrollbar-width:none/.test(one.html.replace(/\s/g, '')));
  // The styles come inline in dev, which is why there is no link to check. What does have to
  // point at the compiler is everything the page fetches: served from the board, a relative
  // address would be asked of the board, which does not have it.
  ok('the kit\'s styles are on the page', /--db-radius-bottom-sheet/.test(one.html), 'tokens.css did not come through');
  const relative = [...one.html.matchAll(/\ssrc="(\/[^"]*)"/g)].map(m => m[1]);
  ok('everything it fetches points at the compiler', relative.length === 0, relative.slice(0, 3).join(' '));

  // A page's own scoped styles: that they compile at all, and that editing them shows.
  //
  // The worst fault this tool has had (KNOWN-ISSUES 1). The pages are reached through a
  // symlink, Astro compiled the page under one path and asked for its style under the
  // resolved one, and the two ids never met: "No cached compile metadata found". The
  // markup updated on every save and the styles never did, with nothing said anywhere.
  fs.writeFileSync(path.join(pages, '03-styled.astro'), `---
import Screen from '@kit/base/Screen.astro';
import Text from '@kit/base/Text.astro';
---
<Screen title="Styled" width={393} height={852}>
  <div class="hdr"><Text size={17}>hello</Text></div>
</Screen>
<style>
  .hdr { display: grid; }
</style>
`);
  await new Promise(r => setTimeout(r, 600));
  const styled = await get('/03-styled');
  ok('a page\'s own scoped style compiles', /\.hdr\[data-astro-cid-[^\]]+\]\{display:grid/.test(styled.html.replace(/\s+/g, '')),
    (styled.html.match(/\.hdr[^}]{0,60}}/) || ['not on the page'])[0]);

  fs.writeFileSync(path.join(pages, '03-styled.astro'),
    fs.readFileSync(path.join(pages, '03-styled.astro'), 'utf8').replace('display: grid', 'display: flex'));
  await new Promise(r => setTimeout(r, 900));
  const restyled = await get('/03-styled');
  ok('and editing it shows on the next render', /display:flex/.test(restyled.html.replace(/\s+/g, '')),
    (restyled.html.match(/\.hdr[^}]{0,60}}/) || ['not on the page'])[0]);

  // Selected text has to look selected. The board drives the selection from its own layer
  // over the frame, so the page is never the focused document, and an unfocused selection
  // is painted in a grey faint enough to read as nothing having happened. Naming
  // ::selection is what makes it show. Without this line the feature works and looks
  // broken, which is the worst of both.
  ok('a page is told how to paint selected text', /::selection\{background:/.test(one.html),
    (one.html.match(/data-designbook="selection"[^<]{0,60}/) || ['no selection style on the page'])[0]);

  const two = await get('/02-android');
  ok('an Android page answers', two.status === 200);
  ok('at its own size', /designbook-width" content="382"/.test(two.html),
    (two.html.match(/designbook-width" content="\d+"/) || [''])[0]);

  const missing = await get('/99-not-here');
  ok('a page that is not there says so in the board\'s own words',
    /No page at this address/.test(missing.html) && !/astro/i.test(missing.html.slice(0, 400)),
    `answered ${missing.status}: ${missing.html.slice(0, 80)}`);

  serve.close();
  await astro.stop();
}

console.log(`\n${passed} passed, ${failed} failed`);
clean();
process.exit(failed ? 1 : 0);
