import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  scanFrame, elementDetail, auditElement, shotOf, shotRegion, shotStatesOf, shotSizesOf,
  rememberLook, getRemembered, savePicture, pictureUrl, getRefs, warmFrame
} from './api.js';
import { hit, labelOf, parentOf, childOf, onFrame, rematch, measure, promptFor, modelFor, TEMPLATES } from './pick.js';
import { ImageDialog, AnnotateDialog, CompareDialog } from './Dialogs.jsx';
import { windowOf, scanLocal, detailLocal, auditLocal } from './local.js';
import { isScreenSize } from './frames.js';

// Choosing things inside a frame, and getting what you chose to Claude.
//
// Hover an element on the frame you have chosen and it is outlined with its name; click it
// and it is chosen; right-click it and everything that can be done with it is there. What
// comes out is a picture and a few lines of text, because a person can say "this" to Claude
// when it is looking at the thing, and Claude can act on it when it knows the file and the
// line.
//
// None of it reads the live page, which another origin makes impossible. The page is read
// by the headless browser (inspect.js) and the answer is a map of boxes; this works on the map.

const ask = message => window.parent.postMessage(message, '*');
const NOT_HERE = typeof window === 'undefined' || window.parent === window;

// Where a frame's page is scrolled to, when the board can tell, which is when the page is
// on this origin. A page on another cannot be asked.
function scrollOf(frameId) {
  const node = document.querySelector(`.st-world > .st-frame[data-id="${CSS.escape(frameId)}"] iframe`);
  if (!node) return { y: 0, known: true };
  try {
    void node.contentWindow.document;
    return { y: node.contentWindow.scrollY || 0, known: true };
  } catch (_) {
    return { y: 0, known: false };
  }
}

// A frame's page is opened in the headless browser ahead of being asked about, for the one
// kind of page that needs it: a project's dev server. Reading one takes as long as the site
// takes to draw itself (a loader, a curtain), and that wait is better spent while the pointer
// is on its way to the frame than after it has pressed. Once a minute per frame is enough.
const warmed = new Map();
export function warmAhead(f) {
  if (!f || !f.running || f.local) return;
  const at = warmed.get(f.id) || 0;
  if (Date.now() - at < 60000) return;
  warmed.set(f.id, Date.now());
  warmFrame(f.id).catch(() => {});
}

// ── the map of a frame ──────────────────────────────────────────────────────

function useFrameScan(frame, on) {
  const [state, setState] = useState({ key: '', status: 'idle', scan: null, error: '' });
  const key = frame ? `${frame.id}|${frame.width}x${frame.height}|${frame.nonce}` : '';
  const stamp = frame ? frame.stamp : '';
  const read = useRef({ nonce: null, key: '' });
  const local = !!frame && !!frame.local;

  // A page of the board's own is read where it is: its window is reachable, the answer is a
  // few milliseconds, and no browser is started. Read again when the page loads again.
  useEffect(() => {
    if (!on || !frame || !local) return;
    let alive = true;
    let timer = 0;
    let node = null;
    const take = () => {
      if (!alive) return false;
      const win = windowOf(frame.id);
      if (!win) return false;
      try {
        setState({ key, status: 'ready', scan: scanLocal(win), error: '' });
      } catch (err) {
        setState({ key, status: 'failed', scan: null, error: String(err.message || err) });
      }
      return true;
    };
    const watch = () => {
      const el = document.querySelector(`.st-world > .st-frame[data-id="${CSS.escape(frame.id)}"] iframe`);
      if (el && el !== node) { node = el; el.addEventListener('load', () => { clearTimeout(timer); timer = setTimeout(take, 120); }); }
    };
    setState(s => (s.key === key ? s : { key, status: 'reading', scan: null, error: '' }));
    let tries = 0;
    const poll = () => {
      watch();
      if (take() || ++tries > 150) return;
      timer = setTimeout(poll, 40);
    };
    timer = setTimeout(poll, 0);
    return () => { alive = false; clearTimeout(timer); };
  }, [on, key, stamp, local]);

  useEffect(() => {
    if (!on || !frame || local) return;
    let alive = true;
    // Taken again when the page changed, but not at once: a person saving files makes a
    // change a second, and each one is a page being read.
    const delay = read.current.key === key ? 1400 : 120;
    const fresh = read.current.nonce !== null && read.current.nonce !== frame.nonce;
    setState(s => ({ ...s, status: 'reading', error: '', ...(s.key === key ? {} : { scan: null }) }));
    const gone = new AbortController();
    const timer = setTimeout(() => {
      scanFrame(frame.id, fresh, gone.signal).then(answer => {
        if (!alive) return;
        read.current = { nonce: frame.nonce, key };
        if (answer.error) setState({ key, status: 'failed', scan: null, error: answer.error });
        else setState({ key, status: 'ready', scan: answer, error: '' });
      }).catch(err => { if (alive) setState({ key, status: 'failed', scan: null, error: String(err.message || err) }); });
    }, delay);
    return () => { alive = false; clearTimeout(timer); gone.abort(); };
  }, [on, key, stamp, local]);

  // Not a map of another frame.
  return state.key === key ? state : { key, status: on ? 'reading' : 'idle', scan: null, error: '' };
}

// ── the state behind it all ─────────────────────────────────────────────────

export function usePick({ frame, inside, scrolled, say, onReload, onFit }) {
  const live = !!frame && frame.running && !inside;
  const state = useFrameScan(frame, live);
  const list = state.scan ? state.scan.list : null;

  const [picks, setPicks] = useState([]);
  const [hover, setHover] = useState(-1);
  const [alt, setAlt] = useState(false);
  const [snip, setSnip] = useState(false);
  const [note, setNote] = useState('');
  const [reference, setReference] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState('');
  const [details, setDetails] = useState({});
  const [issues, setIssues] = useState({});
  const [thumb, setThumb] = useState(null);
  const [remembered, setRemembered] = useState([]);
  const [refs, setRefs] = useState(null);

  // Everything the actions read, as it is now, so they never act on a render that is over.
  const S = useRef({});
  S.current = { frame, list, picks, details, issues, note, reference, thumb, scrolled };

  // A different frame starts clean.
  const frameId = frame ? frame.id : '';
  useEffect(() => {
    setPicks([]); setHover(-1); setSnip(false); setNote(''); setReference(null);
    setDetails({}); setIssues({}); setThumb(null); setDialog(null);
  }, [frameId]);

  // A choice survives the page being drawn again: the same thing, found on the new map.
  const scanKey = state.status === 'ready' ? `${state.key}|${state.scan.list.length}|${state.scan.h}` : '';
  useEffect(() => {
    if (!list) return;
    setPicks(was => {
      let changed = false;
      const next = [];
      for (const p of was) {
        if (p.kind === 'region') { next.push(p); continue; }
        const i = list[p.i] && list[p.i].t === p.el.t && (list[p.i].x || '') === (p.el.x || '') ? p.i : rematch(p.el, list);
        if (i < 0) { changed = true; continue; }
        if (i !== p.i || list[i] !== p.el) changed = true;
        next.push({ kind: 'el', i, el: list[i] });
      }
      return changed ? next : was;
    });
    setDetails({});
    setIssues({});
  }, [scanKey]);

  // Alt held while hovering measures, and only while it is held.
  useEffect(() => {
    if (!live) return;
    const key = ev => setAlt(ev.altKey);
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
    window.addEventListener('blur', () => setAlt(false));
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); };
  }, [live]);

  // What is known about each chosen element, asked for when it is chosen. A page of the
  // board's own is asked in place and answers at once; another is asked of the server.
  useEffect(() => {
    if (!frame) return;
    let alive = true;
    const win = frame.local ? windowOf(frame.id) : null;
    const screen = isScreenSize(frame.width, frame.height);
    for (const p of picks) {
      if (p.kind === 'region') continue;
      if (!details[p.i]) {
        if (win) {
          const d = detailLocal(win, p.i);
          if (d && !d.stale) setDetails(was => ({ ...was, [p.i]: d }));
        } else {
          elementDetail(frame.id, p.i).then(d => { if (alive && !d.stale && !d.error) setDetails(was => ({ ...was, [p.i]: d })); });
        }
      }
      if (!issues[p.i]) {
        if (win) {
          const a = auditLocal(win, p.i, { width: frame.width, height: frame.height, screen, touch: screen && frame.width <= 500 });
          if (a.issues) setIssues(was => ({ ...was, [p.i]: a.issues }));
        } else {
          auditElement(frame.id, p.i).then(a => { if (alive && a.issues) setIssues(was => ({ ...was, [p.i]: a.issues })); });
        }
      }
    }
    return () => { alive = false; };
  }, [picks.map(p => p.kind === 'region' ? 'r' : p.i).join(','), frameId, scanKey]);

  // Where an element is, for a request to the server that did not number it: the server reads
  // a page of the board's own separately, so it is told where to look and not which number.
  const findOf = useCallback(i => {
    const f = S.current.frame;
    const d = S.current.details[i];
    if (!f || !f.local || !d || !Array.isArray(d.path)) return undefined;
    return { path: d.path, selector: d.selector, text: (d.text || '').slice(0, 60), tag: d.tag };
  }, []);

  // The headless browser is asked to open the page ahead of the first picture, so the
  // first picture is not the one that pays for it.
  useEffect(() => { if (frame && live && state.status === 'ready') warmFrame(frame.id).catch(() => {}); }, [frameId, live, state.status === 'ready']);

  const findNow = i => {
    const f = S.current.frame;
    const d = S.current.details[i];
    if (!f || !f.local || !d || !Array.isArray(d.path)) return undefined;
    return { path: d.path, selector: d.selector, text: (d.text || '').slice(0, 60), tag: d.tag };
  };

  // The picture that goes in the panel: the thing itself.
  const pickKey = picks.map(p => p.kind === 'region' ? `r${p.rect.x},${p.rect.y},${p.rect.w},${p.rect.h}` : p.i).join('|');
  useEffect(() => {
    if (!frame || !picks.length) { setThumb(null); return; }
    let alive = true;
    const timer = setTimeout(async () => {
      const lead = picks[0];
      const answer = lead.kind === 'region'
        ? await shotRegion(frame.id, { ...lead.rect, label: 'region' })
        : picks.length > 1
          ? await shotOf(frame.id, { i: lead.i, find: S.current.frame.local ? findNow(lead.i) : undefined, mode: 'marked', marks: picks.filter(p => p.kind !== 'region').map((p, n) => ({ i: p.i, find: findNow(p.i), n: n + 1 })), label: frame.title })
          : await shotOf(frame.id, { i: lead.i, find: findNow(lead.i), mode: 'element', label: labelOf(lead.el) });
      if (alive && answer.name) setThumb({ key: pickKey, ...answer });
    }, 120);
    return () => { alive = false; clearTimeout(timer); };
  }, [pickKey, frameId, scanKey, frame && frame.local && picks.length ? Object.keys(details).length : 0]);

  useEffect(() => {
    if (!frame) return;
    let alive = true;
    getRemembered(frame.id).then(items => { if (alive) setRemembered(items || []); }).catch(() => {});
    return () => { alive = false; };
  }, [frameId, dialog && dialog.type]);

  // ── what a click does ─────────────────────────────────────────────────

  const choose = useCallback((i, add) => {
    const l = S.current.list;
    if (!l || i < 0) { setPicks(add ? S.current.picks : []); return; }
    setPicks(was => {
      const has = was.findIndex(p => p.kind === 'el' && p.i === i);
      if (add) {
        if (has >= 0) return was.filter((_, n) => n !== has);
        return [...was.filter(p => p.kind === 'el'), { kind: 'el', i, el: l[i] }].slice(0, 6);
      }
      return [{ kind: 'el', i, el: l[i] }];
    });
  }, []);

  const up = useCallback(() => {
    const l = S.current.list;
    const p = S.current.picks[0];
    if (!l || !p || p.kind !== 'el') return;
    const to = parentOf(l, p.i);
    if (to >= 0) setPicks([{ kind: 'el', i: to, el: l[to] }]);
  }, []);
  const down = useCallback(() => {
    const l = S.current.list;
    const p = S.current.picks[0];
    if (!l || !p || p.kind !== 'el') return;
    const to = childOf(l, p.i);
    if (to >= 0) setPicks([{ kind: 'el', i: to, el: l[to] }]);
  }, []);

  // ── what comes out ────────────────────────────────────────────────────

  const copyText = useCallback((text, what) => {
    ask({ type: 'copy', text });
    try { navigator.clipboard && navigator.clipboard.writeText(text); } catch (_) {}
    say(S.current.frame.id, what);
  }, [say]);

  // Inside the editor the editor puts it on the clipboard. In a browser tab the browser's
  // own clipboard is tried, and the editor's way is the fallback for both.
  const copyImage = useCallback((file, text, what) => {
    const viaEditor = () => ask({ type: 'copyImage', file, text: text || '' });
    if (NOT_HERE && navigator.clipboard && window.ClipboardItem) {
      fetch(pictureUrl(file.split('/').pop())).then(r => r.blob())
        .then(blob => navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]))
        .catch(viaEditor);
    } else {
      viaEditor();
    }
    say(S.current.frame.id, what);
  }, [say]);

  const working = useCallback(async (words, job) => {
    setBusy(words);
    try { return await job(); } finally { setBusy(''); }
  }, []);

  // A picture of what is chosen, with the reference beside it when there is one.
  const pictureOf = useCallback(async (items, mode) => {
    const f = S.current.frame;
    const lead = items[0];
    let shot;
    if (lead.kind === 'region') shot = await shotRegion(f.id, { ...lead.rect, label: 'region' });
    else if (items.length > 1) shot = await shotOf(f.id, { i: lead.i, find: findOf(lead.i), mode: 'marked', marks: items.map((p, n) => ({ i: p.i, find: findOf(p.i), n: n + 1 })), label: f.title });
    else shot = await shotOf(f.id, { i: lead.i, find: findOf(lead.i), mode: mode || 'element', marks: [{ i: lead.i, find: findOf(lead.i), n: 0 }], label: labelOf(lead.el) });
    if (shot.error || shot.stale) return { error: shot.error || 'The page has changed. Choose the element again.' };
    const ref = S.current.reference;
    if (!ref) return shot;
    const both = await sideBySide(pictureUrl(shot.name), ref.url, 'Now', 'Reference');
    const saved = await savePicture(both, 'with-reference');
    return saved.error ? { error: saved.error } : saved;
  }, []);

  const text = useCallback((shotFile) => {
    const s = S.current;
    const model = modelFor({ picks: s.picks, details: s.details, note: s.note, fileKnown: /^(canvas:|exp:)/.test(s.frame.id) });
    return promptFor({
      frame: s.frame, picks: s.picks, details: s.details, issues: s.issues,
      note: s.note, shot: shotFile || (s.thumb && s.thumb.file), hasReference: !!s.reference,
      hint: model ? model.hint : ''
    });
  }, []);

  const actions = useMemo(() => ({
    async copyPicture(items, mode) {
      const list = items || S.current.picks;
      if (!list.length) return;
      await working('Taking the picture...', async () => {
        const shot = await pictureOf(list, mode);
        if (shot.error) return say(S.current.frame.id, shot.error);
        copyImage(shot.file, '', mode === 'context' ? 'picture in context copied' : 'picture copied');
      });
    },
    copyPrompt(items) {
      if (!(items || S.current.picks).length) return;
      copyText(text(), 'prompt copied');
    },
    async copyBoth() {
      const list = S.current.picks;
      if (!list.length) return;
      await working('Taking the picture...', async () => {
        const shot = await pictureOf(list);
        if (shot.error) return say(S.current.frame.id, shot.error);
        copyImage(shot.file, text(shot.file), 'picture and prompt copied');
      });
    },
    async annotate(mode) {
      const list = S.current.picks;
      if (!list.length) return;
      await working('Taking the picture...', async () => {
        const shot = await pictureOf(list, mode || 'context');
        if (shot.error) return say(S.current.frame.id, shot.error);
        setDialog({ type: 'annotate', name: shot.name, file: shot.file });
      });
    },
    async states() {
      const p = S.current.picks[0];
      if (!p || p.kind !== 'el') return;
      await working('Putting it in each state...', async () => {
        const made = await shotStatesOf(S.current.frame.id, p.i, findOf(p.i));
        if (made.error || made.stale) return say(S.current.frame.id, made.error || 'choose it again');
        setDialog({
          type: 'image', title: 'States', name: made.name, file: made.file,
          note: made.same && made.same.length ? `No visible change: ${made.same.join(', ')}.` : ''
        });
      });
    },
    async sizes() {
      const p = S.current.picks[0];
      const d = p && S.current.details[p.i];
      if (!p || !d) return;
      await working('Drawing the page at three widths...', async () => {
        const made = await shotSizesOf(S.current.frame.id,
          { path: d.path, selector: d.selector, text: (d.text || '').slice(0, 60), tag: d.tag }, [390, 768, 1440]);
        if (made.error) return say(S.current.frame.id, made.error);
        if (made.none) return say(S.current.frame.id, 'not found at any width');
        setDialog({
          type: 'image', title: 'At 390, 768 and 1440', name: made.name, file: made.file,
          note: made.missing && made.missing.length ? `Not there at ${made.missing.join(', ')}px.` : ''
        });
      });
    },
    async remember() {
      const p = S.current.picks[0];
      if (!p || p.kind !== 'el') return;
      await working('Remembering how it looks...', async () => {
        const made = await rememberLook(S.current.frame.id, p.i, labelOf(p.el), findOf(p.i));
        if (made.error || made.stale) return say(S.current.frame.id, made.error || 'choose it again');
        say(S.current.frame.id, made.git ? 'look remembered, with the files' : 'look remembered');
        getRemembered(S.current.frame.id).then(setRemembered).catch(() => {});
      });
    },
    compare(id) { setDialog({ type: 'compare', id }); },
    async chooseReference() {
      if (!refs) { try { setRefs(await getRefs()); } catch (_) { setRefs([]); } }
      setDialog({ type: 'reference' });
    },
    clearReference() { setReference(null); },
    openFile(d) {
      if (d && d.source && d.source.open) ask({ type: 'openRepoFile', file: d.source.open, line: d.source.line });
    },
    copyDetail(what) {
      const p = S.current.picks[0];
      const d = p && S.current.details[p.i];
      if (!d) return;
      const value = what === 'selector' ? d.selector : what === 'class' ? d.cls : d.text;
      if (value) copyText(value, `${what} copied`);
    },
    selectParent: up
  }), [working, pictureOf, copyImage, copyText, text, refs, say, up]);

  // ── what is under the pointer, and the menu for it ────────────────────

  const under = useCallback((overlay, ev) => {
    const f = S.current.frame;
    const l = S.current.list;
    if (!l || S.current.scrolled) return -1;
    const at = onFrame(overlay, f, ev);
    return hit(l, at.x, at.y, scrollOf(f.id).y);
  }, []);

  // The right button over the frame: the element under it becomes the choice, the way it
  // does in a design tool, and the menu is about it. Over nothing it is the frame's menu.
  const rightDown = useCallback((overlay, ev) => {
    const i = under(overlay, ev);
    const l = S.current.list;
    if (i < 0 || !l) return null;
    const have = S.current.picks.some(p => p.kind === 'el' && p.i === i);
    if (!have) setPicks([{ kind: 'el', i, el: l[i] }]);
    return { i, el: l[i], multi: have && S.current.picks.length > 1 };
  }, [under]);

  const menuItems = useCallback(el => {
    const p = S.current.picks;
    const many = p.length > 1;
    const d = !many && S.current.details[el.i];
    const items = [
      { group: 'Picture' },
      { label: 'Copy screenshot', title: 'The element on its own, on the clipboard', run: () => actions.copyPicture() },
      { label: 'Copy screenshot in context', title: 'The frame around it, with the element boxed', run: () => actions.copyPicture(undefined, 'context') },
      { label: 'Copy as prompt', title: 'Where it is, what it is, the file and line, what it looks like', run: () => actions.copyPrompt() },
      { label: 'Annotate...', title: 'Draw on the picture before copying it', run: () => actions.annotate() },
      { group: 'Copy' },
      !many && { label: 'Copy selector', run: () => actions.copyDetail('selector') },
      !many && { label: 'Copy classes', run: () => actions.copyDetail('class') },
      !many && el.el.x && { label: 'Copy text', run: () => actions.copyDetail('text') },
      !many && d && d.source && { label: 'Open in editor', title: `${d.source.file}:${d.source.line}`, run: () => actions.openFile(d) },
      !many && { label: 'Select parent', title: 'Up one level (arrow up)', run: up },
      { group: 'Look' },
      !many && { label: 'States', title: 'Hover, focus and pressed, side by side', run: () => actions.states() },
      !many && { label: 'At 390, 768 and 1440', title: 'The same element at three widths', run: () => actions.sizes() },
      !many && { label: 'Remember this look', title: 'Take its picture and the project files as they are now', run: () => actions.remember() },
      !many && { label: 'Add a reference...', title: 'Put another picture beside it', run: () => actions.chooseReference() }
    ].filter(Boolean);
    return items;
  }, [actions, up]);

  // ── the snip tool ─────────────────────────────────────────────────────

  const snipped = useCallback(rect => {
    setSnip(false);
    if (rect.w < 8 || rect.h < 8) return;
    setPicks([{ kind: 'region', rect }]);
  }, []);

  // The keys: out of whatever is going on, up and down the tree, and the snip tool.
  const key = useCallback(ev => {
    if (!frame) return false;
    if (ev.key === 'Escape') {
      if (dialog) { setDialog(null); return true; }
      if (snip) { setSnip(false); return true; }
      if (picks.length) { setPicks([]); return true; }
      return false;
    }
    if (!live) return false;
    if (ev.metaKey || ev.ctrlKey) return false;
    if (ev.key === 'ArrowUp' && picks.length) { ev.preventDefault(); up(); return true; }
    if (ev.key === 'ArrowDown' && picks.length) { ev.preventDefault(); down(); return true; }
    if (ev.key === 's' || ev.key === 'S') { setSnip(on => !on); return true; }
    return false;
  }, [frame, live, dialog, snip, picks.length, up, down]);

  return {
    frame, live, state, list, picks, setPicks, hover, setHover, alt, setAlt, snip, setSnip, snipped,
    note, setNote, reference, setReference, dialog, setDialog, busy, details, issues, thumb,
    remembered, refs, actions, choose, under, rightDown, menuItems, key, onReload, onFit, say, copyText,
    scrolled: !!scrolled,
    disabled: state.status !== 'ready' || !!scrolled
  };
}

// Two pictures on one canvas with their names, for "this, and this is what it should be".
async function sideBySide(a, b, nameA, nameB) {
  const load = src => new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  // Both at the same height, so they read as two versions of one thing.
  // Tall enough to compare the detail of a whole screen, which is what this is mostly for.
  const h = Math.min(Math.max(ia.height, ib.height), 1200);
  const wa = Math.round(ia.width * (h / ia.height));
  const wb = Math.round(ib.width * (h / ib.height));
  const pad = 20;
  const head = 28;
  let scale = 1;
  const total = wa + wb + pad * 3;
  if (total > 1568) scale = 1568 / total;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(total * scale);
  canvas.height = Math.round((h + head + pad * 2) * scale);
  const c = canvas.getContext('2d');
  c.scale(scale, scale);
  c.fillStyle = '#eef0f3';
  c.fillRect(0, 0, total, h + head + pad * 2);
  c.fillStyle = '#222';
  c.font = '600 14px -apple-system, system-ui, sans-serif';
  c.fillText(nameA, pad, pad + 14);
  c.fillText(nameB, pad * 2 + wa, pad + 14);
  c.drawImage(ia, pad, pad + head, wa, h);
  c.drawImage(ib, pad * 2 + wa, pad + head, wb, h);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

// ── over the frame ──────────────────────────────────────────────────────────

// Drawn over the frame you have chosen, in the same layer as the board moves, so it is
// exactly where the frame is at any zoom. It takes the pointer; the page underneath never
// sees it, which is why a click chooses an element instead of pressing a button.
export function PickLayer({ pick, frame, onEnter }) {
  const ref = useRef(null);
  const frameTo = useRef(0);
  const drag = useRef(null);
  // The browser follows a drag's release with a click, and that click must not choose an
  // element over the region that was just cut.
  const snipped = useRef(false);
  const [rubber, setRubber] = useState(null);
  const list = pick.list || [];
  const scroll = scrollOf(frame.id).y;

  const move = ev => {
    if (drag.current) {
      const at = onFrame(ref.current, frame, ev);
      const d = drag.current;
      setRubber({ x: Math.min(d.x, at.x), y: Math.min(d.y, at.y), w: Math.abs(at.x - d.x), h: Math.abs(at.y - d.y) });
      return;
    }
    if (pick.disabled || pick.snip) return;
    cancelAnimationFrame(frameTo.current);
    const { clientX, clientY, altKey } = ev;
    frameTo.current = requestAnimationFrame(() => {
      pick.setAlt(altKey);
      pick.setHover(pick.under(ref.current, { clientX, clientY }));
    });
  };

  const down = ev => {
    if (ev.button !== 0 || !pick.snip) return;
    ev.preventDefault();
    const at = onFrame(ref.current, frame, ev);
    drag.current = at;
    setRubber({ x: at.x, y: at.y, w: 0, h: 0 });
    ref.current.setPointerCapture(ev.pointerId);
  };

  const up = ev => {
    if (!drag.current) return;
    const at = onFrame(ref.current, frame, ev);
    const d = drag.current;
    drag.current = null;
    snipped.current = true;
    setTimeout(() => { snipped.current = false; }, 400);
    setRubber(null);
    pick.snipped({
      x: Math.min(d.x, at.x), y: Math.min(d.y, at.y) + scroll,
      w: Math.abs(at.x - d.x), h: Math.abs(at.y - d.y)
    });
  };

  const click = ev => {
    if (ev.button !== 0 || pick.snip || pick.disabled || snipped.current) return;
    ev.stopPropagation();
    pick.choose(pick.under(ref.current, ev), ev.shiftKey || ev.metaKey || ev.ctrlKey);
  };

  const chosen = new Set(pick.picks.filter(p => p.kind === 'el').map(p => p.i));
  const hovered = !pick.disabled && !pick.snip && pick.hover >= 0 && !chosen.has(pick.hover) ? list[pick.hover] : null;
  const placed = r => ({ left: r[0], top: r[1] - scroll, width: r[2], height: r[3] });
  const els = pick.picks.filter(p => p.kind === 'el');

  // Distances: from the first chosen element to what is hovered while Alt is held, or
  // between the first two chosen.
  const lines = [];
  if (pick.alt && els.length && hovered) lines.push(...measure(list[els[0].i].r, (hovered.v || hovered.r)));
  else if (els.length > 1) lines.push(...measure(list[els[0].i].r, list[els[1].i].r));

  const status = pick.state.status;
  const chip = pick.scrolled
    ? 'scrolled'
    : status === 'failed' ? 'failed' : status === 'reading' && !pick.list ? 'reading' : '';

  return (
    <div
      ref={ref}
      className={'st-frame st-pick' + (pick.snip ? ' is-snipping' : '') + (pick.disabled ? ' is-off' : '')}
      data-id={frame.id}
      style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
      onPointerMove={move}
      onPointerDown={down}
      onPointerUp={up}
      onPointerLeave={() => { cancelAnimationFrame(frameTo.current); pick.setHover(-1); }}
      onClick={click}
      onDoubleClick={() => { if (!pick.snip && onEnter) onEnter(); }}
      onContextMenu={ev => ev.preventDefault()}
    >
      {pick.picks.map((p, n) => p.kind === 'region' ? (
        <div key={'r' + n} className="st-pick-box is-chosen is-region" style={{ left: p.rect.x, top: p.rect.y - scroll, width: p.rect.w, height: p.rect.h }}>
          <span className="st-pick-tag is-chosen">{Math.round(p.rect.w)} x {Math.round(p.rect.h)}</span>
        </div>
      ) : list[p.i] ? (
        <div key={p.i} className="st-pick-box is-chosen" style={placed(list[p.i].v || list[p.i].r)}>
          {els.length > 1 ? <span className="st-pick-n">{els.indexOf(p) + 1}</span> : null}
          <span className="st-pick-tag is-chosen">{labelOf(list[p.i])} <i>{Math.round(list[p.i].r[2])} x {Math.round(list[p.i].r[3])}</i></span>
        </div>
      ) : null)}

      {hovered ? (
        <div className="st-pick-box" style={placed(hovered.v || hovered.r)}>
          <span className="st-pick-tag">{labelOf(hovered)} <i>{Math.round(hovered.r[2])} x {Math.round(hovered.r[3])}</i></span>
        </div>
      ) : null}

      {lines.map((l, n) => (
        <div key={n} className={'st-pick-gap is-' + l.way}
          style={l.way === 'h'
            ? { left: Math.min(l.x1, l.x2), top: l.y1 - scroll, width: Math.abs(l.x2 - l.x1) }
            : { left: l.x1, top: Math.min(l.y1, l.y2) - scroll, height: Math.abs(l.y2 - l.y1) }}>
          <span>{l.label}</span>
        </div>
      ))}

      {rubber ? <div className="st-pick-box is-snip" style={{ left: rubber.x, top: rubber.y, width: rubber.w, height: rubber.h }} /> : null}

      {chip ? (
        <div className="st-pick-chip" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
          {chip === 'reading' ? <span>Reading the page...</span> : null}
          {chip === 'failed' ? <span>Could not read this page: {pick.state.error}</span> : null}
          {chip === 'scrolled' ? (
            <>
              <span>Scrolled, so the board cannot tell where things are.</span>
              {pick.onReload ? <button onClick={() => pick.onReload(frame.id)}>Back to top</button> : null}
              {pick.onFit && !frame.fit ? <button onClick={() => pick.onFit(frame)}>Show full content</button> : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── the panel ───────────────────────────────────────────────────────────────

export function PickPanel({ pick }) {
  const { picks, details, issues, thumb, note, reference, busy, remembered, actions } = pick;
  const [more, setMore] = useState(false);
  if (!picks.length || !pick.frame) return null;

  const lead = picks[0];
  const region = lead.kind === 'region';
  const d = !region && picks.length === 1 ? details[lead.i] : null;
  const found = picks.flatMap(p => (p.kind === 'el' ? issues[p.i] || [] : []));
  const sourceOf = d && d.source;
  const s = (d && d.style) || {};
  const t = (d && d.tokens) || {};
  const named = (v, k) => (t[k] ? `${v}  ${t[k]}` : v);
  const title = picks.length > 1 ? `${picks.length} chosen` : region ? 'Region' : labelOf(lead.el);
  const mine = remembered.filter(Boolean);
  const model = modelFor({ picks, details, note, fileKnown: /^(canvas:|exp:)/.test(pick.frame.id) });

  return (
    <div className="st-pickpanel" onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
      <header>
        <b title={title}>{title}</b>
        <button className="st-x" title="Choose nothing (Escape)" onClick={() => pick.setPicks([])}>&times;</button>
      </header>

      <div className="st-pickpanel-thumb">
        {thumb && thumb.key === picks.map(p => p.kind === 'region' ? `r${p.rect.x},${p.rect.y},${p.rect.w},${p.rect.h}` : p.i).join('|')
          ? <img src={pictureUrl(thumb.name)} alt="" draggable={false} />
          : <span>Taking its picture...</span>}
      </div>

      {sourceOf ? (
        <button className="st-pickpanel-source" title="Open this line in the editor" onClick={() => actions.openFile(d)}>
          {sourceOf.file}{sourceOf.line ? `:${sourceOf.line}` : ''}
          {d.components && d.components[0] ? <em>{d.components[0]}</em> : null}
        </button>
      ) : null}

      {d ? (
        <dl className="st-pickpanel-facts">
          <dt>Size</dt><dd>{Math.round(d.rect.w)} x {Math.round(d.rect.h)}</dd>
          {s.size ? (<><dt>Type</dt><dd>{s.font ? s.font + ' ' : ''}{s.size}{s.lineHeight ? ' / ' + s.lineHeight : ''} {s.weight}</dd></>) : null}
          {s.color ? (<><dt>Colour</dt><dd><i className="st-sw" style={{ background: s.color }} />{named(s.color, 'color')}</dd></>) : null}
          {s.background ? (<><dt>Fill</dt><dd><i className="st-sw" style={{ background: s.background }} />{named(s.background, 'background')}</dd></>) : null}
          {s.radius ? (<><dt>Radius</dt><dd>{named(s.radius, 'radius')}</dd></>) : null}
          {s.padding ? (<><dt>Padding</dt><dd>{s.padding}</dd></>) : null}
          {s.gap ? (<><dt>Gap</dt><dd>{named(s.gap, 'gap')}</dd></>) : null}
        </dl>
      ) : null}

      {found.length ? (
        <ul className="st-pickpanel-issues">
          {found.slice(0, 4).map((i, n) => <li key={n} className={i.severity === 'bad' ? 'is-bad' : ''}><b>{i.kind}</b> {i.detail}</li>)}
        </ul>
      ) : null}

      <div className="st-pickpanel-templates">
        {TEMPLATES.filter(([label]) => label !== 'Match reference' || reference).map(([label, line]) => (
          <button key={label} onClick={() => pick.setNote(n => (n ? n.replace(/\s*$/, ' ') : '') + line)}>{label}</button>
        ))}
      </div>
      <textarea
        className="st-pickpanel-note"
        placeholder="What should change? Goes in the prompt."
        value={note}
        rows={2}
        onChange={e => pick.setNote(e.target.value)}
        onKeyDown={e => e.stopPropagation()}
      />

      {reference ? (
        <div className="st-pickpanel-ref">
          <img src={reference.url} alt="" />
          <span>{reference.name}</span>
          <button className="st-x" title="Take the reference away" onClick={actions.clearReference}>&times;</button>
        </div>
      ) : null}

      {model ? (
        <div className="st-pickpanel-model" title={`Why: ${model.reason}.`}>
          <span>{model.agent ? <>Goes to <b>{model.agent}</b> ({model.name})</> : <>Needs <b>{model.name}</b></>}</span>
          <button onClick={() => pick.copyText(model.command, `${model.command} copied`)} title="To switch the session itself instead">{model.command}</button>
        </div>
      ) : null}

      <div className="st-row">
        <button className="st-btn st-btn--go" disabled={!!busy} onClick={() => actions.copyPicture()} title="The picture, on the clipboard, to paste into Claude">Copy screenshot</button>
        <button className="st-btn" disabled={!!busy} onClick={() => actions.copyPrompt()} title="Where it is, the file and line, what it looks like, your note">Copy prompt</button>
      </div>
      <button className="st-btn" disabled={!!busy} onClick={() => actions.copyBoth()} title="The picture and the words on the clipboard together. A chat box takes the picture; an editor takes the words.">
        Copy both
      </button>
      {busy ? <p className="st-note-line">{busy}</p> : null}

      <button className="st-pickpanel-more" onClick={() => setMore(m => !m)}>{more ? 'Less' : 'More'}</button>
      {more ? (
        <div className="st-pickpanel-extra">
          {!region ? <button className="st-btn" disabled={!!busy} onClick={() => actions.copyPicture(undefined, 'context')}>Screenshot in context</button> : null}
          <button className="st-btn" disabled={!!busy} onClick={() => actions.annotate()}>Annotate</button>
          {!region && picks.length === 1 ? <button className="st-btn" disabled={!!busy} onClick={actions.states}>States</button> : null}
          {!region && picks.length === 1 ? <button className="st-btn" disabled={!!busy} onClick={actions.sizes}>3 widths</button> : null}
          <button className="st-btn" disabled={!!busy} onClick={actions.chooseReference}>Reference</button>
          {!region && picks.length === 1 ? <button className="st-btn" disabled={!!busy} onClick={actions.remember}>Remember look</button> : null}
          {mine.length ? <button className="st-btn" onClick={() => actions.compare(mine[0].id)} title={mine[0].label}>Compare with before</button> : null}
        </div>
      ) : null}
    </div>
  );
}

// ── dialogs ─────────────────────────────────────────────────────────────────

export function PickDialogs({ pick }) {
  const { dialog, setDialog, frame, actions } = pick;
  if (!dialog || !frame) return null;
  const close = () => setDialog(null);

  if (dialog.type === 'image') {
    return (
      <ImageDialog
        title={dialog.title}
        src={pictureUrl(dialog.name)}
        note={dialog.note}
        onCopy={() => { ask({ type: 'copyImage', file: dialog.file, text: '' }); pick.say(frame.id, 'picture copied'); }}
        onClose={close}
      />
    );
  }
  if (dialog.type === 'annotate') {
    return (
      <AnnotateDialog
        src={pictureUrl(dialog.name)}
        onCopy={async blob => {
          const saved = await savePicture(blob, 'annotated');
          if (saved.error) return pick.say(frame.id, saved.error);
          ask({ type: 'copyImage', file: saved.file, text: '' });
          pick.say(frame.id, 'annotated picture copied');
          close();
        }}
        onClose={close}
      />
    );
  }
  if (dialog.type === 'compare') {
    return <CompareDialog frame={frame} id={dialog.id} say={pick.say} onClose={close} />;
  }
  if (dialog.type === 'reference') {
    return (
      <ImageDialog
        title="Pick a reference"
        onClose={close}
        render={() => (
          <div className="st-refpick">
            {(pick.refs || []).filter(r => r.kind === 'image').length
              ? (pick.refs || []).filter(r => r.kind === 'image').map(r => (
                <button key={r.name} onClick={() => { pick.setReference({ name: r.name, url: r.url }); close(); }}>
                  <img src={r.url} alt={r.name} />
                  <span>{r.name}</span>
                </button>
              ))
              : <p className="st-note-line">No pictures in this board's references yet. Add one in References, and it is here.</p>}
          </div>
        )}
      />
    );
  }
  return null;
}
