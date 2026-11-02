import { Card } from './Card.jsx';
import { IconBadge } from '../micro/IconBadge.jsx';

// An empty state goes inside the card it would have filled, not in place of it, so the
// screen does not change shape when the first item arrives.

export function EmptyState({ title = 'Nothing here yet', body = 'What to do about it, in one line.', action = 'Add the first one', glyph = '□' }) {
  return (
    <Card context="system">
      <div className="empty-state">
        <IconBadge glyph={glyph} />
        <div className="t-card-title">{title}</div>
        {body ? <div className="t-card-description secondary">{body}</div> : null}
        {action ? <button className="btn btn--secondary" style={{ width: 'auto' }}>{action}</button> : null}
      </div>
    </Card>
  );
}
