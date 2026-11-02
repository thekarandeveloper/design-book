// Finding boards, and making the two halves of one.
//
// A board is a `.designbook` FILE, the board itself, with a `.designbook` FOLDER beside it
// holding everything the board shows. Everything in here is about locating those two,
// creating them, and saying what a folder already has.

const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');

const state = require('./state');

const BOOK_DIR = '.designbook';   // the folder: everything a board needs
const BOOK_EXT = '.designbook';   // the file: the board itself
// What the board was called before, newest first: `.design` until this was Design Book,
// `.canvas` before that. Both the folder and the file are renamed the first time a board
// of that age is opened, so nobody has to move anything by hand.
const LEGACY = ['.design', '.canvas'];

const log = (line) => state.log && state.log.appendLine(line);
// ── discovery ─────────────────────────────────────────────────────────────

const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } };
const isFile = p => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } };
// lstat, not stat: a symlinked `.designbook` is another board's folder borrowed by a project
// so its framework can compile the experiments. The board belongs where the folder really
// lives, and nothing is ever written through the link.
const isRealDir = p => { try { return fs.lstatSync(p).isDirectory(); } catch (_) { return false; } };
const readJson = (file, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
};
// Anything at all at that path, a link included. A link is not a folder we may write
// over, but it is something, so a migration leaves it alone.
const exists = p => { try { fs.lstatSync(p); return true; } catch (_) { return false; } };

// Where a board's folder really is: the name it has now, or the name it had before the
// rename. A board set up by an older version keeps working, and its folder is renamed
// the first time that board is opened.
function resourcesIn(folder) {
  for (const dir of [BOOK_DIR, ...LEGACY]) {
    const hit = path.join(folder, dir);
    if (isRealDir(hit)) return hit;
  }
  return '';
}

// Which board extension a file name carries, if any: the one now or one from before.
// `.designbook` on its own is the folder, not a board called nothing.
function boardExt(name) {
  for (const ext of [BOOK_EXT, ...LEGACY]) {
    if (name.length > ext.length && name.endsWith(ext)) return ext;
  }
  return '';
}

// ── finding boards ────────────────────────────────────────────────────────

const SKIP_SCAN = new Set([
  'node_modules', 'dist', 'build', 'out', 'target', 'vendor',
  '.next', '.astro', '.build', '.gradle', '.venv', 'DerivedData', 'Pods'
]);

function scan(dir, depth, found) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    if (e.isFile() && boardExt(e.name)) {
      found.boards.push(path.join(dir, e.name));
    } else if (e.isDirectory() && (e.name === BOOK_DIR || LEGACY.includes(e.name))) {
      found.folders.push(path.join(dir, e.name));
    }
  }
  if (depth <= 0) return;
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || SKIP_SCAN.has(e.name)) continue;
    scan(path.join(dir, e.name), depth - 1, found);
  }
}

// Scanning is cheap but it happens on every refresh, so the answer is held for a moment.
let boardCache = { at: 0, list: [] };
const forgetBoards = () => { boardCache.at = 0; };

function boardFiles() {
  if (Date.now() - boardCache.at < 3000) return boardCache.list;
  const found = { boards: [], folders: [] };
  for (const folder of vscode.workspace.workspaceFolders || []) scan(folder.uri.fsPath, 2, found);
  // A board made before the file existed is listed under the name its file will have.
  // Nothing is written for it here: looking at a workspace should never add a file to a
  // repo. The file appears the first time that board is opened.
  for (const root of found.folders) {
    const folder = path.dirname(root);
    if (found.boards.some(file => path.dirname(file) === folder)) continue;
    found.boards.push(legacyBoardPath(folder));
  }
  const list = [...new Set(found.boards)].sort();
  boardCache = { at: Date.now(), list };
  return list;
}

const boardIn = folder => {
  try {
    const files = fs.readdirSync(folder)
      .filter(f => boardExt(f) && isFile(path.join(folder, f)))
      .sort();
    const hit = files.find(f => f.endsWith(BOOK_EXT)) || files[0];
    return hit ? path.join(folder, hit) : '';
  } catch (_) { return ''; }
};

// What an older board's file will be called, from the name it already keeps.
function legacyBoardPath(folder) {
  const root = resourcesIn(folder) || path.join(folder, BOOK_DIR);
  const cfg = readJson(path.join(root, 'studio.config.json'), {}) || {};
  const name = String(cfg.name || path.basename(folder).replace(/^\d+-/, '')).trim();
  return path.join(folder, name + BOOK_EXT);
}

function canvasForBoard(file) {
  const folder = path.dirname(file);
  const doc = readJson(file);
  const name = doc && typeof doc.name === 'string' && doc.name.trim()
    ? doc.name.trim()
    : path.basename(file, boardExt(path.basename(file)) || BOOK_EXT);
  return { id: path.join(folder, BOOK_DIR), file, root: path.join(folder, BOOK_DIR), folder, name };
}

const canvases = () => boardFiles().map(canvasForBoard);
const firstCanvas = () => canvases()[0] || null;

// The board for a folder, whatever its file happens to be called.
function canvasFor(folder) {
  const existing = boardIn(folder);
  if (existing) return canvasForBoard(existing);
  if (!resourcesIn(folder)) return null;
  const made = ensureBoardFile(folder);
  return made ? canvasForBoard(made) : null;
}

const hasCanvas = folder => !!boardIn(folder) || !!resourcesIn(folder);

// ── the two halves of a board ─────────────────────────────────────────────

// The file. Written once, and it absorbs the config a board set up by an older version
// kept in its folder, so there is one place to look rather than three.
// Opening a `.designbook` file that somebody just made: it is empty, or it is not a board
// yet, so it is given the shape of one. A file that already holds a board is read and
// left exactly as it is.
function ensureBoardDoc(canvas) {
  const doc = readJson(canvas.file);
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return ensureBoardFile(canvas.folder, canvas.name, { overwrite: true });
  }
  // A board written under an older name says so in two places: the version key it opens
  // with and the folder it names. Both are brought up to date and nothing else in the
  // file is touched, so the sections and the frame sizes are exactly as they were.
  if (doc.designbook === 1 && doc.resources === BOOK_DIR) return;
  const fixed = { designbook: 1 };
  for (const [key, value] of Object.entries(doc)) {
    if (key === 'design' || key === 'canvas' || key === 'designbook') continue;
    fixed[key] = key === 'resources' ? BOOK_DIR : value;
  }
  if (!fixed.resources) fixed.resources = BOOK_DIR;
  try {
    fs.writeFileSync(canvas.file, JSON.stringify(fixed, null, 2) + '\n');
    log(`[design book] ${path.basename(canvas.file)} brought up to date`);
  } catch (err) {
    log(`[design book] could not update ${canvas.file}: ${err.message}`);
  }
}

function ensureBoardFile(folder, nameArg, { overwrite = false } = {}) {
  const root = resourcesIn(folder) || path.join(folder, BOOK_DIR);
  const cfg = readJson(path.join(root, 'studio.config.json'), {}) || {};
  const name = String(nameArg || cfg.name || path.basename(folder).replace(/^\d+-/, '')).trim();
  const file = path.join(folder, name + BOOK_EXT);
  if (isFile(file) && !overwrite) return file;

  const doc = {
    designbook: 1,
    name,
    resources: BOOK_DIR,
    frame: cfg.frame || { width: 1440, height: 900 },
    sections: [],
    frames: {}
  };
  if (cfg.live) doc.live = cfg.live;
  if (cfg.note) doc.note = cfg.note;
  // Sizes carry over; the free x and y do not, because sections place frames now.
  const old = readJson(path.join(root, 'canvas.json'), {}) || {};
  for (const [id, saved] of Object.entries(old.frames || {})) {
    const keep = {};
    if (typeof saved.width === 'number') keep.width = saved.width;
    if (typeof saved.height === 'number') keep.height = saved.height;
    if (Object.keys(keep).length) doc.frames[id] = keep;
  }

  try {
    fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
    for (const absorbed of ['studio.config.json', 'canvas.json']) {
      try { fs.unlinkSync(path.join(root, absorbed)); } catch (_) {}
    }
    log(`[design book] ${path.basename(file)} written beside ${BOOK_DIR}/`);
    forgetBoards();
    return file;
  } catch (err) {
    log(`[design book] could not write ${file}: ${err.message}`);
    return '';
  }
}

// The folder. Everything the board needs, next to the board.
// Somebody else's `.design` file is not ours to rename. It is one of ours if it holds a
// board, or if a board's folder sits beside it.
function looksLikeBoard(file) {
  const doc = readJson(file);
  if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
    if (doc.designbook || doc.design || doc.canvas) return true;
    if (doc.frames && doc.sections) return true;
  }
  return !!resourcesIn(path.dirname(file));
}

// A board file with an older extension is renamed to `.designbook`, and the path it
// now has is returned. The board document itself does not change: only its name does,
// so that double-clicking it opens the board rather than a page of JSON.
function migrateBoardFile(file) {
  const base = path.basename(file);
  const ext = boardExt(base);
  if (!ext || ext === BOOK_EXT) return file;
  if (!looksLikeBoard(file)) return file;
  const renamed = path.join(path.dirname(file), base.slice(0, -ext.length) + BOOK_EXT);
  if (exists(renamed)) return renamed;
  try {
    fs.renameSync(file, renamed);
    log(`[design book] ${base} renamed to ${path.basename(renamed)}`);
    forgetBoards();
    return renamed;
  } catch (err) {
    log(`[design book] could not rename ${base}: ${err.message}`);
    return file;
  }
}

function ensureResources(canvas) {
  if (isRealDir(canvas.root)) return;
  // A `.designbook` that is a link is another board's folder, borrowed by this project so
  // that its framework can compile the experiments. It is set up already, where it
  // really lives, and nothing is ever written through the link.
  if (exists(canvas.root)) return;

  // The folder used to be called `.canvas`. Renaming it keeps the pages, the references
  // and the notes under them; copying the template beside it would leave all of that
  // orphaned in a folder nothing reads any more.
  const legacy = resourcesIn(canvas.folder);
  if (legacy) {
    try {
      fs.renameSync(legacy, canvas.root);
      log(`[design book] ${path.basename(legacy)}/ renamed to ${BOOK_DIR}/`);
      forgetBoards();
      return;
    } catch (err) {
      log(`[design book] could not rename ${legacy}: ${err.message}`);
    }
  }

  copyDir(path.join(state.extensionPath, 'templates', BOOK_DIR.slice(1)), canvas.root);
  log(`[design book] ${BOOK_DIR}/ created beside ${path.basename(canvas.file)}`);
}

const foldersWithoutCanvas = () =>
  (vscode.workspace.workspaceFolders || [])
    .filter(f => !hasCanvas(f.uri.fsPath))
    .map(f => f.uri.fsPath);

// Every git repo in the workspace, including one level of children, so a workspace
// holding several product repos lists all of them rather than just its root.
function gitRepos() {
  const seen = new Map();
  const add = (dir, workspaceRoot) => {
    if (seen.has(dir)) return;
    if (!isDir(path.join(dir, '.git'))) return;
    // `01-App` on its own says nothing, so a nested repo is labelled by the folder it
    // sits under: "Plate / 01-App".
    const rel = path.relative(workspaceRoot, dir);
    const base = path.basename(workspaceRoot).replace(/^\d+-/, '');
    seen.set(dir, {
      folder: dir,
      name: rel ? `${base} / ${rel}` : base,
      hasCanvas: hasCanvas(dir)
    });
  };
  for (const folder of vscode.workspace.workspaceFolders || []) {
    const root = folder.uri.fsPath;
    add(root, root);
    let children = [];
    try {
      children = fs.readdirSync(root, { withFileTypes: true })
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => path.join(root, e.name));
    } catch (_) {}
    for (const child of children) {
      add(child, root);
      // One more level: a workspace of products where each product holds its own repo.
      try {
        for (const e of fs.readdirSync(child, { withFileTypes: true })) {
          if (e.isDirectory() && !e.name.startsWith('.')) add(path.join(child, e.name), root);
        }
      } catch (_) {}
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ── setting a repo up ─────────────────────────────────────────────────────

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
  }
}

const SKIP = new Set(['node_modules', 'build', '.git', '.gradle', 'DerivedData', 'Pods', '.build', 'dist']);

function findDesignTokens(dir, depth = 0) {
  if (depth > 8) return null;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return null; }
  for (const e of entries) if (e.isFile() && e.name === 'DesignTokens.kt') return path.join(dir, e.name);
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || SKIP.has(e.name)) continue;
    const hit = findDesignTokens(path.join(dir, e.name), depth + 1);
    if (hit) return hit;
  }
  return null;
}

module.exports = {
  BOOK_DIR, BOOK_EXT, LEGACY, boardExt, migrateBoardFile, ensureBoardDoc,
  isDir, isFile, isRealDir, exists, readJson, resourcesIn,
  scan, boardFiles, forgetBoards, boardIn, legacyBoardPath, canvasForBoard,
  canvases, firstCanvas, canvasFor, hasCanvas,
  ensureBoardFile, ensureResources, foldersWithoutCanvas, gitRepos,
  copyDir, findDesignTokens, SKIP
};
