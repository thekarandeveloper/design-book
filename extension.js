// Design Book
//
// A board is a file. `Rachna Labs.designbook` is the board: its name, the project it
// watches, its sections, and the size of every frame. The `.designbook` folder beside it is
// the warehouse: the experiments, the references, the rules Claude reads.
//
// This file is the wiring: what the editor can be asked to do, and what happens in the
// sidebar. The work itself lives next door, one file per job:
//
//   src/state.js         what every part shares: the log, the servers, the tabs
//   src/boards.js        finding a board, and making the two halves of one
//   src/server.js        the board server for a board, and talking to it
//   src/board-editor.js  the board as an editor tab, and the webview it holds
//   src/claude.js        the pointer in CLAUDE.md, and the arrow on a frame

const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');

const state = require('./src/state');
const {
  BOOK_DIR, BOOK_EXT,
  canvases, canvasFor, canvasForBoard, firstCanvas, forgetBoards,
  ensureBoardFile, ensureResources, foldersWithoutCanvas, gitRepos,
  findDesignTokens, isFile
} = require('./src/boards');
const { request, ensureServer, stopServer, stopAll } = require('./src/server');
const {
  VIEW_TYPE, BoardEditor, openCanvas, openSetup, openInBrowser, postToPanel, tellTheme
} = require('./src/board-editor');
const { ensureClaudeContext, askClaude } = require('./src/claude');
const { ensureSkill, skillHome } = require('./src/skill');

let log;
let tree;

function activate(context) {
  state.extensionPath = context.extensionPath;
  log = state.log = vscode.window.createOutputChannel('Design');
  tree = new CanvasTree();
  state.hooks.refresh = () => tree.refresh();
  state.hooks.start = () => start();

  const cmd = (name, fn) => vscode.commands.registerCommand('designbook.' + name, fn);
  const canvasOf = item => item?.canvas || firstCanvas();

  context.subscriptions.push(
    log,
    vscode.window.registerTreeDataProvider('designbook.tree', tree),

    // Opening a `.designbook` file opens the board it describes.
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, new BoardEditor(), {
      webviewOptions: { retainContextWhenHidden: true, enableFindWidget: false },
      supportsMultipleEditorsPerDocument: false
    }),

    cmd('open', item => openCanvas(canvasOf(item), item?.route)),
    cmd('setUp', setUp),
    cmd('newCanvas', newCanvasFile),
    cmd('refresh', () => tree.refresh()),
    cmd('newScreen', item => newScreen(canvasOf(item))),
    cmd('copyContext', item => copyContext(canvasOf(item))),
    cmd('start', start),
    cmd('askClaude', item => askClaude(canvasOf(item))),
    cmd('linkClaude', item => {
      const canvas = canvasOf(item);
      if (!canvas) return;
      ensureClaudeContext(canvas);
      vscode.window.showInformationMessage(`CLAUDE.md in ${path.basename(canvas.folder)} now points at ${BOOK_DIR}/.`);
    }),
    cmd('openInBrowser', item => openInBrowser(canvasOf(item), item?.route)),
    cmd('revealFolder', item => {
      const canvas = canvasOf(item);
      if (canvas) vscode.env.openExternal(vscode.Uri.file(canvas.root));
    }),
    cmd('restart', item => {
      const canvas = canvasOf(item);
      if (!canvas) return;
      stopServer(canvas.root);
      ensureServer(canvas).then(() => tree.refresh());
    }),
    cmd('showLog', () => log.show()),
    cmd('installSkill', async () => {
      ensureSkill({ force: true });
      const open = await vscode.window.showInformationMessage(
        'The Claude skill is installed.', 'Show it'
      );
      if (open) {
        vscode.window.showTextDocument(vscode.Uri.file(path.join(skillHome(), 'SKILL.md')));
      }
    }),
    cmd('syncTokens', item => syncTokens(canvasOf(item))),
    cmd('openFile', file => vscode.window.showTextDocument(vscode.Uri.file(file))),

    vscode.workspace.onDidChangeWorkspaceFolders(() => tree.refresh()),
    // The board is an iframe and inherits none of the editor's colours, so it is told
    // whenever they change.
    vscode.window.onDidChangeActiveColorTheme(() => tellTheme()),
    { dispose: stopAll }
  );

  // A board made, renamed or deleted anywhere in the workspace, by hand or by Claude.
  //
  // Debounced, because the board writes its own file as frames are dragged and resized,
  // and a rename arrives as a delete and a create: the list is wanted once, after the
  // dust has settled, not three times while it is in the air.
  let soon;
  const bump = () => {
    clearTimeout(soon);
    soon = setTimeout(() => tree.refresh(), 300);
  };
  const watcher = vscode.workspace.createFileSystemWatcher(`**/*${BOOK_EXT}`);
  watcher.onDidCreate(bump);
  watcher.onDidChange(bump);
  watcher.onDidDelete(bump);
  context.subscriptions.push(watcher, { dispose: () => clearTimeout(soon) });

  const folderWatcher = vscode.workspace.createFileSystemWatcher(`**/${BOOK_DIR}/**`);
  folderWatcher.onDidCreate(bump);
  folderWatcher.onDidDelete(bump);
  context.subscriptions.push(folderWatcher);

  // A way in from outside the editor.
  //
  // Claude runs in a terminal and cannot call a VS Code command, but it can touch a
  // file. Writing `.designbook/.open` brings the board up, so asking for four variations
  // ends with them on screen rather than with a sentence about where they are.
  const opener = vscode.workspace.createFileSystemWatcher(`**/${BOOK_DIR}/.open`);
  const onOpenRequest = async uri => {
    const root = path.dirname(uri.fsPath);
    const canvas = canvasFor(path.dirname(root));
    if (!canvas) return;
    let route = 'pages';
    try {
      const asked = fs.readFileSync(uri.fsPath, 'utf8').trim();
      if (asked) route = asked;
    } catch (_) {}
    try { fs.unlinkSync(uri.fsPath); } catch (_) {}
    tree.refresh();
    await openCanvas(canvas, route);
  };
  opener.onDidCreate(onOpenRequest);
  opener.onDidChange(onOpenRequest);
  context.subscriptions.push(opener);

  // The half of this that lives outside the editor: the skill an agent reads.
  ensureSkill();

  setContext();
}

function deactivate() { stopAll(); }

// What the plugin asks first: a board that already exists, a repo to make one in, or a
// folder of your own.
async function start() {
  const boards = canvases();
  const repos = gitRepos().filter(r => !boards.some(c => c.folder === r.folder));

  const items = [];
  if (boards.length) {
    items.push({ label: 'Boards', kind: vscode.QuickPickItemKind.Separator });
    items.push(...boards.map(c => ({
      label: path.basename(c.file),
      description: c.name,
      detail: c.folder,
      canvas: c
    })));
  }
  if (repos.length) {
    items.push({ label: 'No board yet', kind: vscode.QuickPickItemKind.Separator });
    items.push(...repos.map(r => ({ label: r.name, description: 'set this repo up', detail: r.folder, repo: r })));
  }
  items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
  items.push({
    label: 'A board somewhere else',
    description: 'pick any folder',
    detail: 'The board opens with Setup on it, and reads that folder when you press it',
    create: true
  });

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: boards.length ? 'Open a board' : 'No board in this workspace yet',
    matchOnDetail: true
  });
  if (!pick) return;

  if (pick.create) return createElsewhere();
  if (pick.canvas) return openCanvas(pick.canvas, 'pages');
  if (pick.repo) return setUp(pick.repo.folder);
}

async function createElsewhere() {
  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    openLabel: 'Set this folder up',
    title: 'Which folder should the board be about?'
  });
  if (!picked?.length) return;
  const folder = picked[0].fsPath;

  // The board is only found inside an open folder, so add it if it is not one already.
  const open = (vscode.workspace.workspaceFolders || []).some(f => f.uri.fsPath === folder);
  if (!open) {
    vscode.workspace.updateWorkspaceFolders(
      (vscode.workspace.workspaceFolders || []).length, 0, { uri: vscode.Uri.file(folder) }
    );
  }
  await setUp(folder);
}

function setContext() {
  vscode.commands.executeCommand('setContext', 'designbook.hasCanvas', canvases().length > 0);
}

// ── the tree ──────────────────────────────────────────────────────────────

class CanvasTree {
  constructor() {
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
  }
  refresh() {
    forgetBoards();
    setContext();
    this._emitter.fire();
  }
  getTreeItem(item) { return item; }

  // Every board in the workspace, in one list, however many repos are open. Under them,
  // a row for each folder that has no board yet, which is where setting one up starts.
  async getChildren(item) {
    if (item) return [];
    const nodes = canvases().map(canvasNode);
    for (const folder of foldersWithoutCanvas()) {
      nodes.push(node(`Set up ${path.basename(folder).replace(/^\d+-/, '')}`, NONE, {
        contextValue: 'setup',
        iconPath: new vscode.ThemeIcon('add'),
        description: 'no board here yet',
        tooltip: folder,
        command: { command: 'designbook.setUp', title: 'Set up', arguments: [folder] }
      }));
    }
    return nodes;
  }
}

function node(label, collapsible, props) {
  return Object.assign(new vscode.TreeItem(label, collapsible), props);
}

const COLLAPSED = vscode.TreeItemCollapsibleState.Collapsed;
const NONE = vscode.TreeItemCollapsibleState.None;

// One row per board. The folder is on every row, always, because two repos can hold a
// board of the same name and the name alone would not tell them apart.
function canvasNode(canvas) {
  return node(canvas.name, NONE, {
    kind: 'canvas', canvas, contextValue: 'canvas',
    iconPath: new vscode.ThemeIcon('layout'),
    resourceUri: vscode.Uri.file(canvas.file),
    tooltip: canvas.file,
    description: folderLabel(canvas.folder),
    command: { command: 'designbook.open', title: 'Open board', arguments: [{ canvas, route: 'pages' }] }
  });
}

// Where a board lives, said the way the workspace reads it: "Plate / 02-Platforms", so a
// nested repo is named by the product it belongs to rather than by `01-App` on its own.
function folderLabel(folder) {
  for (const open of vscode.workspace.workspaceFolders || []) {
    const root = open.uri.fsPath;
    if (folder !== root && !folder.startsWith(root + path.sep)) continue;
    const base = path.basename(root).replace(/^\d+-/, '');
    const rel = path.relative(root, folder);
    return rel ? `${base} / ${rel}` : base;
  }
  return folder;
}

// Setting a repo up.
//
// Nothing is written from here. A repo with no board file is given the board itself,
// empty, with one Setup button on it: the work of reading the repo belongs to the board
// server, which is the only part of this that can report on it step by step while it
// runs. So all this does is settle which folder, and open it.
async function setUp(folderArg) {
  let folder = typeof folderArg === 'string' ? folderArg : null;
  if (!folder) {
    const options = foldersWithoutCanvas();
    if (!options.length) {
      const existing = canvases();
      if (existing.length) return openCanvas(existing[0], 'pages');
      return createElsewhere();
    }
    if (options.length === 1) folder = options[0];
    else {
      const pick = await vscode.window.showQuickPick(
        options.map(f => ({ label: path.basename(f), description: f, folder: f })),
        { placeHolder: 'Which repo?' }
      );
      if (!pick) return;
      folder = pick.folder;
    }
  }
  return openSetup(folder);
}

// A second board in a folder that already has one: same warehouse, another board. Two
// boards beside one `.designbook` folder share its experiments and its references, which is
// how one project can have a board per surface.
async function newCanvasFile() {
  const folders = (vscode.workspace.workspaceFolders || []).map(f => f.uri.fsPath);
  if (!folders.length) return createElsewhere();
  const folder = folders.length === 1 ? folders[0] : await (async () => {
    const pick = await vscode.window.showQuickPick(
      folders.map(f => ({ label: path.basename(f), description: f, folder: f })),
      { placeHolder: 'Which folder?' }
    );
    return pick && pick.folder;
  })();
  if (!folder) return;

  const name = await vscode.window.showInputBox({
    prompt: 'What is this board called?',
    placeHolder: 'Marketing site',
    validateInput: v => (/[\\/:]/.test(v || '') ? 'A file name, so no slashes.' : null)
  });
  if (!name) return;

  const file = path.join(folder, name + BOOK_EXT);
  if (isFile(file)) {
    forgetBoards();
    return openCanvas(canvasForBoard(file), 'pages');
  }
  const canvas = canvasForBoard(file);
  ensureResources(canvas);
  const written = ensureBoardFile(folder, name);
  if (!written) return;
  forgetBoards();
  tree.refresh();
  ensureClaudeContext(canvas);
  openCanvas(canvasForBoard(written), 'pages');
}

// ── commands that change the repo ─────────────────────────────────────────

async function newScreen(canvas) {
  const port = await ensureServer(canvas);
  if (!port) return;
  const title = await vscode.window.showInputBox({
    prompt: 'Screen name, as a person would say it',
    placeHolder: 'Recipe detail'
  });
  if (!title) return;
  const { id } = await request(port, '/__api/page/new', { method: 'POST', body: { title } });
  tree.refresh(true);
  openCanvas(canvas, `edit/${id}`);
}

async function copyContext(canvas) {
  const port = await ensureServer(canvas);
  if (!port) return;
  await vscode.env.clipboard.writeText(await request(port, '/__api/brief', { raw: true }));
  vscode.window.showInformationMessage('The board context is copied. Paste it to Claude.');
}

async function syncTokens(canvas) {
  if (!canvas) return;
  let kt = findDesignTokens(canvas.folder);
  if (!kt) {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true, canSelectFolders: false,
      openLabel: 'Use this DesignTokens.kt', filters: { Kotlin: ['kt'] }
    });
    if (!picked?.length) return;
    kt = picked[0].fsPath;
  }
  try {
    const { generateTokensCss } = require(path.join(extensionPath, 'app', 'tools', 'gen-tokens.cjs'));
    fs.writeFileSync(path.join(canvas.root, 'tokens.css'), generateTokensCss(kt));
    vscode.window.showInformationMessage(`tokens.css written from ${path.basename(kt)}.`);
  } catch (err) {
    vscode.window.showErrorMessage(`Could not generate tokens.css: ${err.message}`);
  }
}

module.exports = { activate, deactivate };
