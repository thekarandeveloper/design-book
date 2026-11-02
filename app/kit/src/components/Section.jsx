import { Slot } from '../slot.jsx';

// A titled group. Sections sit --section-gap apart, which the screen body applies, so a
// section never carries a margin of its own.

export function Section({ title = 'Today', more = 'See all', children }) {
  return (
    <section className="section">
      {title ? (
        <header className="section-header">
          <h2 className="t-section-header">{title}</h2>
          {more ? <a className="more" href="#">{more}</a> : null}
        </header>
      ) : null}
      <Slot value={children} />
    </section>
  );
}
