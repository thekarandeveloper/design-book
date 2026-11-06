import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FRAME_GROUPS } from './frames.js';
import { holdWheel, onEachFrame, wheelStep } from './navigate.js';
import { SleeperContext, createSleeper } from './awake.js';
import { usePick, PickLayer, PickPanel, PickDialogs } from './Pick.jsx';
import { labelOf } from './pick.js';

// The board: sections, zoom, pan, selection, frames you can move between sections and
// resize.
//
// Frames are rendered directly rather than through a wrapper of our own, so a component
// edit updates every frame at once through hot reload, with no reload of the board.
//
// A frame is not loose on an infinite plane. It belongs to a section, and the section
// lays its frames out in one line, left to right. So a drag means one thing only: put
// this frame in that section, in that order. Nothing can be dropped into a gap where
// nobody will find it again, and the order survives in the .designbook file.
//
// Selection does two jobs. It is what the inspector acts on, and it is what decides
// where a scroll goes: an unselected frame does not take pointer events at all, so the
// wheel reaches the board and pans it wherever the pointer happens to be. Select a
// frame and that one frame takes the wheel, so you scroll the page inside it. That is
// one rule rather than two, and it is the behaviour of every board tool.

const MIN = 0.05;
const MAX = 4;

// How far a section's line runs either way. A section splits the whole board, not the
// strip its frames happen to occupy, so the line has to outrun anything that could be
// put on it.
const EDGE = 50000;

// How tall a section's name is, in screen pixels. The labels layer places by hand, so
// the one number the stylesheet and the placement both depend on is written once.
const BAND_BAR = 24;

export function Board({
  frames, bands = [], onResize, onFit, onReload, onDrop,
  onAddSection, onRenameSection, onRemoveSection,
  onSelect, onRename, onDelete, onCheck, onCopy, onSay, focus,
  storageKey, empty
}) {
  const boardRef = useRef(null);
  const worldRef = useRef(null);
  const pickWorldRef = useRef(null);
  const [view, setView] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('st-view:' + storageKey) || 'null');
      if (saved && typeof saved.k === 'number') return saved;
    } catch (_) {}
    return { x: 48, y: 24, k: 0.5 };
  });
  const [panning, setPanning] = useState(false);

  // Where the board really is, between one drawn frame and the next.
  //
  // Moving used to be React state, so a trackpad's hundred events a second were a
  // hundred renders of everything on the board. Nothing about a frame changes when the
  // board moves, only where the whole layer is drawn, so the move is written straight
  // onto that layer and React is told once a frame, for the labels and the readout.
  const live = useRef(view);
  // Which frames run, which are a picture, which are nothing: worked out from where the
  // board is looking, every time it moves, and handed on only where it changed.
  const sleeper = useRef(null);
  if (!sleeper.current) sleeper.current = createSleeper();
  const paint = useCallback(() => {
    const at = live.current;
    const el = worldRef.current;
    if (el) {
      el.style.transform = `translate3d(${at.x}px, ${at.y}px, 0) scale(${at.k})`;
      el.style.setProperty('--k', String(Math.max(0.2, Math.min(1, at.k))));
      // The real zoom, for what the board draws over a frame and wants to stay one
      // pixel thick however far in or out it is.
      el.style.setProperty('--zoom', String(at.k));
    }
    // What is drawn over the chosen frame moves exactly as the world does.
    const over = pickWorldRef.current;
    if (over) {
      over.style.transform = `translate3d(${at.x}px, ${at.y}px, 0) scale(${at.k})`;
      over.style.setProperty('--zoom', String(at.k));
    }
    sleeper.current.update({ view: at });
    setView(at);
  }, []);
  const beat = useRef(null);
  if (!beat.current) beat.current = onEachFrame(paint);

  // Every move goes through here: a whole new place, or a change to the one it is at.
  const move = useCallback(next => {
    const was = live.current;
    const to = typeof next === 'function' ? next(was) : next;
    const k = Math.min(MAX, Math.max(MIN, to.k === undefined ? was.k : to.k));
    const x = to.x === undefined ? was.x : to.x;
    const y = to.y === undefined ? was.y : to.y;
    if (x === was.x && y === was.y && k === was.k) return;
    live.current = { x, y, k };
    beat.current.ask();
  }, []);

  // The first draw, and the last one: the layer is written to directly, so it has to be
  // given its place when it appears, and the beat stopped when it goes.
  useEffect(() => {
    paint();
    return () => {
      if (beat.current) beat.current.stop();
      if (sleeper.current) sleeper.current.stop();
    };
  }, [paint]);
  const [selected, setSelected] = useState('');
  const [drag, setDrag] = useState(null);
  const [menu, setMenu] = useState(null);        // the right click menu: what, and where
  // The frame you have gone inside.
  //
  // A frame is a page running in an iframe, and an iframe takes the pointer or it does
  // not: there is no half. While it has the pointer, every click, every scroll and the
  // right button belong to that page and the board never hears them. So going inside is
  // something you do on purpose, by double-clicking, and Escape comes back out. Choosing
  // a frame still gives you its panel, its menu and its handles.
  const [inside, setInside] = useState('');
  const [renaming, setRenaming] = useState('');   // a section's name, being typed
  const [naming, setNaming] = useState('');       // a frame's name, being typed
  const [size, setSize] = useState({ w: 1200, h: 800 });
  const [settling, setSettling] = useState(false);

  // The labels are placed in the viewport, so the viewport's size is part of placing them.
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const frame = frames.find(f => f.id === selected) || null;

  // What the wheel handler needs to know without being rebuilt for it.
  const framesRef = useRef(frames);
  framesRef.current = frames;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  // Frames of another origin whose page has been scrolled, so where it is now is unknown.
  const [scrolled, setScrolled] = useState(() => new Set());
  const nonces = useRef({});
  useEffect(() => {
    // A frame that loaded its page again is at the top again.
    let changed = false;
    const next = new Set(scrolled);
    for (const f of frames) {
      if (nonces.current[f.id] !== undefined && nonces.current[f.id] !== f.nonce && next.delete(f.id)) changed = true;
      nonces.current[f.id] = f.nonce;
    }
    if (changed) setScrolled(next);
  }, [frames]);

  // Choosing elements inside the frame that is chosen: its map, what is under the pointer,
  // what is picked, and what can be done with it.
  const pick = usePick({
    frame,
    inside: !!frame && inside === frame.id,
    scrolled: !!frame && scrolled.has(frame.id),
    say: onSay || (() => {}),
    onReload,
    onFit
  });
  const pickRef = useRef(pick);
  pickRef.current = pick;

  // What the sleeper decides from: where every frame is and how big, how big the window
  // is, and the frame that is chosen, which stays awake wherever it ends up.
  const shape = frames.map(f => `${f.id}:${f.x},${f.y},${f.width},${f.height},${f.running ? 1 : 0}`).join('|');
  useEffect(() => {
    sleeper.current.update({
      frames: frames.map(f => ({ id: f.id, x: f.x, y: f.y, width: f.width, height: f.height, running: !!f.running })),
      size,
      keep: new Set(selected ? [selected] : []),
      view: live.current
    });
  }, [shape, size, selected]);

  // Selecting is the board's own business, but what is selected decides where the next
  // frame goes, so it is said out loud.
  const select = useCallback(id => {
    setSelected(id);
    if (onSelect) onSelect(id);
  }, [onSelect]);

  // Where the board was left, written once the moving stops. Writing to storage is a
  // synchronous thing, and doing it on every drawn frame of a pan is sixty of them a
  // second for an answer nobody reads until the window opens again.
  useEffect(() => {
    const id = setTimeout(() => {
      try { localStorage.setItem('st-view:' + storageKey, JSON.stringify(view)); } catch (_) {}
    }, 400);
    return () => clearTimeout(id);
  }, [view, storageKey]);

  // When the line changes, because a frame was deleted or moved or made, the rest of it
  // slides to where it now belongs rather than jumping. Only then: panning and zooming
  // must stay exactly as fast as the hand moving them.
  const where = frames.map(f => `${f.id}:${f.x},${f.y}`).join('|');
  useEffect(() => {
    if (drag) return;
    setSettling(true);
    const done = setTimeout(() => setSettling(false), 380);
    return () => clearTimeout(done);
  }, [where]);

  // A frame that has gone away cannot stay selected.
  useEffect(() => {
    if (selected && !frames.some(f => f.id === selected)) setSelected('');
  }, [frames, selected]);

  // Where a drop would land. Sections are bands down the board, so the pointer's y picks
  // the section and its x picks the place in that section's line.
  const lanes = useMemo(() => {
    const out = new Map();
    for (const band of bands) out.set(band.id, { band, frames: [] });
    for (const f of frames) {
      const lane = out.get(f.section);
      if (lane) lane.frames.push(f);
    }
    for (const lane of out.values()) lane.frames.sort((a, b) => a.x - b.x);
    return out;
  }, [bands, frames]);

  const targetAt = useCallback((world, movingId) => {
    if (!bands.length) return null;
    let band = bands.find(b => world.y >= b.y && world.y <= b.y + b.height);
    if (!band) {
      // Above the first band or below the last: the nearest one, so a drop always lands.
      band = bands.reduce((best, b) => {
        const d = Math.abs(world.y - (b.y + b.height / 2));
        return !best || d < best.d ? { b, d } : best;
      }, null).b;
    }
    const lane = lanes.get(band.id);
    const line = (lane ? lane.frames : []).filter(f => f.id !== movingId);
    let index = line.length;
    for (let i = 0; i < line.length; i++) {
      if (world.x < line[i].x + line[i].width / 2) { index = i; break; }
    }
    const caret = index === 0
      ? (line[0] ? line[0].x - 28 : band.x + 32)
      : line[index - 1].x + line[index - 1].width + 28;
    return { section: band.id, index, caret, bandY: band.y, bandHeight: band.height };
  }, [bands, lanes]);

  const zoomAt = useCallback((clientX, clientY, factor) => {
    const rect = boardRef.current.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    move(v => {
      const k = Math.min(MAX, Math.max(MIN, v.k * factor));
      if (k === v.k) return v;
      return { k, x: px - (px - v.x) * (k / v.k), y: py - (py - v.y) * (k / v.k) };
    });
  }, [move]);

  const centre = factor => {
    const r = boardRef.current.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
  };

  const fit = useCallback((only) => {
    const list = only ? frames.filter(f => f.id === only) : frames;
    if (!list.length) return move({ x: 48, y: 24, k: 0.5 });
    const box = list.reduce((acc, f) => ({
      minX: Math.min(acc.minX, f.x),
      minY: Math.min(acc.minY, f.y),
      maxX: Math.max(acc.maxX, f.x + f.width),
      maxY: Math.max(acc.maxY, f.y + (f.height || 600) + 22)
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

    const rect = boardRef.current.getBoundingClientRect();
    const pad = 56;
    // Everything on the board, however far out that is. A board with one very tall
    // screen on it fits at a few percent, and that is the right answer: it is the whole
    // board, which is what fitting means.
    const k = Math.min(MAX, Math.max(MIN, Math.min(
      (rect.width - pad * 2) / Math.max(1, box.maxX - box.minX),
      (rect.height - pad * 2) / Math.max(1, box.maxY - box.minY)
    )));
    move({
      k,
      x: pad - box.minX * k + (rect.width - pad * 2 - (box.maxX - box.minX) * k) / 2,
      y: pad - box.minY * k
    });
  }, [frames, move]);

  // Bring one frame into the middle of the window, at a zoom it fits in. A frame that
  // has just been made is no use at the far right of a line nobody has scrolled to.
  const centreOn = useCallback(id => {
    const f = frames.find(x => x.id === id);
    if (!f || !boardRef.current) return;
    const rect = boardRef.current.getBoundingClientRect();
    const pad = 64;
    // By its width rather than its whole height. A screen showing its full content can be
    // forty thousand pixels tall, and fitting that would draw it as a hairline: across is
    // what tells you which screen this is, and down is what scrolling is for.
    // Never past life size: a small frame blown up to fill the window is not a truer
    // view of it, it is a bigger one.
    const k = Math.min(1, Math.max(MIN, (rect.width - pad * 2) / Math.max(1, f.width)));
    const fits = f.height * k < rect.height - pad * 2;
    move({
      k,
      x: rect.width / 2 - (f.x + f.width / 2) * k,
      // In the middle when the whole of it fits, at its own top when it does not.
      y: fits ? rect.height / 2 - (f.y + f.height / 2) * k : pad - f.y * k
    });
  }, [frames, move]);

  // A frame the board is asked to show: selected, and brought into the middle.
  const asked = useRef('');
  useEffect(() => {
    if (!focus || focus === asked.current) return;
    if (!frames.some(f => f.id === focus)) return;
    asked.current = focus;
    select(focus);
    centreOn(focus);
  }, [focus, frames, select, centreOn]);

  // Bound by hand: React's onWheel is passive, so it cannot preventDefault and the page
  // would scroll instead of the board moving. An event that started inside a selected
  // frame never reaches here, which is exactly how scrolling inside one works.
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    // A swipe, a notch and a pinch all arrive as a wheel event and mean different
    // things. What each one means is worked out in one place, against the numbers Figma
    // actually uses, and the movement is gathered up and applied once a frame.
    const held = holdWheel();
    const gathered = { dx: 0, dy: 0, scale: 1, x: 0, y: 0, zooming: false };
    const apply = () => {
      if (gathered.zooming) zoomAt(gathered.x, gathered.y, gathered.scale);
      else move(v => ({ ...v, x: v.x - gathered.dx, y: v.y - gathered.dy }));
      gathered.dx = 0;
      gathered.dy = 0;
      gathered.scale = 1;
      gathered.zooming = false;
    };
    const wheelBeat = onEachFrame(apply);

    // The wheel, over the frame you have chosen, scrolls the page inside it.
    //
    // A page that has somewhere to scroll takes the wheel once it is chosen, which is what
    // choosing it is for; a page that has nowhere to go leaves the wheel to the board, or
    // the board would stop moving whenever the pointer crossed it. A pinch is always the
    // board's: it is a zoom, and zooming is never a scroll.
    //
    // A page on this origin is scrolled directly. A page on another, which is any live
    // route, cannot be reached from here at all, so for a moment the frame is given the
    // pointer and the wheel goes to it as it would to any page. Where that page is
    // afterwards is not something the board can know, and it says so.
    let handBack = 0;
    const scrollInside = ev => {
      if (ev.ctrlKey || ev.metaKey) return false;
      const node = ev.target.closest && ev.target.closest('.st-frame');
      if (!node || node.getAttribute('data-id') !== selectedRef.current) return false;
      const f = framesRef.current.find(x => x.id === selectedRef.current);
      // The frame itself, and the layer drawn over it, are two elements: the page is in
      // one and the pointer is on the other.
      const real = el.querySelector(`.st-world > .st-frame[data-id="${CSS.escape(selectedRef.current)}"]`);
      const over = el.querySelector('.st-pick');
      const iframe = f && f.scrolls && real ? real.querySelector('iframe') : null;
      if (!iframe) return false;
      ev.preventDefault();
      const unit = ev.deltaMode === 1 ? 40 : ev.deltaMode === 2 ? 800 : 1;
      try {
        const view = iframe.contentWindow;
        void view.document;           // throws when the page is another origin
        view.scrollBy({ left: ev.deltaX * unit, top: ev.deltaY * unit, behavior: 'instant' });
        return true;
      } catch (_) {}
      real.classList.add('is-scrolling');
      if (over) over.classList.add('is-scrolling');
      clearTimeout(handBack);
      handBack = setTimeout(() => {
        real.classList.remove('is-scrolling');
        if (over) over.classList.remove('is-scrolling');
      }, 500);
      setScrolled(was => (was.has(f.id) ? was : new Set(was).add(f.id)));
      return true;
    };

    const onWheel = ev => {
      if (scrollInside(ev)) return;
      ev.preventDefault();
      const step = wheelStep(ev, held);
      if (step.kind === 'zoom') {
        gathered.zooming = true;
        gathered.scale *= step.scale;
        gathered.x = ev.clientX;
        gathered.y = ev.clientY;
      } else {
        gathered.dx += step.dx;
        gathered.dy += step.dy;
      }
      wheelBeat.ask();
    };
    // The right button, caught twice.
    //
    // Inside an editor's panel the board is a page inside a page, and the editor can take
    // the contextmenu event before this ever sees it. The press of the right button comes
    // first and reaches the page either way, so that is what opens the menu; the
    // contextmenu event, if it arrives at all, only refuses the editor's own menu.
    const frameUnder = target => {
      const node = target && target.closest && target.closest('.st-frame');
      if (!node) return null;
      return frames.find(frame => frame.id === node.getAttribute('data-id')) || null;
    };

    const onRightDown = ev => {
      if (ev.button !== 2) return;
      const f = frameUnder(ev.target);
      if (!f) return;
      ev.preventDefault();
      ev.stopPropagation();
      select(f.id);
      // Over the layer drawn on the chosen frame, the menu is about the element under
      // the pointer, which the right button also chooses.
      const layer = ev.target.closest && ev.target.closest('.st-pick');
      const element = layer && pickRef.current.live ? pickRef.current.rightDown(layer, ev) : null;
      setMenu({ frame: f, x: ev.clientX, y: ev.clientY, element });
    };
    const onMenu = ev => {
      if (!frameUnder(ev.target)) return;
      ev.preventDefault();
      ev.stopPropagation();
    };
    el.addEventListener('pointerdown', onRightDown, true);
    el.addEventListener('mousedown', onRightDown, true);
    el.addEventListener('contextmenu', onMenu, true);

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      wheelBeat.stop();
      clearTimeout(handBack);
      el.removeEventListener('pointerdown', onRightDown, true);
      el.removeEventListener('mousedown', onRightDown, true);
      el.removeEventListener('contextmenu', onMenu, true);
      el.removeEventListener('wheel', onWheel);
    };
  }, [zoomAt, move, frames, select]);

  useEffect(() => {
    const onKey = ev => {
      if (ev.target.matches('input, textarea, [contenteditable]')) return;
      // What is chosen inside the frame comes first: Escape lets go of that before it lets
      // go of the frame, and the arrows walk the tree.
      if (pickRef.current.key(ev)) return;
      if (ev.key === 'Escape') {
        setMenu(null);
        // Out of the frame first, because that is what Escape means while you are in one.
        if (inside) setInside('');
        else { select(''); setRenaming(''); }
      }
      else if ((ev.key === 'Delete' || ev.key === 'Backspace') && selected && onDelete) {
        ev.preventDefault();
        onDelete(selected);
      }
      else if (ev.key === '1') fit();
      else if (ev.key === '2' && selected) fit(selected);
      else if (ev.key === '0') move(v => ({ ...v, k: 1 }));
      else if (ev.key === '+' || ev.key === '=') centre(1.2);
      else if (ev.key === '-') centre(1 / 1.2);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fit, selected, inside, onDelete, move]);

  const startPan = ev => {
    if (ev.button !== 0 && ev.button !== 1) return;
    setMenu(null);
    setInside('');
    if (ev.target.closest('.st-frame-bar, .st-handle, .st-inspector, .st-band-bar')) return;
    // Selecting a frame is selecting a frame, and nothing else.
    //
    // Pressing on one used to start a pan as well, so the smallest movement while
    // clicking slid the whole board under the thing you were pointing at. The middle
    // button still pans from anywhere, which is how you pan without leaving a frame.
    if (ev.button !== 1 && ev.target.closest('.st-frame')) return;
    // A press on the board itself, rather than on a frame, clears the selection.
    select('');
    if (ev.altKey) return;

    const startX = ev.clientX;
    const startY = ev.clientY;
    const from = live.current;
    setPanning(true);
    const drag = e => move({ ...from, x: from.x + (e.clientX - startX), y: from.y + (e.clientY - startY) });
    const up = () => {
      setPanning(false);
      window.removeEventListener('pointermove', drag);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', drag);
    window.addEventListener('pointerup', up);
  };

  const world = e => {
    const rect = boardRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - view.x) / view.k,
      y: (e.clientY - rect.top - view.y) / view.k
    };
  };

  const startDrag = (ev, f) => {
    ev.stopPropagation();
    select(f.id);
    const startX = ev.clientX;
    const startY = ev.clientY;
    // A click is not a drag. Without this, selecting a frame would reorder the section
    // it is already in every time it is touched.
    let moved = false;
    const move = e => {
      if (!moved && Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) < 6) return;
      moved = true;
      setDrag({
        id: f.id,
        dx: (e.clientX - startX) / view.k,
        dy: (e.clientY - startY) / view.k,
        target: targetAt(world(e), f.id)
      });
    };
    const up = e => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const landed = moved ? targetAt(world(e), f.id) : null;
      setDrag(null);
      if (!landed || !onDrop) return;
      // Dropping a frame back where it already was is not a move. Without this a nudge
      // rewrites the board file and every frame after it shuffles along for nothing.
      const line = (lanes.get(f.section) || { frames: [] }).frames;
      const from = line.findIndex(x => x.id === f.id);
      if (landed.section === f.section && landed.index === from) return;
      onDrop(f.id, landed.section, landed.index);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startResize = (ev, f, axis) => {
    ev.stopPropagation();
    ev.preventDefault();
    const startX = ev.clientX;
    const startY = ev.clientY;
    const w0 = f.width;
    const h0 = f.height;
    const next = e => ({
      width: axis === 'y' ? w0 : Math.max(200, Math.round(w0 + (e.clientX - startX) / view.k)),
      height: axis === 'x' ? h0 : Math.max(200, Math.round(h0 + (e.clientY - startY) / view.k))
    });
    const move = e => { const n = next(e); onResize(f.id, n.width, n.height, false); };
    const up = e => {
      const n = next(e);
      // Dragged to a size: that is a size somebody chose, so the frame stops fitting.
      onResize(f.id, n.width, n.height, true, false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const worldInside = useMemo(() => (
    <>
      {bands.filter(band => band.chrome).map(band => (
        <div
          key={band.id}
          className={'st-section' + (band.odd ? ' is-odd' : '') + (drag?.target?.section === band.id ? ' is-target' : '')}
          style={{ left: -EDGE, top: band.y, width: EDGE * 2, height: band.height }}
        >
          <div className="st-rule" />
        </div>
      ))}

      {drag?.target ? (
        <div
          className="st-caret"
          style={{
            left: drag.target.caret,
            top: drag.target.bandY + 40,
            height: Math.max(120, drag.target.bandHeight - 56)
          }}
        />
      ) : null}

      {frames.map(f => {
        const isSelected = f.id === selected;
        const isDragging = drag?.id === f.id;
        return (
          <div
            key={f.id}
            data-id={f.id}
            className={'st-frame' + (isSelected ? ' is-selected' : '') + (f.id === inside ? ' is-inside' : '') + (isDragging ? ' is-moving' : '')}
            style={{
              left: f.x,
              top: f.y,
              width: f.width,
              transform: isDragging ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined
            }}
            onPointerDown={() => { if (f.id !== selected) { select(f.id); centreOn(f.id); } }}
            onDoubleClick={() => setInside(f.id)}
            onContextMenu={ev => {
              ev.preventDefault();
              select(f.id);
              setMenu({ frame: f, x: ev.clientX, y: ev.clientY });
            }}
          >
            {f.body}

            {isSelected ? (
              <>
                <span className="st-handle st-handle--e" onPointerDown={e => startResize(e, f, 'x')} />
                <span className="st-handle st-handle--s" onPointerDown={e => startResize(e, f, 'y')} />
                <span className="st-handle st-handle--se" onPointerDown={e => startResize(e, f, 'xy')} />
              </>
            ) : null}
          </div>
        );
      })}
    </>
  ), [frames, bands, drag, selected, inside, select, centreOn, startResize]);

  return (
    <SleeperContext.Provider value={sleeper.current}>
    <div
      ref={boardRef}
      className={'st-board' + (panning ? ' is-panning' : '') + (drag ? ' is-dragging' : '')}
      onPointerDown={startPan}
    >
      {/* --k is the zoom, as a number the stylesheet can divide by: a title and the
          buttons beside it are sized against it, so they stay the same size on screen
          however far out the board is. Below 20% they stop growing, or a label would
          cover the thing it names. */}
      <div ref={worldRef} className={'st-world' + (settling ? ' is-settling' : '')}>
        {worldInside}
      </div>

      {/* What is drawn over the chosen frame: its elements, outlined as the pointer
          crosses them. A layer of its own that moves as the world does, so choosing an
          element redraws that layer and not every frame on the board. */}
      <div ref={pickWorldRef} className="st-world st-world--pick">
        {frame && pick.live && !drag ? (
          <PickLayer pick={pick} frame={frame} onEnter={() => setInside(frame.id)} />
        ) : null}
      </div>

      {/* Labels live over the board, not in it.
          A label drawn inside the world is drawn at the world's scale, so at 30% it is
          unreadable and anything that grows it back collides with the label above. Here
          they are placed by converting world coordinates to the screen, so a title is
          the same size at any zoom and two labels can never overlap: a section's name is
          tucked into the left edge above its line, and a frame's name is held below
          it. */}
      {/* How much a label says depends on how far out the board is. Zoomed out, the
          world shrinks but a label cannot, so saying everything about every frame turns
          the board into a wall of text over the work. The section's name is what you
          need at that distance; the rest comes back as you come in. */}
      <div className={'st-labels is-' + (view.k >= 0.45 ? 'full' : view.k >= 0.22 ? 'brief' : 'quiet') + (settling ? ' is-settling' : '')}>
        {bands.filter(band => band.chrome).map(band => {
          // A section's name is tucked into the left edge of the viewport, flush against
          // it, and held inside the viewport while any part of that section is on
          // screen. It does not follow its frames: a name that drifts across the board
          // with them floats over the work, and a wall of them is the clutter you are
          // trying to look past. On the edge it is a rail you read down instead, and
          // once the section is gone, so is its name.
          const top = view.y + band.y * view.k;
          const bottom = top + band.height * view.k;
          if (bottom < 24 || top > size.h - 8) return null;
          return (
          <div
            key={band.id}
            className={'st-band-bar' + (drag?.target?.section === band.id ? ' is-target' : '')}
            style={{
              // Three things it has to be under, and the lowest of them wins: six
              // pixels above its own line, so it is never on the section before it; its
              // own section's bottom, so it is never under frames it does not name; and
              // the board's own controls in the bottom left corner, which it now shares
              // an edge with.
              top: Math.max(8, Math.min(top - BAND_BAR - 6, bottom - BAND_BAR - 6, size.h - 72))
            }}
          >
            {renaming === band.id ? (
              <input
                className="st-band-name-input"
                defaultValue={band.name}
                autoFocus
                onBlur={e => { setRenaming(''); onRenameSection(band.id, e.target.value); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') setRenaming('');
                }}
              />
            ) : (
              <b onDoubleClick={() => setRenaming(band.id)} title="Double-click to rename">{band.name}</b>
            )}
            <span className="st-band-count">{band.count}</span>
            <button
              className="st-band-x"
              title={band.count ? 'Remove this section. Its frames move to the one above.' : 'Remove this section'}
              onClick={() => onRemoveSection(band.id)}
            >
              &times;
            </button>
          </div>
          );
        })}

        {frames.map(f => {
          // A name for a frame nobody can see is a name nobody can read. On a board of
          // eighty frames that is seventy of them, placed again every time the board
          // moves, so the ones off the edge are not drawn at all.
          const x = view.x + f.x * view.k;
          const width = f.width * view.k;
          const y = view.y + f.y * view.k;
          if (x > size.w + 80 || x + width < -80 || y > size.h + 40 || y + f.height * view.k < -80) return null;

          const band = bands.find(b => b.id === f.section);
          const dx = drag?.id === f.id ? drag.dx * view.k : 0;
          const dy = drag?.id === f.id ? drag.dy * view.k : 0;
          const top = view.y + f.y * view.k - 30;
          // Never above its own section's line, which is where that section's name is.
          const floor = band && band.chrome ? view.y + band.y * view.k + 8 : -Infinity;
          return (
            <div
              key={f.id}
              className={'st-frame-bar' + (f.id === selected ? ' is-selected' : '')}
              style={{
                left: view.x + f.x * view.k + dx,
                top: Math.max(top, floor) + dy,
                // Never wider than the frame it names, so two names cannot run into
                // each other. Shorter than that if the name is short.
                maxWidth: Math.max(44, f.width * view.k)
              }}
              onPointerDown={ev => {
                if (naming === f.id) return;
                select(f.id);
                startDrag(ev, f);
              }}
            >
              {naming === f.id ? (
                <input
                  className="st-name-input"
                  defaultValue={f.title}
                  autoFocus
                  onPointerDown={e => e.stopPropagation()}
                  onBlur={e => { setNaming(''); onRename(f.id, e.target.value); }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') setNaming('');
                  }}
                />
              ) : (
                <b
                  onDoubleClick={() => { if (f.canRename && onRename) setNaming(f.id); }}
                  title={f.canRename ? 'Double-click to rename' : undefined}
                >
                  {f.title}
                </b>
              )}
              {/* One press that always works. The right button is not ours to rely on:
                  inside an editor's panel the editor can take it before the page ever
                  sees it, and then nothing happens, which is worse than no menu at all. */}
              <button
                className="st-bar-more"
                title="What can be done to this frame"
                aria-label="What can be done to this frame"
                onPointerDown={ev => ev.stopPropagation()}
                onClick={ev => {
                  ev.stopPropagation();
                  select(f.id);
                  const box = ev.currentTarget.getBoundingClientRect();
                  setMenu({ frame: f, x: Math.round(box.left), y: Math.round(box.bottom + 4) });
                }}
              >
                <MoreIcon />
              </button>

              {/* The name, and what the board has to say about this frame right now.
                  Everything you can do to it is under the right button, so none of it
                  is here: a row of buttons over every frame is a row you read past,
                  and the board is for looking at the work. */}
              {f.check && f.check.issues && f.check.issues.length ? (
                <span className="st-found" title="What the last check found">
                  {f.check.issues.length}
                </span>
              ) : null}
              {/* A screen scrolls down, and that is what it is for. One that scrolls
                  across has something wider than the screen, which is a mistake on any
                  device, so it says so where the frame's name is. */}
              {f.sideways ? (
                <span
                  className="st-found st-wide"
                  title={`The page is ${f.sideways.by}px wider than this frame${f.sideways.clipped ? ', and hides it instead of scrolling' : ', so there is a horizontal scrollbar'}. Check this frame to see what is wider.`}
                >
                  {f.sideways.clipped ? 'Cut off at the side' : 'Scrolls sideways'}
                </span>
              ) : null}
              {f.stale ? (
                <span
                  className="st-found st-wide"
                  title={`The code this page was drawn from is newer than the page: ${f.stale.join(', ')}. The page may no longer match it.`}
                >
                  Code changed
                </span>
              ) : null}
              {f.note ? <span className="st-said">{f.note}</span> : null}
            </div>
          );
        })}
      </div>

      {!frames.length && !bands.length ? <div className="st-empty">{empty}</div> : null}

      {frame ? (
        <Inspector
          frame={frame}
          onResize={(w, h) => onResize(frame.id, w, h, true, false)}
          onFit={onFit ? () => onFit(frame) : null}
          onReload={onReload ? () => onReload(frame.id) : null}
          onCheck={onCheck ? () => onCheck(frame.id) : null}
          onCopy={onCopy}
          onDelete={frame.canDelete && onDelete ? () => onDelete(frame.id) : null}
          onClose={() => select('')}
        />
      ) : null}

      <PickPanel pick={pick} />
      <PickDialogs pick={pick} />

      {menu ? (
        <Menu
          pick={pick}
          at={menu}
          onClose={() => setMenu(null)}
          onReload={onReload}
          onCheck={onCheck}
          onFit={onFit}
          onRename={id => { setMenu(null); setNaming(id); }}
          onDelete={onDelete}
        />
      ) : null}

      <div className="st-boardbar" onPointerDown={e => e.stopPropagation()}>
        <div className="st-zoom">
          <button className="st-btn" title="Zoom out" onClick={() => centre(1 / 1.2)}>&minus;</button>
          <span>{Math.round(view.k * 100)}%</span>
          <button className="st-btn" title="Zoom in" onClick={() => centre(1.2)}>+</button>
        </div>
        <button className="st-btn" title="Fit everything (1)" onClick={() => fit()}>Fit</button>
        <button className="st-btn" title="100% (0)" onClick={() => move(v => ({ ...v, k: 1 }))}>100%</button>
        {pick.live ? (
          <button
            className={'st-btn' + (pick.snip ? ' st-btn--go' : '')}
            title="Snip a region of this frame, to paste (S)"
            onClick={() => pick.setSnip(on => !on)}
          >
            Snip
          </button>
        ) : null}
        {onAddSection ? (
          <button
            className="st-btn"
            title="Split the board: a line across it, and everything under the line is the new section"
            onClick={() => { const id = onAddSection(); if (id) setRenaming(id); }}
          >
            + Section
          </button>
        ) : null}
      </div>
    </div>
    </SleeperContext.Provider>
  );
}

// Three things, and no more: how big it is, a look over it, and what that look found.
//
// Everything else that was here was a way of nudging a number. A frame is a size
// something ships at, so the size is chosen from the sizes that exist, and typing one in
// is what "Custom" is for.

// What you can do to a frame, where the pointer is.
//
// The same things the frame's own bar and its panel offer, in the place a person looks
// for them: under the right button. Nothing lives only here, so nobody has to find it.
function MoreIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="2.5" cy="6" r="1.1" fill="currentColor" />
      <circle cx="6" cy="6" r="1.1" fill="currentColor" />
      <circle cx="9.5" cy="6" r="1.1" fill="currentColor" />
    </svg>
  );
}

function Menu({ pick, at, onClose, onReload, onCheck, onFit, onRename, onDelete }) {
  const { frame, x, y } = at;
  const ref = useRef(null);
  const [place, setPlace] = useState({ left: x, top: y });

  // Kept inside the window: a menu opened near an edge would otherwise open where it
  // cannot be read.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    setPlace({
      left: Math.max(8, Math.min(x, window.innerWidth - box.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - box.height - 8))
    });
  }, [x, y]);

  useEffect(() => {
    const away = ev => { if (!ref.current || !ref.current.contains(ev.target)) onClose(); };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  }, [onClose]);

  const frameItems = [
    ...(frame.actions || []).map(action => ({ label: action.label, title: action.title, run: action.onClick })),
    onReload ? { label: 'Reload', title: 'Load this page again', run: () => onReload(frame.id) } : null,
    onFit ? { label: 'Show full content', title: 'As tall as the whole page, however long it runs', run: () => onFit(frame) } : null,
    onCheck ? { label: 'Check this frame', title: 'The words, the claims, what cannot be read', run: () => onCheck(frame.id) } : null,
    frame.canRename && onRename ? { label: 'Rename', title: 'Rename this frame and its file', run: () => onRename(frame.id) } : null,
    frame.canDelete && onDelete ? { label: 'Delete frame', title: 'Its file goes to .designbook/.trash', run: () => onDelete(frame.id), gone: true } : null
  ].filter(Boolean);

  // Over an element: what can be done with it, and under that the two things about the
  // frame that are wanted most. Over nothing: the frame's own menu.
  const items = at.element
    ? [
        ...pick.menuItems(at.element),
        { group: 'Frame' },
        ...frameItems.filter(i => i.label === 'Reload' || i.label === 'Show full content')
      ]
    : frameItems;

  return (
    <div
      ref={ref}
      className="st-context"
      style={{ left: place.left, top: place.top }}
      onContextMenu={ev => ev.preventDefault()}
      // The menu sits inside the board, whose own press handler closes it. Without this a
      // real press shut the menu before its click could land on the item.
      onPointerDown={ev => ev.stopPropagation()}
    >
      <p className="st-context-what">{at.element ? labelOf(at.element.el) : frame.title}</p>
      {items.map((item, n) => item.group ? (
        <p key={'g' + n} className="st-context-group">{item.group}</p>
      ) : (
        <button
          key={item.label}
          className={'st-context-item' + (item.gone ? ' is-gone' : '')}
          title={item.title}
          onClick={() => { onClose(); item.run(); }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function Inspector({ frame, onResize, onFit, onReload, onCheck, onCopy, onDelete, onClose }) {
  const sizes = FRAME_GROUPS.flatMap(([group, grow, list]) =>
    list.map(([label, w, h]) => ({ group, label, w, h })));
  const match = sizes.find(s => s.w === frame.width && s.h === frame.height);
  const [custom, setCustom] = useState(!match);
  const [w, setW] = useState(frame.width);
  const [h, setH] = useState(frame.height);

  useEffect(() => {
    setW(frame.width);
    setH(frame.height);
    setCustom(!sizes.some(s => s.w === frame.width && s.h === frame.height));
  }, [frame.id, frame.width, frame.height]);

  const pick = value => {
    if (value === 'custom') return setCustom(true);
    // As tall as what is in it, and it stays that way: the frame measures itself again
    // whenever the page changes, so a screen that grows by a section grows with it.
    if (value === 'fit') { setCustom(false); return onFit && onFit(); }
    const [pw, ph] = value.split('x').map(Number);
    setCustom(false);
    onResize(pw, ph);
  };

  const commit = () => {
    const width = Math.max(40, Number(w) || frame.width);
    const height = Math.max(40, Number(h) || frame.height);
    setW(width);
    setH(height);
    onResize(width, height);
  };

  return (
    <div className="st-inspector" onPointerDown={e => e.stopPropagation()}>
      <header>
        <b>{frame.title}</b>
        <button className="st-x" title="Deselect (Escape)" onClick={onClose}>&times;</button>
      </header>

      <select
        className="st-select"
        value={frame.fit || frame.measuring ? 'fit' : custom ? 'custom' : `${frame.width}x${frame.height}`}
        onChange={e => pick(e.target.value)}
      >
        {onFit ? (
          <option value="fit">
            Show full content
            {frame.measuring ? ' \u00b7 measuring' : frame.fit ? ` \u00b7 ${frame.width} x ${frame.height}` : ''}
          </option>
        ) : null}
        {FRAME_GROUPS.map(([group, grow, list]) => (
          <optgroup key={group} label={group}>
            {list.map(([label, pw, ph]) => (
              <option key={label} value={`${pw}x${ph}`}>{label} &middot; {pw} x {ph}</option>
            ))}
          </optgroup>
        ))}
        <option value="custom">Custom{custom ? ` · ${frame.width} x ${frame.height}` : ''}</option>
      </select>

      {custom ? (
        <div className="st-row">
          <label>W<input type="number" value={w} onChange={e => setW(e.target.value)} onBlur={commit} /></label>
          <label>H<input type="number" value={h} onChange={e => setH(e.target.value)} onBlur={commit} /></label>
        </div>
      ) : null}

      <div className="st-row st-row--wrap">
        {(frame.actions || []).map(action => (
          <button key={action.label} className="st-btn st-btn--small" title={action.title} onClick={action.onClick}>
            {action.label}
          </button>
        ))}
        {onReload ? (
          <button className="st-btn st-btn--small" title="Load this page again" onClick={onReload}>
            Reload
          </button>
        ) : null}
      </div>

      {onCheck ? (
        <button className="st-btn" onClick={onCheck} title="Look it over: the words, the claims, what cannot be read">
          Check this frame
        </button>
      ) : null}

      {frame.check ? <Found frame={frame} onCopy={onCopy} /> : null}

      {onDelete ? (
        <button
          className="st-btn st-btn--gone"
          onClick={onDelete}
          title="Throw this frame away. Its file goes to .designbook/.trash"
        >
          Delete frame
        </button>
      ) : null}
    </div>
  );
}

// What the last look found, worst first, in the words of what is wrong. The copy button
// is the point of it: the whole list goes to Claude, which can fix it where it lives.
function Found({ frame, onCopy }) {
  const check = frame.check;
  if (check.failed) return <p className="st-note-line st-bad">Could not check it: {check.failed}</p>;
  const issues = check.issues || [];
  if (!issues.length) return <p className="st-note-line">Nothing found.</p>;

  const order = { bad: 0, warn: 1 };
  const sorted = [...issues].sort((a, b) => (order[a.severity] || 2) - (order[b.severity] || 2));

  const asText = () => [
    `${frame.title} (${frame.width} x ${frame.height})`,
    frame.path ? frame.path : '',
    '',
    ...sorted.map(i => {
      const many = i.count > 1 ? ` (${i.count} places${i.also && i.also.length ? `: ${i.also.join(', ')}` : ''})` : '';
      return `- ${i.kind}: ${i.what ? `"${i.what}" ` : ''}${i.detail}${many}${i.where ? ` [${i.where}]` : ''}`;
    }),
    '',
    'Fix these in that file, then check the frame again.'
  ].filter(l => l !== undefined).join('\n');

  return (
    <div className="st-warnings">
      <div className="st-warnings-head">
        <b>{issues.length} to look at</b>
        <span className="st-grow" />
        <button className="st-btn" onClick={() => onCopy && onCopy(frame.id, asText())}>Copy</button>
      </div>
      <ul className="st-found-list">
        {sorted.map((i, n) => (
          <li key={n} className={i.severity === 'bad' ? 'is-bad' : ''}>
            <b>{i.kind}{i.count > 1 ? ` (${i.count})` : ''}</b>
            {i.what ? <q>{i.what}{i.also && i.also.length ? `, ${i.also.join(', ')}` : ''}</q> : null}
            <em>{i.detail}</em>
          </li>
        ))}
      </ul>
    </div>
  );
}
