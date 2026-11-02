import React, { useCallback, useEffect, useState } from 'react';
import { getProject, getTokens, putToken, deleteToken, getPalette, onStudioChanged } from './api.js';

// The project's own design system, read out of the project's own stylesheet, and
// editable in place.
//
// Nothing here is supplied by the board: a value shown is a value the project ships.
// Editing one writes that one line back, so a change made here and a change made by
// Claude are the same change to the same file.

const isColour = v => /^(#|rgb|hsl|oklch|color\()/i.test(v);

export function SystemPage() {
  const [styles, setStyles] = useState([]);
  const [file, setFile] = useState('');
  const [data, setData] = useState(null);
  const [adding, setAdding] = useState('');
  const [error, setError] = useState('');
  const [palette, setPalette] = useState(null);
  const [copied, setCopied] = useState('');

  const load = useCallback(() => {
    getProject().then(p => setStyles(p.styles || [])).catch(() => setStyles([]));
    getTokens(file).then(setData).catch(() => setData(null));
    getPalette().then(setPalette).catch(() => setPalette(null));
  }, [file]);

  // Everything on this page is for building an experiment with, so everything on it can
  // be taken away: one click puts a value on the clipboard.
  const copy = async value => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      setTimeout(() => setCopied(''), 1400);
    } catch (_) {}
  };

  useEffect(load, [load]);
  useEffect(() => onStudioChanged(load), [load]);

  const tokens = data?.tokens || { colours: [], lengths: [], fonts: [], other: [] };
  const all = [...tokens.colours, ...tokens.lengths, ...tokens.fonts, ...tokens.other];
  const scopes = [...new Set(all.map(t => t.scope))];

  const write = async (scope, name, value) => {
    setError('');
    try {
      await putToken(data?.file, scope, name, value);
      load();
    } catch (err) {
      setError(String(err.message || err));
    }
  };

  const remove = async (scope, name) => {
    setError('');
    try {
      await deleteToken(data?.file, scope, name);
      load();
    } catch (err) {
      setError(String(err.message || err));
    }
  };

  return (
    <div className="st-doc">
      <div className="st-doc-inner">
        <h2>Design system</h2>
        <p className="st-note-line">
          {data?.file
            ? <>Every token in <code>{data.file}</code>: {data.count} of them. Change a value and it is written
              back to that line. Claude edits the same file.</>
            : 'No stylesheet in this project declares custom properties yet.'}
        </p>

        {styles.length > 1 ? (
          <div className="st-presets" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', marginBottom: 18 }}>
            {styles.map(s => (
              <button
                key={s.file}
                className={'st-chipbtn' + (data?.file === s.file ? ' is-on' : '')}
                title={s.file}
                onClick={() => setFile(s.file)}
              >
                {s.file.split('/').pop()} ({s.count})
              </button>
            ))}
          </div>
        ) : null}

        {error ? <div className="st-banner" style={{ color: '#f0a08f' }}>{error}</div> : null}

        {palette ? (
          <>
            <h2>Colour, everywhere it is used ({palette.colours.length})</h2>
            <p className="st-note-line">
              Read from every file in the project, most used first, whether it was declared as a
              token or typed in place. Click one to copy it.
            </p>
            <div className="st-swatchwall">
              {palette.colours.map(c => (
                <button
                  key={c.value}
                  className={'st-swatchcell' + (copied === c.value ? ' is-done' : '')}
                  title={`${c.count} times. ${c.files.join(', ')}`}
                  onClick={() => copy(c.value)}
                >
                  <span style={{ background: c.value }} />
                  <b>{copied === c.value ? 'copied' : c.value}</b>
                  <i>{c.count}</i>
                </button>
              ))}
            </div>

            <h2>Fonts ({palette.fonts.length})</h2>
            <div className="st-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
              {palette.fonts.map(f => (
                <button key={f.value} className="st-tile st-tile--file" onClick={() => copy(f.value)}>
                  <span className="st-tile-art st-tile-art--live" style={{ height: 92, padding: 14 }}>
                    <span style={{ fontFamily: `'${f.value}', system-ui`, fontSize: 24, color: 'var(--text-primary, #111)' }}>
                      Ag
                    </span>
                  </span>
                  <span className="st-tile-name">{copied === f.value ? 'copied' : f.value}</span>
                  <span className="st-tile-sub">{f.count} references</span>
                </button>
              ))}
            </div>

            {palette.iconPacks.length || palette.svgFiles.length ? (
              <>
                <h2>Icons</h2>
                <p className="st-note-line">
                  {palette.iconPacks.length
                    ? <>Packs already in this project: {palette.iconPacks.map(i => <code key={i.value}>{i.value} </code>)}</>
                    : 'No icon package found.'}
                  {palette.svgFiles.length ? ` ${palette.svgFiles.length} svg files.` : ''}
                </p>
                {palette.svgFiles.length ? (
                  <div className="st-spec"><div className="st-props" style={{ borderTop: 0, maxHeight: 180, overflow: 'auto' }}>
                    {palette.svgFiles.map(f => <div key={f}>{f}</div>)}
                  </div></div>
                ) : null}
                {palette.iconNames.length ? (
                  <div className="st-presets" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', marginTop: 10 }}>
                    {palette.iconNames.map(i => (
                      <button key={i.value} className="st-chipbtn" onClick={() => copy(i.value)}>{i.value}</button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}

            <h2 style={{ marginTop: 34 }}>Declared tokens</h2>
            <p className="st-note-line">
              The ones the project names, and the only ones that can be changed from here.
            </p>
          </>
        ) : null}

        {scopes.map(scope => {
          const list = all.filter(t => t.scope === scope);
          return (
            <div key={scope || 'top'} style={{ marginBottom: 26 }}>
              <h2>{scope || 'Top level'}</h2>
              <div className="st-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
                {list.map(t => (
                  <Token
                    key={scope + t.name}
                    token={t}
                    onSave={value => write(scope, t.name, value)}
                    onDelete={() => remove(scope, t.name)}
                  />
                ))}

                {adding === scope ? (
                  <NewToken onCancel={() => setAdding('')} onSave={(name, value) => { setAdding(''); write(scope, name, value); }} />
                ) : (
                  <button className="st-token st-token--add" onClick={() => setAdding(scope)}>
                    <span>+ Add a token</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Token({ token, onSave, onDelete }) {
  const [value, setValue] = useState(token.value);
  useEffect(() => setValue(token.value), [token.value]);
  const dirty = value !== token.value;

  return (
    <div className="st-token">
      <span
        className="st-token-chip"
        style={isColour(value) ? { background: value } : { background: '#22262a', display: 'grid', placeItems: 'center' }}
      >
        {isColour(value) ? null : <code className="st-token-plain">{value}</code>}
      </span>
      <span className="st-token-name" title={token.name}>{token.name.replace(/^--/, '')}</span>
      <span className="st-token-edit">
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onSave(value); if (e.key === 'Escape') setValue(token.value); }}
          onBlur={() => dirty && onSave(value)}
        />
        <button className="st-x" title="Delete this token" onClick={onDelete}>&times;</button>
      </span>
    </div>
  );
}

function NewToken({ onSave, onCancel }) {
  const [name, setName] = useState('--');
  const [value, setValue] = useState('');

  return (
    <div className="st-token">
      <span className="st-token-chip" style={{ background: isColour(value) ? value : '#22262a' }} />
      <span className="st-token-edit" style={{ borderTop: 0 }}>
        <input autoFocus placeholder="--name" value={name} onChange={e => setName(e.target.value)} />
      </span>
      <span className="st-token-edit">
        <input
          placeholder="value"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && name.length > 2 && value) onSave(name, value); if (e.key === 'Escape') onCancel(); }}
        />
        <button className="st-x" title="Cancel" onClick={onCancel}>&times;</button>
      </span>
    </div>
  );
}
