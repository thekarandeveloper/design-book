import { Button } from '../micro/Button.jsx';

// DSSheetScaffold. Top corners at 40, which is its own radius and not the card scale.

export function Sheet({ title = 'Add to the basket', body = 'Its content, then its action.', action = 'Add' }) {
  return (
    <div className="sheet">
      <div className="sheet-grabber" />
      {title ? <div className="t-card-title">{title}</div> : null}
      {body ? <p className="t-body secondary">{body}</p> : null}
      {action ? <Button label={action} /> : null}
    </div>
  );
}
