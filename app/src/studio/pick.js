// Choosing things inside a frame: which element is under the pointer, what to call it, how
// far it is from the next one, and what to say about it to Claude.
//
// Nothing here touches the page. It works on the list a scan returns (see inspect.js),
// where each element is a row: its box, its parent, its words, its classes. The hit test is
// the one place that matters: it has to pick the element a person means, which is the
// smallest one under the pointer, and not the one that happens to be first.

const NAMES = {
  a: 'Link', button: 'Button', img: 'Image', picture: 'Image', svg: 'Icon', video: 'Video', canvas: 'Canvas',
  h1: 'Heading', h2: 'Heading', h3: 'Heading', h4: 'Heading', h5: 'Heading', h6: 'Heading',
  p: 'Text', span: 'Text', label: 'Label', li: 'List item', ul: 'List', ol: 'List',
  input: 'Input', textarea: 'Input', select: 'Select', form: 'Form',
  nav: 'Nav', header: 'Header', footer: 'Footer', main: 'Main', section: 'Section', article: 'Article', aside: 'Aside',
  table: 'Table', figure: 'Figure', body: 'Page'
};

// What a person would call it: its kind, and the words on it if it has any.
export function labelOf(el) {
  if (!el) return '';
  const kind = NAMES[el.t];
  const words = (el.a || el.x || '').trim();
  const quoted = words ? ` "${words.length > 26 ? words.slice(0, 25) + '...' : words}"` : '';
  if (kind) return kind + quoted;
  const cls = (el.c || '').split(' ')[0];
  return (cls ? `${el.t}.${cls}` : el.t) + quoted;
}

const area = r => r[2] * r[3];
const box = el => el.v || el.r;

// The element a click would mean: of everything under the point, the smallest, and of two
// the same size the one later in the page, which is drawn on top. Elements something else
// is covering are skipped, and the page itself is the answer only when nothing else is.
export function hit(list, x, y, scrollY = 0) {
  const py = y + scrollY;
  let best = -1;
  let size = Infinity;
  for (let i = 0; i < list.length; i++) {
    const el = list[i];
    if (el.o) continue;
    const r = box(el);
    if (x < r[0] || x >= r[0] + r[2] || py < r[1] || py >= r[1] + r[3]) continue;
    if (i === 0 && list.length > 1) { if (best < 0) best = 0; continue; }
    const a = area(r);
    if (a <= size) { size = a; best = i; }
  }
  return best;
}

export const parentOf = (list, i) => (list[i] && list[i].p >= 0 ? list[i].p : -1);

// Down one level: the biggest child that is not covered, which is the one that is most of
// what is inside.
export function childOf(list, i) {
  let best = -1;
  let size = -1;
  for (let n = i + 1; n < list.length; n++) {
    if (list[n].p !== i || list[n].o) continue;
    const a = area(box(list[n]));
    if (a > size) { size = a; best = n; }
  }
  return best;
}

// Where a point on the board is on the frame, in the frame's own pixels. The frame is drawn
// scaled, so its on-screen box says how much.
export function onFrame(overlay, frame, ev) {
  const box = overlay.getBoundingClientRect();
  return {
    x: (ev.clientX - box.left) * (frame.width / Math.max(1, box.width)),
    y: (ev.clientY - box.top) * (frame.width / Math.max(1, box.width))
  };
}

// The same element on a scan that was taken after something changed: the closest one of
// the same kind that says the same thing, so a choice survives the page being redrawn.
export function rematch(was, list) {
  if (!was || !list) return -1;
  const cx = was.r[0] + was.r[2] / 2;
  const cy = was.r[1] + was.r[3] / 2;
  let best = -1;
  let far = Infinity;
  for (let i = 0; i < list.length; i++) {
    const el = list[i];
    if (el.t !== was.t || (el.x || '') !== (was.x || '') || (el.c || '') !== (was.c || '')) continue;
    const d = Math.hypot(el.r[0] + el.r[2] / 2 - cx, el.r[1] + el.r[3] / 2 - cy);
    if (d < far) { far = d; best = i; }
  }
  return far < 600 ? best : -1;
}

// ── measuring ─────────────────────────────────────────────────────────────

const px = n => `${Math.round(n)}`;

// The distances between two boxes, drawn the way a design tool draws them: a line across
// each gap with its length. When one is inside the other, the four distances from the
// inner one's edges to the outer one's.
export function measure(a, b) {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  const lines = [];
  const inside = bx >= ax && by >= ay && bx + bw <= ax + aw && by + bh <= ay + ah;
  const around = ax >= bx && ay >= by && ax + aw <= bx + bw && ay + ah <= by + bh;
  if (inside || around) {
    const [o, i] = inside ? [a, b] : [b, a];
    const cx = i[0] + i[2] / 2;
    const cy = i[1] + i[3] / 2;
    const gaps = [
      [i[1] - o[1], cx, o[1], cx, i[1], 'v'],
      [o[1] + o[3] - (i[1] + i[3]), cx, i[1] + i[3], cx, o[1] + o[3], 'v'],
      [i[0] - o[0], o[0], cy, i[0], cy, 'h'],
      [o[0] + o[2] - (i[0] + i[2]), i[0] + i[2], cy, o[0] + o[2], cy, 'h']
    ];
    for (const [d, x1, y1, x2, y2, way] of gaps) if (d > 0.5) lines.push({ x1, y1, x2, y2, way, label: px(d) });
    return lines;
  }
  const across = Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
  const down = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx));
  if (bx >= ax + aw || ax >= bx + bw) {
    const left = bx >= ax + aw ? [ax + aw, bx] : [bx + bw, ax];
    const d = left[1] - left[0];
    const y = across > 0 ? Math.max(ay, by) + across / 2 : (ay + ah / 2 + by + bh / 2) / 2;
    lines.push({ x1: left[0], y1: y, x2: left[1], y2: y, way: 'h', label: px(d) });
  }
  if (by >= ay + ah || ay >= by + bh) {
    const top = by >= ay + ah ? [ay + ah, by] : [by + bh, ay];
    const d = top[1] - top[0];
    const x = down > 0 ? Math.max(ax, bx) + down / 2 : (ax + aw / 2 + bx + bw / 2) / 2;
    lines.push({ x1: x, y1: top[0], x2: x, y2: top[1], way: 'v', label: px(d) });
  }
  return lines;
}

// The same distances as words, for the prompt.
export function gapText(a, b, from, to) {
  const lines = measure(a, b);
  if (!lines.length) return `${from} and ${to} overlap`;
  const parts = lines.map(l => `${l.label}px ${l.way === 'h' ? 'across' : 'down'}`);
  return `${from} to ${to}: ${parts.join(', ')}`;
}

// ── what to say ───────────────────────────────────────────────────────────

// One line each, in the words a person would use. Chosen ones are added to the note and
// can be edited after.
export const TEMPLATES = [
  ['Make it stand out', 'Make this more prominent.'],
  ['Quieter', 'Make this quieter and lighter.'],
  ['Fix spacing', 'Fix the spacing around this so it is even and matches the rest of the page.'],
  ['Align it', 'Align this with the elements around it.'],
  ['Works on mobile', 'Make this work properly on a phone width.'],
  ['Use tokens', 'Replace the hard-coded values here with the project design tokens.'],
  ['Fix contrast', 'Fix the contrast so this can be read.'],
  ['Match reference', 'Match this to the reference picture.'],
  ['Change the text', 'Change the text in this to: ']
];

const short = (list, n) => list.slice(0, n).join(' ');

// ── how big a change is, and so what it needs ──────────────────────────────
//
// A spacing value, a colour, a line of text: Claude does these in one edit to one file, and
// the cheapest model does them as well as the dearest. A change that touches how a page is
// laid out, or has to work across widths, needs more thought, and is where a bigger model
// earns what it costs. Choosing wrongly the one way wastes money and the other wastes time,
// so it is worked out from what was asked for, here, for nothing, and offered as a choice
// rather than made.
//
// The words are the ones people use for each kind of change, in English and in the Hindi
// that is written the same way.
const SMALL = /\b(text|copy|word|label|colou?r|rang|contrast|size|bigger|smaller|bada|chota|font|weight|bold|spacing|space|margin|padding|gap|align|radius|round|border|shadow|opacity|token|hide|show|remove|delete|rename|typo|prominent|quiet|lighter|darker)\b/i;
const STRONG = /(redesign|restructure|rebuild|rewrite|refactor|new (section|component|page|screen)|layout|flow|architecture)/i;
const MEDIUM = /(mobile|responsive|breakpoint|animat|interaction|grid|reference|across|every|all of|hover|state)/i;
const CONTAINER = new Set(['section', 'main', 'body', 'header', 'footer', 'article', 'aside', 'nav', 'form']);

// The agent that does each size of change, on the model that suits it (see src/agents.js).
// The prompt names it, so the work goes there without anybody switching models. The biggest
// changes stay with the session that is already open: they need the context it has.
export const MODELS = [
  { id: 'haiku', name: 'Haiku', agent: 'design-edit', hint: 'Small change: give it to the design-edit agent.' },
  { id: 'sonnet', name: 'Sonnet', agent: 'design-build', hint: 'Give it to the design-build agent.' },
  { id: 'opus', name: 'Opus', agent: '', hint: '' }
];

// Which model, why, and the command that switches to it. `null` until there is something
// to base it on: what should change.
export function modelFor({ picks, details, note, fileKnown }) {
  const words = (note || '').trim();
  if (!words) return null;
  const reasons = [];
  let tier = 0;
  if (STRONG.test(words)) { tier = 2; reasons.push('it changes how something is laid out or built'); }
  else if (MEDIUM.test(words)) { tier = 1; reasons.push('it has to hold across widths or states'); }
  else if (SMALL.test(words)) reasons.push('a value or a line of text');
  else { tier = 1; reasons.push('it is not clear how small it is'); }

  const els = picks.filter(p => p.kind === 'el');
  if (els.length > 3) { tier = Math.min(2, tier + 1); reasons.push(`${els.length} elements at once`); }
  if (els.some(p => CONTAINER.has(p.el.t))) { tier = Math.min(2, tier + 1); reasons.push('a whole section, not one element'); }
  const lead = els[0];
  // A frame that is one file of its own is a file that is known, whatever the element says.
  const known = fileKnown || (lead && details[lead.i] && details[lead.i].source);
  if (lead && details[lead.i] && !known && tier === 0) { tier = 1; reasons.push('the file is not known, so it has to be found'); }
  if (!reasons.length || (tier === 0 && known)) reasons.push('one element, and its file is known');

  const model = MODELS[tier];
  return { ...model, command: `/model ${model.id}`, reason: reasons.join('; ') };
}

// Everything Claude needs to find the thing and change it, as little text as will do: where
// it is, what it is, the file it is written in, what it looks like, what is wrong with it.
// Nothing here costs a search, and the file and line are the part that saves the most.
export function promptFor({ frame, picks, details, issues, note, shot, hasReference, hint }) {
  const out = [];
  out.push(`Design Book: ${frame.title} [${frame.id}] (${frame.width} x ${frame.height})`);
  if (frame.path) out.push(`Frame file: ${frame.path}`);

  picks.forEach((pick, n) => {
    const tag = picks.length > 1 ? `${n + 1}` : '';
    if (pick.kind === 'region') {
      const r = pick.rect;
      out.push(`Region ${tag}: ${Math.round(r.w)} x ${Math.round(r.h)} at ${Math.round(r.x)}, ${Math.round(r.y)} in the frame`.replace('Region :', 'Region:'));
      return;
    }
    const d = details[pick.i];
    const el = pick.el;
    const head = `Element ${tag}: ${labelOf(el)}`.replace('Element :', 'Element:');
    out.push(head);
    if (!d) return;
    if (d.selector) out.push(`  where: ${d.selector}`);
    if (d.cls) out.push(`  classes: ${d.cls.length > 140 ? d.cls.slice(0, 139) + '...' : d.cls}`);
    if (d.source) {
      const owner = d.components && d.components.length ? ` (${d.components[0]})` : '';
      out.push(`  code: ${d.source.file}${d.source.line ? ':' + d.source.line : ''}${owner}`);
    } else if (d.components && d.components.length) {
      out.push(`  component: ${d.components.join(' in ')}`);
    }
    out.push(`  size: ${Math.round(d.rect.w)} x ${Math.round(d.rect.h)} at ${Math.round(d.rect.x)}, ${Math.round(d.rect.y)}`);
    const s = d.style || {};
    const t = d.tokens || {};
    const named = (value, key) => (t[key] ? `${value} (${t[key]})` : value);
    const type = s.size ? `${s.font ? s.font + ' ' : ''}${s.size}${s.lineHeight ? '/' + s.lineHeight : ''} ${s.weight || ''}`.trim() : '';
    const look = [
      type && `type ${type}`,
      s.color && `color ${named(s.color, 'color')}`,
      s.background && `background ${named(s.background, 'background')}`,
      s.border && `border ${s.border}`,
      s.radius && `radius ${named(s.radius, 'radius')}`
    ].filter(Boolean);
    if (look.length) out.push(`  looks: ${look.join(', ')}`);
    const room = [
      s.padding && `padding ${s.padding}`, s.margin && `margin ${s.margin}`,
      s.gap && `gap ${named(s.gap, 'gap')}`,
      s.display && `${s.display}${s.direction ? ' ' + s.direction : ''}`
    ].filter(Boolean);
    if (room.length) out.push(`  box: ${room.join(', ')}`);
    const bad = issues[pick.i];
    if (bad && bad.length) out.push(`  wrong: ${bad.slice(0, 4).map(i => `${i.kind}, ${i.detail}`).join('; ')}`);
  });

  if (picks.length > 1) {
    const els = picks.filter(p => p.kind !== 'region' && p.el);
    for (let a = 0; a < els.length - 1 && a < 3; a++) {
      out.push(`  gap: ${gapText(els[a].el.r, els[a + 1].el.r, `${picks.indexOf(els[a]) + 1}`, `${picks.indexOf(els[a + 1]) + 1}`)}`);
    }
  }
  if (shot) out.push(`Screenshot: ${shot}`);
  if (hasReference) out.push('Reference: the second picture in the screenshot is what it should look like.');
  if (note && note.trim()) out.push('', note.trim());
  if (hint) out.push(hint);
  return out.join('\n');
}

export const shortList = short;
