// What only the real board server can be asked.
//
//   node tools/livetest.mjs
//
// `selftest.mjs` checks the pieces: the compiler, the kit, a page's own values. It cannot
// reach the watcher, the poster queue or the API, because those live in the vite plugin
// and only exist while a board is being served. So this starts one, against a throwaway
// board in a temp folder, asks it the questions that have been wrong before, and stops it.
//
// Slower than the selftest (a server, and a headless browser for the pictures), and it
// needs a port, so it is its own command rather than part of that suite.
//
// What it holds: KNOWN-ISSUES 7, a frame's picture outliving the page it is a picture of.

import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

// A port nothing else here uses: the boards themselves count up from 5273.
const PORT = 5399;
const app = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'poster-')));
const studio = path.join(temp, '.designbook');
fs.mkdirSync(path.join(studio, 'pages'), { recursive: true });
fs.writeFileSync(path.join(temp, 'Board.designbook'), JSON.stringify({ sections: [] }));
const page = path.join(studio, 'pages', '01-p.astro');
const body = n => `---
import Screen from '@kit/base/Screen.astro';
import Text from '@kit/base/Text.astro';
---
<Screen title="P" width={393} height={852}><Text size={17}>${n}</Text></Screen>
`;
fs.writeFileSync(page, body('one'));

const proc = spawn(process.execPath, [path.join(app, 'node_modules/vite/bin/vite.js')], {
  cwd: app, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, STUDIO_ROOT: studio, REPO_ROOT: temp, STUDIO_PORT: String(PORT), STUDIO_HISTORY: 'off' }
});
let log = '';
proc.stdout.on('data', d => { log += d; });
proc.stderr.on('data', d => { log += d; });

const stop = () => { try { proc.kill('SIGTERM'); } catch (_) {} };
const wait = ms => new Promise(r => setTimeout(r, ms));
// Drawing a picture runs a headless browser through a queue, so how long it takes is not
// a number this can know. Waiting a fixed few seconds passed on a warm machine and failed
// on a cold one, which is a test reporting the weather.
const until = async (what, ms = 40000) => {
  const stop = Date.now() + ms;
  while (Date.now() < stop) {
    const v = await what();
    if (v) return v;
    await wait(500);
  }
  return null;
};
const api = async (p, init) => {
  const r = await fetch(`http://localhost:${PORT}/__api${p}`, init);
  return r.headers.get('content-type')?.includes('json') ? r.json() : r.text();
};
const posterFiles = () => {
  const root = path.join(os.homedir(), 'Library', 'Caches', 'design-book');
  const hits = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f); else if (e.name.endsWith('.jpg') && f.includes('posters')) hits.push(f);
  } };
  try { walk(root); } catch (_) {}
  return hits;
};

let pass = 0, fail = 0;
const ok = (what, good, detail = '') => { (good ? pass++ : fail++); console.log(`  ${good ? 'ok  ' : 'FAIL'}  ${what}${good || !detail ? '' : '\n          ' + detail}`); };

try {
  let up = false;
  for (let i = 0; i < 60; i++) { try { await api('/studio'); up = true; break; } catch (_) { await wait(1000); } }
  console.log('  server up:', up, '| alive:', proc.exitCode === null);
  const before = posterFiles().length;
  const pages0 = (await api('/studio')).pages || [];
  console.log('  frames the board sees:', JSON.stringify(pages0.map(p => p.id)));
  const made = await api('/poster', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: pages0[0] && pages0[0].id }) });
  console.log('  poster answer:', JSON.stringify(made));
  const drew = await until(async () => posterFiles().length > before);
  ok('a picture is drawn when asked for', !!drew, `${before} pictures before, ${posterFiles().length} after waiting; answer ${JSON.stringify(made)}`);

  const posterAt = await until(async () =>
    ((await api('/studio')).pages || []).find(p => p.id === pages0[0].id)?.poster);
  ok('and the board reports it', !!posterAt, JSON.stringify(((await api('/studio')).pages || []).map(p => [p.id, p.poster])));

  // A colour that exists only on a frame reaches the design system, marked (board).
  // Karan asked for one list rather than two, so the label is the only thing separating
  // a value the code declares from one an agent invented on a page.
  fs.writeFileSync(page, body('two').replace('</Screen>', '</Screen>\n<style>.z{color:#BB2244}</style>'));
  const rules = await until(async () => {
    try {
      const t = fs.readFileSync(path.join(studio, 'CLAUDE.md'), 'utf8');
      return /#BB2244/i.test(t) ? t : null;
    } catch (_) { return null; }
  }) || '';
  ok('a colour used only on a frame reaches the design system', /#BB2244/i.test(rules),
    (rules.match(/#[0-9A-Fa-f]{6}[^\n]{0,24}/g) || []).slice(0, 4).join(' | ') || 'no colours at all');
  ok('and is marked as the board\'s, not the code\'s', /#BB2244[^\n]*\(board\)/i.test(rules),
    (rules.match(/#BB2244[^\n]*/i) || ['not on the page'])[0]);

  const gone = await until(async () =>
    !((await api('/studio')).pages || []).find(p => p.id === pages0[0].id)?.poster);
  ok('editing the page throws the picture away', !!gone,
    `poster is still ${((await api('/studio')).pages || []).find(p => p.id === pages0[0].id)?.poster}`);
} catch (err) {
  console.log('  FAIL  the check itself broke:', err.message);
  console.log(log.slice(-1500));
  fail++;
} finally {
  stop();
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
