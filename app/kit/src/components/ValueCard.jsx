import { Card } from './Card.jsx';

// For the one number a screen is about. The unit sits beside the value rather than under
// it, so the pair reads as a single quantity.

export function ValueCard({ label = 'Eaten today', value = '1,840', unit = 'kcal', note = '460 left of 2,300', context = 'glass' }) {
  return (
    <Card context={context}>
      {label ? <div className="t-caption secondary">{label}</div> : null}
      <div style={{ marginTop: 'var(--space-2)' }}>
        <span className="t-large-value">{value}</span>
        {unit ? <span className="t-value-unit secondary">{' '}{unit}</span> : null}
      </div>
      {note ? <div className="t-card-description secondary" style={{ marginTop: 'var(--space-2)' }}>{note}</div> : null}
    </Card>
  );
}
