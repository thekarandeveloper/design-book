import React, { useCallback, useEffect, useState } from 'react';
import { getSync, enableSync, syncNow, resolveSync, approveSync, onSync } from './api.js';

// The board's files are shared work, kept on the repo's default branch whatever branch
// somebody is on (see tools/sync.js for how, and for what it never does). This is the small
// part of the bar that says where that stands, and the one place to turn it on, choose
// between two people's versions of a file, or turn it off.

const ago = at => {
  if (!at) return '';
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
};

const LABEL = {
  idle: 'Synced',
  syncing: 'Syncing',
  pending: 'Changes waiting',
  conflict: 'Choose a version',
  review: 'Look first',
  offline: 'Offline',
  error: 'Not synced',
  'no-branch': 'Not synced',
  off: 'Sync off'
};

export function SyncPill() {
  const [s, setS] = useState(null);
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    let alive = true;
    getSync().then(v => { if (alive) setS(v); }).catch(() => {});
    const off = onSync(v => setS(was => ({ ...(was || {}), ...v })));
    const t = setInterval(() => tick(n => n + 1), 30000);
    return () => { alive = false; off(); clearInterval(t); };
  }, []);

  const act = useCallback(job => job().then(v => setS(was => ({ ...(was || {}), ...v }))).catch(() => {}), []);

  // Nowhere to keep it in step with: say nothing, rather than offering what cannot be done.
  if (!s || !s.git || !s.remote) return null;

  const state = s.enabled ? s.state : 'off';
  return (
    <>
      <button
        className={'st-sync is-' + state}
        onClick={() => setOpen(true)}
        title={s.message || (s.enabled ? `Kept on ${s.branch || 'the default branch'}` : 'Not shared yet')}
      >
        <i />
        <span>{LABEL[state] || 'Sync'}</span>
        {state === 'conflict' ? <b>{(s.conflicts || []).length}</b> : null}
        {state === 'review' ? <b>{(s.review || []).length}</b> : null}
      </button>
      {open ? <SyncDialog s={s} act={act} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function SyncDialog({ s, act, onClose }) {
  useEffect(() => {
    const esc = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [onClose]);

  const branch = s.branch || s.branchGuess || 'the default branch';
  const conflicts = s.conflicts || [];

  return (
    <div className="st-overlay" onClick={onClose} onPointerDown={e => e.stopPropagation()}>
      <div className="st-pickdialog" onClick={e => e.stopPropagation()}>
        <header>
          <b>{s.enabled ? `Kept on ${branch}` : `Keep this board in step with ${branch}?`}</b>
          <button className="st-close" onClick={onClose} title="Close (Escape)">&times;</button>
        </header>

        {!s.enabled ? (
          <>
            <p className="st-note-line">
              The board's files (the board file, pages, references and parts) are kept on {branch},
              whatever branch you are on, and shared with everybody who opens this repo. Others'
              changes come in, and yours go out, a few seconds after you stop.
            </p>
            <p className="st-note-line">
              Only those files are committed and pushed, as one commit on top of what origin has. Your
              code, your branch, your index and anything you have not published are never touched, and
              nothing is forced. You are on {s.mine || 'a branch'}.
            </p>
            <footer>
              <button className="st-btn st-btn--go" onClick={() => { act(() => enableSync(true)); onClose(); }}>Turn on</button>
              <button className="st-btn" onClick={onClose}>Not now</button>
            </footer>
          </>
        ) : (
          <>
            <p className="st-note-line">
              {s.state === 'idle' ? `In step with origin/${branch}${s.lastAt ? `, ${ago(s.lastAt)}` : ''}.` : (s.message || LABEL[s.state])}
              {s.mine && s.mine !== branch ? ` You are on ${s.mine}, which is not touched.` : ''}
            </p>

            {(s.review || []).length ? (
              <div className="st-compare-files">
                <ul>
                  {(s.review || []).slice(0, 12).map(file => <li key={file}><span>{file}</span></li>)}
                  {(s.review || []).length > 12 ? <li><span>and {(s.review || []).length - 12} more</span></li> : null}
                </ul>
                <p className="st-note-line">Your files are exactly as they were. Send them if you meant this, or put them back as they are on {branch}, which keeps what is here in the trash first.</p>
              </div>
            ) : null}

            {conflicts.length ? (
              <div className="st-compare-files">
                <p className="st-note-line">Somebody else changed these as well as you. Choose which version stays:</p>
                <ul>
                  {conflicts.map(file => (
                    <li key={file}>
                      <span>{file.split('/').slice(-2).join('/')}</span>
                      <button className="st-btn" onClick={() => act(() => resolveSync(file, 'mine'))}>Keep mine</button>
                      <button className="st-btn" onClick={() => act(() => resolveSync(file, 'theirs'))}>Take theirs</button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <footer>
              {(s.review || []).length ? (
                <>
                  <button className="st-btn st-btn--go" onClick={() => act(() => approveSync('send'))}>Send them</button>
                  <button className="st-btn" onClick={() => act(() => approveSync('revert'))}>Put them back</button>
                </>
              ) : <button className="st-btn st-btn--go" onClick={() => act(syncNow)}>Sync now</button>}
              <button className="st-btn" onClick={() => { act(() => enableSync(false)); onClose(); }} title="Stops sharing from this machine. Nothing is deleted anywhere.">Turn off</button>
              <button className="st-btn" onClick={onClose}>Close</button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
