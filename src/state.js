// What every part of the extension shares.
//
// One place rather than a web of imports: the log, where the extension was installed,
// the server and the tab belonging to each canvas, and the two things the board asks
// the extension to do. A module that needs any of it reads it from here, so nothing has
// to import anything that imports it back.

const state = {
  log: null,
  extensionPath: '',
  servers: new Map(),      // canvas root -> { proc, port, starting }
  panels: new Map(),       // canvas root -> WebviewPanel
  pendingRoute: new Map(), // canvas root -> the view to land on when it opens
  // Set in activate(). The board is in an iframe and cannot call a command itself.
  hooks: {
    refresh: () => {},
    start: () => {}
  }
};

module.exports = state;
