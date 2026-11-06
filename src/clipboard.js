// A picture on the clipboard.
//
// The editor's own clipboard takes text and nothing else, and a page inside an editor's
// panel is not always allowed to write to the system one. So the picture is put there from
// here, by the operating system's own means, which is what a screenshot tool does.
//
// With text as well, both go on at once and whatever is pasted into takes the one it
// prefers: a chat box takes the picture, an editor takes the words.

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const run = (cmd, args) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: 15000 }, err => (err ? reject(err) : resolve()));
});

async function onMac(file, text) {
  // The text goes in as an argument, not into the script, so nothing in it can be taken
  // for AppleScript.
  const lines = text
    ? [
        'on run argv',
        'set img to read (POSIX file (item 1 of argv)) as «class PNGf»',
        'set the clipboard to {«class PNGf»:img, string:(item 2 of argv)}',
        'end run'
      ]
    : [
        'on run argv',
        'set the clipboard to (read (POSIX file (item 1 of argv)) as «class PNGf»)',
        'end run'
      ];
  await run('osascript', [...lines.flatMap(l => ['-e', l]), file, ...(text ? [text] : [])]);
}

async function onWindows(file) {
  const script = '$f=$args[0];Add-Type -AssemblyName System.Windows.Forms,System.Drawing;'
    + '$i=[System.Drawing.Image]::FromFile($f);[System.Windows.Forms.Clipboard]::SetImage($i);$i.Dispose()';
  await run('powershell', ['-NoProfile', '-STA', '-Command', script, file]);
}

async function onLinux(file) {
  try { await run('wl-copy', ['--type', 'image/png', '--', file]); return; } catch (_) {}
  await run('sh', ['-c', 'xclip -selection clipboard -t image/png -i "$0"', file]);
}

// Resolves to true when the picture is on the clipboard.
async function copyImage(file, text) {
  const real = path.resolve(String(file || ''));
  // Only a picture the board made: a PNG somewhere under the home folder.
  if (!real.startsWith(os.homedir() + path.sep) || !/\.png$/i.test(real) || !fs.existsSync(real)) return false;
  try {
    if (process.platform === 'darwin') await onMac(real, text);
    else if (process.platform === 'win32') await onWindows(real);
    else await onLinux(real);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { copyImage };
