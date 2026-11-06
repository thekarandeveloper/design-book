// Remembering how something looked, and going back to it.
//
// "Remember this look" takes two things at once: a picture of the element, and a snapshot
// of the project's files as they are at that moment. Asking Claude for a change happens
// between them and what comes after. Comparing shows the picture as it was beside the
// picture as it is, and names the files that changed in between. Undoing puts those files
// back to what they were when the look was remembered.
//
// The snapshot is `git stash create`: a commit object holding the working tree, made
// without touching it, without a stash entry and without a branch. Nothing about the
// repo's history changes. Undoing does not rewrite anything either; it copies files from
// that commit back, and first makes a snapshot of what is there, so an undo can be undone.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const git = (cwd, args) => new Promise((resolve, reject) => {
  execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, out, errText) => {
    if (err) reject(new Error((errText || err.message).trim()));
    else resolve(String(out).replace(/\n+$/, ''));
  });
});

// Not the board's own files, and not the framework's cache: changes to those are not what
// anybody asked Claude for.
// A draft frame lives in `.designbook/pages` and a part in `.designbook/parts`, and those are
// exactly what Claude edits, so they count. What the board keeps for itself does not.
const noise = file => /^\.designbook\/(\.|checks\.json|studio\.json|CLAUDE\.md|refs\.json|refs\/)/.test(file)
  || /\.designbook$/.test(file) || /^\.next\//.test(file)
  || /(^|\/)node_modules\//.test(file) || /^\.astro\//.test(file);

export async function repoOf(cwd) {
  try { return await git(cwd, ['rev-parse', '--show-toplevel']); } catch (_) { return ''; }
}

export async function snapshot(cwd) {
  const root = await repoOf(cwd);
  if (!root) return null;
  let hash = '';
  try { hash = await git(root, ['stash', 'create']); } catch (_) {}
  if (!hash) {
    try { hash = await git(root, ['rev-parse', 'HEAD']); } catch (_) { return null; }
  }
  let untracked = [];
  try { untracked = (await git(root, ['ls-files', '--others', '--exclude-standard'])).split('\n').filter(Boolean); } catch (_) {}
  return { root, hash, untracked };
}

// What changed since: files that were there and are different now, and files that were not
// there and are. The first can be put back; the second are named, and left alone.
export async function since(snap) {
  const changed = (await git(snap.root, ['diff', '--name-only', snap.hash]).catch(() => ''))
    .split('\n').filter(f => f && !noise(f));
  let now = [];
  try { now = (await git(snap.root, ['ls-files', '--others', '--exclude-standard'])).split('\n').filter(Boolean); } catch (_) {}
  const before = new Set(snap.untracked || []);
  const created = now.filter(f => !before.has(f) && !noise(f));

  // A file that did not exist in the snapshot cannot be restored from it.
  const restorable = [];
  const added = [];
  for (const f of changed) {
    try { await git(snap.root, ['cat-file', '-e', `${snap.hash}:${f}`]); restorable.push(f); } catch (_) { added.push(f); }
  }
  return { changed: restorable, added: [...added, ...created] };
}

// Puts these files back as they were, after making a snapshot of how they are now.
export async function restore(snap, files) {
  const keep = await snapshot(snap.root);
  const inside = files.filter(f => {
    const full = path.resolve(snap.root, f);
    return full.startsWith(snap.root + path.sep) && !noise(f);
  });
  if (!inside.length) return { restored: [], redo: null };
  await git(snap.root, ['restore', `--source=${snap.hash}`, '--worktree', '--', ...inside]);
  return { restored: inside, redo: keep ? keep.hash : null };
}

export const exists = file => { try { return fs.existsSync(file); } catch (_) { return false; } };
