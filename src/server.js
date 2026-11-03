// The board server: one per board, and a small HTTP client for talking to it.

const vscode = require('vscode');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const state = require('./state');
const { isDir } = require('./boards');

const log = (line) => state.log && state.log.appendLine(line);
const servers = state.servers;

// Finding node, and a PATH that works.
//
// An editor launched from the Dock inherits a bare PATH, so `npm` is not on it even
// though every terminal has it. The board then never starts and there is nothing on
// screen to say why. So the binary is looked for where it actually lives, and the PATH
// handed to anything we spawn is widened to match a login shell.
const EXTRA_PATHS = [
  '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin',
  path.join(os.homedir(), '.local/bin'),
  path.join(os.homedir(), '.volta/bin'),
  path.join(os.homedir(), '.bun/bin')
];

function widePath() {
  const current = (process.env.PATH || '').split(':').filter(Boolean);
  const merged = [...new Set([...current, ...EXTRA_PATHS])];
  return merged.join(':');
}

// Node is the editor's own binary, asked to run as node. There is nothing to look for:
// a machine that is running this extension is already running node, so a PATH without it,
// a version manager, or a Homebrew that moved cannot keep the board from starting.
const NODE = process.execPath;

function nodeEnv(extra) {
  return { ...process.env, ELECTRON_RUN_AS_NODE: '1', PATH: widePath(), ...extra };
}

// npm, on the other hand, is a shell script, and node cannot read one. What is wanted is
// the JS file behind it, which is where the `npm` on the PATH really points.
let cachedNpm = '';
function findNpm() {
  if (cachedNpm && fs.existsSync(cachedNpm)) return cachedNpm;
  for (const dir of widePath().split(':')) {
    let real = '';
    try { real = fs.realpathSync(path.join(dir, 'npm')); } catch (_) { continue; }
    const cli = real.endsWith('.js')
      ? real
      : path.join(path.dirname(real), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (fs.existsSync(cli)) { cachedNpm = cli; return cli; }
  }
  return '';
}

// A new version deletes the folder the old one ran from, and a window that was open at
// the time still points there. Spawning in a folder that is gone fails as ENOENT naming
// node, the one thing that is not missing, so the real reason is said instead.
function appGone(appDir) {
  return isDir(appDir)
    ? ''
    : 'Design Book was updated while this window was open. Reload the window (Cmd+Shift+P, '
      + '"Developer: Reload Window") and open the board again.';
}

// ── the server ────────────────────────────────────────────────────────────

function request(port, route, { method = 'GET', body, raw } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    // `localhost`, not 127.0.0.1: Vite binds the name, which resolves to ::1 on this
    // machine. Asking for the address answered nothing, so every open believed the
    // server was down and started another one.
    const req = http.request({
      host: 'localhost', port, path: route, method, timeout: 15000,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}
    }, res => {
      let text = '';
      res.on('data', c => (text += c));
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`${method} ${route}: ${res.statusCode}`));
        if (raw) return resolve(text);
        try { resolve(text ? JSON.parse(text) : {}); } catch (_) { resolve(text); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const alive = port => request(port, '/__api/studio').then(() => true, () => false);

// How many boards may have a server at once. Each one is a node process with a module
// graph, and a project's own dev server behind it, so they are not free. Past this, the
// one nobody is looking at goes.
const MOST = 4;

async function ensureServer(canvas) {
  if (!canvas) return 0;
  const existing = servers.get(canvas.root);
  if (existing) existing.used = Date.now();
  if (existing?.port && await alive(existing.port)) return existing.port;
  if (existing?.starting) return 0;

  retireIdle();

  const appDir = path.join(state.extensionPath, 'app');
  if (!isDir(path.join(appDir, 'node_modules'))) {
    const done = await install(appDir);
    if (!done) return 0;
  }

  const entry = { proc: null, port: 0, starting: true, used: Date.now() };
  servers.set(canvas.root, entry);
  log(`[design book] starting for ${canvas.folder}`);

  return new Promise(resolve => {
    const vite = path.join(appDir, 'node_modules', 'vite', 'bin', 'vite.js');
    const gone = appGone(appDir);
    if (gone || !fs.existsSync(vite)) {
      if (gone) vscode.window.showErrorMessage(gone);
      log(gone || `[design book] vite is missing at ${vite}. Run npm install in ${appDir}.`);
      if (!gone) state.log && state.log.show();
      entry.starting = false;
      servers.delete(canvas.root);
      return resolve(0);
    }
    log(`[design book] ${NODE} ${vite}`);

    const proc = spawn(NODE, [vite], {
      cwd: appDir,
      env: nodeEnv({
        STUDIO_ROOT: canvas.root,
        REPO_ROOT: canvas.folder,
        STUDIO_PORT: String(5273 + servers.size - 1)
      })
    });
    entry.proc = proc;

    let settled = false;
    const done = port => {
      if (settled) return;
      settled = true;
      entry.starting = false;
      entry.port = port;
      resolve(port);
    };

    const onData = chunk => {
      const text = String(chunk);
      // Streamed as it comes, without a line break of our own.
      if (state.log) state.log.append(text);
      const m = text.match(/localhost:(\d+)/);
      if (m) done(Number(m[1]));
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', code => {
      log(`[design book] ${canvas.name} server exited with ${code}`);
      servers.delete(canvas.root);
      done(0);
    });
    setTimeout(() => {
      if (!settled) { log('[design book] no ready line after 30s, see the log'); done(0); }
    }, 30000);
  });
}

// A board whose tab has gone does not need a server, but a reload closes and reopens a
// tab in a second, so it is given a minute to come back before anything is stopped.
const GRACE = 60000;

function releaseServer(root) {
  const entry = servers.get(root);
  if (!entry) return;
  clearTimeout(entry.idle);
  entry.idle = setTimeout(() => {
    if (state.panels.has(root)) return;         // it came back
    log(`[design book] stopping the server for ${root}, nothing is looking at it`);
    stopServer(root);
  }, GRACE);
}

// Nothing is looking at it and something else wants to start: the oldest of those goes.
function retireIdle() {
  if (servers.size < MOST) return;
  const idle = [...servers.entries()]
    .filter(([root]) => !state.panels.has(root))
    .sort((a, b) => (a[1].used || 0) - (b[1].used || 0));
  while (servers.size >= MOST && idle.length) {
    const [root] = idle.shift();
    log(`[design book] ${MOST} servers is enough: stopping the one for ${root}`);
    stopServer(root);
  }
}

// The one thing a fresh install has to do for itself.
//
// What the board runs on is a few hundred megabytes of node packages, which is more than
// belongs in an extension, so it is fetched once on the machine that needs it. It happens
// in a progress bar rather than a terminal, because nothing is being asked of the person
// beyond waiting.
let installing = null;

function install(appDir) {
  if (installing) return installing;

  installing = vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Design Book: setting up, once',
      cancellable: false
    },
    async progress => {
      progress.report({ message: 'fetching what the board runs on' });
      const gone = appGone(appDir);
      if (gone) {
        vscode.window.showErrorMessage(gone);
        return false;
      }
      const npm = findNpm();
      if (!npm) {
        vscode.window.showErrorMessage(
          'Design Book needs npm to set itself up, and there is none on this machine. '
          + 'Install Node from nodejs.org, or with `brew install node`, then open the board again.'
        );
        return false;
      }

      log(`[design book] ${NODE} ${npm} install in ${appDir}`);
      const ok = await new Promise(resolve => {
        const proc = spawn(NODE, [npm, 'install', '--no-audit', '--no-fund'], {
          cwd: appDir,
          env: nodeEnv({ npm_config_yes: 'true' })
        });
        let tail = '';
        const onData = chunk => {
          const text = String(chunk);
          tail = (tail + text).slice(-400);
          if (state.log) state.log.append(text);
          const line = text.trim().split('\n').pop();
          if (line) progress.report({ message: line.slice(0, 60) });
        };
        proc.stdout.on('data', onData);
        proc.stderr.on('data', onData);
        proc.on('error', err => {
          log(`[design book] ${err.message}`);
          vscode.window.showErrorMessage(appGone(appDir) || `Design Book could not run npm: ${err.message}`);
          resolve(false);
        });
        proc.on('exit', code => {
          if (code !== 0) log(`[design book] npm install ended with ${code}:\n${tail}`);
          resolve(code === 0);
        });
      });

      if (!ok) {
        const show = await vscode.window.showErrorMessage(
          'Design Book could not set itself up. The log says what npm reported.', 'Show the log'
        );
        if (show && state.log) state.log.show();
      }
      return ok;
    }
  );

  installing.finally(() => { installing = null; });
  return installing;
}

function stopServer(root) {
  const entry = servers.get(root);
  if (entry?.idle) clearTimeout(entry.idle);
  if (entry?.proc) { try { entry.proc.kill(); } catch (_) {} }
  servers.delete(root);
}
function stopAll() { for (const root of [...servers.keys()]) stopServer(root); }

module.exports = { widePath, request, alive, ensureServer, releaseServer, stopServer, stopAll };
