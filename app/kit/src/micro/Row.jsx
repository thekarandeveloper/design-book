import { IconBadge } from './IconBadge.jsx';

// A list row. Rows after the first get a hairline from the stylesheet, so a card of rows
// needs no dividers of its own.

export function Row({ title = 'A row', caption = '', value = '', glyph = '●', showBadge = true }) {
  return (
    <div className="row">
      {showBadge ? <IconBadge glyph={glyph} /> : null}
      <div className="row-text">
        <div className="row-title">{title}</div>
        {caption ? <div className="t-caption secondary">{caption}</div> : null}
      </div>
      {value ? <span className="row-value">{value}</span> : null}
    </div>
  );
}
