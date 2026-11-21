// The board's own history: every change committed to the branch you are on, and a way
// back to any of them.
//
// What this replaces: a sync system that kept the board's files on the repo's default
// branch and fetched, merged and pushed them on every change. That reached across branches
// under somebody who was drawing. This stays on the branch you are already on, commits
// only the board's own files, and never touches the network.
//
// Going back is forwards: choosing an older state writes those files over the current ones
// and commits that, so nothing is lost and the state you left is itself in the list.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { boardHistory, boardRevert, onHistory } from './api.js';

// Telling the editor something, the way the rest of the board does.
const ask = message => window.parent.postMessage(message, '*');

export function History({ inline }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ on: false, why: '', branch: '', commits: [] });
  const [busy, setBusy] = useState('');
  const [sure, setSure] = useState('');     // the commit being confirmed
  const box = useRef(null);

  const read = useCallback(() => {
    boardHistory().then(d => setState(d || {})).catch(() => {});
  }, []);

  // Read when it is shown, and whenever the server says it saved something, so the list
  // is not a list of what was true when the board started.
  useEffect(() => { if (inline || open) read(); }, [inline, open, read]);
  useEffect(() => onHistory(() => { if (inline || open) read(); }), [inline, open, read]);

  useEffect(() => {
    if (inline || !open) return;
    const away = ev => { if (box.current && !box.current.contains(ev.target)) { setOpen(false); setSure(''); } };
    const esc = ev => { if (ev.key === 'Escape') { setOpen(false); setSure(''); } };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', esc);
    };
  }, [inline, open]);

  const goBack = async sha => {
    setBusy(sha);
    try {
      const back = await boardRevert(sha);
      if (back && back.ok) {
        ask({ type: 'say', text: `The board is back to ${back.at}.` });
        setOpen(false);
        setSure('');
        read();
      } else {
        ask({ type: 'failed', text: `Could not go back: ${(back && back.why) || 'unknown'}` });
      }
    } catch (err) {
      ask({ type: 'failed', text: `Could not go back: ${err.message || err}` });
    } finally {
      setBusy('');
    }
  };

  const commits = state.commits || [];

  // The list, which is the whole of it. The same list whether it is opening from its own
  // button or sitting inside the board's menu, because it is the same thing.
  const list = (
    <>
      <p className="st-history-head">
        {state.on
          ? <>Saved to <b>{state.branch}</b> on this machine. Nothing is pushed.</>
          : state.why || 'No history for this board.'}
      </p>

      {state.on && !commits.length ? (
        <p className="st-history-none">Nothing saved yet. The next change to the board starts it.</p>
      ) : null}

      {commits.length ? (
        <ul className="st-history-list">
          {commits.map((c, n) => (
            <li key={c.sha}>
              <button
                className="st-history-row"
                disabled={!!busy}
                onClick={() => setSure(sure === c.sha ? '' : c.sha)}
                title={`${c.short} by ${c.who}`}
              >
                <span className="st-history-dot" data-now={n === 0 ? 'yes' : undefined} aria-hidden="true" />
                <span className="st-history-what">
                  <b>{c.subject.replace(/^Design Book: /, '')}</b>
                  <em>{c.when}{n === 0 ? ' \u00b7 now' : ''}</em>
                </span>
              </button>
              {/* Asked before anything is written. Going back is recoverable, because
                  what you are leaving is committed first, but it still changes every
                  file on the board under somebody who did not mean it. */}
              {sure === c.sha ? (
                <div className="st-history-sure">
                  <span>Put the board back to this?</span>
                  <button className="st-btn st-btn--go" disabled={!!busy} onClick={() => goBack(c.sha)}>
                    {busy === c.sha ? 'Going back\u2026' : 'Go back'}
                  </button>
                  <button className="st-btn" disabled={!!busy} onClick={() => setSure('')}>Cancel</button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );

  // Inside somebody else's menu: the list, and none of the furniture. The menu it is in
  // is already the thing that opens and shuts.
  if (inline) return <div className="st-history-inline">{list}</div>;

  return (
    <div className="st-history" ref={box}>
      <button
        className={'st-pillbtn' + (open ? ' is-open' : '')}
        title={state.on ? `Every board change is committed to ${state.branch}` : state.why || 'No history'}
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        <ClockIcon />
        <span>History</span>
      </button>
      {open ? <div className="st-history-menu">{list}</div> : null}
    </div>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.8V8l2.2 1.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
