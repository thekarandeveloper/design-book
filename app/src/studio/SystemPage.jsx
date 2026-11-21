import React, { useCallback, useEffect, useState } from 'react';
import { getProject, getTokens, putToken, deleteToken, getPalette, onStudioChanged } from './api.js';
import { Pointed, usePointed } from './Pointed.jsx';

// The project's own design system, read out of the project's own stylesheet, and
// editable in place.
//
// Nothing here is supplied by the board: a value shown is a value the project ships.
// Editing one writes that one line back, so a change made here and a change made by
// Claude are the same change to the same file.

const isColour = v => /^(#|rgb|hsl|oklch|color\()/i.test(v);

// Where a colour sits, so a wall of them can be put in an order somebody can scan.
//
// Sorted by name, a palette is alphabet soup: `--accent`, `--border`, `--brand` in a row
// with nothing in common. Sorted by use, it is whatever the code happened to do most.
// Sorted by tint it is a palette: the greys together, then the colours by hue, each run
// running light to dark. That is the order you look for a colour in.
function tintOf(value) {
  const rgb = rgbOf(value);
  // Anything that cannot be read (oklch, color(), a var) keeps its place at the end
  // rather than being guessed at and put somewhere wrong.
  if (!rgb) return { known: false, hue: 999, light: 0, grey: false };
  const [r, g, b] = rgb.map(n => n / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  const d = max - min;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * light - 1));
  let hue = 0;
  if (d !== 0) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue = (hue * 60 + 360) % 360;
  }
  // Below this a colour reads as a grey however its hue computes, and a grey sorted into
  // the blues is the thing that makes a palette look shuffled.
  const grey = sat < 0.12;
  return { known: true, hue, light, grey, sat };
}

function rgbOf(value) {
  const v = String(value || '').trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(v);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map(c => c + c).join('');
    if (h.length >= 6) return [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)].map(x => parseInt(x, 16));
    return null;
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (m) {
    const parts = m[1].split(/[,\/\s]+/).filter(Boolean).slice(0, 3).map(Number);
    if (parts.length === 3 && parts.every(n => Number.isFinite(n))) return parts;
  }
  return null;
}

// Whether two colours are the same colour. `#FFF`, `#ffffff` and `rgb(255,255,255)` are
// one white written three ways, and a palette that shows all three is a palette that
// cannot be read.
function sameAs(value) {
  const rgb = rgbOf(value);
  return rgb ? rgb.join(',') : String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

// The hex a colour input can be set to, since it only speaks `#rrggbb`.
function hexOf(value) {
  const rgb = rgbOf(value);
  if (!rgb) return '#808080';
  return '#' + rgb.map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('');
}

// Greys first, lightest down, then the colours by hue, each run lightest down. Anything
// unreadable last, in the order it came.
function byTint(list) {
  return [...list].sort((a, b) => {
    const x = tintOf(a.value);
    const y = tintOf(b.value);
    if (x.known !== y.known) return x.known ? -1 : 1;
    if (x.grey !== y.grey) return x.grey ? -1 : 1;
    if (!x.grey) {
      const hx = Math.round(x.hue / 24);
      const hy = Math.round(y.hue / 24);
      if (hx !== hy) return hx - hy;
    }
    return y.light - x.light;
  });
}

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
  // A newline comes with it, so pasting into a prompt leaves the cursor ready to keep
  // typing rather than on the end of the thing just pasted.
  const copy = async value => {
    try {
      await navigator.clipboard.writeText(value + '\n');
      setCopied(value);
      setTimeout(() => setCopied(c => (c === value ? '' : c)), 1400);
    } catch (_) {}
  };

  // The same right click as the moodboard: take the name, take the value, or take it
  // out of the stylesheet. What is on the menu depends on what was pressed, because a
  // colour somebody typed into a file by hand is not this board's to delete.
  const pointed = usePointed();

  useEffect(load, [load]);
  useEffect(() => onStudioChanged(load), [load]);

  const tokens = data?.tokens || { colours: [], lengths: [], fonts: [], other: [] };
  const all = [...tokens.colours, ...tokens.lengths, ...tokens.fonts, ...tokens.other];
  const scopes = [...new Set(all.map(t => t.scope))];

  // The corner button, which is the same button on every view and adds this view's thing.
  // A token belongs to a scope and the button has no way to say which, so it opens the
  // first one, which is where a new token goes unless somebody says otherwise.
  useEffect(() => {
    const open = () => setAdding(was => was || scopes[0] || '');
    window.addEventListener('st-add', open);
    return () => window.removeEventListener('st-add', open);
  }, [scopes.join('|')]);

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

  // Colours and fonts, and nothing else.
  //
  // This page used to list every custom property by name, in four lists, with lengths and
  // icon packs under them. A list of names is a thing you read, and a design system is a
  // thing you look at: the two decisions anybody comes here to make are which colour and
  // which face. Lengths and the rest are still in the stylesheet and Claude still edits
  // them; they are not what this page is for.
  // One tile per colour, not one per name.
  //
  // A stylesheet says the same colour several times under different names: `--brand`,
  // `--primary` and `--ring` are often one green. Shown as three tiles that is three
  // greens to compare, and changing one of them silently breaks the agreement between
  // them. So the same colour is one tile, and the names that share it are linked to it:
  // changing the tile writes all of them, which is what somebody meant by changing "the
  // brand green".
  const groups = (() => {
    const by = new Map();
    for (const t of tokens.colours || []) {
      const key = sameAs(t.value);
      const had = by.get(key);
      if (had) had.names.push(t);
      else by.set(key, { value: t.value, names: [t] });
    }
    return byTint([...by.values()]);
  })();
  const theirs = new Set(groups.map(g => sameAs(g.value)));
  const used = byTint(
    (palette?.colours || [])
      .filter(c => !theirs.has(sameAs(c.value)))
      // The wall itself can repeat: the same colour typed as `#FFF` in one file and
      // `#ffffff` in another is one colour.
      .filter((c, i, all) => all.findIndex(o => sameAs(o.value) === sameAs(c.value)) === i)
  );

  return (
    <div className="st-doc">
      <div className="st-doc-inner">
        <h2>Colour</h2>
        <p className="st-note-line">
          {data?.file
            ? <>The {groups.length} colours declared in <code>{data.file}</code>, greys first and then by
              hue. Click one to change it: the new value is written back to that line.</>
            : 'No stylesheet in this project declares colours yet.'}
        </p>

        {error ? <div className="st-banner" style={{ color: '#f0a08f' }}>{error}</div> : null}

        <div className="st-chips">
          {groups.map(g => (
            <label
              key={sameAs(g.value)}
              className={'st-chip' + (copied === g.names[0].name ? ' is-done' : '')}
              title={`${g.names.map(n => n.name).join(', ')}: ${g.value}`}
              onContextMenu={pointed.open({ kind: 'token', group: g })}
            >
              <span className="st-chip-art" style={{ background: g.value }}>
                {/* The picker is the swatch. A colour input over it, invisible, so the
                    whole tile is the thing you press rather than a small square beside
                    it. */}
                <input
                  type="color"
                  value={hexOf(g.value)}
                  onChange={e => g.names.forEach(n => write(n.scope, n.name, e.target.value))}
                />
              </span>
              <b>{copied === g.names[0].name ? 'copied' : g.value}</b>
              {g.names.length > 1 ? <i>{g.names.length} names</i> : null}
            </label>
          ))}
        </div>

        {adding ? (
          <div style={{ marginTop: 14 }}>
            <NewToken onCancel={() => setAdding('')} onSave={(name, value) => { setAdding(''); write(adding, name, value); }} />
          </div>
        ) : null}

        {used.length ? (
          <>
            <h2>Typed in place ({used.length})</h2>
            <p className="st-note-line">
              Colours the project writes straight into a file rather than taking from a
              token. They cannot be changed from here, because each one would have to be
              changed in every file that typed it. Click one to copy it.
            </p>
            <div className="st-chips">
              {used.map(c => (
                <button
                  key={c.value}
                  className={'st-chip is-flat' + (copied === c.value ? ' is-done' : '')}
                  title={`${c.count} times. ${c.files.join(', ')}`}
                  onClick={() => copy(c.value)}
                  onContextMenu={pointed.open({ kind: 'typed', value: c.value })}
                >
                  <span className="st-chip-art" style={{ background: c.value }} />
                  <b>{copied === c.value ? 'copied' : c.value}</b>
                  <i>{c.count}</i>
                </button>
              ))}
            </div>
          </>
        ) : null}

        {palette?.fonts?.length ? (
          <>
            <h2>Fonts ({palette.fonts.length})</h2>
            <p className="st-note-line">
              Every face the project asks for, most used first. Click one to copy its name.
            </p>
            <div className="st-faces">
              {palette.fonts.map(f => (
                <button
                  key={f.value}
                  className="st-face"
                  onClick={() => copy(f.value)}
                  onContextMenu={pointed.open({ kind: 'font', value: f.value })}
                >
                  <span className="st-face-art" style={{ fontFamily: `'${f.value}', system-ui` }}>Ag</span>
                  <b>{copied === f.value ? 'copied' : f.value}</b>
                  <i>{f.count} references</i>
                </button>
              ))}
            </div>
          </>
        ) : null}

        <Pointed at={pointed.at} onClose={pointed.close}>
          {pointed.at ? <SystemMenu
            at={pointed.at.item}
            copy={v => { copy(v); pointed.close(); }}
            remove={(scope, name) => { remove(scope, name); pointed.close(); }}
          /> : null}
        </Pointed>
      </div>
    </div>
  );
}

// What a right click offers, which is different for each of the three things on this
// page. A colour the project declared has a name worth quoting and can be taken out; a
// colour somebody typed into a file by hand has neither, and saying "Delete" over it
// would be a lie about what this board can reach.
function SystemMenu({ at, copy, remove }) {
  if (at.kind === 'token') {
    const names = at.group.names;
    return (
      <>
        {names.map(n => (
          <button key={n.scope + n.name} className="st-menu-item" onClick={() => copy(n.name)}>
            Copy {n.name.replace(/^--/, '')}
          </button>
        ))}
        <button className="st-menu-item" onClick={() => copy(`var(${names[0].name})`)}>
          Copy var(…)
        </button>
        <button className="st-menu-item" onClick={() => copy(at.group.value)}>
          Copy {at.group.value}
        </button>
        <button
          className="st-menu-item st-menu-item--bad"
          onClick={() => names.forEach(n => remove(n.scope, n.name))}
        >
          Delete {names.length > 1 ? `all ${names.length} names` : 'this token'}
        </button>
        <div className="st-menu-note">Deleting removes the line from the stylesheet</div>
      </>
    );
  }
  return (
    <>
      <button className="st-menu-item" onClick={() => copy(at.value)}>Copy {at.value}</button>
      <div className="st-menu-note">
        {at.kind === 'font'
          ? 'A face the project asks for, not a token'
          : 'Typed into a file by hand, so it has no name to change'}
      </div>
    </>
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

// The kinds of thing a token is, and what each one is set with.
//
// A token used to be two text boxes: a name and whatever you could type. That is the same
// box for a colour, a font and a length, so you had to know the syntax of each before you
// could add one, and a mistyped one is a token that silently does nothing. Saying what
// kind it is first means the right control can be offered: a colour gets the colour
// picker, a length gets a slider you can drag, a font gets the fonts that are actually
// available. What is written to the file is the same plain CSS either way.
const KINDS = [
  { id: 'colour', label: 'Colour', hint: '#1c2b25' },
  { id: 'size', label: 'Size', hint: '16px' },
  { id: 'font', label: 'Font', hint: 'Plus Jakarta Sans' },
  { id: 'other', label: 'Something else', hint: 'any CSS value' }
];

// The faces a browser can actually use without fetching anything, and the ones Google
// Fonts serves that a project is most likely to want. Typing a name that is not here is
// still allowed: the list is a shortcut, not a gate.
const FONTS = [
  'system-ui', '-apple-system', 'Inter', 'Plus Jakarta Sans', 'Poppins', 'Lato',
  'Roboto', 'Open Sans', 'Montserrat', 'Source Sans 3', 'Work Sans', 'DM Sans',
  'Manrope', 'Nunito', 'Figtree', 'Outfit', 'Playfair Display', 'Lora',
  'Merriweather', 'Space Grotesk', 'JetBrains Mono', 'IBM Plex Mono', 'Geist Mono'
];

function NewToken({ onSave, onCancel }) {
  const [kind, setKind] = useState('');
  const [name, setName] = useState('--');
  const [value, setValue] = useState('');
  const [size, setSize] = useState(16);
  const [unit, setUnit] = useState('px');

  const chosen = KINDS.find(k => k.id === kind);
  const out = kind === 'size' ? `${size}${unit}` : value;
  const ready = name.length > 2 && !!out;
  const keys = e => {
    if (e.key === 'Enter' && ready) onSave(name, out);
    if (e.key === 'Escape') onCancel();
  };

  // What kind, before anything else.
  if (!kind) {
    return (
      <div className="st-newtoken">
        <p className="st-newtoken-ask">What kind of token?</p>
        <div className="st-newtoken-kinds">
          {KINDS.map(k => (
            <button key={k.id} onClick={() => setKind(k.id)}>
              {k.label}
              <em>{k.hint}</em>
            </button>
          ))}
        </div>
        <button className="st-newtoken-x" onClick={onCancel}>Cancel</button>
      </div>
    );
  }

  return (
    <div className="st-newtoken" onKeyDown={keys}>
      <div className="st-newtoken-head">
        <b>{chosen.label}</b>
        <button className="st-newtoken-back" onClick={() => setKind('')}>Change</button>
        <button className="st-newtoken-x" onClick={onCancel}>Cancel</button>
      </div>

      <label className="st-newtoken-row">
        <span>Name</span>
        <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="--name" />
      </label>

      {kind === 'colour' ? (
        <label className="st-newtoken-row">
          <span>Colour</span>
          <input
            className="st-newtoken-colour"
            type="color"
            value={isColour(value) ? value : '#1c2b25'}
            onChange={e => setValue(e.target.value)}
          />
          <input className="st-newtoken-said" value={value} onChange={e => setValue(e.target.value)} placeholder="#1c2b25" />
        </label>
      ) : null}

      {kind === 'size' ? (
        <label className="st-newtoken-row">
          <span>Size</span>
          {/* Dragged, because a length is a thing you judge by eye and not by typing. */}
          <input
            className="st-newtoken-drag"
            type="range"
            min={0}
            max={unit === 'px' ? 96 : 8}
            step={unit === 'px' ? 1 : 0.125}
            value={size}
            onChange={e => setSize(Number(e.target.value))}
          />
          <input
            className="st-newtoken-said"
            type="number"
            value={size}
            onChange={e => setSize(Number(e.target.value) || 0)}
          />
          <select value={unit} onChange={e => setUnit(e.target.value)}>
            {['px', 'rem', 'em', '%'].map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </label>
      ) : null}

      {kind === 'font' ? (
        <label className="st-newtoken-row">
          <span>Font</span>
          <input
            className="st-newtoken-said"
            list="st-fonts"
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder="Plus Jakarta Sans"
            style={{ fontFamily: value ? `'${value}', system-ui` : undefined }}
          />
          <datalist id="st-fonts">
            {FONTS.map(f => <option key={f} value={f} />)}
          </datalist>
        </label>
      ) : null}

      {kind === 'other' ? (
        <label className="st-newtoken-row">
          <span>Value</span>
          <input className="st-newtoken-said" value={value} onChange={e => setValue(e.target.value)} placeholder="any CSS value" />
        </label>
      ) : null}

      <div className="st-newtoken-foot">
        {/* What will be written, said before it is written. */}
        <code>{name}: {out || '\u2026'};</code>
        <button className="st-btn st-btn--go" disabled={!ready} onClick={() => onSave(name, out)}>Add</button>
      </div>
    </div>
  );
}

