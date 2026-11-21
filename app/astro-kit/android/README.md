# android

What Android draws around a screen, at Material's own sizes.

Everything in this folder is the system, not the product. The app's code says what is inside
a screen and says nothing about the status bar above it, the app bar under that, or the
navigation bar at the bottom, so every board page used to guess them and write them again in
its own CSS. A page should import these and then draw only the screen: the bars come out the
same height on every page, and a height that was wrong is wrong in one file.

## The components

| Component | Props |
|---|---|
| `AndroidStatusBar.astro` | `time` ('9:41'), `tint` ('dark' \| 'light'), `scheme`, `signal` (0 to 4), `wifi`, `battery` (0 to 100), `charging` |
| `AndroidTopAppBar.astro` | `title`, `variant` ('small' \| 'medium' \| 'large' \| 'centre'), `navigation` ('back' \| 'menu' \| 'none'), `scheme`, `background`, `elevated`. Slot `actions` |
| `AndroidNavBar.astro` | `style` ('gesture' \| 'buttons'), `tint`, `scheme` |
| `AndroidBottomBar.astro` | `items` (`{ icon, label, active, badge }`), `scheme`, `labels` ('always' \| 'selected' \| 'none') |
| `AndroidFAB.astro` | `icon` ('add'), `label` (makes it extended), `size` ('small' \| 'regular' \| 'large'), `position` ('bottom-right' \| 'none'), `offset` (16) |
| `AndroidListItem.astro` | `title`, `subtitle`, `supporting`, `icon`, `avatar`, `trailing`, `divider`, `lines` (1 \| 2 \| 3), `scheme` |
| `AndroidCard.astro` | `variant` ('elevated' \| 'filled' \| 'outlined'), `padding` (16), `radius` (12), `width`, `scheme`. Default slot |
| `AndroidButton.astro` | `label`, `variant` ('filled' \| 'tonal' \| 'outlined' \| 'text' \| 'elevated'), `icon`, `size` ('small' \| 'regular'), `full`, `disabled`, `scheme` |

## The sizes they hold

| What | Height |
|---|---|
| status bar | 24 |
| top app bar | 64 small and centre, 112 medium, 152 large |
| navigation bar, the app's | 80, with a 64 by 32 active indicator |
| navigation bar, the system's | 24 on gestures, 48 on buttons |
| list row | 56, 72, 88 by its number of lines |
| button | 40 regular, 32 small, pill radius |
| FAB | 40, 56, 96, with 12, 16, 28 of radius |

## Type

Android's body is 14 and never iOS's 17. Label 14 medium, title 22, headline 24, display 32.
Each is read from a variable with the Material value as its fallback, so a project that sets
its own scale is followed and one that does not still gets Android's:
`--db-android-body` (14), `--db-android-label` (14), `--db-android-label-sm` (12),
`--db-android-title` (22), `--db-android-headline` (24), `--db-android-headline-lg` (28).

## Notes

No fonts are loaded. The face is `--db-font`, the generic stack, because a board page draws
in a headless browser with no network and Roboto fetched from Google would be a blank frame.
Nothing here ships JavaScript, and nothing here reads the scheme: `scheme` is set on the
element as `data-scheme` and the variables behind it change value.

`AndroidFAB` at its default `position` is absolute, so whatever holds it needs its own
`position: relative`.
