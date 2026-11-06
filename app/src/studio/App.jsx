import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useHash, parseRoute, go } from './useHash.js';
import { find, getStudio, newFrame, onStudioChanged, runSetup, onSetupStep } from './api.js';
import { FRAME_GROUPS } from './frames.js';
import { PagesBoard } from './PagesBoard.jsx';
import { Moodboard } from './Moodboard.jsx';
import { Gallery } from './Gallery.jsx';
import { SystemPage } from './SystemPage.jsx';
import { Editor } from './Editor.jsx';
import { SyncPill } from './Sync.jsx';

// One bar, and the board under it.
//
// A sidebar costs a column of width on every screen to show four words that never
// change. A segmented control says the same thing in a strip, which leaves the whole
// window for the thing you came to look at.

// What the board is about. Components are not in here: you go there to take one, not to
// look at it, so it sits on its own in the corner, out of the way until it is wanted.
const SECTIONS = [
  ['pages', 'Screens'],
  ['system', 'Design system'],
  ['moodboard', 'Moodboard']
];

const ask = message => window.parent.postMessage(message, '*');

export function App() {
  const route = parseRoute(useHash());
  const [studio, setStudio] = useState(null);
  // Dark unless somebody says otherwise: the board sits inside an editor, and an editor
  // is dark.
  // The editor's theme, not one of our own: it arrives in the address the board was
  // opened at, and again whenever the editor's theme changes.
  const [theme, setTheme] = useState(
    () => (new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark')
  );
  const [selected, setSelected] = useState('');  // the frame the board has selected
  const [focus, setFocus] = useState('');        // the frame to bring into view next

  const reload = useCallback(() => getStudio().then(setStudio).catch(() => setStudio(null)), []);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => onStudioChanged(reload), [reload]);

  useEffect(() => {
    const on = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', on);
    window.addEventListener('focus', on);
    return () => {
      document.removeEventListener('visibilitychange', on);
      window.removeEventListener('focus', on);
    };
  }, [reload]);

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  useEffect(() => {
    const on = ev => {
      const msg = ev.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'route' && typeof msg.route === 'string') go(msg.route);
      if (msg.type === 'theme') setTheme(msg.theme === 'dark' ? 'dark' : 'light');
      if (msg.type === 'reload') reload();
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [reload]);

  // A new frame lands next to the frame you were looking at when you made it, and the
  // board goes to it. Nothing selected, and it goes last, where new work goes.
  const addFrame = async (title, width, height, grow) => {
    const sections = studio?.sections || [];
    const beside = selected && sections.some(b => b.frames.includes(selected)) ? selected : '';
    const section = sections.length ? sections[sections.length - 1].id : '';
    const made = await newFrame(title, width, height, { section, after: beside, grow });
    await reload();
    if (made?.id) setFocus(made.id);
  };

  if (!studio) {
    return <div className="st-doc"><p className="st-note-line">Reading the board folder...</p></div>;
  }

  const editing = route.view === 'edit';

  return (
    <div className="st-shell">
      <div className="st-main">
        {editing ? <Editor page={route.page} onSaved={reload} /> : null}
        {route.view === 'pages'
          ? <PagesBoard studio={studio} onSelect={setSelected} focus={focus} />
          : null}
        {route.view === 'moodboard' ? <Moodboard /> : null}
        {route.view === 'components' ? <Gallery /> : null}
        {route.view === 'system' ? <SystemPage /> : null}
      </div>

      {/* The thing you reach for while looking at the board sits in the corner nearest
          your hand, with its name on it. The drawer of components is a symbol in the
          bar: you know where it is, and it does not need a word. */}
      {route.view === 'pages' && !studio.setup?.needed ? <NewFrame onAdd={addFrame} /> : null}

      {/* The repo keeps being worked on while the board is open, and a file somebody
          added is not on the board until something looks for it. This looks. */}
      {route.view === 'pages' && !studio.setup?.needed ? <Rescan onDone={reload} /> : null}

      {/* Floating, so the whole window belongs to the work and the controls sit over it. */}
      <header className="st-bar">
        {editing ? (
          <button className="st-btn" onClick={() => go('/pages')}>&lsaquo; {route.page}</button>
        ) : (
          <nav className="st-seg">
            {SECTIONS.map(([id, label]) => (
              <button key={id} aria-current={id === route.view} onClick={() => go(`/${id}`)}>
                {label}
              </button>
            ))}
          </nav>
        )}

        <button
          className={'st-icon' + (route.view === 'components' ? ' is-on' : '')}
          onClick={() => go(route.view === 'components' ? '/pages' : '/components')}
          title={route.view === 'components' ? 'Back to the board' : 'Components'}
          aria-label="Components"
        >
          <GridIcon />
        </button>

        {route.view === 'pages' && !studio.setup?.needed ? <SyncPill /> : null}

        <Search onPick={id => { go('/pages'); setFocus(id); }} />
      </header>
    </div>
  );
}

// Scan the repo again, in the corner opposite the new frame button.
//
// It is the setup pass run a second time, which is safe: a screen already on the board
// keeps the page it has, edits and all, and only what is new is converted. So the answer
// to "I added three screens" is this button, and the answer is three new frames.
function Rescan({ onDone }) {
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(null);
  const [found, setFound] = useState({});
  // The bar only ever moves forward: a step that reports its count and then reports what
  // it found would otherwise drop back to the start of itself.
  const reached = useRef(0);
  const [bar, setBar] = useState(0);

  useEffect(() => onSetupStep(data => {
    if (!data || data.error) return;
    setStep(data);
    if (data.found) setFound(f => ({ ...f, [data.step]: data.found }));
    const within = data.total ? data.done / data.total : 0;
    const at = Math.min(1, (data.step - 1 + within) / (data.steps || 6));
    if (at > reached.current) { reached.current = at; setBar(at); }
  }), []);

  const run = async () => {
    if (running) return;
    setRunning(true);
    setStep(null);
    setFound({});
    reached.current = 0;
    setBar(0);
    try {
      const summary = await runSetup();
      await onDone();
      const made = summary.pages || 0;
      const live = (summary.routes || []).length;
      ask({
        type: 'say',
        text: made
          ? `${made} new ${made === 1 ? 'frame' : 'frames'} on the board.`
          : `Nothing new to draw. ${live} of the project's own pages are on the board.`
      });
    } catch (err) {
      ask({ type: 'failed', text: `The repo could not be scanned: ${err.message || err}` });
    } finally {
      setRunning(false);
      setStep(null);
    }
  };

  const lines = Object.keys(found).sort().map(key => found[key]);

  return (
    <>
      <button
        className={'st-rescan' + (running ? ' is-busy' : '')}
        onClick={run}
        disabled={running}
        title={running ? 'scanning' : 'Scan this repo again, and bring in what is new'}
        aria-label="Scan this repo again"
      >
        <RescanIcon />
      </button>

      {/* What it is doing, while it does it. The numbers come from the work itself, so
          the bar moves because something happened and not because time passed. */}
      {running ? (
        <section className="st-scanning" aria-live="polite">
          <div className="st-scanning-bar"><span style={{ width: `${Math.round(bar * 100)}%` }} /></div>
          <p className="st-scanning-step">
            {step ? `${step.step} of ${step.steps}: ${step.message}` : 'reading the repo'}
            {step && step.total ? ` (${step.done} of ${step.total})` : ''}
          </p>
          {lines.length ? (
            <ul className="st-scanning-found">
              {lines.map(line => <li key={line}>{line}</li>)}
            </ul>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function RescanIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
      <path
        d="M13 7.5a5.5 5.5 0 1 1-1.9-4.16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M13 1.4v3.1h-3.1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// New: a frame at a size something actually ships at.
function NewFrame({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [w, setW] = useState('1080');
  const [h, setH] = useState('1080');
  const [busy, setBusy] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const away = ev => { if (ref.current && !ref.current.contains(ev.target)) setOpen(false); };
    const esc = ev => { if (ev.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  const add = async (title, width, height, grow) => {
    setBusy(title);
    try { await onAdd(title, width, height, grow); } finally { setBusy(''); setOpen(false); }
  };

  const custom = () => {
    const width = Math.round(Number(w));
    const height = Math.round(Number(h));
    if (!width || !height) return;
    // A size you typed is a size you meant: it is cropped, not grown.
    add(`${width} x ${height}`, width, height, false);
  };

  return (
    <div className="st-picker st-picker--corner" ref={ref}>
      <button className="st-floater" title="A frame at a size something ships at" onClick={() => setOpen(o => !o)}>
        <PlusIcon />
        New frame
      </button>
      {open ? (
        <div className="st-menu st-menu--wide st-menu--up">
          {FRAME_GROUPS.map(([group, grow, sizes]) => (
            <div key={group}>
              <div className="st-menu-note">{group}</div>
              {sizes.map(([label, width, height]) => (
                <button
                  key={label}
                  className="st-menu-item"
                  disabled={!!busy}
                  onClick={() => add(label, width, height, grow)}
                >
                  {busy === label ? 'Adding...' : label}
                  <em>{width} x {height}</em>
                </button>
              ))}
            </div>
          ))}
          <div className="st-menu-note">Any size</div>
          <div className="st-menu-size">
            <input value={w} onChange={e => setW(e.target.value)} aria-label="Width" />
            <span>x</span>
            <input value={h} onChange={e => setH(e.target.value)} aria-label="Height" />
            <button className="st-btn" onClick={custom}>Add</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

// Looking for a frame.
//
// The name first, because that is what anybody remembers. What is written inside the
// frames after it, under its own heading, because a word from a headline is often all
// you have. Pressing a result takes the board to that frame and fits it in the window.
function Search({ onPick }) {
  // Shut, it is one icon in the bar. Open, it is a box: a board is for looking at the
  // work, and a search box sits there empty most of the day.
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [found, setFound] = useState(null);
  const [at, setAt] = useState(0);        // which result the keyboard is on
  const box = useRef(null);
  const asked = useRef(0);

  // One ask per pause, not one per letter: a board of eighty frames is eighty files.
  useEffect(() => {
    const word = q.trim();
    if (word.length < 2) { setFound(null); return; }
    const mine = ++asked.current;
    const id = setTimeout(() => {
      find(word)
        .then(answer => { if (mine === asked.current) { setFound(answer); setAt(0); } })
        .catch(() => { if (mine === asked.current) setFound(null); });
    }, 140);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    const away = ev => {
      if (box.current && box.current.contains(ev.target)) return;
      setFound(null);
      // It shuts again when there is nothing in it, and stays open when there is.
      if (!q.trim()) setOpen(false);
    };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  }, [q]);

  const rows = [
    ...((found && found.titles) || []).map(t => ({ kind: 'name', id: t.id, title: t.title, note: t.where })),
    // A frame found by its name is listed under what is inside it as well: the two are
    // different answers to the same question, and the line that matched is worth seeing.
    ...((found && found.inside) || []).map(i => ({
      kind: 'inside', id: i.id, title: i.title, note: i.hits[0] ? i.hits[0].text : i.where, hits: i.hits.length
    }))
  ];

  const pick = row => {
    if (!row) return;
    setFound(null);
    setQ('');
    setOpen(false);
    onPick(row.id);
  };

  const onKey = ev => {
    if (ev.key === 'Escape') {
      setFound(null);
      if (q) setQ('');
      else { setOpen(false); ev.currentTarget.blur(); }
      return;
    }
    if (!rows.length) return;
    if (ev.key === 'ArrowDown') { ev.preventDefault(); setAt(n => Math.min(rows.length - 1, n + 1)); }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); setAt(n => Math.max(0, n - 1)); }
    if (ev.key === 'Enter') { ev.preventDefault(); pick(rows[at]); }
  };

  const names = rows.filter(r => r.kind === 'name');
  const inside = rows.filter(r => r.kind === 'inside');
  const line = row => rows.indexOf(row);

  if (!open) {
    return (
      <button
        className="st-icon"
        title="Find a frame"
        aria-label="Find a frame"
        onClick={() => setOpen(true)}
      >
        <SearchIcon />
      </button>
    );
  }

  return (
    <div className="st-search" ref={box}>
      <SearchIcon />
      <input
        className="st-search-box"
        placeholder="Find a frame"
        value={q}
        autoFocus
        onChange={e => setQ(e.target.value)}
        onKeyDown={onKey}
      />
      {q.trim().length > 1 && found ? (
        <div className="st-search-found">
          {!rows.length ? <p className="st-search-none">Nothing by that name, and nothing says it.</p> : null}

          {names.length ? <p className="st-search-what">Frames</p> : null}
          {names.map(row => (
            <button
              key={'name:' + row.id}
              className={'st-search-row' + (line(row) === at ? ' is-at' : '')}
              onMouseEnter={() => setAt(line(row))}
              onClick={() => pick(row)}
            >
              <b>{row.title}</b>
              <span>{row.note}</span>
            </button>
          ))}

          {inside.length ? <p className="st-search-what">Inside frames</p> : null}
          {inside.map(row => (
            <button
              key={'inside:' + row.id}
              className={'st-search-row' + (line(row) === at ? ' is-at' : '')}
              onMouseEnter={() => setAt(line(row))}
              onClick={() => pick(row)}
            >
              <b>{row.title}</b>
              <span>{row.note}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg className="st-search-icon" width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
      <circle cx="5.5" cy="5.5" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8.6 8.6 L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinejoin="round">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </svg>
  );
}
