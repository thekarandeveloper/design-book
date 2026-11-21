// The board's own history, on the branch you are already on.
//
// What this replaces: the board used to keep its files on the repo's default branch and
// fetch, merge and push them there on every change, so that a page one person drew was a
// page the next person opened. That is a sharing problem, and it was solved by reaching
// across branches, which is a lot of machinery to have running under somebody who is
// drawing. This does the smaller, plainer thing: whatever branch you are on, a change to
// the board is committed to that branch, locally, and nothing is ever fetched or pushed.
//
// THE RULES, each of which is a way the board could otherwise take something that is not
// its own:
//
//   - Only the board's own files are committed, named explicitly, every time. The commit
//     is made with a pathspec, which commits those paths from the working tree without
//     touching the index, so a change you have staged elsewhere is still staged
//     afterwards and is never swept into a commit you did not make.
//   - The branch is never changed, nothing is checked out over your work, nothing is
//     pushed, nothing is fetched, and no history is rewritten. Going back to an older
//     state is a new commit on top, not a reset.
//   - Nothing is deleted to make room. Going back writes the old files over the current
//     ones, and the current ones are in the commit that was made a moment before, which
//     is the whole point of committing on every change.
//   - A repo that is not a repo, a board outside any repo, or git missing: everything
//     here answers "no history" and does nothing.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// The board's own files: its document, and the parts of its folder that are the work.
// Everything else in the folder is either rebuilt (the rules file, the index, the port) or
// is one person's own state (what is open, what was checked), and belongs to nobody else.
const OWNED_DIRS = ['pages', 'refs', 'parts', 'gen'];
const OWNED_FILES = ['refs.json'];

// How many commits the list goes back. A board's history is read to find the state you
// want, and nobody scrolls past fifty to find it.
const MOST = 50;

// `keep` leaves the output exactly as git wrote it.
//
// Trimming is right for a one-line answer and wrong for a listing: `git status` writes
// a space in the first column when a file is changed in the working tree but not staged,
// so ` M .designbook/pages/01-a.html` arrived as `M .designbook/...`, every path lost its
// first character, and the commit was refused for a pathspec with the dot missing off
// `.designbook`. It only showed on the first entry, and only for that one status, which
// is why it looked like it worked.
function git(args, cwd, { timeout = 15000, keep = false } = {}) {
  return new Promise(resolve => {
    let proc;
    try {
      proc = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (_) {
      return resolve({ ok: false, out: '', err: 'git could not be started' });
    }
    let out = '';
    let err = '';
    const done = setTimeout(() => { try { proc.kill(); } catch (_) {} }, timeout);
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { err += d; });
    proc.on('error', e => { clearTimeout(done); resolve({ ok: false, out: '', err: e.message }); });
    proc.on('close', code => {
      clearTimeout(done);
      resolve({ ok: code === 0, out: keep ? out : out.trim(), err: err.trim() });
    });
  });
}

export function createHistory({ boardFile, studioRoot, log = () => {}, debounce = 9000 }) {
  let repo = '';          // the repo root, once it is known
  let branch = '';        // the branch as of the last look
  let timer = 0;
  let busy = false;
  let state = { on: false, why: 'looking for a repo', branch: '', at: 0, saving: false };
  const listeners = new Set();

  const tell = () => { for (const fn of listeners) fn(state); };
  const set = patch => { state = { ...state, ...patch }; tell(); };

  // The paths this may ever touch, relative to the repo root, as git wants them.
  //
  // Only the ones that are really there, or that git already knows about. A board with no
  // `gen` folder is the normal case, and git refuses a whole command when one pathspec in
  // it matches nothing: one missing folder stopped every commit the board tried to make.
  // A tracked path that has been deleted is kept, because its deletion is a change to
  // record.
  let known = new Set();
  function paths() {
    if (!repo) return [];
    const rel = p => path.relative(repo, p).split(path.sep).join('/');
    const want = [rel(boardFile)];
    for (const d of OWNED_DIRS) want.push(rel(path.join(studioRoot, d)));
    for (const f of OWNED_FILES) want.push(rel(path.join(studioRoot, f)));
    return want.filter(p => {
      // Nothing outside the repo, whatever the board file's path turned out to be.
      if (!p || p.startsWith('..')) return false;
      if (fs.existsSync(path.join(repo, p))) return true;
      return [...known].some(f => f === p || f.startsWith(p + '/'));
    });
  }

  // What git has on this branch under the board, so a path that only exists in history
  // is still named.
  async function learn() {
    if (!repo) return;
    const rel = p => path.relative(repo, p).split(path.sep).join('/');
    const under = rel(studioRoot);
    const out = await git(['ls-files', '-z', '--', under, rel(boardFile)], repo, { keep: true });
    known = new Set((out.out || '').split('\0').filter(Boolean));
  }

  async function find() {
    const start = path.dirname(studioRoot);
    if (!fs.existsSync(start)) return set({ on: false, why: 'the board folder is not there' });
    const top = await git(['rev-parse', '--show-toplevel'], start);
    if (!top.ok || !top.out) return set({ on: false, why: 'this board is not inside a git repo' });
    repo = top.out;
    await learn();
    const head = await git(['rev-parse', '--abbrev-ref', 'HEAD'], repo);
    branch = head.ok ? head.out : '';
    set({ on: true, why: '', branch });
    return true;
  }

  // What changed, said in a few words, for the commit's subject line.
  //
  // The board document changes on nearly every save, because moving anything writes it,
  // so naming it alongside the pages made every line in the history read
  // "Plate.designbook, something and 40 more" and the list said nothing. The pages are
  // what somebody recognises; the board document is only mentioned when it is the one
  // thing that changed, and then it is called what it is.
  // The board's files that differ right now, as git names them.
  //
  // This is what is committed, rather than the folders themselves. `git commit` refuses
  // the whole command when one pathspec matches nothing it knows, and an empty `refs/`
  // folder is exactly that: it is there on disk, so naming it looked safe, and every
  // commit the board tried to make in that repo was refused with "pathspec did not match
  // any file(s) known to git". Asking git what changed cannot name something git does not
  // know about.
  //
  // Read with -z, so a file with a space or a quote in its name arrives whole.
  async function changedFiles() {
    if (!repo) return [];
    const out = await git(['status', '--porcelain', '-z', '--untracked-files=all', '--', ...paths()], repo, { keep: true });
    const parts = (out.out || '').split('\0').filter(Boolean);
    const files = [];
    for (let i = 0; i < parts.length; i++) {
      const entry = parts[i];
      const status = entry.slice(0, 2);
      const name = entry.slice(3);
      // A rename is two entries: the new name, then the old one it came from.
      if (status[0] === 'R' || status[1] === 'R') {
        const from = parts[++i];
        if (from) files.push(from);
      }
      if (name) files.push(name);
    }
    return files;
  }

  async function what() {
    const files = await changedFiles();
    if (!files.length) return '';
    const board = path.basename(boardFile);
    const pages = files
      .filter(f => path.basename(f) !== board)
      .map(f => path.basename(f).replace(/\.(astro|html|json)$/, ''));
    if (!pages.length) return 'the board, rearranged';
    if (pages.length === 1) return pages[0];
    if (pages.length === 2) return pages.join(' and ');
    if (pages.length <= 4) return `${pages.slice(0, -1).join(', ')} and ${pages[pages.length - 1]}`;
    return `${pages.slice(0, 2).join(', ')} and ${pages.length - 2} more`;
  }

  // One commit, of the board's files only.
  async function save(why) {
    if (!repo || busy) return;
    busy = true;
    set({ saving: true });
    try {
      const files = await changedFiles();
      if (!files.length) return;                   // nothing of the board's changed
      const subject = why || (await what()) || 'opened';
      // A new page is a file git has never seen, and `commit -- <file>` cannot commit one
      // of those: it refuses the whole command with "did not match any file(s) known to
      // git". Which is every page the board makes, so nothing was ever committed in a
      // repo whose board was new. So the board's own paths are added first, and only
      // those: `git add -- <paths>` leaves everything staged outside them exactly as it
      // was, which is the promise this file makes.
      await git(['add', '--', ...paths()], repo);
      // `commit -- <files>` then commits those files and nothing else, so whatever else
      // somebody has staged is still staged afterwards.
      const made = await git(['commit', '--no-verify', '-m', `Design Book: ${subject}`, '--', ...files], repo);
      if (made.ok) {
        log(`[history] ${subject}`);
        await learn();
        set({ at: Date.now() });
      } else if (!/nothing to commit|no changes added/i.test(made.err + made.out)) {
        log(`[history] could not commit: ${made.err || made.out}`);
      }
    } finally {
      busy = false;
      set({ saving: false });
    }
  }

  return {
    get state() { return state; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    async start() {
      if (!(await find())) return;
      // Whatever was already different when the board opened is the first commit, so the
      // history starts from a known place rather than from whenever the next edit lands.
      await save('opened');
    },

    // Called whenever a board file changes. Held for a moment, because drawing writes a
    // file several times in a few seconds and each of those is not a thing to remember.
    touched() {
      if (!state.on) return;
      clearTimeout(timer);
      timer = setTimeout(() => save(), debounce);
    },

    // The board's commits, newest first.
    async list() {
      if (!state.on) return { ok: false, why: state.why, commits: [] };
      const out = await git([
        'log', `-${MOST}`, '--no-merges',
        '--pretty=format:%H%x00%h%x00%s%x00%cr%x00%an',
        '--', ...paths()
      ], repo);
      if (!out.ok) return { ok: false, why: out.err || 'could not read the history', commits: [] };
      const commits = (out.out || '').split('\n').filter(Boolean).map(line => {
        const [sha, short, subject, when, who] = line.split('\0');
        return { sha, short, subject, when, who };
      });
      return { ok: true, branch, commits };
    },

    // What a commit did to the board, for the person deciding whether it is the one.
    async files(sha) {
      if (!state.on || !/^[0-9a-f]{7,40}$/i.test(sha)) return [];
      const out = await git(['show', '--name-only', '-z', '--pretty=format:', sha, '--', ...paths()], repo, { keep: true });
      return (out.out || '').split('\0').filter(Boolean);
    },

    // Put the board back to how it was at a commit.
    //
    // Forwards, not backwards: the files from that commit are written over the current
    // ones and committed as a new commit. Nothing is reset, so everything that happened
    // since is still in the history and can be gone back to in exactly the same way.
    async revert(sha) {
      if (!state.on) return { ok: false, why: state.why };
      if (!/^[0-9a-f]{7,40}$/i.test(sha)) return { ok: false, why: 'that is not a commit' };
      if (busy) return { ok: false, why: 'something is already being saved' };
      busy = true;
      set({ saving: true });
      try {
        // Whatever is in the folder right now, committed first, so going back can itself
        // be gone back from.
        const pending = await what();
        if (pending) {
          const files = await changedFiles();
          if (files.length) {
            await git(['add', '--', ...paths()], repo);
            await git(['commit', '--no-verify', '-m', `Design Book: ${pending}`, '--', ...files], repo);
          }
        }
        const subject = await git(['log', '-1', '--pretty=format:%s', sha], repo);
        // `checkout <sha> -- <paths>` writes those paths from that commit into the working
        // tree and the index. Only those paths: nothing else in the checkout is touched,
        // and the branch does not move.
        // Only the board's paths that commit actually holds: naming one it does not have
        // makes git refuse the whole checkout, the same way an empty folder did above.
        const held = await git(['ls-tree', '-r', '--name-only', '-z', sha, '--', ...paths()], repo, { keep: true });
        const files = (held.out || '').split('\0').filter(Boolean);
        if (!files.length) return { ok: false, why: 'that commit holds none of the board' };
        const back = await git(['checkout', sha, '--', ...files], repo);
        if (!back.ok) return { ok: false, why: back.err || 'could not read that commit' };
        const name = `Design Book: back to ${sha.slice(0, 7)} ${subject.out || ''}`.trim();
        const after = await changedFiles();
        if (after.length) await git(['add', '--', ...paths()], repo);
        const made = after.length
          ? await git(['commit', '--no-verify', '-m', name, '--', ...after], repo)
          : { ok: false, err: 'nothing to commit' };
        if (!made.ok && !/nothing to commit/i.test(made.err + made.out)) {
          return { ok: false, why: made.err || made.out };
        }
        log(`[history] back to ${sha.slice(0, 7)}`);
        set({ at: Date.now() });
        return { ok: true, at: sha.slice(0, 7) };
      } finally {
        busy = false;
        set({ saving: false });
      }
    },

    stop() { clearTimeout(timer); listeners.clear(); }
  };
}
