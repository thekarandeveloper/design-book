// DS.Buttons. Full width by default, because that is what a CTA is on a phone; `plain` is
// the one that sizes to its label.

export const BUTTON_VARIANTS = ['primary', 'secondary', 'danger', 'plain'];

export function Button({ label = 'Continue', variant = 'primary', disabled = false, fullWidth = true, onClick }) {
  return (
    <button
      className={`btn btn--${variant}`}
      disabled={disabled}
      onClick={onClick}
      style={fullWidth || variant === 'plain' ? undefined : { width: 'auto' }}
    >
      {label}
    </button>
  );
}
