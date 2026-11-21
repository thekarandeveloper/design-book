import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getRefs, putRefs, upload, getAssets, deleteRef } from './api.js';
import { RefDialog } from './RefDialog.jsx';
import { Pointed, usePointed } from './Pointed.jsx';

const ask = message => window.parent.postMessage(message, '*');

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

  // The corner button, which is the same button on every view and adds this view's thing.
  useEffect(() => {
    const open = () => input.current && input.current.click();
    window.addEventListener('st-add', open);
    return () => window.removeEventListener('st-add', open);
  }, []);

  const load = useCallback(() => { getRefs().then(setRefs).catch(() => setRefs([])); }, []);
  useEffect(load, [load]);

  // Only what can be looked at. A PDF or a zip in a moodboard is a file somebody has to
  // open somewhere else, and a wall of grey tiles is not a moodboard.
  const media = refs.filter(r => r.kind === 'image' || r.kind === 'video');

  // The name, on the clipboard, because that is what a prompt refers to: "like
  // shelf-3.png" is a thing an agent can go and look at and find in .designbook/refs/.
  // A newline comes with it, so pasting it leaves the cursor ready to keep typing.
  const [said, setSaid] = useState('');
  const pointed = usePointed();
  const copyName = async name => {
    const text = name + '\n';
    ask({ type: 'copy', text });
    try { await navigator.clipboard.writeText(text); } catch (_) {}
    setSaid(name);
    setTimeout(() => setSaid(s => (s === name ? '' : s)), 1400);
  };

  // Thrown away, not destroyed: the server moves the file to .designbook/.trash.
  const throwAway = async name => {
    pointed.close();
    setRefs(list => list.filter(r => r.name !== name));
    try { await deleteRef(name); } catch (_) {}
    load();
  };

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
        {/* The page says what it is by what is on it. The paragraph that used to be here
            explained dropping, where files are saved and what kinds are allowed, and
            then the empty state said the same thing again underneath it. */}
        <h2>Moodboard</h2>
        {busy ? <p className="st-note-line">Adding {busy}...</p> : null}

        {asking ? (
          <RefDialog files={asking} onDone={save} onCancel={() => setAsking(null)} />
        ) : null}

        {!media.length ? (
          <p className="st-empty-line">
            Drop anything here, or press <b>+</b>. Saved in <code>.designbook/refs/</code>.
          </p>
        ) : null}

        <div className="st-grid">
          {media.map(ref => (
            <div className="st-tile" key={ref.name} onContextMenu={pointed.open(ref)}>
              {/* Clicking takes the name, because that is what this tile is for: naming
                  the reference in a prompt. Opening the file is in the menu, where
                  something you do rarely belongs. */}
              <button
                type="button"
                className="st-tile-art"
                title={`Copy ${ref.name}`}
                onClick={() => copyName(ref.name)}
              >
                <Thumb item={ref} />
              </button>
              <span className="st-tile-name" title={ref.name}>
                {said === ref.name ? 'Copied' : ref.name}
              </span>
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

        </div>

        <Pointed at={pointed.at} onClose={pointed.close}>
          <button
            className="st-menu-item"
            onClick={() => { copyName(pointed.at.item.name); pointed.close(); }}
          >
            Copy name
          </button>
          <button
            className="st-menu-item"
            onClick={() => { window.open(pointed.at.item.url, '_blank', 'noreferrer'); pointed.close(); }}
          >
            Open
          </button>
          <button
            className="st-menu-item st-menu-item--bad"
            onClick={() => throwAway(pointed.at.item.name)}
          >
            Delete
          </button>
          <div className="st-menu-note">Deleted goes to .designbook/.trash</div>
        </Pointed>

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
  // Only what can be looked at, the same rule as the board above. The scan picks these
  // up by where they sit, so a Swift file in an Assets folder came through as a logo:
  // a grey tile saying SWIFT is not a reference, it is a file somebody has to open
  // somewhere else.
  const seen = /\.(png|jpe?g|webp|avif|gif|svg|mp4|webm|mov)$/i;
  const media = list => (list || []).filter(i => seen.test(i.file));
  const groups = [
    ['Logos', media(assets.logos)],
    ['Icons', media(assets.icons)],
    ['Images', media(assets.images)]
  ].filter(([, list]) => list.length);
  if (!groups.length) return null;

  return (
    <>
      <h2>Already in this repo</h2>
      <p className="st-note-line">Shown where they lie, never copied.</p>
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
                  {/\.(mp4|webm|mov)$/i.test(item.file)
                    ? <video src={`/@repo/${item.file}`} muted playsInline preload="metadata" />
                    : <img src={`/@repo/${item.file}`} alt={item.file} />}
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
