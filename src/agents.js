// The agents that do Design Book's work cheaply.
//
// A small visual change (a value, a colour, a line of text) does not need the biggest model
// or the whole project read. It needs one file, opened at one line, and one edit. So there
// are two agents for it, each on the model that does that kind of work well: `design-edit`
// on the smallest, for one value in one file, and `design-build` on the middle one, for a
// change that spans a component. The prompt the board writes names the one that fits, so
// the work goes to it without anybody switching models, and what comes back is two lines.
//
// They are installed the way the skill is, in the home folder where Claude Code looks for
// them, and the same rule holds: a file somebody has edited is never overwritten. The new
// version is put beside it instead.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const state = require('./state');

const log = line => state.log && state.log.appendLine(line);
const digest = text => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
const read = file => { try { return fs.readFileSync(file, 'utf8'); } catch (_) { return ''; } };

const AGENTS = ['design-edit', 'design-build'];
const home = () => path.join(os.homedir(), '.claude', 'agents');
const shipped = name => path.join(state.extensionPath, 'agents', `${name}.md`);

function ensureAgents({ force = false } = {}) {
  const dir = home();
  const stamps = path.join(dir, '.installed-by-design-book.json');
  let known = {};
  try { known = JSON.parse(read(stamps)) || {}; } catch (_) {}

  for (const name of AGENTS) {
    const ours = read(shipped(name));
    if (!ours) continue;
    const to = path.join(dir, `${name}.md`);
    const there = read(to);
    if (there === ours) continue;

    // Nothing there, or the last thing we wrote: it is ours to update.
    const write = () => {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(to, ours);
      known[name] = digest(ours);
      fs.writeFileSync(stamps, JSON.stringify(known));
      log(`[design book] the ${name} agent is installed at ${to}`);
    };
    if (!there || force || (known[name] && known[name] === digest(there))) { write(); continue; }

    // Somebody has made it their own.
    try {
      fs.writeFileSync(path.join(dir, `${name}.design-book.md`), ours);
      log(`[design book] ${to} has been edited, so it was left alone. The new one is beside it.`);
    } catch (err) {
      log(`[design book] could not write the ${name} agent: ${err.message}`);
    }
  }
}

module.exports = { ensureAgents, agentsHome: home };
