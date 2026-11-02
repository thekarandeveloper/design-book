import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Render } from '@puckeditor/core';
import { puckConfig } from 'virtual:studio-catalog';
import { Board } from './Board.jsx';
import { useAwake } from './awake.js';
import { getPage, putPositions, putSections, isReady, measurePage, renameFrame, deleteFrame, checkFrame, getStudio, onStudioChanged } from './api.js';
import { ExportDialog } from './ExportDialog.jsx';
import { Setup } from './Setup.jsx';

// Every screen on one board.
//
// A live route is an iframe pointed straight at the project's own dev server, so its hot
// reload keeps working and what you see is the real page. A screen the board owns is
// rendered into the board directly, so a component edit redraws all of them at once.
//
// Which section a frame is in, where it sits in that section's line, and how big it is
// are the board's business and are kept in the `.designbook` file beside the folder, so the
// board is the same board on any machine that opens it.

const GAP = 88;      // between frames in a line
const HEADER = 112;  // under a section's line, before its frames start
const PAD = 240;     // under the frames, where the next section's name sits
const BETWEEN = 0;   // nothing: one section ends where the next one begins

// How long a frame that fits its content is left alone after it has been measured, even
// when the project keeps changing. A save hot-reloads a page and touches several files,
// and measuring is a real page load that moves every frame under it, so once is enough
// for a spell of work rather than once per file.
const SETTLE = 30000;

// Whether a measurement is different enough from the height the frame already has to be
// worth writing down.
//
// A page with an animation on it, or a font that lands late, measures a few pixels
// differently every time, and a board whose frames all move by four pixels is a board
// that shuffles. So the difference has to be one somebody could see: 24 pixels, or one
// per cent of a long page.
const worth = (height, was) => {
  const had = Number(was) || 0;
  return !had || Math.abs(height - had) >= Math.max(24, Math.round(had * 0.01));
};

const ask = message => window.parent.postMessage(message, '*');

// Alt-click inside a frame: the page says which file and line it came from, and the
// board hands that to the editor. The frame is another origin, so this is the only way
// anything inside it can speak, and it is the whole conversation.
if (typeof window !== 'undefined' && !window.__canvasSourceListener) {
  window.__canvasSourceListener = true;
  window.addEventListener('message', ev => {
    const m = ev.data;
    if (!m || m.type !== 'canvas:source' || !m.file) return;
    const line = Number(String(m.loc || '').split(':')[0]) || 0;
    ask({ type: 'openRepoFile', file: m.file, line });
  });
}

export function PagesBoard({ studio: initial, onSelect, focus }) {
  const [studio, setStudio] = useState(initial);
  const [docs, setDocs] = useState({});
  const [edits, setEdits] = useState({});
  const [bands, setBands] = useState(initial?.sections || []);
  const [measuring, setMeasuring] = useState(null);
  // Which frame is chosen, so it can be kept awake wherever it ends up.
  const [chosen, setChosen] = useState('');
  // How many times each frame has been asked to load its page again. The number is the
  // ask: a frame throws away what it has and starts over when its number changes.
  const [reloads, setReloads] = useState({});
  const onReload = useCallback(id => {
    setReloads(was => ({ ...was, [id]: (was[id] || 0) + 1 }));
  }, []);
  const [note, setNote] = useState({});
  const [exporting, setExporting] = useState(null);
  const saveTimer = useRef(null);

  // A word on the frame itself, so an action that happened somewhere else says so where
  // it was asked for.
  const say = useCallback((id, text) => {
    setNote(n => ({ ...n, [id]: text }));
    setTimeout(() => setNote(n => { const next = { ...n }; delete next[id]; return next; }), 2400);
  }, []);

  // The frame's name, which is what you say when you talk about it. Its whole path is on
  // the button as a tooltip, for when that is what you need instead.
  //
  // Copying goes through the editor's own clipboard, which is allowed everywhere; the
  // page's own is tried too, for a board opened in a browser.
  const copyName = useCallback(page => {
    ask({ type: 'copy', text: page.title });
    try { navigator.clipboard && navigator.clipboard.writeText(page.title); } catch (_) {}
    say(page.id, 'name copied');
  }, [say]);

  useEffect(() => { setStudio(initial); }, [initial]);
  // The server owns the section list; a drag shows its result at once and then saves it.
  useEffect(() => { setBands(initial?.sections || []); }, [initial]);
  useEffect(() => { if (studio?.sections) setBands(studio.sections); }, [studio?.sections]);

  const reload = useCallback(() => getStudio().then(setStudio).catch(() => {}), []);

  // When the board last heard that something in the project changed. That is the one
  // reason a frame which fits its content measures itself again, so it is kept rather
  // than acted on: a measurement must never be the thing that starts the next one.
  const heard = useRef(0);

  // A route added or removed anywhere lands on the board without a refresh.
  useEffect(() => onStudioChanged(() => { heard.current = Date.now(); reload(); }), [reload]);

  const puckIds = (studio?.pages || []).filter(p => p.kind === 'puck').map(p => p.id);

  useEffect(() => {
    let alive = true;
    Promise.all(puckIds.map(id => getPage(id).then(doc => [id, doc], () => null)))
      .then(pairs => { if (alive) setDocs(Object.fromEntries(pairs.filter(Boolean))); });
    return () => { alive = false; };
  }, [puckIds.join(',')]);

  // A project's dev server takes a few seconds, and its routes only exist on the board
  // once it has answered. Ask again until it has, then stop.
  useEffect(() => {
    if (!studio?.live?.configured || studio.live.status === 'running') return;
    const id = setInterval(() => {
      getStudio().then(next => {
        setStudio(next);
        if (next?.live?.status === 'running') clearInterval(id);
      }).catch(() => {});
    }, 2000);
    return () => clearInterval(id);
  }, [studio?.live?.configured, studio?.live?.status]);

  const save = useCallback((id, patch) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      putPositions({ [id]: patch }).catch(() => {});
    }, 250);
  }, []);

  // What a frame looks like here until the server is asked again.
  //
  // It has to be held, not just sent: the board server does not hand its own saves back
  // any more, because hearing one was what sent a frame off to measure itself again.
  const onResize = useCallback((id, width, height, done, fit) => {
    // `fit` says what this height means: true for one the frame measured off its own
    // content, false for one somebody chose, and nothing at all to leave that as it is.
    const choice = typeof fit === 'boolean' ? { fit } : null;
    setEdits(e => ({ ...e, [id]: { ...e[id], width, height, ...choice } }));
    if (done) save(id, { width, height, ...choice });
  }, [save]);

  // The natural height of what a frame is showing.
  //
  // A live frame is another origin and cannot be measured from here, so the same page is
  // fetched once through this server and measured there. The frame you are looking at is
  // untouched, which is why its hot reload still works.
  const onFit = useCallback(frame => {
    const page = (studio?.pages || []).find(p => p.id === frame.id);
    if (!page) return;
    if (!page.url) {
      // A screen the board renders itself is in this document already.
      const node = document.querySelector(`[data-frame="${CSS.escape(page.id)}"] > *`);
      if (node) onResize(page.id, frame.width, Math.ceil(node.scrollHeight) + 2, true, true);
      return;
    }
    // The choice is saved as it is made, not when the height lands: fitting is a
    // standing choice, and a page that is already the right height measures the same
    // and writes nothing at all.
    setEdits(e => ({ ...e, [page.id]: { ...e[page.id], fit: true } }));
    save(page.id, { fit: true });
    setMeasuring({ id: page.id, url: page.url, width: frame.width, fit: true, viewport: viewportFor(frame.height), was: frame.height });
  }, [studio, onResize, save]);

  // A frame whose height nobody has chosen measures itself once, so a page taller than
  // the default is not cut off before you have touched anything.
  //
  // Only the ones you are looking at, though, and one at a time. Measuring is a real
  // page load, and measuring every frame on the board at once was both the slowest thing
  // here and the reason the board would not sit still: each height that landed moved
  // every frame under it, for a minute, while nothing was being looked at.
  //
  // When each frame was last measured, which is what makes it stop. A frame measures
  // itself because there is a reason to and never because of a measurement: the reason
  // is the board hearing that the project changed since this frame was last measured,
  // and even then not for another half minute, so a page being worked on is re-measured
  // once for the spell of work rather than once per file the dev server touches.
  const measured = useRef(new Map());
  const due = id => {
    const at = measured.current.get(id);
    if (!at) return true;                       // never measured: it has no height yet
    return heard.current > at && Date.now() - at > SETTLE;
  };
  const [near, setNear] = useState(() => new Set());
  const sawNear = useCallback(id => {
    setNear(seen => (seen.has(id) ? seen : new Set(seen).add(id)));
  }, []);

  useEffect(() => {
    if (measuring) return;
    const next = (studio?.pages || [])
      .find(p => p.url && !p.sized && near.has(p.id) && due(p.id));
    if (!next) return;
    measured.current.set(next.id, Date.now());
    const e = edits[next.id] || {};
    // A frame set to fit keeps fitting; one being measured for the first time is not
    // being set to anything, it just has no height yet.
    setMeasuring({
      id: next.id,
      url: next.url,
      width: e.width || next.frame.width,
      fit: next.fit || undefined,
      viewport: viewportFor(e.height || next.frame.height),
      was: e.height || next.frame.height
    });
  }, [studio, measuring, edits, near]);

  // One measurement at a time, asked of the server.
  //
  // The server draws the page in the same headless browser that checks and exports a
  // frame, so the answer is the height a person would scroll through. A dev server that
  // has never served that page can take most of a minute to answer, which is why this
  // waits rather than giving up: the height is the point.
  useEffect(() => {
    if (!measuring) return;
    let alive = true;
    measurePage(measuring.url, measuring.width, measuring.viewport)
      .then(answer => {
        if (!alive || !answer || !answer.height) return;
        const height = Math.ceil(answer.height) + 2;
        // All but the same height as last time is nothing to write down: the frame is
        // already that tall to look at, and writing it would move every frame under it
        // for nothing.
        if (!worth(height, measuring.was)) return;
        onResize(measuring.id, measuring.width, height, true, measuring.fit);
      })
      .catch(() => {})
      .finally(() => {
        // From when it finished, not from when it started: the half minute is quiet
        // time for the board, and a cold page can take most of a minute to answer.
        measured.current.set(measuring.id, Date.now());
        if (alive) setMeasuring(null);
      });
    return () => { alive = false; };
  }, [measuring, onResize]);

  const pages = (studio?.pages || []).map(p => {
    const e = edits[p.id] || {};
    return {
      ...p,
      fit: typeof e.fit === 'boolean' ? e.fit : !!p.fit,
      frame: { width: e.width || p.frame.width, height: e.height || p.frame.height }
    };
  });

  const byId = Object.fromEntries(pages.map(p => [p.id, p]));
  // Frames somebody is working on right now, said by whoever is doing the work.
  const busyIds = new Set(studio?.working || []);
  // Frames the board is looking over right now, and what it found last time.
  const scanIds = new Set(studio?.checking || []);
  const checks = studio?.checks || {};

  // When a check finishes, the board goes back to that frame and fits it in the window.
  const [afterCheck, setAfterCheck] = useState('');
  const wasScanning = useRef([]);
  useEffect(() => {
    const now = studio?.checking || [];
    const done = wasScanning.current.filter(id => !now.includes(id));
    if (done.length) setAfterCheck(done[done.length - 1]);
    wasScanning.current = now;
  }, [studio?.checking]);

  const onCheck = useCallback(async id => {
    say(id, 'analysing...');
    try {
      await checkFrame(id);
      await reload();
    } catch (_) {
      say(id, 'could not check it');
    }
  }, [say, reload]);

  // One save for every change to the section list, and the server hands back the list it
  // actually wrote, so an auto-placed frame becomes a placed one the moment it is moved.
  const saveBands = next => {
    setBands(next);
    putSections(next.map(({ id, name, frames }) => ({ id, name, frames })))
      .then(res => { if (res?.sections) setBands(res.sections); })
      .catch(() => {});
  };

  const onDrop = (id, sectionId, index) => {
    const next = bands.map(b => ({ ...b, frames: b.frames.filter(f => f !== id) }));
    const band = next.find(b => b.id === sectionId) || next[0];
    if (!band) return;
    band.frames.splice(Math.max(0, Math.min(index, band.frames.length)), 0, id);
    saveBands(next);
  };

  // The new section's id goes back to the board, which puts the cursor in its name: a
  // section is a thing you called something, not "Section 2".
  const onAddSection = () => {
    const taken = new Set(bands.map(b => b.name));
    let n = bands.length + 1;
    while (taken.has(`Section ${n}`)) n++;
    const id = `section-${n}`;
    saveBands([...bands, { id, name: `Section ${n}`, frames: [] }]);
    return id;
  };

  const onRenameSection = (id, name) => {
    const clean = String(name || '').trim();
    if (!clean) return;
    saveBands(bands.map(b => (b.id === id ? { ...b, name: clean } : b)));
  };

  // A section is a grouping, never a container that can take frames with it: whatever is
  // in it moves to the section above, or to the one below when it was the first.
  const onRemoveSection = id => {
    if (bands.length < 2) return;
    const i = bands.findIndex(b => b.id === id);
    if (i < 0) return;
    const keep = bands[i].frames;
    const next = bands.filter(b => b.id !== id);
    const into = next[Math.max(0, i - 1)];
    into.frames = [...into.frames, ...keep];
    saveBands(next);
  };

  // A frame made here can be called something else. A page of the project cannot: its
  // name is the route, and that is decided in the project.
  const onRename = useCallback(async (id, title) => {
    const page = (studio?.pages || []).find(p => p.id === id);
    if (!page || page.source !== 'canvas') return;
    try {
      await renameFrame(id, title);
      await reload();
    } catch (_) {
      say(id, 'could not rename');
    }
  }, [studio, say]);

  // Delete throws a frame made here away. A page of the project stays: its file is the
  // project's, and deleting it here would delete the real page.
  const onDelete = useCallback(async id => {
    const page = (studio?.pages || []).find(p => p.id === id);
    if (!page) return;
    if (page.source !== 'canvas') {
      say(id, 'a page of the project');
      return;
    }
    try {
      const res = await deleteFrame(id);
      await reload();
      ask({ type: 'say', text: `${page.title} moved to ${res.trashed}` });
    } catch (_) {
      say(id, 'could not delete');
    }
  }, [studio, say, reload]);

  const placed = layout(bands, byId);

  const frames = placed.frames.map(({ page, section, x, y }) => ({
    section,
    id: page.id,
    title: page.title,
    subtitle: page.source === 'live' ? page.file : page.source === 'repo' ? dirOf(page.file) : '',
    width: page.frame.width,
    height: page.frame.height,
    // As tall as what is in it, rather than a height somebody chose.
    fit: !!page.fit,
    // Being measured right now. A page its dev server has not served before can take a
    // while, and a size selector that says nothing looks broken.
    measuring: measuring?.id === page.id,
    x,
    y,
    note: note[page.id] || '',
    canRename: page.source === 'canvas',
    canDelete: page.source === 'canvas',
    check: checks[page.id] || null,
    path: page.path || '',
    // Nothing but the name until the name is hovered. A row of buttons over every frame
    // is a row of buttons you read past, and the board is for looking at the work.
    actions: [
      { label: 'Copy name', title: page.path || 'Copy this frame’s name', onClick: () => copyName(page) },
      ...(page.url ? [{ label: 'Export', title: 'Export this frame as a file', onClick: () => setExporting(page) }] : [])
    ],
    body: (
      <Frame
        page={page}
        width={page.frame.width}
        height={page.frame.height}
        working={busyIds.has(page.id)}
        scanning={scanIds.has(page.id)}
        keepAwake={page.id === chosen}
        reload={reloads[page.id] || 0}
        onNear={sawNear}
      >
        {docs[page.id] ? <Render config={puckConfig} data={docs[page.id].data} /> : null}
      </Frame>
    )
  }));

  return (
    <>
      <Board
        frames={frames}
        bands={placed.bands}
        onDrop={onDrop}
        onAddSection={onAddSection}
        onRenameSection={onRenameSection}
        onRemoveSection={onRemoveSection}
        onResize={onResize}
        onFit={onFit}
        onReload={onReload}
        onSelect={id => { setChosen(id); if (onSelect) onSelect(id); }}
        onRename={onRename}
        onDelete={onDelete}
        onCheck={onCheck}
        onCopy={(id, text) => {
          ask({ type: 'copy', text });
          try { navigator.clipboard && navigator.clipboard.writeText(text); } catch (_) {}
          say(id, 'copied for Claude');
        }}
        focus={afterCheck || focus}
        storageKey={`pages:${studio?.root || ''}`}
        empty={
          // A repo with no board file has nothing on it yet and one thing to do, so that
          // one thing is what an empty board shows.
          studio?.setup?.needed
            ? <Setup studio={studio} />
            : studio?.live?.configured && studio.live.status !== 'running'
              ? `Starting the project's dev server (${studio.live.status})...`
              : 'No screens yet. Press "New frame", or point this board at a project with a live block in its .designbook file.'
        }
      />
      {exporting ? (
        <ExportDialog
          page={exporting}
          onClose={() => setExporting(null)}
          onDone={res => { ask({ type: 'reveal', file: res.file }); say(exporting.id, 'exported'); }}
        />
      ) : null}

    </>
  );
}

// The window a screen is measured in. Its own height when that is a window's worth, and
// a plain desktop window otherwise: a frame already stretched to ten thousand pixels
// would otherwise measure itself against ten thousand pixels of viewport units.
const viewportFor = height => Math.min(1200, Math.max(600, Number(height) || 900));

const dirOf = file => {
  const parts = file.split('/');
  parts.pop();
  return parts.join('/');
};

// Sections down the board, frames in a line across each one.
//
// A section is laid out, not drawn: its frames are placed left to right in the order the
// .designbook file lists them, and the band is whatever size that comes to. So there is one
// place a frame can be, the order is a list a person can read, and nothing drifts into a
// corner of an infinite plane where it is never seen again.
function layout(bands, byId) {
  const lines = bands.map(band => {
    const pages = (band.frames || []).map(id => byId[id]).filter(Boolean);
    let x = 0;
    let tall = 0;
    const placed = pages.map(page => {
      const at = x;
      x += page.frame.width + GAP;
      // The frame's own label sits above it, in the section's strip, so it is not part
      // of the frame's height any more.
      tall = Math.max(tall, page.frame.height);
      return { page, x: at };
    });
    return { band, placed, content: Math.max(0, x - GAP), tall: Math.max(tall, 200) };
  });

  // Every band is as wide as the widest one, so an empty section is still a target you
  // can drop onto rather than a thin strip to aim at.
  const widest = Math.max(560, ...lines.map(l => l.content));
  // A board nobody has split is not drawn as a section. One band with its box and its
  // title around everything would be a frame around the whole wall, which says nothing.
  const chrome = lines.length > 1;
  const head = chrome ? HEADER : 0;
  const out = { bands: [], frames: [] };
  let y = 0;
  for (const line of lines) {
    const top = y + head;
    for (const { page, x } of line.placed) out.frames.push({ page, section: line.band.id, x, y: top });
    out.bands.push({
      id: line.band.id,
      name: line.band.name,
      count: line.placed.length,
      odd: out.bands.length % 2 === 1,
      chrome,
      x: -PAD,
      y,
      width: widest + PAD * 2,
      height: head + line.tall + (chrome ? PAD : 0)
    });
    y += head + line.tall + (chrome ? PAD + BETWEEN : BETWEEN);
  }
  return out;
}

// What a frame shows, and what it shows while it has nothing to show.
//
// Two rules. It loads only once it is near the viewport, because a project with two
// hundred routes would otherwise start two hundred iframes at once and the board would
// never settle. And it never shows a framework's error page: that page is the dev server
// talking to a developer about its own internals, and on a board it reads as though the
// design itself is broken. So the board asks whether the page is really being served,
// shows that it is coming until it is, and keeps asking.

const WAIT = [1500, 3000, 6000, 10000];

function Frame({ page, width, height, working, scanning, keepAwake, reload, onNear, children }) {
  const ref = useRef(null);
  const near = useAwake(ref, { keep: keepAwake });
  const [served, setServed] = useState(!page.url);  // the server says the page is there
  const [drawn, setDrawn] = useState(!page.url);    // the frame has finished loading it
  const [why, setWhy] = useState('');
  const [slow, setSlow] = useState(false);
  const [again, setAgain] = useState(0);

  useEffect(() => {
    // The board is told once, the first time this frame is reached, so it knows which
    // ones are worth measuring.
    if (near && onNear) onNear(page.id);
  }, [near, onNear, page.id]);

  // Asked to load the page again: throw away what is there and start over, the same as
  // the one button the waiting card offers.
  const asked = useRef(reload);
  useEffect(() => {
    if (reload === asked.current) return;
    asked.current = reload;
    setSlow(false);
    setServed(!page.url);
    setDrawn(!page.url);
    setAgain(n => n + 1);
  }, [reload, page.url]);

  // Asked while the frame is already loading it, not before. A page this dev server has
  // not drawn before can take most of a minute, and asking first and loading after made
  // every frame cost that twice.
  useEffect(() => {
    if (!near || !page.url) return;
    let alive = true;
    let tries = 0;
    let timer;
    const look = async () => {
      let answer;
      try {
        answer = await isReady(page.id);
      } catch (_) {
        answer = { ok: false, why: 'the board server is not answering' };
      }
      if (!alive) return;
      if (answer.ok) return setServed(true);
      setWhy(answer.why || '');
      setSlow(tries >= 1);
      timer = setTimeout(look, WAIT[Math.min(tries++, WAIT.length - 1)]);
    };
    look();
    return () => { alive = false; clearTimeout(timer); };
  }, [near, page.id, page.url, again]);

  // When the work finishes, the frame loads again: what it is showing is now old.
  const wasWorking = useRef(working);
  useEffect(() => {
    if (wasWorking.current && !working) {
      setServed(!page.url);
      setDrawn(!page.url);
      setAgain(n => n + 1);
    }
    wasWorking.current = working;
  }, [working, page.url]);

  const ready = !working && served && drawn;

  return (
    <div ref={ref} className="st-screen" data-frame={page.id} style={{ width, height }}>
      {!near ? <div className="st-frame-pending" /> : null}
      {near && page.url
        ? <iframe
            key={again}
            src={page.url}
            title={page.title}
            loading="lazy"
            onLoad={() => setDrawn(true)}
          />
        : null}
      {near && !page.url ? children : null}
      {scanning ? <Scanning /> : null}
      {near && !ready ? (
        <Coming
          title={page.title}
          working={working}
          slow={!working && slow}
          why={why}
          onAgain={() => { setSlow(false); setServed(false); setDrawn(false); setAgain(n => n + 1); }}
        />
      ) : null}
    </div>
  );
}

// Being looked over: the design stays visible under a line sweeping down it, because
// what is being checked is the thing you are looking at.
function Scanning() {
  return (
    <div className="st-scan">
      <span className="st-scan-line" />
      <span className="st-scan-word">Analysing</span>
    </div>
  );
}

// The waiting state. It is the shape of the thing that is coming, in the board's own
// colours, and it says what is happening in one line rather than showing a stack trace.
function Coming({ title, working, slow, why, onAgain }) {
  return (
    <div className={'st-coming' + (working ? ' is-working' : '')}>
      <div className="st-coming-inner">
        <b>{title}</b>
        <div className="st-progress"><span /></div>
        <p>
          {working
            ? 'Being designed...'
            : slow
              ? (why ? `Still waiting: ${why}.` : 'Still waiting for the dev server.')
              : 'Rendering...'}
        </p>
        {!working && slow ? <button className="st-btn" onClick={onAgain}>Try again</button> : null}
      </div>
    </div>
  );
}
