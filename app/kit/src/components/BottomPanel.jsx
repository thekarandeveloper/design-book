import { Button } from '../micro/Button.jsx';

// The CTA strip at the foot of a screen. It sits ON the bottom edge: there is never an
// empty strip under it, which is the one layout rule people notice without naming.

export function BottomPanel({ label = 'Continue', variant = 'primary', disabled = false }) {
  return (
    <div className="bottom-panel">
      <Button label={label} variant={variant} disabled={disabled} />
    </div>
  );
}
