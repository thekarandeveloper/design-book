// Always 40x40 at radius 10. The size is fixed on purpose: a badge that grows with its
// row stops reading as a badge.

export const BADGE_TONES = ['brand', 'success', 'warning', 'danger'];

const TONE = {
  brand: {},
  success: { background: 'var(--success-11)', color: 'var(--success-5)' },
  warning: { background: 'var(--warning-11)', color: 'var(--warning-5)' },
  danger: { background: 'var(--danger-11)', color: 'var(--danger-5)' }
};

export function IconBadge({ glyph = '●', tone = 'brand' }) {
  return <span className="icon-badge" style={TONE[tone]}>{glyph}</span>;
}
