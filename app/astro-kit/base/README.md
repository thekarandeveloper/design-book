# base

The document a board page is, and the pieces every platform shares. A page imports what it
needs by path, which is what Astro does best:

```astro
---
import Screen from '../../astro-kit/base/Screen.astro';
import Row from '../../astro-kit/base/Row.astro';
import Text from '../../astro-kit/base/Text.astro';
import Icon from '../../astro-kit/base/Icon.astro';
---
<Screen title="Settings" device="iphone" source="app/src/screens/Settings.tsx">
  <Row padding="var(--db-space-4, 16px)" justify="space-between">
    <Text size={17}>Notifications</Text>
    <Icon name="chevron.right" color="var(--db-text-muted, #94A6BA)" />
  </Row>
</Screen>
```

Two things to know before you build a screen with these:

- A length prop takes a number or a string. A number is pixels. A string passes through
  untouched, so pass `var(--db-space-4, 16px)` and the screen stays on the project's own
  spacing scale.
- Nothing here picks a type size. iOS body is 17, Android body is 14, web is 16, and type
  does not convert between them, so the platform folder passes the number to `Text`.

## The components

| Component | What it is | Props |
|---|---|---|
| `Screen.astro` | The whole document: one screen, body exactly the frame's size, no scrollbar drawn. Emits the `designbook-*` metas the board sizes the frame from. | `title` (required), `device` `iphone`\|`android`\|`web` (iphone), `width`, `height` (device defaults: 393x852, 360x800, 1440x900), `grow` (false), `scheme` `light`\|`dark` (light), `background` (`--db-background`), `group`, `source` |
| `Stack.astro` | A flex container, column by default. | `direction` `column`\|`row` (column), `gap` (0), `padding`, `align`, `justify`, `grow` (false), `width`, `height` |
| `Row.astro` | A horizontal row with the defaults a list row or a toolbar line wants. | `gap` (12), `align` (center), `justify`, `padding`, `width`, `height` |
| `Text.astro` | Text at one platform size. With no `size` it inherits. | `as` (p), `size`, `weight`, `color` (`--db-text`), `align`, `lines` (clamp with an ellipsis), `mono` (false) |
| `Card.astro` | A surface. `gap` also makes it lay its children out in a column. | `padding` (`--db-space-4`), `radius` (`--db-radius-xl`), `background` (`--db-surface`), `border` (true), `shadow` (false), `gap`, `width` |
| `Divider.astro` | One hairline, not a border on a row, so two rows never double it. | `inset` (0), `vertical` (false) |
| `Spacer.astro` | Empty space. With `size` that many pixels, with nothing all the space left. | `size` |
| `Icon.astro` | A stand-in for a platform icon, drawn as a small SVG. | `name` (required), `size` (20), `color` (currentColor), `weight` (1.8 stroke), `filled` (false) |

## Icons

SF Symbols and Material icons do not render in a browser, so `Icon` draws its own. A drawing
is close to the real glyph, never the same, so the svg always carries `data-symbol="<name>"`:
that is what tells whoever builds the screen for real which icon this is.

Ask by the iOS name or the Material one, they land on the same shape:

`chevron.right` `chevron.left` `chevron.down` `chevron.up` `xmark` `plus` `magnifyingglass`
`bell` `person.circle` `house` `square.stack` `gear` `trash` `pencil` `checkmark`
`arrow.left` `arrow.right` `ellipsis` `heart` `star` `clock` `calendar` `doc` `folder`
`lock` `info.circle` `exclamationmark.triangle` `square.and.arrow.up` `line.3.horizontal`
`envelope` `phone` `camera` `photo` `play.fill` `pause.fill`

A `.fill` suffix draws the same shape filled. A name nobody knows draws a neutral rounded
square with a dot, and still carries `data-symbol`, so a screen never has a hole in it where
an icon was meant to be.
