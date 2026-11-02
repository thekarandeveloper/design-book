// DSCloseButton and DSBackButton. These sit on the LEFT of a bar, always, which is a
// house rule rather than a preference: every screen in the app puts them there.

export const NAV_BUTTON_KINDS = ['close', 'back'];

export function NavButton({ kind = 'close', onClick }) {
  const glyph = kind === 'back' ? '‹' : '×';
  return (
    <button className="nav-button" aria-label={kind === 'back' ? 'Back' : 'Close'} onClick={onClick}>
      {glyph}
    </button>
  );
}
