import React, { useEffect, useState } from 'react';
import { exportFrame } from './api.js';

// What a frame becomes when it leaves the board.
//
// Everything here is a real decision somebody has to make about a file they are about to
// post, print or send: how many pixels, what format, what is behind it. Nothing is
// guessed at export time, and what the dialog says the file will be is what it is.

const FORMATS = [
  ['png', 'PNG', 'Lossless, and the only one that keeps transparency well'],
  ['jpeg', 'JPEG', 'Smaller, no transparency'],
  ['webp', 'WebP', 'Smaller again, for the web'],
  ['pdf', 'PDF', 'Vector text, for printing and sending']
];

const SCALES = [[1, '1x'], [2, '2x'], [3, '3x'], [4, '4x']];

const BACKGROUNDS = [
  ['page', 'As designed'],
  ['white', 'White'],
  ['transparent', 'Transparent']
];

const kb = bytes => (bytes > 1024 * 1024
  ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
  : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export function ExportDialog({ page, onClose, onDone }) {
  const [format, setFormat] = useState('png');
  const [scale, setScale] = useState(2);
  const [background, setBackground] = useState('page');
  const [quality, setQuality] = useState(92);
  const [whole, setWhole] = useState(false);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState(null);
  const [failed, setFailed] = useState('');

  useEffect(() => {
    const esc = ev => { if (ev.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const isPdf = format === 'pdf';
  const lossy = format === 'jpeg' || format === 'webp';
  const canBeClear = format === 'png' || format === 'webp';
  const out = isPdf
    ? `${page.frame.width} x ${page.frame.height} pt`
    : `${page.frame.width * scale} x ${page.frame.height * scale} px`;

  const run = async () => {
    setBusy(true);
    setFailed('');
    try {
      const res = await exportFrame(page.id, {
        format,
        scale: isPdf ? 1 : scale,
        quality,
        background: canBeClear ? background : background === 'transparent' ? 'page' : background,
        whole
      });
      setMade(res);
      onDone(res);
    } catch (err) {
      setFailed('That did not work. The board log says why.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="st-overlay" onClick={onClose}>
      <div className="st-export" onClick={e => e.stopPropagation()}>
        <header>
          <div>
            <b>Export</b>
            <span>{page.title} &middot; {page.frame.width} x {page.frame.height}</span>
          </div>
          <button className="st-close" onClick={onClose} title="Close (Escape)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
                 strokeWidth="1.9" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <Row label="Format">
          <Segment
            options={FORMATS.map(([id, label, note]) => ({ id, label, note }))}
            value={format}
            onPick={setFormat}
          />
        </Row>

        {!isPdf ? (
          <Row label="Size">
            <Segment
              options={SCALES.map(([n, label]) => ({
                id: n, label, note: `${page.frame.width * n} x ${page.frame.height * n} pixels`
              }))}
              value={scale}
              onPick={setScale}
            />
          </Row>
        ) : null}

        <Row label="Behind">
          <Segment
            options={BACKGROUNDS.map(([id, label]) => ({
              id, label, off: id === 'transparent' && !canBeClear
            }))}
            value={background}
            onPick={setBackground}
          />
        </Row>

        {lossy ? (
          <Row label="Quality">
            <div className="st-slider">
              <input
                type="range" min="40" max="100" value={quality}
                onChange={e => setQuality(Number(e.target.value))}
              />
              <em>{quality}</em>
            </div>
          </Row>
        ) : null}

        <Row label="">
          <button
            className={'st-switch' + (whole ? ' is-on' : '')}
            role="switch"
            aria-checked={whole}
            onClick={() => setWhole(w => !w)}
          >
            <span />
            Whole page, however tall it runs
          </button>
        </Row>

        <footer>
          <span className="st-out">{out}</span>
          <span className="st-grow" />
          <button className="st-btn" onClick={onClose}>Cancel</button>
          <button className="st-btn st-btn--go" disabled={busy} onClick={run}>
            {busy ? 'Drawing...' : 'Export'}
          </button>
        </footer>

        {made ? (
          <p className="st-note-line">
            {made.file.split('/').slice(-1)[0]} written, {kb(made.bytes)}. It is in Finder.
          </p>
        ) : null}
        {failed ? <p className="st-note-line st-bad">{failed}</p> : null}
        {busy ? (
          <p className="st-note-line">
            A page the dev server has not drawn before can take most of a minute.
          </p>
        ) : null}
      </div>
    </div>
  );
}

// A line of the dialog: what it is on the left, what you can do about it on the right.
function Row({ label, children }) {
  return (
    <div className="st-exrow">
      <label>{label}</label>
      <div>{children}</div>
    </div>
  );
}

// One choice out of a few. A track with the chosen one filled, rather than a row of
// buttons that each look like they could be pressed at the same time.
function Segment({ options, value, onPick }) {
  return (
    <div className="st-segmented">
      {options.map(o => (
        <button
          key={o.id}
          className={value === o.id ? 'is-on' : ''}
          disabled={o.off}
          title={o.note || ''}
          onClick={() => onPick(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
