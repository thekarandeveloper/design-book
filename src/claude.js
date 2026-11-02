// How the board reaches Claude. Two halves, and the first one matters more.

const vscode = require('vscode');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const state = require('./state');
const { BOOK_DIR } = require('./boards');
const { ensureServer, request } = require('./server');

const log = (line) => state.log && state.log.appendLine(line);

// ── Claude ────────────────────────────────────────────────────────────────
//
// Two halves, and the first one matters more.
//
// AUTOMATIC: a pointer in the repo's root CLAUDE.md, so every Claude session in this
// repo already knows the board is there and what the rules are. Nothing has to be
// explained again, in this session or any later one.
//
// ON DEMAND: the arrow on a screen. Claude Code's `insertAtMention` command takes no
// arguments and mentions whatever file is in the active editor, so a reference is sent
// by opening the file and running it. That puts `@.designbook/pages/today.json` in the
// input, and whatever is typed after it is about that screen with every reference
// already in reach.

const POINTER_START = '<!-- design-book:start -->';
const POINTER_END = '<!-- design-book:end -->';

function pointerBlock(canvas) {
  const file = path.basename(canvas.file);
  return [
    POINTER_START,
    '## Design Book',
    '',
    `\`${file}\` is this repo's design board: open it in VS Code and the project's own`,
    `pages are frames on it. \`${BOOK_DIR}/\` beside it holds everything the board shows.`,
    '',
    'Read these two when you are about to design, and not before. They are named rather',
    'than pulled in, because a session that is not designing should not pay for them:',
    '',
    `- \`${BOOK_DIR}/CLAUDE.md\` is what is on the board right now: every frame with the file`,
    '  behind it, the colours and fonts this project really uses, its tokens, its components.',
    `- \`${BOOK_DIR}/studio.json\` is the same as an index, with each component's props and its`,
    '  real path. Read it instead of opening the component files.',
    '',
    '**Design in the frame you were given, and only that one.** Change that frame\'s own file.',
    'Nothing else: no copy under a new name, no second version beside it, no page nobody',
    'mentioned. More than one version only when options are asked for, and then three.',
    '',
    `**Never redraw a page of this project inside \`${BOOK_DIR}/\`.** A reimplementation looks`,
    'authoritative while being wrong. Change the project\'s own source; the board shows it live.',
    '',
    '**It must not look like a machine made it.** Unless the ask says otherwise: no em dashes,',
    'no outline or stroke illustration, no gradient mesh, no glow, no abstract swooshes.',
    '',
    'The rest of the house rules are in the `design-book` skill, which loads itself when there',
    'is designing to do.',
    POINTER_END
  ].join('\n');
}

// Where Claude will actually read it: the root of the repo the board sits in, because
// that is the CLAUDE.md a session in this project loads. A board in a plain folder with
// no repo around it keeps its own.
function claudeHome(canvas) {
  let dir = canvas.folder;
  for (let i = 0; i < 6; i++) {
    if (dir === path.dirname(dir) || dir === os.homedir()) break;
    try { if (fs.statSync(path.join(dir, '.git')).isDirectory()) return dir; } catch (_) {}
    dir = path.dirname(dir);
  }
  return canvas.folder;
}

// Written once and kept up to date in place, so running it again never stacks up copies.
function ensureClaudeContext(canvas) {
  const file = path.join(claudeHome(canvas), 'CLAUDE.md');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) {}

  const block = pointerBlock(canvas);
  // A repo written to under either older name carries those markers: `design-board`
  // while this was Design, `design-canvas` before that. Each one is replaced where it
  // sits, so nobody ends up with two blocks saying the same thing.
  for (const was of ['design-board', 'design-canvas']) {
    const start = `<!-- ${was}:start -->`;
    const end = `<!-- ${was}:end -->`;
    if (!text.includes(start) || !text.includes(end)) continue;
    text = text.slice(0, text.indexOf(start))
      + POINTER_START + POINTER_END
      + text.slice(text.indexOf(end) + end.length);
  }

  let next;
  if (text.includes(POINTER_START) && text.includes(POINTER_END)) {
    const before = text.slice(0, text.indexOf(POINTER_START));
    const after = text.slice(text.indexOf(POINTER_END) + POINTER_END.length);
    next = before + block + after;
  } else if (text.trim()) {
    next = text.replace(/\s*$/, '') + '\n\n' + block + '\n';
  } else {
    next = `# ${canvas.name}\n\n` + block + '\n';
  }

  if (next !== text) {
    try {
      fs.writeFileSync(file, next);
      log(`[design book] ${file} now carries the board's rules`);
    } catch (err) {
      log(`[design book] could not update CLAUDE.md: ${err.message}`);
    }
  }
}

const hasClaudeCode = () => !!vscode.extensions.getExtension('anthropic.claude-code');

// Open each file and let Claude Code mention it. The command reads the active editor,
// which is why the files are opened rather than passed.
async function mention(files) {
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: false });
    try {
      await vscode.commands.executeCommand('claude-vscode.insertAtMention');
    } catch (_) {
      try { await vscode.commands.executeCommand('claude-code.insertAtMentioned'); } catch (_) {}
    }
  }
}

// The arrow on a screen, and the command on the board's row.
async function askClaude(canvas, pageFile) {
  if (!canvas) return;
  ensureClaudeContext(canvas);

  if (!hasClaudeCode()) {
    // Without the extension there is still the CLI, and the brief still has everything.
    const port = await ensureServer(canvas);
    const brief = port ? await request(port, '/__api/brief', { raw: true }) : '';
    fs.writeFileSync(path.join(canvas.root, 'task.md'), brief + '\n');
    const term = vscode.window.createTerminal({ name: `Claude: ${canvas.name}`, cwd: canvas.folder });
    term.show();
    term.sendText(`claude "Read ${BOOK_DIR}/task.md and do what it says."`);
    return;
  }

  try { await vscode.commands.executeCommand('claude-vscode.sidebar.open'); } catch (_) {}

  const files = [path.join(canvas.root, 'CLAUDE.md'), path.join(canvas.root, 'studio.json')];
  if (pageFile) {
    const target = path.resolve(canvas.root, pageFile.replace(/^\//, ''));
    if (target.startsWith(os.homedir() + path.sep) && fs.existsSync(target)) files.push(target);
  }
  await mention(files);

  try { await vscode.commands.executeCommand('claude-vscode.focus'); } catch (_) {}

  vscode.window.setStatusBarMessage(
    pageFile
      ? `Design: ${path.basename(pageFile)} and its rules are in Claude's input. Say what to change.`
      : "Design: the rules and the index are in Claude's input. Say what to build.",
    6000
  );
}

module.exports = { ensureClaudeContext, askClaude, hasClaudeCode, pointerBlock, claudeHome };
