# The kit a board page is built from

A page on the board is a screen of a real product, drawn in a browser. Everything that is the
same on every such screen lives here and is written once: the document, the system chrome, the
type, the spacing. A page should be the screen and nothing else.

These are Astro components. They run on the board's own Astro (the board owns it, the project
never installs anything), they ship no JavaScript, and their styles are scoped.

## House rules, not negotiable

- No em dashes anywhere, in code, comments or copy. A comma does the job.
- No emojis.
- Comments say **why**, in simple English, short sentences, where something is not obvious or
  where a value came from. Match the density of the files already in `app/tools`.
- Astro only. No React, no client-side JavaScript, no `client:` directives. A frame is a
  picture of a screen; it does not need to run.
- Every size, colour and font comes from a CSS variable with a fallback:
  `var(--db-space-4, 16px)`. Never a bare hex in a component.
- One component, one file, named as it is used: `IOSNavBar.astro`.
- Each file starts with a comment block: what it is, and the one thing that would be got wrong
  without it.

## The variables every component may use

`tokens.css` is generated per project by the board from the project's own design system, so
these names always exist. Each has the fallback shown, for a project that has not set it.

| Variable | Fallback | What it is |
|---|---|---|
| `--db-primary` | `#2E7BF6` | the action colour |
| `--db-on-primary` | `#FFFFFF` | text on the action colour |
| `--db-surface` | `#FFFFFF` | a card, a sheet, a bar |
| `--db-surface-raised` | `#F7FAFD` | a surface above a surface |
| `--db-background` | `#F2F2F7` | the page behind the surfaces |
| `--db-border` | `#D8E3EF` | a hairline |
| `--db-text` | `#152233` | primary text |
| `--db-text-secondary` | `#4E6177` | secondary text |
| `--db-text-muted` | `#94A6BA` | the quietest text |
| `--db-danger` | `#DC2626` | destructive |
| `--db-success` | `#059669` | done, online |
| `--db-warning` | `#D97706` | needs attention |
| `--db-radius-sm` .. `--db-radius-2xl` | `4 8 12 16 20px` | corner radii |
| `--db-radius-full` | `999px` | a pill |
| `--db-space-1` .. `--db-space-16` | `4 8 12 16 20 24 28 32 40 48 64px` | the spacing scale (1,2,3,4,5,6,7,8,10,12,16) |
| `--db-screen-x` | `24px` | a screen's side margin |
| `--db-font` | system stack | the body face |
| `--db-font-mono` | system mono | for data |

Dark mode is the same variables with other values, set on `[data-scheme="dark"]`. A component
never checks the scheme itself.

## Type

Type does not convert between platforms and must not be unified: iOS body is 17, Android body
is 14, web is 16. So a component that draws text takes a `size` from its own platform's scale
and nothing else decides it.

## The props every chrome component shares

- `scheme`: `'light' | 'dark'`, default `'light'`. Set on the element as `data-scheme`, not read.
- Any slot it offers is named and documented in its own file.

## What each folder holds

- `base/` the document and the pieces every platform shares.
- `ios/` what iOS draws itself, at the sizes iOS draws them.
- `android/` the same for Material.

`index.ts` re-exports nothing: pages import a component by path, which is what Astro does best.

## An app whose palette changes

Some apps repaint themselves: a cycle app has a palette per phase, a theme picker has one
per theme. The board reads every one of them, and keeps the kit's neutrals as they are, so a
settings screen does not come out pink on pink. What that holds back is still there under a
name of its own:

- `--db-primary`, `--db-secondary`, `--db-accent`, `--db-bg-top`, `--db-bg-mid`,
  `--db-bg-bot`, `--db-tile-fill` and the rest of the tints are the current palette's.
- `--db-tinted-surface`, `--db-tinted-text` and the other `--db-tinted-*` are that palette's
  chrome. **A screen the app really does paint in the palette uses these.** Reaching for the
  nearest tint instead gives a card in the wrong colour.
- `:root[data-phase="<name>"]` carries every palette by name, so one attribute on a page
  shows the app as it looks in any of them.

## Two things worth knowing before you build a page

- **`grow` on `Screen`** is what tells the board the screen scrolls. Without it the frame is
  a fixed box and anything past the bottom is cropped with nothing said. `render-page.mjs`
  measures the furthest element on the page, not `scrollHeight`, so it catches this.
- **A filled symbol keeps its detail.** `Icon` fills the container of a `.fill` symbol and
  cuts the detail inside it back out, the way SF Symbols does. A new shape marks its inner
  parts `data-cut` so they are cut rather than swallowed.

## The device, and the chrome a page does not draw

`Screen` draws the phone around the page: the band, the corners, the island and the bar at
the bottom. A frame on the board is therefore the DEVICE, not the screen inside it, which
is why a 393 by 852 iPhone measures 417 by 876. What a page measures itself against is
still the screen, so `--db-screen-w` and `--db-screen-h` did not change.

- `bezel={false}` turns it off, for a page that is one component rather than a whole screen.
- `homeTint="light"` for a screen dark enough that the bar has to be white.
- **Do not draw a home indicator in a page.** It is part of the device now.

## A round button is a component

Back, close, and the one that opens a setting are one shape on iOS. `IOSCircleButton` is
that shape, at 44, with three fills: `tint` (a wash of the app's own colour), `neutral`
(`systemFill`) and `glass` (`.regularMaterial`). A page does not build its own.

On the current iOS a back button is the glass one: `DS.Buttons.Back` is
`.glassEffect(.regular, in: Circle())` from iOS 26, and the filled disc is what it falls
back to below that. Check which the app you are drawing really uses before you pick a fill.

## The chrome a page never positions itself

Four components own their own position, so a page says what, not where.

- **`IOSAppBar`** is the bar an app draws at the top of its own screen: a round button in
  the corner, the title on the middle of the SCREEN and not on what is left beside the
  button, and the app's own three paddings. `kind="back"` or `kind="close"` puts the right
  button in it. This is not `IOSNavBar`, which is the system's 44pt bar with a chevron and
  a label.
- **`IOSCircleButton`** is that button. `kind="back"` and `kind="close"` carry the app's own
  numbers: 44 across, the glyph at 15 or 13 bold, on the glass circle the current iOS draws,
  with the hairline round its edge. Three fills for anything else: `tint`, `neutral`, `glass`.
- **`IOSSheet`** is the whole presentation, not just the panel: the screen behind it, dimmed,
  with ITS status bar showing in the strip above. A page inside a sheet does not draw a
  status bar of its own, and does not draw the dim. The large detent is the safe area plus
  10, which is where iOS puts it.
- **`Screen`** draws the device and the bar at the bottom, as above.

If a page is positioning one of these by hand, the component is missing something. Add it
there rather than in the page, or the next screen gets it slightly different.
