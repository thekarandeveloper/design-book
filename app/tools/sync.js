// Keeping the board in step with the repo's default branch, whatever branch somebody is on.
//
// The board's files are shared work: a page one person draws is a page the next person opens.
// Left to each person's own branch they drift, and a board that was current on Monday is a
// board somebody has to reconcile by hand on Friday. So the board's files (and only those)
// live on the default branch, and this keeps them there: it fetches, brings in what others
// changed, merges where both changed, commits and pushes, on every change.
//
// THE FIRST RULE: nobody's work is lost, in any case. Nothing here deletes a file. A file
// that is to be replaced or taken away is first moved to `.designbook/.trash/sync/<time>/`,
// and nothing here ever empties that folder. A file is only overwritten if it is still exactly what was
// compared a moment ago, so an edit made while this is working is never written over. A
// deletion is only sent to origin if the board itself deleted the file; one that vanished any
// other way (a git reset, a checkout, a wiped folder) is put back. And a change to many files
// at once, which is what a reset or a checkout looks like and not what a person drawing
// looks like, is held for somebody to look at before it goes anywhere.
//
// Other things it never does, each of which would be a way to hurt somebody's work:
//
//   - It never touches the branch you are on, your index or any file that is not the
//     board's. It does not check anything out, so a half-finished change cannot be in the way.
//   - It never pushes your branch. In particular it never pushes the default branch as it is
//     on your machine, which may carry commits you have not published. What it pushes is one
//     commit it builds itself, on top of what origin already has, holding board files.
//   - It never forces. A push that is refused is fetched, merged and tried again, a few times,
//     and then said out loud.
//   - It never settles a disagreement. Where two people changed the same lines of one file,
//     both are kept and the file waits for somebody to choose.
//
// How, without a second working copy: the commit is made from git's plumbing. A temporary
// index is loaded with origin's tree, the board's changed files are written into it, and
// that tree is committed with origin's commit as its parent. Nothing is checked out, so it
// costs no disk and does not care how big the repo is, and the checkout you are working in
// is never involved.
//
// What the files are compared against is the last state that was in step: a three-way merge
// with that as the base. A file that only you changed is pushed; one that only they changed
// is brought in; one that both changed is merged as text where it can be.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// What is the board's: its own file, and these parts of its folder. Everything else in the
// folder is made here and rebuilt (the rules file, the index, the port) or is somebody's own
// state (what is being worked on, what was checked), and is never shared.
export const OWNED_DIRS = ['pages', 'refs', 'parts', 'gen'];
export const OWNED_FILES = ['refs.json'];
// What is only this machine's.
const LOCAL = ['.sync.json', '.port', '.working', '.open', '.check', 'checks.json', 'studio.json', 'CLAUDE.md', '.trash'];
// A file bigger than this is a video or a design file, and a repo is the wrong place for it.
const MOST_BYTES = 8 * 1024 * 1024;
const TRIES = 3;
// More than this many files changed at once is held for a look. A person designing changes a
// few in a few seconds; a git reset, a checkout of an old branch or a wiped folder changes a
// dozen.
const MASS = 10;


const posix = p => p.split(path.sep).join('/');
const sha0 = '0000000000000000000000000000000000000000';

// ── running git ─────────────────────────────────────────────────────────────

function run(cwd, args, { input, env, ms = 60000, ok = [0], any = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', ...env } });
    const out = [];
    const err = [];
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, ms);
    child.stdout.on('data', c => out.push(c));
    child.stderr.on('data', c => err.push(c));
    child.on('error', e => { clearTimeout(timer); reject(Object.assign(new Error(`git: ${e.message}`), { code: -1 })); });
    child.on('close', code => {
      clearTimeout(timer);
      const stdout = Buffer.concat(out);
      const stderr = Buffer.concat(err).toString('utf8').trim();
      if (any || ok.includes(code)) return resolve({ stdout, stderr, code });
      reject(Object.assign(new Error(stderr || `git ${args[0]} ended with ${code}`), { code, stderr, stdout }));
    });
    if (input !== undefined) child.stdin.end(input); else child.stdin.end();
  });
}

const text = r => r.stdout.toString('utf8').replace(/\n+$/, '');

// ── the engine ──────────────────────────────────────────────────────────────

export function createSync({ boardFile, studioRoot, log = () => {}, debounce = 8000, poll = 180000, isWorking = () => false }) {
  const stateFile = path.join(studioRoot, '.sync.json');
  const listeners = new Set();
  let timer = 0;
  let ticker = 0;
  let running = null;
  let again = false;
  let top = '';
  // Files this wrote into the working folder, so hearing them come back from the watcher
  // is not taken for somebody having changed them.
  const wrote = new Map();
  let retry = false;

  let st = { enabled: false, base: {}, conflicts: {}, deleted: {}, lastAt: 0, lastCommit: '', error: '', note: '' };
  try { st = { ...st, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) }; } catch (_) {}

  let live = { state: st.enabled ? 'idle' : 'off', message: '', branch: '', mine: '', pending: 0, remote: '', review: [] };
  let approved = false;

  const save = () => { try { fs.writeFileSync(stateFile, JSON.stringify(st, null, 1)); } catch (_) {} };
  const tell = () => { for (const fn of listeners) { try { fn(status()); } catch (_) {} } };
  const set = (patch) => { live = { ...live, ...patch }; tell(); };

  function status() {
    return {
      enabled: st.enabled,
      state: st.enabled ? live.state : 'off',
      message: live.message,
      branch: live.branch,            // the branch the board's files are kept on
      mine: live.mine,                // the branch this checkout is on
      remote: live.remote,
      pending: live.pending,
      review: live.review,            // changed all at once, waiting to be looked at
      lastAt: st.lastAt,
      lastCommit: st.lastCommit,
      conflicts: Object.keys(st.conflicts)
    };
  }

  // ── what is there ─────────────────────────────────────────────────────

  async function where() {
    if (top) return top;
    const dir = fs.existsSync(path.dirname(boardFile)) ? path.dirname(boardFile) : studioRoot;
    const r = await run(dir, ['rev-parse', '--show-toplevel']);
    top = fs.realpathSync(text(r));
    return top;
  }

  const relOf = abs => posix(path.relative(top, safeReal(abs)));
  function safeReal(abs) {
    // The file may not exist yet; its folder does.
    try { return fs.realpathSync(abs); } catch (_) {
      try { return path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs)); } catch (_) { return abs; }
    }
  }
  const absOf = rel => path.join(top, rel.split('/').join(path.sep));

  // The paths in the repo that are the board's, as folders and files.
  function ownedPrefixes() {
    const base = relOf(studioRoot);
    return {
      dirs: OWNED_DIRS.map(d => `${base}/${d}`),
      files: [...OWNED_FILES.map(f => `${base}/${f}`), relOf(boardFile)]
    };
  }

  function isOwnedRel(rel) {
    const { dirs, files } = ownedPrefixes();
    return files.includes(rel) || dirs.some(d => rel.startsWith(d + '/'));
  }

  // Whether a file the watcher noticed is one of these, and not one this just wrote.
  function owns(abs) {
    if (!top) return false;
    let rel;
    try { rel = relOf(abs); } catch (_) { return false; }
    if (!isOwnedRel(rel)) return false;
    if (path.basename(abs) === '.DS_Store') return false;
    const at = wrote.get(abs);
    return !(at && Date.now() - at < 2500);
  }

  function walk(dir, out) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      if (e.name === '.DS_Store' || e.name.startsWith('.git')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, out);
      else if (e.isFile()) out.push(full);
    }
  }

  // The board's files as they are in the working folder: path in the repo, and what git
  // would call each one.
  async function ours() {
    const abs = [];
    for (const d of OWNED_DIRS) walk(path.join(studioRoot, d), abs);
    for (const f of OWNED_FILES) { const p = path.join(studioRoot, f); if (fs.existsSync(p)) abs.push(p); }
    if (fs.existsSync(boardFile)) abs.push(boardFile);
    const keep = [];
    const skipped = [];
    for (const p of abs) {
      let size = 0;
      try { size = fs.statSync(p).size; } catch (_) { continue; }
      if (size > MOST_BYTES) { skipped.push(path.basename(p)); continue; }
      keep.push(p);
    }
    const map = new Map();
    if (keep.length) {
      const r = await run(top, ['hash-object', '--stdin-paths'], { input: keep.join('\n') + '\n' });
      const shas = text(r).split('\n');
      keep.forEach((p, i) => map.set(relOf(p), shas[i]));
    }
    return { map, skipped };
  }

  // What origin has, from the commit.
  async function theirs(commit) {
    const map = new Map();
    if (!commit) return map;
    const { dirs, files } = ownedPrefixes();
    const r = await run(top, ['ls-tree', '-r', '-z', commit, '--', ...dirs, ...files]);
    for (const row of r.stdout.toString('utf8').split('\0')) {
      if (!row) continue;
      const tab = row.indexOf('\t');
      const meta = row.slice(0, tab).split(' ');
      map.set(row.slice(tab + 1), meta[2]);
    }
    return map;
  }

  const blob = async sha => (await run(top, ['cat-file', 'blob', sha])).stdout;

  // ── the default branch ────────────────────────────────────────────────

  async function defaultBranch() {
    try {
      const r = await run(top, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
      const name = text(r).replace(/^origin\//, '');
      if (name) return name;
    } catch (_) {}
    try {
      const r = await run(top, ['ls-remote', '--symref', 'origin', 'HEAD'], { ms: 30000 });
      const m = /ref:\s+refs\/heads\/(\S+)\s+HEAD/.exec(text(r));
      if (m) return m[1];
    } catch (_) {}
    for (const b of ['main', 'master']) {
      try { await run(top, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${b}`]); return b; } catch (_) {}
    }
    return '';
  }

  // ── a text merge, where both sides changed one file ───────────────────

  const isBinary = buf => buf.subarray(0, 8000).includes(0);

  // Ours is read from the file: scanning only hashes the working folder, it does not store it.
  async function mergeText(baseSha, rel, theirSha) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbmerge-'));
    try {
      const o = path.join(dir, 'ours'); const b = path.join(dir, 'base'); const t = path.join(dir, 'theirs');
      const ob = fs.readFileSync(absOf(rel));
      const tb = await blob(theirSha);
      if (isBinary(ob) || isBinary(tb)) return null;
      fs.writeFileSync(o, ob);
      fs.writeFileSync(t, tb);
      fs.writeFileSync(b, baseSha ? await blob(baseSha) : '');
      // The exit code is how many places could not be merged; a negative one is an error.
      const r = await run(top, ['merge-file', '-p', o, b, t], { any: true });
      // A base that is nothing is not a base: two files that both began here are two
      // answers, not one answer edited twice.
      if (r.code !== 0 || !baseSha) return null;
      return r.stdout;
    } catch (_) {
      return null;
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
  }

  // ── one pass ──────────────────────────────────────────────────────────

  // Where a file goes before it is replaced or taken away: a copy of it, under the time,
  // in the board's own trash. Never deleted from there by this.
  function trashPath(rel) {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    return path.join(studioRoot, '.trash', 'sync', stamp, rel);
  }
  function keep(rel) {
    const abs = absOf(rel);
    if (!fs.existsSync(abs)) return '';
    const to = trashPath(rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(abs, to);
    return to;
  }

  const hashNow = async rel => {
    const abs = absOf(rel);
    if (!fs.existsSync(abs)) return null;
    try { return text(await run(top, ['hash-object', '--path', rel, abs])); } catch (_) { return undefined; }
  };

  // Writes a file only if it is still what was compared. If it is not, it was edited while
  // this was working, and the edit is left exactly as it is: the next pass finds it.
  async function put(rel, buf, expect) {
    if ((await hashNow(rel)) !== expect) { retry = true; return false; }
    keep(rel);
    const abs = absOf(rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    wrote.set(abs, Date.now());
    fs.writeFileSync(abs, buf);
    return true;
  }

  // Takes a file out of the folder by moving it to the trash, under the same condition. A
  // move, not a delete: the file is whole in the trash, and the folder is without it.
  async function drop(rel, expect) {
    if ((await hashNow(rel)) !== expect) { retry = true; return false; }
    const abs = absOf(rel);
    const to = trashPath(rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    wrote.set(abs, Date.now());
    fs.renameSync(abs, to);
    return true;
  }

  // Works out what each file needs, writes what is to come in, and returns what is to go
  // out. Nothing is pushed here.
  async function plan(commit, allowPush) {
    const [mine, theirsMap] = await Promise.all([ours(), theirs(commit)]);
    const all = new Set([...mine.map.keys(), ...theirsMap.keys()]);
    const out = { push: [], pulled: [], merged: [], restored: [], conflicts: {}, skipped: mine.skipped, ours: mine.map, theirs: theirsMap };

    for (const rel of all) {
      const o = mine.map.get(rel) || null;
      const t = theirsMap.get(rel) || null;
      const b = st.base[rel] || null;
      if (o === t) continue;

      const held = st.conflicts[rel];
      if (held && held.theirs === t) { out.conflicts[rel] = held; continue; }  // still waiting for somebody to choose

      if (t === b) {                                                    // only this side changed it
        if (!o) {
          // Gone from here. A file the board deleted is deleted for everybody; one that went
          // any other way (a reset, a checkout, a wiped folder) is put back, because the only
          // safe reading of a file that disappeared is that it was not meant to.
          if (st.deleted[rel]) { out.push.push(rel); continue; }
          if (t && await put(rel, await blob(t), null)) out.restored.push(rel);
          continue;
        }
        out.push.push(rel);
        continue;
      }
      if (o === b) {                                                    // only the other side
        const ok = t ? await put(rel, await blob(t), o) : await drop(rel, o);
        if (ok) out.pulled.push(rel);
        continue;
      }
      // Both changed it, to different things.
      if (o && t) {
        const merged = await mergeText(b, rel, t);
        if (merged) {
          if (await put(rel, merged, o)) { out.merged.push(rel); out.push.push(rel); }
          continue;
        }
      }
      out.conflicts[rel] = { theirs: t, ours: o, at: Date.now() };
    }
    if (!allowPush) out.push = [];
    return out;
  }

  // A commit on top of origin's, holding only the files that are to go out.
  async function commitOf(commit, rels) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbindex-'));
    const env = { GIT_INDEX_FILE: path.join(dir, 'index') };
    try {
      await run(top, ['read-tree', commit], { env });
      const rows = [];
      for (const rel of rels) {
        const abs = absOf(rel);
        if (fs.existsSync(abs)) {
          const sha = text(await run(top, ['hash-object', '-w', '--path', rel, abs]));
          rows.push(`100644 ${sha}\t${rel}`);
        } else {
          rows.push(`0 ${sha0}\t${rel}`);
        }
      }
      await run(top, ['update-index', '--index-info'], { env, input: rows.join('\n') + '\n' });
      const tree = text(await run(top, ['write-tree'], { env }));
      const was = text(await run(top, ['rev-parse', `${commit}^{tree}`]));
      if (tree === was) return '';
      const names = rels.map(r => r.split('/').pop());
      const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? ` and ${names.length - 3} more` : '');
      const made = await run(top, ['commit-tree', tree, '-p', commit, '-m', `Design Book: ${shown}`], { env });
      return text(made);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
  }

  // What the remote said, in its own words: its "remote:" lines, and not git's summary of the
  // push, which only repeats where it was going.
  const said = e => {
    const lines = (e.stderr || e.message || '').split('\n').map(l => l.trim()).filter(Boolean);
    const remote = lines.filter(l => l.startsWith('remote:')).map(l => l.replace(/^remote:\s*/, '')).filter(Boolean);
    return (remote.length ? remote : lines.slice(-1)).join(' ').slice(0, 220);
  };

  const refused = e => /non-fast-forward|fetch first|\[rejected\]|failed to push some refs/i.test(e.stderr || e.message)
    && !/protected branch|denied|not allowed|pre-receive hook declined|GH006|hook declined/i.test(e.stderr || e.message);

  async function cycle(reason) {
    await where();
    ensureExcluded();

    let remote = '';
    try { remote = text(await run(top, ['remote', 'get-url', 'origin'])); } catch (_) {}
    if (!remote) return set({ state: 'no-remote', message: 'This repo has no origin to keep the board in step with.', remote: '' });

    let mineBranch = '';
    try { mineBranch = text(await run(top, ['rev-parse', '--abbrev-ref', 'HEAD'])); } catch (_) {}

    const branch = await defaultBranch();
    if (!branch) return set({ state: 'no-branch', message: 'Could not tell which branch is the default one.', remote, mine: mineBranch });
    set({ state: 'syncing', message: '', branch, mine: mineBranch, remote });
    retry = false;

    // The agent is mid-way through a piece of work: bring in what others did, and push
    // when it finishes, so half a page is never what somebody else gets.
    const allowPush = !isWorking();

    for (let attempt = 1; attempt <= TRIES; attempt++) {
      try {
        await run(top, ['fetch', '--quiet', '--no-tags', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], { ms: 45000 });
      } catch (e) {
        if (/couldn't find remote ref/i.test(e.message)) return set({ state: 'no-branch', message: `origin has no ${branch} yet.` });
        return set({ state: 'offline', message: 'Could not reach origin. The board keeps working and will try again.', pending: live.pending });
      }
      const commit = text(await run(top, ['rev-parse', `refs/remotes/origin/${branch}`]));
      const p = await plan(commit, allowPush);

      // Many files at once is what a git reset or a checkout does, not what drawing does. It
      // is not sent until somebody has looked: the files stay as they are.
      let held = [];
      const first = Object.keys(st.base).length === 0;
      if (p.push.length > MASS && !first && !approved) { held = p.push; p.push = []; }

      let pushed = '';
      if (p.push.length) {
        const made = await commitOf(commit, p.push);
        if (made) {
          try {
            // Not forced, and only this commit: never the branch as it is here.
            await run(top, ['push', '--porcelain', 'origin', `${made}:refs/heads/${branch}`], { ms: 60000 });
            pushed = made;
          } catch (e) {
            if (refused(e) && attempt < TRIES) { log(`[sync] origin moved while pushing; fetching again (${attempt}/${TRIES})`); continue; }
            return set({
              state: 'error', pending: p.push.length,
              message: refused(e)
                ? `origin kept moving, so the push was refused ${TRIES} times. It will try again.`
                : `origin refused the push: ${said(e)}`
            });
          }
        }
      }

      // Everything that is now the same on both sides is the new base. A file still waiting
      // on somebody's choice keeps the base it had, so the disagreement does not vanish.
      const after = await ours();
      const nextBase = {};
      const finalTheirs = pushed ? await theirs(pushed) : p.theirs;
      for (const rel of new Set([...after.map.keys(), ...finalTheirs.keys()])) {
        if (p.conflicts[rel]) { if (st.base[rel]) nextBase[rel] = st.base[rel]; continue; }
        const o = after.map.get(rel) || null;
        const t = finalTheirs.get(rel) || null;
        // A file whose push is still pending is not yet the same on both sides.
        if (o === t && o) nextBase[rel] = o;
        else if (st.base[rel] && !(o === null && t === null)) nextBase[rel] = st.base[rel];
      }
      st.base = nextBase;
      for (const rel of p.push) delete st.deleted[rel];
      st.conflicts = p.conflicts;
      st.lastAt = Date.now();
      if (pushed) st.lastCommit = pushed.slice(0, 7);
      save();

      approved = false;
      const waiting = Object.keys(p.conflicts).length;
      const pendingNow = allowPush ? 0 : [...after.map.keys()].filter(r => after.map.get(r) !== finalTheirs.get(r)).length;
      const bits = [];
      if (pushed) bits.push(`${p.push.length} sent`);
      if (p.pulled.length) bits.push(`${p.pulled.length} brought in`);
      if (p.merged.length) bits.push(`${p.merged.length} merged`);
      if (p.restored.length) bits.push(`${p.restored.length} put back`);
      if (p.skipped.length) bits.push(`${p.skipped.join(', ')} too big to share`);
      log(`[sync] ${reason}: ${bits.join(', ') || 'already in step'} (${branch})`);
      return set({
        state: held.length ? 'review' : waiting ? 'conflict' : pendingNow ? 'pending' : 'idle',
        pending: held.length || pendingNow,
        review: held.map(r => r.split('/').slice(-2).join('/')),
        message: held.length
          ? `${held.length} files changed at once. That is what a git reset or a checkout does, so they are held until you have looked. Nothing has been lost or sent.`
          : waiting ? `${waiting} file${waiting === 1 ? '' : 's'} changed by somebody else and by you.`
          : p.restored.length ? `${p.restored.length} file${p.restored.length === 1 ? ' was' : 's were'} missing and put back, because they were not deleted from the board.`
          : p.skipped.length ? `${p.skipped.join(', ')} is too big to share through git.` : '',
        branch, mine: mineBranch, remote
      });
    }
  }

  // ── the local exclude ─────────────────────────────────────────────────
  //
  // The board's files are kept by this, so they are not what `git status` should be about on
  // a branch of somebody's own. They are excluded for this machine only, in the repo's own
  // exclude file, which nobody commits. A file that is tracked on the branch is not affected
  // by it, and one that arrives from a pull replaces an excluded one without a word.
  function ensureExcluded() {
    try {
      const base = relOf(studioRoot);
      const lines = [
        ...OWNED_DIRS.map(d => `/${base}/${d}/`),
        ...[...OWNED_FILES, ...LOCAL].map(f => `/${base}/${f}`),
        `/${relOf(boardFile)}`
      ];
      const file = path.join(fs.realpathSync(top), '.git', 'info', 'exclude');
      if (!fs.existsSync(path.dirname(file))) return;      // a linked worktree: leave its git dir alone
      const start = '# design-book:start';
      const end = '# design-book:end';
      const was = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      const block = `${start}\n${lines.join('\n')}\n${end}`;
      let next;
      if (was.includes(start) && was.includes(end)) next = was.slice(0, was.indexOf(start)) + block + was.slice(was.indexOf(end) + end.length);
      else next = was.replace(/\s*$/, '') + (was.trim() ? '\n\n' : '') + block + '\n';
      if (next !== was) fs.writeFileSync(file, next);
    } catch (_) {}
  }

  // ── the way in ────────────────────────────────────────────────────────

  function go(reason) {
    if (!st.enabled) return Promise.resolve(status());
    if (running) { again = true; return running; }
    clearTimeout(timer);
    running = (async () => {
      try {
        await cycle(reason);
      } catch (e) {
        log(`[sync] ${e.message}`);
        set({ state: 'error', message: (e.message || 'something went wrong').split('\n')[0].slice(0, 200) });
      }
      running = null;
      if (retry) { retry = false; again = true; }
      if (again) { again = false; return go('again'); }
      return status();
    })();
    return running;
  }

  return {
    status,
    // Whether this repo can be kept in step, found without fetching anything.
    async probe() {
      try {
        await where();
      } catch (_) { return { git: false, remote: false, branch: '', mine: '' }; }
      let remote = ''; let mine = ''; let branch = '';
      try { remote = text(await run(top, ['remote', 'get-url', 'origin'])); } catch (_) {}
      try { mine = text(await run(top, ['rev-parse', '--abbrev-ref', 'HEAD'])); } catch (_) {}
      try { branch = text(await run(top, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).replace(/^origin\//, ''); } catch (_) {}
      return { git: true, remote: !!remote, branch, mine };
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    owns,
    // The board itself deleted this file (it moved it to the trash). This is the only kind of
    // deletion that is sent to origin.
    deleted(abs) {
      if (!top || !st.enabled) return;
      let rel;
      try { rel = relOf(abs); } catch (_) { return; }
      if (!isOwnedRel(rel)) return;
      st.deleted[rel] = Date.now();
      save();
    },
    // Many files held for a look: send them, or put them back as origin has them.
    async approve() { approved = true; return go('you approved them'); },
    async revert() {
      await where();
      const commit = live.branch ? text(await run(top, ['rev-parse', `refs/remotes/origin/${live.branch}`])) : '';
      const t = await theirs(commit);
      for (const rel of Object.keys(st.base)) {
        const sha = t.get(rel);
        if (!sha) continue;
        const now = await hashNow(rel);
        if (now !== sha) await put(rel, await blob(sha), now);
      }
      return go('you put them back');
    },
    // Somebody changed one of the files: wait for the changing to stop, then go.
    touched(abs) {
      if (!st.enabled || !owns(abs)) return;
      set({ state: live.state === 'syncing' ? 'syncing' : 'pending', pending: Math.max(1, live.pending) });
      clearTimeout(timer);
      timer = setTimeout(() => go('a change'), debounce);
    },
    now: () => go('asked'),
    // The agent has finished a piece of work.
    finished() { return go('the work finished'); },
    async enable(on) {
      st.enabled = !!on;
      save();
      clearInterval(ticker);
      if (!on) { set({ state: 'off', message: '' }); return status(); }
      ticker = setInterval(() => { go('a look for what others did'); }, poll);
      if (ticker.unref) ticker.unref();
      set({ state: 'idle' });
      return go('turned on');
    },
    start() {
      if (!st.enabled) return;
      clearInterval(ticker);
      ticker = setInterval(() => { go('a look for what others did'); }, poll);
      if (ticker.unref) ticker.unref();
      go('the board opened');
    },
    // One file two people changed: keep mine, or take theirs.
    async resolve(rel, take) {
      await where();
      const held = st.conflicts[rel];
      if (!held || !isOwnedRel(rel)) return status();
      if (take === 'theirs') {
        const now = await hashNow(rel);
        // Mine goes to the trash first: choosing theirs must never be the end of it.
        if (held.theirs) await put(rel, await blob(held.theirs), now); else await drop(rel, now);
      }
      // Whichever was chosen, the other side's version is now the base, so the choice is the
      // only change left: mine goes out as a change of theirs, theirs is already in step.
      if (held.theirs) st.base[rel] = held.theirs; else delete st.base[rel];
      delete st.conflicts[rel];
      save();
      return go(`you chose ${take}`);
    },
    stop() { clearTimeout(timer); clearInterval(ticker); }
  };
}
