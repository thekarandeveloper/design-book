import React, { useEffect, useRef, useState } from 'react';
import { compareLook, undoLook, redoLook, pictureUrl } from './api.js';

// The pictures the board makes of an element, shown big, drawn on, and set beside what
// they used to be.

function Frame({ title, onClose, children, wide }) {
  useEffect(() => {
    const esc = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [onClose]);
  return (
    <div className="st-overlay" onClick={onClose} onPointerDown={e => e.stopPropagation()}>
      <div className={'st-pickdialog' + (wide ? ' is-wide' : '')} onClick={e => e.stopPropagation()}>
        <header>
          <b>{title}</b>
          <button className="st-close" onClick={onClose} title="Close (Escape)">&times;</button>
        </header>
        {children}
      </div>
    </div>
  );
}

// A picture, and what can be done with it.
export function ImageDialog({ title, src, note, onCopy, onClose, render }) {
  return (
    <Frame title={title} onClose={onClose}>
      {render ? render() : <div className="st-pickdialog-art"><img src={src} alt="" draggable={false} /></div>}
      {note ? <p className="st-note-line">{note}</p> : null}
      {onCopy ? (
        <footer>
          <button className="st-btn st-btn--go" onClick={onCopy}>Copy picture</button>
          <button className="st-btn" onClick={onClose}>Close</button>
        </footer>
      ) : null}
    </Frame>
  );
}

// ── drawing on a picture ────────────────────────────────────────────────────

const TOOLS = [['box', 'Box'], ['arrow', 'Arrow'], ['circle', 'Circle'], ['pen', 'Pen'], ['text', 'Text']];
const COLOURS = ['#ff3b30', '#ffcc00', '#34c759', '#2e7bf6', '#111111'];

function paint(c, shape, scale) {
  const w = Math.max(3, scale);
  c.lineWidth = w;
  c.strokeStyle = shape.colour;
  c.fillStyle = shape.colour;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  if (shape.tool === 'box') {
    c.strokeRect(shape.x, shape.y, shape.w, shape.h);
  } else if (shape.tool === 'circle') {
    c.beginPath();
    c.ellipse(shape.x + shape.w / 2, shape.y + shape.h / 2, Math.abs(shape.w / 2), Math.abs(shape.h / 2), 0, 0, Math.PI * 2);
    c.stroke();
  } else if (shape.tool === 'arrow') {
    const x2 = shape.x + shape.w;
    const y2 = shape.y + shape.h;
    const angle = Math.atan2(shape.h, shape.w);
    const head = Math.max(14, w * 5);
    c.beginPath();
    c.moveTo(shape.x, shape.y);
    c.lineTo(x2, y2);
    c.stroke();
    c.beginPath();
    c.moveTo(x2, y2);
    c.lineTo(x2 - head * Math.cos(angle - 0.45), y2 - head * Math.sin(angle - 0.45));
    c.lineTo(x2 - head * Math.cos(angle + 0.45), y2 - head * Math.sin(angle + 0.45));
    c.closePath();
    c.fill();
  } else if (shape.tool === 'pen') {
    c.beginPath();
    shape.points.forEach(([x, y], n) => (n ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.stroke();
  } else if (shape.tool === 'text') {
    c.font = `700 ${Math.max(18, w * 6)}px -apple-system, system-ui, sans-serif`;
    c.textBaseline = 'top';
    // A line round it so it reads over any picture.
    c.lineWidth = Math.max(4, w * 1.6);
    c.strokeStyle = '#fff';
    c.strokeText(shape.text, shape.x, shape.y);
    c.fillText(shape.text, shape.x, shape.y);
  }
}

export function AnnotateDialog({ src, onCopy, onClose }) {
  const canvas = useRef(null);
  const image = useRef(null);
  const [tool, setTool] = useState('box');
  const [colour, setColour] = useState(COLOURS[0]);
  const [shapes, setShapes] = useState([]);
  const [now, setNow] = useState(null);
  const [typing, setTyping] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      image.current = img;
      const c = canvas.current;
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      setReady(true);
    };
    img.src = src;
  }, [src]);

  const draw = (extra) => {
    const c = canvas.current;
    if (!c || !image.current) return;
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(image.current, 0, 0);
    const scale = c.width / 520;
    for (const s of shapes) paint(g, s, scale);
    if (extra) paint(g, extra, scale);
  };
  useEffect(() => { if (ready) draw(now); }, [ready, shapes, now]);

  const at = ev => {
    const c = canvas.current;
    const box = c.getBoundingClientRect();
    return { x: (ev.clientX - box.left) * (c.width / box.width), y: (ev.clientY - box.top) * (c.height / box.height) };
  };

  const down = ev => {
    if (typing) return;
    const p = at(ev);
    if (tool === 'text') { setTyping({ x: p.x, y: p.y, value: '', cx: ev.clientX, cy: ev.clientY }); return; }
    canvas.current.setPointerCapture(ev.pointerId);
    setNow(tool === 'pen' ? { tool, colour, points: [[p.x, p.y]] } : { tool, colour, x: p.x, y: p.y, w: 0, h: 0 });
  };
  const move = ev => {
    if (!now) return;
    const p = at(ev);
    setNow(n => (n.tool === 'pen' ? { ...n, points: [...n.points, [p.x, p.y]] } : { ...n, w: p.x - n.x, h: p.y - n.y }));
  };
  const up = () => {
    if (!now) return;
    const tiny = now.tool === 'pen' ? now.points.length < 3 : Math.abs(now.w) + Math.abs(now.h) < 6;
    if (!tiny) setShapes(s => [...s, now]);
    setNow(null);
  };

  const commitText = () => {
    if (typing && typing.value.trim()) setShapes(s => [...s, { tool: 'text', colour, x: typing.x, y: typing.y, text: typing.value.trim() }]);
    setTyping(null);
  };

  const copy = () => {
    draw(null);
    canvas.current.toBlob(blob => onCopy(blob), 'image/png');
  };

  return (
    <Frame title="Draw on the picture" onClose={onClose} wide>
      <div className="st-annotate-tools">
        {TOOLS.map(([id, label]) => (
          <button key={id} className={'st-chipbtn' + (tool === id ? ' is-on' : '')} onClick={() => setTool(id)}>{label}</button>
        ))}
        <span className="st-annotate-sw">
          {COLOURS.map(c => (
            <button key={c} className={'st-annotate-dot' + (colour === c ? ' is-on' : '')} style={{ background: c }} onClick={() => setColour(c)} aria-label={c} />
          ))}
        </span>
        <button className="st-chipbtn" disabled={!shapes.length} onClick={() => setShapes(s => s.slice(0, -1))}>Undo</button>
        <button className="st-chipbtn" disabled={!shapes.length} onClick={() => setShapes([])}>Clear</button>
      </div>
      <div className="st-pickdialog-art is-draw">
        <canvas ref={canvas} onPointerDown={down} onPointerMove={move} onPointerUp={up} />
        {typing ? (
          <input
            className="st-annotate-input"
            autoFocus
            style={{ left: typing.cx, top: typing.cy, color: colour }}
            value={typing.value}
            onChange={e => setTyping(t => ({ ...t, value: e.target.value }))}
            onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') commitText(); if (e.key === 'Escape') setTyping(null); }}
            onBlur={commitText}
            placeholder="Type, then Enter"
          />
        ) : null}
      </div>
      <footer>
        <button className="st-btn st-btn--go" onClick={copy}>Copy picture</button>
        <button className="st-btn" onClick={onClose}>Cancel</button>
      </footer>
    </Frame>
  );
}

// ── before and after ────────────────────────────────────────────────────────

// How it looked when it was remembered, beside how it looks now, and the files that changed
// in between. Going back puts those files as they were; nothing is committed, nothing is
// deleted, and going back can be gone back on.
export function CompareDialog({ frame, id, say, onClose }) {
  const [state, setState] = useState({ loading: true });
  const [chosen, setChosen] = useState({});
  const [sure, setSure] = useState(false);
  const [done, setDone] = useState(null);

  const load = () => {
    setState({ loading: true });
    compareLook(frame.id, id).then(r => {
      if (r.error) return setState({ error: r.error });
      setState(r);
      setChosen(Object.fromEntries((r.changed || []).map(f => [f, true])));
    });
  };
  useEffect(load, [id]);

  const files = Object.keys(chosen).filter(f => chosen[f]);

  const undo = async () => {
    setSure(false);
    const r = await undoLook(frame.id, id, files);
    if (r.error) return say(frame.id, r.error);
    setDone({ undone: true, files: r.restored });
    say(frame.id, `${r.restored.length} file${r.restored.length === 1 ? '' : 's'} put back`);
  };
  const redo = async () => {
    const r = await redoLook(frame.id, id);
    if (r.error) return say(frame.id, r.error);
    setDone({ undone: false, files: r.restored });
    say(frame.id, `${r.restored.length} file${r.restored.length === 1 ? '' : 's'} brought back`);
  };

  return (
    <Frame title="Before and now" onClose={onClose} wide>
      {state.loading ? <p className="st-note-line">Drawing it again...</p> : null}
      {state.error ? <p className="st-note-line st-bad">{state.error}</p> : null}
      {state.sheet ? <div className="st-pickdialog-art"><img src={pictureUrl(state.sheet.name)} alt="" draggable={false} /></div> : null}
      {state.gone ? <p className="st-note-line">The element is not on the page any more, so there is no "now".</p> : null}

      {state.ok && state.git ? (
        <div className="st-compare-files">
          {state.changed.length ? (
            <>
              <p className="st-note-line">Files that are different from when you remembered it:</p>
              <ul>
                {state.changed.map(f => (
                  <li key={f}>
                    <label><input type="checkbox" checked={!!chosen[f]} onChange={e => setChosen(c => ({ ...c, [f]: e.target.checked }))} /> {f}</label>
                  </li>
                ))}
              </ul>
            </>
          ) : <p className="st-note-line">No file has changed since.</p>}
          {state.added.length ? <p className="st-note-line">New since then, and left alone: {state.added.join(', ')}</p> : null}
        </div>
      ) : null}
      {state.ok && !state.git ? <p className="st-note-line">This project is not in git, so only the picture was kept.</p> : null}

      {done ? (
        <p className="st-note-line">{done.undone ? `Put back: ${done.files.join(', ')}.` : `Brought back: ${done.files.join(', ')}.`}</p>
      ) : null}

      <footer>
        {state.ok && state.git && state.changed.length && !done && !sure ? (
          <button className="st-btn st-btn--go" disabled={!files.length} onClick={() => setSure(true)}>Go back to how it was</button>
        ) : null}
        {sure ? (
          <>
            <span className="st-note-line">Put {files.length} file{files.length === 1 ? '' : 's'} back to how they were?</span>
            <button className="st-btn st-btn--go" onClick={undo}>Yes, put them back</button>
            <button className="st-btn" onClick={() => setSure(false)}>No</button>
          </>
        ) : null}
        {done && done.undone ? <button className="st-btn" onClick={redo}>Undo that</button> : null}
        {done && !done.undone ? <button className="st-btn" onClick={load}>Look again</button> : null}
        <button className="st-btn" onClick={onClose}>Close</button>
      </footer>
    </Frame>
  );
}
