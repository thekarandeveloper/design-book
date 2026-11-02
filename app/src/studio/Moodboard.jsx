import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getRefs, putRefs, upload, getAssets } from './api.js';
import { RefDialog } from './RefDialog.jsx';

// References, as a grid of thumbnails.
//
// Anything can be dropped in: screenshots, a video, a PDF, a link, a file of any kind.
// Each one lands in this repo's .designbook/refs/ folder, so a reference is a file in the
// repo like everything else.
//
// The note under a tile is the part that matters to an agent. An image costs a lot to
// look at and still has to be guessed at; "row height 44, checkbox left" can be acted on
// directly. So the note is editable right on the tile.

export function Moodboard() {
  const [refs, setRefs] = useState([]);
  const [dropping, setDropping] = useState(false);
  const [busy, setBusy] = useState(0);
  const timers = useRef({});
  const input = useRef(null);

  const load = useCallback(() => { getRefs().then(setRefs).catch(() => setRefs([])); }, []);
  useEffect(load, [load]);

  // What the repo already holds, which is a reference too: its own logos, icons and
  // photographs. They stay where they are and are shown from there, because a copy of a
  // picture in `.designbook` is a second picture that stops being the real one.
  const [own, setOwn] = useState(null);
  useEffect(() => { getAssets().then(setOwn).catch(() => setOwn(null)); }, []);

  const note = (name, value) => {
    setRefs(list => list.map(r => (r.name === name ? { ...r, note: value } : r)));
    clearTimeout(timers.current[name]);
    timers.current[name] = setTimeout(() => {
      putRefs({ [name]: { note: value } }).catch(() => {});
    }, 500);
  };

  // Nothing is added silently. What a reference is for is asked while it is still in
  // front of you, because an empty note on a tile is a note nobody ever writes.
  const [asking, setAsking] = useState(null);
  const add = files => { if (files.length) setAsking(files); };

  const save = async answers => {
    setAsking(null);
    setBusy(answers.length);
    const said = {};
    for (const { file, note, tags } of answers) {
      try {
        const res = await upload(file.name, await file.arrayBuffer());
        const made = await res.json().catch(() => ({}));
        const name = made.name || file.name;
        if (note || (tags && tags.length)) said[name] = { note, tags };
      } catch (_) {}
      setBusy(n => n - 1);
    }
    if (Object.keys(said).length) await putRefs(said).catch(() => {});
    load();
  };

  const onDrop = async ev => {
    ev.preventDefault();
    setDropping(false);
    const files = [...(ev.dataTransfer?.files || [])];
    if (files.length) return add(files);

    // A dropped link becomes a .url file, so it is a reference like any other.
    const url = ev.dataTransfer?.getData('text/uri-list') || ev.dataTransfer?.getData('text/plain');
    if (url && /^https?:/.test(url.trim())) {
      const name = url.trim().replace(/^https?:\/\//, '').replace(/[^\w.-]+/g, '-').slice(0, 60) + '.url';
      const body = new TextEncoder().encode(`[InternetShortcut]\nURL=${url.trim()}\n`);
      setAsking([new File([body], name, { type: 'text/uri-list' })]);
    }
  };

  return (
    <div
      className={'st-doc' + (dropping ? ' is-dropping' : '')}
      onDragOver={e => { e.preventDefault(); setDropping(true); }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDropping(false); }}
      onDrop={onDrop}
    >
      <div className="st-doc-inner">
        <h2>Moodboard</h2>
        <p className="st-note-line">
          Drop anything here: screenshots, a video, a PDF, a link, any file. It is saved
          in this repo under <code>.designbook/refs/</code>.
          {busy ? ` Adding ${busy}...` : ''}
        </p>

        {asking ? (
          <RefDialog files={asking} onDone={save} onCancel={() => setAsking(null)} />
        ) : null}

        <div className="st-grid">
          {refs.map(ref => (
            <div className="st-tile" key={ref.name}>
              <a className="st-tile-art" href={ref.url} target="_blank" rel="noreferrer" title={ref.name}>
                <Thumb item={ref} />
              </a>
              <span className="st-tile-name" title={ref.name}>{ref.name}</span>
              {ref.tags && ref.tags.length ? (
                <span className="st-tile-tags">{ref.tags.join(' · ')}</span>
              ) : null}
              <textarea
                className="st-tile-note"
                placeholder="What to take from this. Say the decision: row height 44, checkbox left."
                defaultValue={ref.note}
                onChange={e => note(ref.name, e.target.value)}
              />
            </div>
          ))}

          <button className="st-tile st-tile--add" onClick={() => input.current?.click()}>
            <span className="st-tile-art"><em>+ add</em></span>
            <span className="st-tile-name">Add references</span>
            <span className="st-tile-sub">or drop them anywhere here</span>
          </button>
        </div>

        {own ? <Own assets={own} /> : null}

        <input
          ref={input}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={e => { add([...e.target.files]); e.target.value = ''; }}
        />
      </div>
    </div>
  );
}

// The repo's own pictures, grouped the way somebody looks for them. Read only: the file
// belongs to the project, and clicking a tile opens it where it really is.
function Own({ assets }) {
  const groups = [
    ['Logos', assets.logos || []],
    ['Icons', assets.icons || []],
    ['Images', assets.images || []],
    ['Fonts', assets.fonts || []]
  ].filter(([, list]) => list.length);
  if (!groups.length) return null;

  return (
    <>
      <h2 style={{ marginTop: 34 }}>What this repo already has</h2>
      <p className="st-note-line">
        Found where it lies and shown from there, never copied. Click one to open the file.
      </p>
      {groups.map(([name, list]) => (
        <div key={name}>
          <div className="st-menu-note">{name} ({list.length})</div>
          <div className="st-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
            {list.slice(0, 60).map(item => (
              <button
                key={item.file}
                className="st-tile st-tile--file"
                title={item.file}
                onClick={() => window.parent.postMessage(
                  // The whole path: the editor resolves a relative one against the
                  // `.designbook` folder, and these files are the project's own.
                  { type: 'openRepoFile', file: `${assets.repo}/${item.file}` }, '*'
                )}
              >
                <span className="st-tile-art">
                  {/\.(png|jpe?g|webp|avif|gif|svg)$/i.test(item.file)
                    ? <img src={`/@repo/${item.file}`} alt={item.file} />
                    : <em>{(item.file.split('.').pop() || 'file').slice(0, 5)}</em>}
                </span>
                <span className="st-tile-name">{item.file.split('/').pop()}</span>
                <span className="st-tile-sub">{item.file}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function Thumb({ item }) {
  if (item.kind === 'image') return <img src={item.url} alt={item.name} />;
  if (item.kind === 'video') return <video src={item.url} muted playsInline preload="metadata" />;
  if (item.kind === 'link') return <em>link</em>;
  const ext = (item.name.split('.').pop() || 'file').slice(0, 5);
  return <em>{ext}</em>;
}
