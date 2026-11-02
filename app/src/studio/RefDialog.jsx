import React, { useEffect, useState } from 'react';

// What to take from a reference, asked once, while it is still in front of you.
//
// An image costs an agent a lot to look at and still has to be guessed at. One line
// saying what the decision is, and a few tags saying what kind of decision it is, can be
// acted on directly. So the question is asked at the moment of adding, not left as an
// empty box on a tile that nobody fills in later.

// The kinds of thing a reference is usually kept for. Picked, not typed, so the words
// stay the same across a board and an agent can rely on them.
const TAGS = [
  ['Layout', 'how the page is arranged'],
  ['Type', 'the typefaces and their sizes'],
  ['Colour', 'the palette'],
  ['Spacing', 'the air between things'],
  ['Motion', 'how it moves'],
  ['Photography', 'the pictures and their treatment'],
  ['Illustration', 'the drawn parts'],
  ['Copy', 'the words and their tone'],
  ['Product UI', 'a screen of a product'],
  ['Social post', 'a post, a story, a thumbnail'],
  ['Brand', 'the whole identity'],
  ['Do not copy', 'kept as a warning, not a model']
];

export function RefDialog({ files, onDone, onCancel }) {
  const [at, setAt] = useState(0);
  const [notes, setNotes] = useState(() => files.map(() => ''));
  const [tags, setTags] = useState(() => files.map(() => []));
  const [previews, setPreviews] = useState([]);

  useEffect(() => {
    const urls = files.map(f => (f.type.startsWith('image/') || f.type.startsWith('video/')
      ? URL.createObjectURL(f) : ''));
    setPreviews(urls);
    return () => urls.forEach(u => u && URL.revokeObjectURL(u));
  }, [files]);

  useEffect(() => {
    const esc = ev => { if (ev.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onCancel]);

  const file = files[at];
  if (!file) return null;

  const toggle = tag => setTags(all => all.map((t, i) => {
    if (i !== at) return t;
    return t.includes(tag) ? t.filter(x => x !== tag) : [...t, tag];
  }));

  const applyToAll = () => {
    setNotes(all => all.map(() => notes[at]));
    setTags(all => all.map(() => [...tags[at]]));
  };

  const done = () => onDone(files.map((f, i) => ({ file: f, note: notes[i], tags: tags[i] })));

  return (
    <div className="st-overlay" onClick={onCancel}>
      <div className="st-ref-ask" onClick={e => e.stopPropagation()}>
        <header>
          <div>
            <b>What should be taken from this?</b>
            <span>{file.name}{files.length > 1 ? ` · ${at + 1} of ${files.length}` : ''}</span>
          </div>
          <button className="st-close" onClick={onCancel} title="Close (Escape)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
                 strokeWidth="1.9" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>

        <div className="st-ref-body">
          <div className="st-ref-art">
            {previews[at]
              ? (file.type.startsWith('video/')
                  ? <video src={previews[at]} muted playsInline preload="metadata" />
                  : <img src={previews[at]} alt={file.name} />)
              : <em>{(file.name.split('.').pop() || 'file').slice(0, 5)}</em>}
          </div>

          <div className="st-ref-say">
            <label>The decision, in one line</label>
            <textarea
              autoFocus
              value={notes[at]}
              placeholder="Row height 44, checkbox on the left. Not: looks clean."
              onChange={e => setNotes(all => all.map((n, i) => (i === at ? e.target.value : n)))}
            />

            <label>What kind of decision</label>
            <div className="st-ref-tags">
              {TAGS.map(([tag, why]) => (
                <button
                  key={tag}
                  className={'st-chipbtn' + (tags[at].includes(tag) ? ' is-on' : '')}
                  title={why}
                  onClick={() => toggle(tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        </div>

        <footer>
          {files.length > 1 ? (
            <button className="st-btn" onClick={applyToAll}>
              Apply to all ({files.length})
            </button>
          ) : null}
          <span className="st-grow" />
          {at > 0 ? <button className="st-btn" onClick={() => setAt(at - 1)}>Back</button> : null}
          {at < files.length - 1 ? (
            <button className="st-btn" onClick={() => setAt(at + 1)}>Next</button>
          ) : null}
          <button className="st-btn st-btn--go" onClick={done}>
            Add {files.length > 1 ? `all ${files.length}` : ''}
          </button>
        </footer>
      </div>
    </div>
  );
}
