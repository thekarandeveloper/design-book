// The Claude skill, installed with the extension.
//
// The skill is the part that matters most: it is what makes an agent build the right
// thing on a board instead of guessing. It is a markdown file in the user's home, read
// by Claude Code from `~/.claude/skills/`, so the extension writes it there when it
// starts and keeps it current as the extension updates. One install, both halves.
//
// What is never done: overwriting a file somebody has edited. The version last written
// is remembered beside it, so an edited skill is left exactly as it is and the new one
// is put next to it instead.

const vscode = require('vscode');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const state = require('./state');

const SKILL = 'design-book';
const log = line => state.log && state.log.appendLine(line);
const digest = text => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

const home = () => path.join(os.homedir(), '.claude', 'skills', SKILL);
const shipped = () => path.join(state.extensionPath, 'skills', SKILL, 'SKILL.md');

function read(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (_) { return ''; }
}

// `force` is the command: put ours back, whatever is there.
// The same skill under the names it used to have, `canvas` and then `design`. If it is
// one we wrote, it goes: two skills saying the same thing is worse than one, and the
// newer name is the one Claude should find.
const WAS_CALLED = ['design', 'canvas'];

function clearOldSkill() {
  for (const was of WAS_CALLED) {
    const old = path.join(os.homedir(), '.claude', 'skills', was);
    if (old === home()) continue;
    const there = read(path.join(old, 'SKILL.md'));
    if (!there) continue;
    const stamp = read(path.join(old, `.installed-by-${was}`)).trim();
    const ours = there.includes(`name: ${was}`);
    if (!stamp && !ours) continue;            // somebody's own, left alone
    try {
      fs.rmSync(old, { recursive: true, force: true });
      log(`[design book] the old ${was} skill at ${old} was removed; this one replaces it`);
    } catch (_) {}
  }
}

function ensureSkill({ force = false } = {}) {
  clearOldSkill();
  const from = shipped();
  const ours = read(from);
  if (!ours) return;

  const dir = home();
  const to = path.join(dir, 'SKILL.md');
  const stampFile = path.join(dir, '.installed-by-design-book');
  const there = read(to);

  if (there === ours) return;                       // already current

  const write = () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(to, ours);
    fs.writeFileSync(stampFile, `${digest(ours)}\n`);
    log(`[design book] the Claude skill is installed at ${to}`);
  };

  if (!there) return write();

  // Is what is there the last thing we wrote?
  const stamp = read(stampFile).trim();
  if (force || (stamp && stamp === digest(there))) return write();

  // Somebody has made it their own. Leave it, and put ours beside it.
  const beside = path.join(dir, 'SKILL.design-book.md');
  try {
    fs.writeFileSync(beside, ours);
    log(`[design book] ${to} has been edited, so it was left alone. The new one is at ${beside}.`);
  } catch (err) {
    log(`[design book] could not write the skill: ${err.message}`);
  }
}

module.exports = { ensureSkill, skillHome: home };
