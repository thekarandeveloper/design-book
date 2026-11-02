import { Slot } from '../slot.jsx';

// What a page under pages/ is: a bar, a scrolling body, and whatever sits on the bottom
// edge. The body applies --section-gap between its children, so nothing inside it needs
// a margin.

export const SCREEN_CONTEXTS = ['system', 'brand', 'plain'];

export function Screen({ context = 'plain', children }) {
  const cls = ['screen'];
  if (context !== 'plain') cls.push(`screen--${context}`);
  return <div className={cls.join(' ')}><Slot value={children} /></div>;
}

export function ScreenBody({ children }) {
  return <div className="screen-body"><Slot value={children} /></div>;
}
