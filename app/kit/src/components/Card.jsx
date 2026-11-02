import { Slot } from '../slot.jsx';

// view.dsCard(...). The context picks the radius, and nothing else: a system card is 12,
// a brand card 16, a feature card 24. Those are three different objects, not one object
// with a setting.

export const CARD_CONTEXTS = ['system', 'brand', 'glass'];

export function Card({ context = 'system', selected = false, disabled = false, children, tight = false }) {
  const cls = ['card', `card--${context}`];
  if (selected) cls.push('card--selected');
  if (disabled) cls.push('card--disabled');
  return (
    <article
      className={cls.join(' ')}
      style={tight ? { paddingTop: 'var(--space-2)', paddingBottom: 'var(--space-2)' } : undefined}
    >
      <Slot value={children} />
    </article>
  );
}

export function Cards({ children }) {
  return <div className="cards"><Slot value={children} /></div>;
}
