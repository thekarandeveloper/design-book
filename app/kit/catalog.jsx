// The catalog. One declaration per component, and it is the only one.
//
// Three things are generated from this file, which is why it exists at all:
//   1. Puck's palette, so a page is composed by dragging real components.
//   2. The gallery pages, so nothing has to be laid out by hand to be looked at.
//   3. studio.json, the short index an agent reads instead of the whole library.
//
// Add a component here in the same change that adds its file. A component missing from
// the catalog cannot be found again, and will be rebuilt from scratch next time.
//
// This is the DEFAULT kit, shipped with the extension. A repo that needs components of
// its own adds `studio/catalog.jsx`, which replaces this one; `file:` paths below are
// relative to the extension, not to the repo being designed.

import { Text, TEXT_VARIANTS, TEXT_TONES } from './src/micro/Text.jsx';
import { Button, BUTTON_VARIANTS } from './src/micro/Button.jsx';
import { NavButton, NAV_BUTTON_KINDS } from './src/micro/NavButton.jsx';
import { Field, FIELD_STATES } from './src/micro/Field.jsx';
import { Chips } from './src/micro/Chip.jsx';
import { IconBadge, BADGE_TONES } from './src/micro/IconBadge.jsx';
import { Row } from './src/micro/Row.jsx';
import { Divider } from './src/micro/Divider.jsx';
import { TitleBlock } from './src/micro/TitleBlock.jsx';
import { ShimmerLines } from './src/micro/Shimmer.jsx';

import { NavBar } from './src/components/NavBar.jsx';
import { Card, CARD_CONTEXTS } from './src/components/Card.jsx';
import { CardRows } from './src/components/CardRows.jsx';
import { Section } from './src/components/Section.jsx';
import { ValueCard } from './src/components/ValueCard.jsx';
import { EmptyState } from './src/components/EmptyState.jsx';
import { LoadingCard } from './src/components/LoadingCard.jsx';
import { BottomPanel } from './src/components/BottomPanel.jsx';
import { Sheet } from './src/components/Sheet.jsx';
import { TabBar } from './src/components/TabBar.jsx';
import { Screen, ScreenBody, SCREEN_CONTEXTS } from './src/components/Screen.jsx';

const text = v => ({ type: 'text' });
const textarea = () => ({ type: 'textarea' });
const select = options => ({ type: 'select', options: options.map(o => ({ label: String(o), value: o })) });
const bool = () => ({ type: 'radio', options: [{ label: 'No', value: false }, { label: 'Yes', value: true }] });
const number = () => ({ type: 'number' });
const slot = () => ({ type: 'slot' });

export const CATALOG = [
  // ── micro ───────────────────────────────────────────────────────────────
  {
    name: 'Text',
    group: 'micro',
    file: 'app/kit/src/micro/Text.jsx',
    native: 'DS.Typography',
    note: 'Any text. The variant is the type scale; never set a font size by hand.',
    fields: { children: textarea(), variant: select(TEXT_VARIANTS), tone: select(TEXT_TONES) },
    defaultProps: { children: 'Some text', variant: 'body', tone: 'primary' },
    render: Text,
    examples: [
      { variant: 'screenTitle', children: 'Screen title' },
      { variant: 'sectionHeader', children: 'Section header' },
      { variant: 'cardTitle', children: 'Card title' },
      { variant: 'body', children: 'Body, the size most text on a screen is.' },
      { variant: 'cardDescription', tone: 'secondary', children: 'Card description' },
      { variant: 'caption', tone: 'muted', children: 'Caption' },
      { variant: 'footer', tone: 'muted', children: 'Footer' }
    ]
  },
  {
    name: 'Button',
    group: 'micro',
    file: 'app/kit/src/micro/Button.jsx',
    native: 'DS.Buttons.Primary / .Secondary / .Plain',
    note: 'A CTA. Full width unless it is `plain`.',
    fields: { label: text(), variant: select(BUTTON_VARIANTS), disabled: bool(), fullWidth: bool() },
    defaultProps: { label: 'Continue', variant: 'primary', disabled: false, fullWidth: true },
    render: Button,
    examples: [
      { variant: 'primary', label: 'Primary' },
      { variant: 'secondary', label: 'Secondary' },
      { variant: 'danger', label: 'Danger' },
      { variant: 'primary', label: 'Disabled', disabled: true },
      { variant: 'plain', label: 'Plain' }
    ]
  },
  {
    name: 'NavButton',
    group: 'micro',
    file: 'app/kit/src/micro/NavButton.jsx',
    native: 'DSCloseButton / DSBackButton',
    note: 'Close or back. Sits on the LEFT of a bar, always.',
    fields: { kind: select(NAV_BUTTON_KINDS) },
    defaultProps: { kind: 'close' },
    render: NavButton,
    examples: [{ kind: 'close' }, { kind: 'back' }]
  },
  {
    name: 'Field',
    group: 'micro',
    file: 'app/kit/src/micro/Field.jsx',
    native: 'AppTextField',
    note: 'A text input with its label and its error message.',
    fields: { label: text(), placeholder: text(), value: text(), state: select(FIELD_STATES), error: text() },
    defaultProps: { label: 'Label', placeholder: 'Placeholder', value: '', state: 'default', error: '' },
    render: Field,
    examples: [
      { label: 'Label' },
      { label: 'Focused', value: 'Typing', state: 'focus' },
      { label: 'With an error', value: 'Wrong', state: 'error', error: 'This does not look like a phone number.' }
    ]
  },
  {
    name: 'Chips',
    group: 'micro',
    file: 'app/kit/src/micro/Chip.jsx',
    native: 'DS chips',
    note: 'A row of filters. One is selected.',
    fields: { items: text(), selected: text() },
    defaultProps: { items: 'All, Breakfast, Lunch, Dinner', selected: 'All' },
    render: Chips,
    examples: [{ items: 'All, Breakfast, Lunch, Dinner', selected: 'All' }]
  },
  {
    name: 'IconBadge',
    group: 'micro',
    file: 'app/kit/src/micro/IconBadge.jsx',
    native: 'view.dsIconBadge()',
    note: 'Always 40x40 at radius 10. Never resize it.',
    fields: { glyph: text(), tone: select(BADGE_TONES) },
    defaultProps: { glyph: '●', tone: 'brand' },
    render: IconBadge,
    examples: [{ tone: 'brand' }, { tone: 'success', glyph: '✓' }, { tone: 'warning', glyph: '!' }, { tone: 'danger', glyph: '!' }]
  },
  {
    name: 'Row',
    group: 'micro',
    file: 'app/kit/src/micro/Row.jsx',
    native: 'DS row',
    note: 'One line in a list. Put these inside a Card, which draws the hairlines.',
    fields: { title: text(), caption: text(), value: text(), glyph: text(), showBadge: bool() },
    defaultProps: { title: 'A row', caption: 'With a caption', value: '12', glyph: '●', showBadge: true },
    render: Row,
    examples: [{ title: 'A row', caption: 'With a caption', value: '12' }, { title: 'No badge', showBadge: false, value: '4' }]
  },
  {
    name: 'Divider',
    group: 'micro',
    file: 'app/kit/src/micro/Divider.jsx',
    native: 'DS.Colors.separator',
    note: 'One hairline. It never thickens.',
    fields: {},
    defaultProps: {},
    render: Divider,
    examples: [{}]
  },
  {
    name: 'TitleBlock',
    group: 'micro',
    file: 'app/kit/src/micro/TitleBlock.jsx',
    native: 'DS.Spacing.titleToSubtitle',
    note: 'A screen title with its one line of explanation.',
    fields: { title: text(), subtitle: textarea() },
    defaultProps: { title: 'Today', subtitle: 'What this screen is for, in one line.' },
    render: TitleBlock,
    examples: [{}]
  },
  {
    name: 'ShimmerLines',
    group: 'micro',
    file: 'app/kit/src/micro/Shimmer.jsx',
    native: 'AppShimmer',
    note: 'Loading, in the shape of the content that is coming.',
    fields: { lines: number() },
    defaultProps: { lines: 3 },
    render: ShimmerLines,
    examples: [{ lines: 3 }]
  },

  // ── components ──────────────────────────────────────────────────────────
  {
    name: 'NavBar',
    group: 'component',
    file: 'app/kit/src/components/NavBar.jsx',
    native: 'DSNavigationBar',
    note: 'The top bar. Close on the left, title centred.',
    fields: { title: text(), leading: select(['close', 'back', 'none']) },
    defaultProps: { title: 'Title', leading: 'close' },
    render: NavBar,
    examples: [{ title: 'Today' }, { title: 'Recipe', leading: 'back' }]
  },
  {
    name: 'Card',
    group: 'component',
    file: 'app/kit/src/components/Card.jsx',
    native: 'view.dsCard(.system / .brand / .feature)',
    note: 'A surface. The context picks the radius: system 12, brand 16, glass 24.',
    fields: { context: select(CARD_CONTEXTS), selected: bool(), disabled: bool(), children: slot() },
    defaultProps: { context: 'system', selected: false, disabled: false },
    render: Card,
    examples: [{ context: 'system' }, { context: 'brand' }, { context: 'glass' }, { context: 'system', selected: true }, { context: 'system', disabled: true }],
    exampleChild: { variant: 'cardTitle', text: 'A card' }
  },
  {
    name: 'CardRows',
    group: 'component',
    file: 'app/kit/src/components/CardRows.jsx',
    native: 'a card of DS rows',
    note: 'The commonest block: a card of rows. One row per line, "title | caption | value".',
    fields: { context: select(CARD_CONTEXTS), rows: textarea() },
    defaultProps: { context: 'system', rows: 'Breakfast | Poha, chai | 320\nLunch | Dal, rice | 610\nDinner |  | Add' },
    render: CardRows,
    examples: [{}]
  },
  {
    name: 'Section',
    group: 'component',
    file: 'app/kit/src/components/Section.jsx',
    native: 'DS section',
    note: 'A titled group with an optional "see all".',
    fields: { title: text(), more: text(), children: slot() },
    defaultProps: { title: 'Today', more: 'See all' },
    render: Section,
    examples: [{ title: 'Today', more: 'See all' }]
  },
  {
    name: 'ValueCard',
    group: 'component',
    file: 'app/kit/src/components/ValueCard.jsx',
    native: 'DS.Typography.largeValue in a card',
    note: 'For the one number a screen is about.',
    fields: { label: text(), value: text(), unit: text(), note: text(), context: select(CARD_CONTEXTS) },
    defaultProps: { label: 'Eaten today', value: '1,840', unit: 'kcal', note: '460 left of 2,300', context: 'glass' },
    render: ValueCard,
    examples: [{}]
  },
  {
    name: 'EmptyState',
    group: 'component',
    file: 'app/kit/src/components/EmptyState.jsx',
    native: 'DS empty state',
    note: 'Goes inside the card it would have filled, so the screen keeps its shape.',
    fields: { title: text(), body: textarea(), action: text(), glyph: text() },
    defaultProps: { title: 'Nothing here yet', body: 'What to do about it, in one line.', action: 'Add the first one', glyph: '□' },
    render: EmptyState,
    examples: [{}]
  },
  {
    name: 'LoadingCard',
    group: 'component',
    file: 'app/kit/src/components/LoadingCard.jsx',
    native: 'AppShimmer in a card',
    note: 'The loading state of a card, not a spinner.',
    fields: { lines: number(), context: select(CARD_CONTEXTS) },
    defaultProps: { lines: 3, context: 'system' },
    render: LoadingCard,
    examples: [{}]
  },
  {
    name: 'BottomPanel',
    group: 'component',
    file: 'app/kit/src/components/BottomPanel.jsx',
    native: 'view.dsBottomPanel()',
    note: 'The CTA on the bottom edge. Never leave an empty strip under it.',
    fields: { label: text(), variant: select(BUTTON_VARIANTS), disabled: bool() },
    defaultProps: { label: 'Continue', variant: 'primary', disabled: false },
    render: BottomPanel,
    examples: [{}]
  },
  {
    name: 'Sheet',
    group: 'component',
    file: 'app/kit/src/components/Sheet.jsx',
    native: 'DSSheetScaffold',
    note: 'A bottom sheet. Top corners at 40.',
    fields: { title: text(), body: textarea(), action: text() },
    defaultProps: { title: 'Add to the basket', body: 'Its content, then its action.', action: 'Add' },
    render: Sheet,
    examples: [{}]
  },
  {
    name: 'TabBar',
    group: 'component',
    file: 'app/kit/src/components/TabBar.jsx',
    native: 'the app tab bar',
    note: 'The bottom tab bar.',
    fields: { items: text(), selected: text() },
    defaultProps: { items: 'Today, Plan, Basket, Me', selected: 'Today' },
    render: TabBar,
    examples: [{}]
  },
  {
    name: 'ScreenBody',
    group: 'component',
    file: 'app/kit/src/components/Screen.jsx',
    native: 'the scrolling middle of a screen',
    note: 'The scrolling middle. It puts --section-gap between its children, so nothing inside needs a margin.',
    fields: { children: slot() },
    defaultProps: {},
    render: ScreenBody,
    examples: [{}]
  }
];

export default CATALOG;
