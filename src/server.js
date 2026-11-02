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

let cachedNode = '';
function findNode() {
  if (cachedNode) return cachedNode;
  for (const dir of widePath().split(':')) {
    const candidate = path.join(dir, 'node');
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      cachedNode = candidate;
      return candidate;
    } catch (_) {}
  }
  // A login shell knows, even when this process does not.
  try {
    const found = require('node:child_process')
      .execSync('/bin/zsh -lc "command -v node"', { encoding: 'utf8', timeout: 5000 })
      .trim();
    if (found && fs.existsSync(found)) {
      cachedNode = found;
      return found;
    }
  } catch (_) {}
  return '';
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
    const node = findNode();
    const vite = path.join(appDir, 'node_modules', 'vite', 'bin', 'vite.js');
    if (!node || !fs.existsSync(vite)) {
      log(node
        ? `[design book] vite is missing at ${vite}. Run npm install in ${appDir}.`
        : '[design book] could not find node. Open the Design log and check the PATH.');
      state.log && state.log.show();
      entry.starting = false;
      servers.delete(canvas.root);
      return resolve(0);
    }
    log(`[design book] ${node} ${vite}`);

    const proc = spawn(node, [vite], {
      cwd: appDir,
      env: {
        ...process.env,
        PATH: widePath(),
        STUDIO_ROOT: canvas.root,
        REPO_ROOT: canvas.folder,
        STUDIO_PORT: String(5273 + servers.size - 1)
      }
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
      const node = findNode();
      const npm = node ? path.join(path.dirname(node), 'npm') : '';
      if (!node || !fs.existsSync(npm)) {
        vscode.window.showErrorMessage(
          'Design Book needs Node to set itself up, and there is none on this machine. '
          + 'Install it from nodejs.org, or with `brew install node`, then open the board again.'
        );
        return false;
      }

      log(`[design book] ${npm} install in ${appDir}`);
      const ok = await new Promise(resolve => {
        const proc = spawn(node, [npm, 'install', '--no-audit', '--no-fund'], {
          cwd: appDir,
          env: { ...process.env, PATH: widePath(), npm_config_yes: 'true' }
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
        proc.on('error', err => { log(`[design book] ${err.message}`); resolve(false); });
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

module.exports = { widePath, findNode, request, alive, ensureServer, releaseServer, stopServer, stopAll };
