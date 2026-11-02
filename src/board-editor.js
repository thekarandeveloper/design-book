// The board, as an editor tab.

const vscode = require('vscode');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const state = require('./state');

const VIEW_TYPE = 'designbook.board';
const {
  canvasForBoard, ensureBoardDoc, ensureBoardFile, ensureResources,
  forgetBoards, isFile, legacyBoardPath, migrateBoardFile
} = require('./boards');
const { ensureServer, releaseServer } = require('./server');
const { ensureClaudeContext, askClaude } = require('./claude');

const log = (line) => state.log && state.log.appendLine(line);
const panels = state.panels;
const pendingRoute = state.pendingRoute;
const tree = { refresh: () => state.hooks.refresh() };
const start = () => state.hooks.start();

// The editor's own theme, which the board follows. A webview inherits VS Code's colours,
// but the board is an iframe on its own origin and inherits nothing, so it is told.
function editorTheme() {
  const kind = vscode.window.activeColorTheme && vscode.window.activeColorTheme.kind;
  const light = [vscode.ColorThemeKind && vscode.ColorThemeKind.Light,
                 vscode.ColorThemeKind && vscode.ColorThemeKind.HighContrastLight];
  return light.includes(kind) ? 'light' : 'dark';
}

// Every open board, told at once.
function tellTheme() {
  const theme = editorTheme();
  for (const panel of state.panels.values()) {
    try { panel.webview.postMessage({ type: 'theme', theme }); } catch (_) {}
  }
}

// ── the board, as an editor tab ───────────────────────────────────────────
//
// The `.designbook` file is registered as a custom editor, so double-clicking it in the
// explorer opens the board, and VS Code does the rest: the tab has the file's name, it
// reopens with the window, and it can be dragged into a split beside the code it is
// about.
//
// The tab is one iframe over the board server. A webview cannot host a Vite app itself:
// its module graph, its HMR socket and its routing all need a real origin.

// Every tab showing one file, closed. Used when that file has just been renamed.
async function closeTabsFor(file) {
  const groups = (vscode.window.tabGroups && vscode.window.tabGroups.all) || [];
  for (const group of groups) {
    for (const tab of group.tabs || []) {
      const uri = tab.input && tab.input.uri;
      if (!uri || uri.fsPath !== file) continue;
      try { await vscode.window.tabGroups.close(tab); } catch (_) {}
    }
  }
}

class BoardEditor {
  async openCustomDocument(uri) {
    return { uri, dispose() {} };
  }

  // Nothing here edits the file as text. The board writes itself through the board
  // server, so VS Code never has a dirty buffer to reconcile with what is on disk.
  async resolveCustomEditor(document, panel) {
    // A board from before this was called Design Book. Its file is renamed, and the
    // renamed file is opened instead: renaming under an open tab would leave that tab
    // pointing at nothing, so this one closes as the new one opens.
    const moved = migrateBoardFile(document.uri.fsPath);
    if (moved !== document.uri.fsPath) {
      ensureResources(canvasForBoard(moved));
      await closeTabsFor(document.uri.fsPath);
      await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(moved), VIEW_TYPE);
      return;
    }

    // Both halves, whichever is missing: the folder beside the file, and the board in
    // the file. Somebody can make an empty `.designbook` file, open it, and have a board.
    const canvas = canvasForBoard(document.uri.fsPath);
    ensureResources(canvas);
    ensureBoardDoc(canvas);
    // Written before anything else is tried, and written every time a board is opened,
    // so the repo this board sits in always tells an agent how to work on it, even if
    // nothing else here starts.
    ensureClaudeContext(canvas);

    panels.set(canvas.root, panel);
    panel.onDidDispose(() => {
      if (panels.get(canvas.root) === panel) panels.delete(canvas.root);
      releaseServer(canvas.root);
    });
    panel.webview.options = { enableScripts: true, localResourceRoots: [] };
    wirePanel(panel, canvas);
    panel.webview.html = startingHtml(canvas.name);

    const port = await ensureServer(canvas);
    if (!port) {
      panel.webview.html = failedHtml(canvas.name);
      state.log && state.log.show();
      return;
    }
    hideChrome(canvas);

    const route = pendingRoute.get(canvas.root) || 'pages';
    pendingRoute.delete(canvas.root);
    // The theme rides in the address so the board is never the wrong colour for a
    // moment on the way in.
    panel.webview.html = frameHtml(`http://localhost:${port}/?theme=${editorTheme()}#/${route}`, port);
    forgetBoards();
    tree.refresh();
  }
}

function wirePanel(panel, canvas) {
  panel.webview.onDidReceiveMessage(msg => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'log') state.log && state.log.show();
    if (msg.type === 'changed') tree.refresh();
    // The setup pass has finished, so the repo has a board file now. The panel that ran
    // it goes, and the board comes back as what it is from here on: a file you opened.
    if (msg.type === 'setUpDone' && typeof msg.file === 'string') {
      const made = path.resolve(canvas.folder, msg.file);
      if (!made.startsWith(canvas.folder + path.sep) || !made.endsWith('.designbook')) return;
      forgetBoards();
      const board = canvasForBoard(made);
      ensureClaudeContext(board);
      tree.refresh();
      panel.dispose();
      openCanvas(board, 'pages');
    }
    // The arrow on a frame.
    if (msg.type === 'askClaude') askClaude(canvas, typeof msg.file === 'string' ? msg.file : '');
    // The board is in an iframe, where the clipboard is not always allowed. The editor's
    // own clipboard always is.
    if (msg.type === 'copy' && typeof msg.text === 'string') {
      vscode.env.clipboard.writeText(msg.text);
      vscode.window.setStatusBarMessage(`Design: ${msg.text} copied.`, 3000);
    }
    if (msg.type === 'say' && typeof msg.text === 'string') {
      vscode.window.setStatusBarMessage(`Design: ${msg.text}`, 5000);
    }
    if (msg.type === 'failed' && typeof msg.text === 'string') {
      vscode.window.showWarningMessage(msg.text, 'Show the log').then(go => { if (go) state.log && state.log.show(); });
    }
    // A frame exported as a picture: shown in Finder, where it is going to be used.
    if (msg.type === 'reveal' && typeof msg.file === 'string') {
      const target = path.resolve(canvas.root, msg.file);
      if (!target.startsWith(os.homedir() + path.sep) || !fs.existsSync(target)) return;
      // Shown in Finder, and Finder brought forward: an exported file is on its way
      // somewhere else, so the next thing you do is pick it up.
      Promise.resolve(vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(target)))
        .catch(() => {})
        .then(() => vscode.env.openExternal(vscode.Uri.file(path.dirname(target))));
      vscode.window.setStatusBarMessage(`Design: ${path.basename(target)} written.`, 4000);
    }
    // A tile on the board asking for a file: the board is in an iframe and has no
    // editor of its own, so opening it is the extension's job. Paths come relative to
    // the board folder, and a live project may sit outside the repo entirely, so both
    // are allowed and nothing above the home folder is.
    if (msg.type === 'openRepoFile' && typeof msg.file === 'string') {
      const target = path.resolve(canvas.root, msg.file);
      if (!target.startsWith(os.homedir() + path.sep)) return;
      // With a line, the cursor lands on the thing that was clicked.
      const line = Number(msg.line) > 0 ? Number(msg.line) - 1 : 0;
      const at = new vscode.Range(line, 0, line, 0);
      vscode.window.showTextDocument(vscode.Uri.file(target), {
        preview: true,
        selection: line ? at : undefined
      });
    }
  });
}

// The tab holds the board and nothing else.
//
// VS Code draws a breadcrumb over every editor, which on a board is a line of file path
// above the work. It is a window setting, not a per editor one, so it is only turned off
// where the whole window is one board: a folder with a board in it and no repo around it.
// A repo's settings are shared with whoever else works in it and are left alone.
function hideChrome(canvas) {
  const folder = (vscode.workspace.workspaceFolders || [])
    .find(f => f.uri.fsPath === canvas.folder);
  if (!folder) return;
  try { if (fs.statSync(path.join(canvas.folder, '.git')).isDirectory()) return; } catch (_) {}

  const config = vscode.workspace.getConfiguration('breadcrumbs', folder.uri);
  const set = config.inspect('enabled');
  if (set && set.workspaceFolderValue === false) return;
  config.update('enabled', false, vscode.ConfigurationTarget.WorkspaceFolder).then(
    () => log(`[design book] breadcrumbs turned off for ${path.basename(canvas.folder)}; the tab is the board alone`),
    () => {}
  );
}

async function openCanvas(canvas, route) {
  if (!canvas) {
    const go = await vscode.window.showWarningMessage('No board in this workspace yet.', 'Make one');
    if (go) start();
    return;
  }

  // Routing an open board keeps its state, which reopening its tab would lose.
  const panel = panels.get(canvas.root);
  if (panel) {
    panel.webview.postMessage({ type: 'route', route: '/' + (route || 'pages') });
    try { panel.reveal(vscode.ViewColumn.Active, false); } catch (_) {}
    return;
  }

  if (!isFile(canvas.file)) {
    const written = ensureBoardFile(canvas.folder, canvas.name);
    if (!written) return;
  }
  pendingRoute.set(canvas.root, route || 'pages');
  await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(canvas.file), VIEW_TYPE);
}

// A repo with no board yet.
//
// There is no file to open, so there is no document and no custom editor: the board comes
// up as a plain panel showing one Setup button. Nothing is written into the repo on the
// way in, which is the point. Pressing the button runs the setup pass on the board
// server, and when it has written the board file the panel hands over to the file's own
// tab.
async function openSetup(folder) {
  const canvas = canvasForBoard(legacyBoardPath(folder));

  const open = panels.get(canvas.root);
  if (open) {
    try { open.reveal(vscode.ViewColumn.Active, false); } catch (_) {}
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    VIEW_TYPE + '.setup',
    path.basename(folder).replace(/^\d+-/, ''),
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] }
  );
  panels.set(canvas.root, panel);
  panel.onDidDispose(() => {
    if (panels.get(canvas.root) === panel) panels.delete(canvas.root);
    releaseServer(canvas.root);
  });
  wirePanel(panel, canvas);
  panel.webview.html = startingHtml(canvas.name);

  const port = await ensureServer(canvas);
  if (!port) {
    panel.webview.html = failedHtml(canvas.name);
    state.log && state.log.show();
    return;
  }
  panel.webview.html = frameHtml(`http://localhost:${port}/?theme=${editorTheme()}#/pages`, port);
  log(`[design book] ${folder} has no board yet: Setup is on the board`);
}

const shellHtml = body => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; height: 100%; background: #141618; }
  div { padding: 44px; color: #8b9299; font: 13px/1.7 -apple-system, system-ui, sans-serif; }
  b { color: #e6e8ea; font-weight: 600; }
</style></head><body><div>${body}</div></body></html>`;

const startingHtml = name => shellHtml(`<b>${name}</b><br>Starting the board server...`);
const failedHtml = name =>
  shellHtml(`<b>${name}</b><br>The board server did not start. The log says why.`);

function postToPanel(canvas, message) {
  const panel = canvas && panels.get(canvas.root);
  if (panel) panel.webview.postMessage(message);
}

function frameHtml(url, port) {
  const origin = `http://localhost:${port} http://127.0.0.1:${port}`;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-src ${origin};">
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #141618; }
  iframe { display: block; width: 100%; height: 100%; border: 0; }
  #fail { display: none; padding: 40px; color: #8b9299; font: 13px/1.7 -apple-system, system-ui, sans-serif; }
  #fail button { margin-top: 12px; padding: 6px 12px; border: 1px solid #2a2e33; border-radius: 6px; background: #22262a; color: #e6e8ea; font: inherit; cursor: pointer; }
</style>
</head>
<body>
<iframe id="canvas" src="${url}"></iframe>
<div id="fail">
  <p>The board server did not answer on port ${port}.</p>
  <button id="showLog">Show the server log</button>
</div>
<script>
  const vscode = acquireVsCodeApi();
  const frame = document.getElementById('canvas');
  document.getElementById('showLog').addEventListener('click', () => vscode.postMessage({ type: 'log' }));

  window.addEventListener('message', ev => {
    // From the board itself, on to the extension; from the extension, on to the board.
    if (ev.source === frame.contentWindow) vscode.postMessage(ev.data);
    else frame.contentWindow.postMessage(ev.data, '*');
  });

  setTimeout(() => {
    try { if (!frame.contentWindow || frame.contentWindow.length === undefined) throw 0; }
    catch (_) {
      frame.style.display = 'none';
      document.getElementById('fail').style.display = 'block';
    }
  }, 8000);
</script>
</body>
</html>`;
}

async function openInBrowser(canvas, route) {
  const port = await ensureServer(canvas);
  if (!port) return;
  vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${port}/#/${route || 'pages'}`));
}

module.exports = {
  VIEW_TYPE, BoardEditor, openCanvas, openSetup, openInBrowser, postToPanel, tellTheme, editorTheme
};
