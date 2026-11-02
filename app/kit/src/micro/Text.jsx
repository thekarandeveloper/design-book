// Every piece of text on a screen goes through here, so a size is never written by hand.
// The variants are the iOS type scale (DS.Typography), which is deliberately not shared
// with Android: iOS body is 17 and Material body is 14, and forcing one number on both
// makes one platform wrong on every screen.

const CLASS = {
  screenTitle: 't-screen-title',
  introTitle: 't-intro-title',
  sectionHeader: 't-section-header',
  cardTitle: 't-card-title',
  buttonLabel: 't-button-label',
  body: 't-body',
  cardDescription: 't-card-description',
  caption: 't-caption',
  footer: 't-footer',
  largeValue: 't-large-value',
  valueUnit: 't-value-unit',
  pickerRow: 't-picker-row'
};

export const TEXT_VARIANTS = Object.keys(CLASS);
export const TEXT_TONES = ['primary', 'secondary', 'muted'];

export function Text({ as = 'div', variant = 'body', tone = 'primary', children, className = '' }) {
  const Tag = as;
  const tones = { primary: '', secondary: 'secondary', muted: 'muted' };
  return <Tag className={[CLASS[variant] || CLASS.body, tones[tone], className].filter(Boolean).join(' ')}>{children}</Tag>;
}
