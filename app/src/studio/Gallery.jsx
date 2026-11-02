import React, { useEffect, useState } from 'react';
import { getProject, enablePreview, disablePreview, onStudioChanged } from './api.js';

// The project's own components, grouped by the folder they live in.
//
// A thumbnail is the component rendered by the project's own dev server through a small
// preview route, so what you see is the real thing with the real styles. Click one and
// it opens full size; the file opens in the editor from there or from the tile.

const THUMB_W = 1280;
const THUMB_H = 820;
const TILE_W = 232;
const SCALE = TILE_W / THUMB_W;

const openFile = file => window.parent.postMessage({ type: 'openRepoFile', file: '../' + file }, '*');

export function Gallery() {
  const [project, setProject] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);

  const load = () => getProject().then(setProject).catch(() => setProject({ components: [] }));
  useEffect(() => { load(); }, []);
  useEffect(() => onStudioChanged(load), []);

  const components = project?.components || [];
  const preview = project?.preview || {};
  const liveUrl = project?.liveUrl || '';
  const previewing = preview.enabled && liveUrl;

  // src/components/home/Hero.astro is served at /canvas-preview/components/home/Hero/
  const url = file =>
    `${liveUrl}${preview.route}${file.replace(/^src\//, '').replace(/\.astro$/, '')}/`;

  const toggle = async () => {
    setBusy(true);
    try {
      await (preview.enabled ? disablePreview() : enablePreview());
      // Astro needs a moment to pick the new route up.
      setTimeout(load, 1200);
    } finally {
      setBusy(false);
    }
  };

  const byDir = new Map();
  for (const c of components) {
    if (!byDir.has(c.dir)) byDir.set(c.dir, []);
    byDir.get(c.dir).push(c);
  }

  return (
    <div className="st-doc">
      <div className="st-doc-inner">
        <h2>Components</h2>
        <p className="st-note-line">
          {components.length
            ? <>{components.length} in this project. Click one to open it full size.</>
            : 'None found yet. The scan looks in folders named components, ui, views, layouts or design system.'}
        </p>

        {preview.supported ? (
          <div className="st-banner">
            <div>
              {preview.enabled
                ? <>Live previews are on. They come from <code>{preview.file}</code> in the project, which serves a 404 in a build.</>
                : <>Thumbnails need one file in the project, <code>{preview.file}</code>, so its own dev server can render a component on its own. It is dev only and removing it removes every trace.</>}
            </div>
            <button className="st-btn" disabled={busy} onClick={toggle}>
              {busy ? 'Working...' : preview.enabled ? 'Turn previews off' : 'Turn previews on'}
            </button>
          </div>
        ) : null}

        {[...byDir.entries()].map(([dir, list]) => (
          <div key={dir} style={{ marginBottom: 22 }}>
            <h2>{dir}</h2>
            <div className="st-grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${TILE_W}px, 1fr))` }}>
              {list.map(item => (
                <div className="st-tile st-tile--file" key={item.file} title={item.file}>
                  <div
                    className="st-tile-art"
                    data-lang={item.language}
                    onClick={() => (previewing ? setOpen(item) : openFile(item.file))}
                  >
                    {previewing ? (
                      <iframe
                        className="st-thumb"
                        src={url(item.file)}
                        title={item.name}
                        loading="lazy"
                        style={{ width: THUMB_W, height: THUMB_H, transform: `scale(${SCALE})` }}
                      />
                    ) : (
                      <em>{item.language}</em>
                    )}
                  </div>
                  <span className="st-tile-name">{item.name}</span>
                  <span className="st-tile-sub">
                    <button className="st-linkbtn" onClick={() => openFile(item.file)}>open file</button>
                    {item.lines ? ` · ${item.lines} lines` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {open ? <PreviewModal item={open} src={url(open.file)} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

// What the modal is for: look at it properly, and take its name away with you. The two
// copy buttons are the point. A path pasted into Claude is a reference it can act on,
// and a name is what you say when you ask for a change.
function PreviewModal({ item, src, onClose }) {
  const [copied, setCopied] = useState('');

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = async (what, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(''), 1600);
    } catch (_) {}
  };

  return (
    <div className="st-overlay" onClick={onClose}>
      <div className="st-overlay-card" onClick={e => e.stopPropagation()}>
        <header>
          <button
            className={'st-copy' + (copied === 'name' ? ' is-done' : '')}
            title="Copy the name"
            onClick={() => copy('name', item.name)}
          >
            <b>{item.name}</b>
            <i>{copied === 'name' ? 'copied' : 'copy'}</i>
          </button>

          <button
            className={'st-copy' + (copied === 'path' ? ' is-done' : '')}
            title="Copy the path, to paste into Claude"
            onClick={() => copy('path', item.file)}
          >
            <code>{item.file}</code>
            <i>{copied === 'path' ? 'copied' : 'copy'}</i>
          </button>

          <span className="st-grow" />
          <button className="st-btn" onClick={() => openFile(item.file)}>Open file</button>
          <button className="st-btn" onClick={() => window.open(src, '_blank')}>Browser</button>
          <button className="st-x" onClick={onClose}>&times;</button>
        </header>
        <iframe src={src} title={item.name} />
      </div>
    </div>
  );
}
