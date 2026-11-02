import React, { useEffect, useRef, useState } from 'react';
import { runSetup, onSetupStep } from './api.js';

// A repo with no board: one button, on an empty board.
//
// Everything else on the board is about work that exists. There is none yet, so there is
// nothing to show but the one thing that can be done, and one line saying what it will do.
//
// While it runs, what is on screen is the work itself: the step it is on, and what it has
// found so far. The numbers come from the server as it reads, converts and counts, over
// the same socket the board hears about every other change on, so the bar moves because
// something happened and not because time passed.

const ask = message => window.parent.postMessage(message, '*');

export function Setup({ studio }) {
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(null);
  const [found, setFound] = useState({});
  const [done, setDone] = useState(null);
  const [error, setError] = useState('');
  // The bar only ever moves forward: a step that reports its count and then reports what
  // it found would otherwise drop back to the start of itself.
  const reached = useRef(0);
  const [bar, setBar] = useState(0);

  useEffect(() => onSetupStep(data => {
    if (!data) return;
    if (data.error) { setError(data.error); return; }
    setStep(data);
    if (data.found) setFound(f => ({ ...f, [data.step]: data.found }));
    if (data.summary) setDone(data.summary);
    const within = data.total ? data.done / data.total : 0;
    const at = Math.min(1, (data.step - 1 + within) / data.steps);
    if (at > reached.current) { reached.current = at; setBar(at); }
  }), []);

  // The board file exists now, so the board belongs to that file from here on. The editor
  // swaps this panel for the file's own tab, with the frames that were just made on it.
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => ask({ type: 'setUpDone', file: done.board }), 2400);
    return () => clearTimeout(id);
  }, [done]);

  const go = async () => {
    setError('');
    setRunning(true);
    reached.current = 0;
    setBar(0);
    try {
      await runSetup();
    } catch (err) {
      setError(String(err.message || err));
      setRunning(false);
    }
  };

  const lines = Object.keys(found).sort().map(k => found[k]);

  return (
    <div className="st-setup">
      <h2>{done ? 'The board is ready' : 'This repo has no board yet'}</h2>

      {!running && !done ? (
        <>
          <p>
            Setup reads this repo once: the screens it already has become frames, the colours,
            fonts and spacing it uses become its design system, and the pictures it holds are
            recorded where they lie. Nothing in the project is moved or changed.
          </p>
          <button className="st-btn st-btn--go st-setup-go" onClick={go}>Setup</button>
        </>
      ) : null}

      {running && !done ? (
        <>
          <div className="st-setup-bar"><span style={{ width: `${Math.round(bar * 100)}%` }} /></div>
          <p className="st-setup-step">
            {step ? `${step.step} of ${step.steps}: ${step.message}` : 'starting'}
            {step && step.total ? ` (${step.done} of ${step.total})` : ''}
          </p>
          <ul className="st-setup-found">
            {lines.map(line => <li key={line}>{line}</li>)}
          </ul>
        </>
      ) : null}

      {done ? <Summary summary={done} /> : null}
      {error ? <p className="st-setup-error">{error}</p> : null}
    </div>
  );
}

// What it did, in the words of what is now on the board, and what it left out. The whole
// list, file by file with the reason under each, is in the Design log.
function Summary({ summary }) {
  const left = summary.left || [];
  const assets = summary.assets || {};
  return (
    <>
      <ul className="st-setup-found">
        <li>{summary.pages} frames, in {summary.sections.length} sections</li>
        {summary.drawnByProject
          ? <li>{summary.drawnByProject} of them drawn by the project itself, with its own styles and fonts</li>
          : null}
        {summary.nextRoute
          ? <li>one dev only route added to the project, at {summary.nextRoute}, so it can draw them</li>
          : null}
        {summary.retired ? <li>{summary.retired} taken off the board, in .designbook/.trash</li> : null}
        <li>
          {summary.colours} colours, {summary.fonts} fonts, {summary.spacing} spacing steps
          {summary.tokens && summary.tokens.written ? ', written to .designbook/tokens.css' : ''}
        </li>
        <li>{assets.images || 0} images, {assets.icons || 0} icons, {assets.logos || 0} logos</li>
        {(summary.routes || []).length
          ? <li>{summary.routes.length} of the project's own pages, served live by {summary.live || 'its dev server'}</li>
          : (summary.live ? <li>the project's own pages, served by {summary.live}</li> : null)}
        {left.length ? <li>{left.length} left out, in the Design log with the reason</li> : null}
      </ul>
      <p className="st-setup-step">Opening the board</p>
    </>
  );
}
