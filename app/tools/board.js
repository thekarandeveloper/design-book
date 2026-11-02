// The board document: the `.designbook` file.
//
// It is the board. Its name, the project it watches, its sections and the size of every
// frame are in it, and it is a plain JSON file in the repo, so a person and an agent can
// both read it and change it with nothing in between.

import fs from 'node:fs';
import path from 'node:path';

export function createBoard({ studioRoot, boardFile, readJson, writeJson, slug }) {
  const dir = (...p) => path.join(studioRoot, ...p);

  // ── the board document ────────────────────────────────────────────────
  //
  // The `.designbook` FILE is the board: its name, the project it watches, its sections and
  // the size of every frame. The `.designbook` FOLDER beside it is the warehouse: the
  // experiments, the references, the rules Claude reads. One is a thing you double-click,
  // the other is a thing you fill, and neither is a hidden setting.

  // Looked up when it is needed, not once at startup: a server started in a folder
  // before its board file existed would otherwise keep writing to the name it guessed
  // then, which is how an empty second board appears beside a real one.
  let boardAt = '';
  function boardPath() {
    if (boardFile) return boardFile;
    if (boardAt && fs.existsSync(boardAt)) return boardAt;
    boardAt = findBoard();
    return boardAt;
  }

  function findBoard() {
    // Through the link, not beside it. A project can hold a symlink to another canvas's
    // folder so its framework compiles the experiments; the board belongs where the
    // folder really lives, never next to the link.
    let real = studioRoot;
    try { real = fs.realpathSync(studioRoot); } catch (_) {}
    const folder = path.dirname(real);
    let hit = null;
    try {
      hit = fs.readdirSync(folder)
        .filter(f => f.endsWith('.designbook') && f !== path.basename(studioRoot))
        .sort()[0] || null;
    } catch (_) {}
    return path.join(folder, hit || path.basename(folder).replace(/^\d+-/, '') + '.designbook');
  }

  const EMPTY_BOARD = () => ({
    designbook: 1,
    name: path.basename(path.dirname(studioRoot)).replace(/^\d+-/, ''),
    resources: path.basename(studioRoot),
    frame: { width: 1440, height: 900 },
    sections: [],
    frames: {}
  });

  function readBoard() {
    const doc = readJson(boardPath(), null);
    if (doc) {
      return {
        ...EMPTY_BOARD(),
        ...doc,
        sections: Array.isArray(doc.sections) ? doc.sections : [],
        frames: doc.frames && typeof doc.frames === 'object' ? doc.frames : {}
      };
    }
    // Nothing to read. Absorb an older board's config if there is one; otherwise this is
    // a folder with no board in it, and nothing is written until something is saved.
    const cfg = readJson(dir('studio.config.json'), null);
    const old = readJson(dir('canvas.json'), null);
    return cfg || old ? migrateBoard(cfg || {}, old || {}) : EMPTY_BOARD();
  }

  // A canvas set up before the file existed has its name and its live project in
  // studio.config.json and its frame sizes in canvas.json. Both are absorbed once, so
  // there is one place to look rather than three.
  function migrateBoard(cfg, old) {
    const doc = EMPTY_BOARD();
    if (cfg.name) doc.name = cfg.name;
    if (cfg.frame) doc.frame = cfg.frame;
    if (cfg.live) doc.live = cfg.live;
    if (cfg.note) doc.note = cfg.note;
    // Sizes carry over; the free x and y do not, because sections place frames now.
    for (const [id, saved] of Object.entries(old.frames || {})) {
      const keep = {};
      if (typeof saved.width === 'number') keep.width = saved.width;
      if (typeof saved.height === 'number') keep.height = saved.height;
      if (Object.keys(keep).length) doc.frames[id] = keep;
    }
    writeJson(boardPath(), doc);
    for (const gone of ['studio.config.json', 'canvas.json']) {
      try { fs.unlinkSync(dir(gone)); } catch (_) {}
    }
    return doc;
  }

  const writeBoard = doc => writeJson(boardPath(), doc);
  const config = readBoard;

  // ── sections ──────────────────────────────────────────────────────────
  //
  // A section is a band on the board: a name, and the frames in it, left to right.
  //
  // By default there is one. Every page sits in a single horizontal line, which is what
  // a board of screens is for, and the board is split only when somebody splits it: drag
  // a frame into a new band, or list one in the board file. Splitting by kind on its own
  // would divide a board nobody asked to divide.

  const ONE_BAND = 'Pages';

  function listSections(pages) {
    const doc = readBoard();
    const known = new Map(pages.map(p => [p.id, p]));
    const taken = new Set();
    const out = [];

    for (const band of doc.sections) {
      const id = band.id || slug(band.name || 'section');
      const frames = (band.frames || []).filter(f => known.has(f) && !taken.has(f));
      frames.forEach(f => taken.add(f));
      out.push({ id, name: band.name || 'Section', frames, saved: true });
    }

    const loose = pages.filter(page => !taken.has(page.id));
    if (loose.length) {
      // Into the first band, so a route added to the project lands on the line that is
      // already there rather than starting one of its own.
      let band = out[0];
      if (!band) { band = { id: slug(ONE_BAND), name: ONE_BAND, frames: [], saved: false }; out.push(band); }
      band.frames.push(...loose.map(page => page.id));
    }

    // An empty band that was never asked for is noise; one somebody made stays.
    return out.filter(b => b.frames.length || b.saved);
  }

  return { boardPath, readBoard, writeBoard, listSections };
}
