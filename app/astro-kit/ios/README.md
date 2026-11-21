# ios

Everything in this folder is what the system draws, not what the app draws. An app's own code
says what is inside a screen and says nothing about the status bar, the navigation bar, the
tab bar or the home indicator, so every board page used to write those again in CSS and every
page guessed them a little differently. They are here once, at the sizes iOS actually uses on
a 393 x 852 iPhone. A page should import these and then draw only the screen.

Sizes are iOS sizes and are not shared with Android: body 17, callout 16, subheadline 15,
footnote 13, caption 12, title3 20 semibold, title2 22 bold, title1 28 bold, large title 34
bold, a tab bar label 10, a touch target 44. Every length and colour goes through a variable
with a fallback, so a project's `tokens.css` can move any of them.

## The components

| Component | Props | Notes |
|---|---|---|
| `IOSStatusBar` | `time` ('9:41'), `scheme`, `tint` ('dark' \| 'light'), `signal` (0-4), `wifi`, `battery` (0-100), `charging` | 59 tall. The signal, wifi and battery glyphs are inline SVG, never text or an emoji. |
| `IOSNavBar` | `title`, `large`, `back`, `scheme`, `transparent`, `background`, `border` | 44 inline, 96 large. Slots `leading` and `trailing`. Title 17 semibold, or 34 bold when large. |
| `IOSTabBar` | `tabs` (`{ icon, label, active }[]`), `style` ('floating' \| 'classic'), `scheme` | Floating is the iOS 26 glass capsule, classic the older full width bar. Positioned at the bottom of the screen, so the screen must be a positioned box. |
| `IOSHomeIndicator` | `scheme`, `tint` | The 5 tall bar in its 34 tall area. |
| `IOSSheet` | `detent` ('medium' \| 'large' \| number), `radius`, `grabber`, `background`, `scheme` | Pinned to the bottom and both sides, round on top only. Default slot is the content, slot `header` sits above it. |
| `IOSListRow` | `title`, `subtitle`, `value`, `chevron`, `icon`, `iconColor`, `destructive`, `first`, `last` | At least 44 tall, 16 side padding, hairline inset to where the text starts. |
| `IOSGroupedList` | `header`, `footer`, `inset` | The rounded box the rows sit in, on the grouped background. It rounds the first and last row itself, so `first` and `last` are only needed on a row standing alone. |
| `IOSButton` | `label`, `variant` ('filled' \| 'tinted' \| 'plain' \| 'bordered'), `size` ('small' \| 'regular' \| 'large'), `icon`, `full`, `destructive`, `disabled` | 50 tall at large, 44 at regular, 34 at small. Pill radius. |

## Two things worth knowing before using them

**The tab bar has two looks and the caller picks.** On iOS 26 and later a native tab bar is a
floating glass capsule above the bottom edge; before that it is a full width bar on the edge.
Which one a screen shows depends on the OS the app is run on, not on anything in its code.
The capsule's measurements (about 188 wide for two tabs, 58 tall, 25 above the bottom, 94 a
tab) were taken off one screenshot of a real device, so they may be a little off.

**The chevrons are drawn here, not taken from the icon set.** A back button and a list row's
arrow are on almost every screen, so they must not depend on which symbols a project happens
to have. Everything else that takes a symbol name goes through `../base/Icon.astro`.
