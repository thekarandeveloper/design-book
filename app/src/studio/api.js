// One studio per open repo, so nothing here takes a project: the server already knows
// which folder it is rooted at.

const json = async (url, options) => {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`${options?.method || 'GET'} ${url} failed: ${res.status}`);
  return res.json();
};

const send = (url, method, body) =>
  json(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const getStudio = () => json('/__api/studio');
// Whether a frame's page is really being served, so the board can wait instead of
// showing whatever error page the framework would have shown.
export const isReady = page => json(`/__api/ready?page=${encodeURIComponent(page)}`);
export const getPage = page => json(`/__api/page?page=${encodeURIComponent(page)}`);
export const putPage = (page, body) => send(`/__api/page?page=${encodeURIComponent(page)}`, 'PUT', body);
export const newPage = title => send('/__api/page/new', 'POST', { title });
// A frame at an exact size, as a file in .designbook/pages.
export const newFrame = (title, width, height, { section, after, grow } = {}) =>
  send('/__api/frame/new', 'POST', { title, width, height, section, after, grow });
// What a frame is called. The file is renamed with it, keeping its number, and every
// mention of it on the board moves across.
export const renameFrame = (page, title) => send('/__api/frame/rename', 'POST', { page, title });
// A frame made here, thrown away: the file goes to .designbook/.trash.
// Looking for something: the names of frames first, then what is written inside them.
export const find = q => json(`/__api/find?q=${encodeURIComponent(q)}`);
// How tall a frame's page really is, drawn and measured in a real browser. The board
// cannot measure a live page itself: it is another address, and a copy of it served from
// here never finishes drawing itself.
export const measurePage = (url, width, viewport) => send('/__api/measure', 'POST', { url, width, viewport });
// Look at a frame the way a designer would: contrast, cut off edges, small targets.
export const checkFrame = page => send('/__api/check', 'POST', { page });
export const deleteFrame = page => send('/__api/frame/delete', 'POST', { page });
export const exportFrame = (page, options) => send('/__api/export', 'POST', { page, ...options });
export const canExport = () => json('/__api/export/can');
export const putPositions = frames => send('/__api/positions', 'PUT', { frames });
// The sections of the board, in order, each with the frames it holds in order.
export const getSections = () => json('/__api/sections').then(r => r.sections);
export const putSections = sections => send('/__api/sections', 'PUT', { sections });
// One frame to another section, or to another place in its own. `after` is a frame to
// land behind, `to` a place counted from the left, or 'start' or 'end'.
export const moveFrame = (page, where) => send('/__api/frame/move', 'POST', { page, ...where });
export const getBoard = () => json('/__api/board');
export const putBoard = patch => send('/__api/board', 'PUT', patch);
export const getRefs = () => json('/__api/refs').then(r => r.refs);
export const getProject = () => json('/__api/project');
export const enablePreview = () => send('/__api/preview/enable', 'POST', {});
export const disablePreview = () => send('/__api/preview/disable', 'POST', {});
export const getPalette = () => json('/__api/palette');
// Setting this repo up, which is everything a board with no file yet can do.
export const runSetup = () => send('/__api/setup', 'POST', {});
// The pictures the repo holds, where it holds them, recorded by that setup pass.
export const getAssets = () => json('/__api/assets');
export const putToken = (file, scope, name, value) =>
  send('/__api/tokens', 'PUT', { file, scope, name, value });
export const deleteToken = (file, scope, name) =>
  send('/__api/tokens', 'PUT', { file, scope, name, value: null });
export const getTokens = file => json(`/__api/tokens${file ? `?file=${encodeURIComponent(file)}` : ''}`);
export const putRefs = items => send('/__api/refs', 'PUT', { items });
export const getBrief = page => fetch(`/__api/brief${page ? `?page=${encodeURIComponent(page)}` : ''}`).then(r => r.text());

export const upload = (name, buffer) =>
  fetch(`/__api/upload?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: buffer
  });

// Changes made anywhere in the workspace arrive here: the canvas server watches the
// project and announces a rebuild over Vite's socket. Several VS Code windows can be
// open on the same project and all of their boards stay current.
// The setup pass, step by step, as it happens. It comes over the same socket as every
// other change, because it is one: the board is being made out of the repo.
export function onSetupStep(handler) {
  if (!import.meta.hot) return () => {};
  import.meta.hot.on('studio:setup', handler);
  return () => import.meta.hot.off('studio:setup', handler);
}

export function onStudioChanged(handler) {
  if (!import.meta.hot) return () => {};
  const live = () => handler();
  import.meta.hot.on('studio:changed', live);
  import.meta.hot.on('studio:live', live);
  return () => {
    import.meta.hot.off('studio:changed', live);
    import.meta.hot.off('studio:live', live);
  };
}
