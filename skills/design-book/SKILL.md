---
name: design-book
description: Design on a Design Book board (a .designbook file plus the .designbook folder beside it). Change the page a frame points at when asked to design or fix it, or make three genuinely different versions when options are asked for. Works for web, iOS and Android projects, reusing the app's existing components and real measurements. Use when the user says "in design", "design mein", "design book mein", "in the book", "in canvas", "canvas mein", points at a frame or a page and asks to design or change it, gives a reference image, asks for options or versions of a screen, hero, section, component or layout, or wants to try a design before building it in the app.
---

# Design Book

The board shows the project's own pages. Designing here is changing those pages, and the
frame redraws as the file is saved.

## Design in the frame you were given, and only that one

One frame was named; one file changes. `.designbook/CLAUDE.md` lists every frame with the
file behind it, and for a page of the project that is the project's own source.

## Change what was asked, and leave the rest of the file alone

A heading, a colour, one card: change those lines. Do not rewrite a page to change a
line in it. Rewriting costs more than the work, loses whatever else was in the file, and
makes the diff unreadable, which is the thing a frame is for.

Read what you need and no more: the frame's own file, not the ones beside it; the index
when you need a component you have not used yet, not before. A file you have just
written is already known, so do not read it back.

## Three versions, but only when versions are asked for

"Options", "variations", "versions", "ideas", "ways to do this", or a number: then make
**three**, unless a number is given. Not three shades of one idea: three different
answers to the same question. If you cannot say in one sentence how each differs in
approach, they are not three versions yet.

A useful spread is one that is conservative, one that reorganises, and one that removes
something. For a hero: the familiar centred one, a split that shows the work beside the
sentence, and one with nothing but type. For a list: rows, cards, and a table.

Name each file after its idea, never after its number: `hero-split`, `hero-centred`,
`hero-type-only`. Put the set in a section of its own, so they are compared against each
other rather than against the rest of the board.

## Before writing anything

1. Find the board: a `*.designbook` file, with a `.designbook/` folder beside it. The file is the
   board (its name, its sections, its frames, the project it watches); the folder holds
   everything the board shows. If there is neither, say so and point at the Design icon in
   the activity bar, which makes both.
2. **Read `.designbook/CLAUDE.md`.** It is regenerated whenever the project changes, so it is
   never stale: every colour the app actually uses with counts, its fonts, its icon
   packages, its declared tokens, and every page and component with the file behind each.
   It is the smaller of the two files and it names everything, so it comes first.
   `.designbook/studio.json` is the same list with each component's props; read it when you
   are about to use a component, not as a matter of course.
3. **Read the moodboard.** `.designbook/refs/` holds the references and `.designbook/refs.json`
   the one line of note under each. A note is a decision to follow, not a mood. For a
   post or a poster this comes first, before the design system.
4. **Open the app's existing components before inventing anything.** Whatever the
   platform, the measurements you need are already written down somewhere: a button's
   height, a card's corner radius, a row's padding. Take them.

## It must not look like a machine made it

Unless the ask says otherwise in so many words: no em dashes, no outline or stroke
illustration, no thin-line icon sets as decoration, no gradient mesh, no glow, no
floating 3D blobs, no abstract swooshes. Solid shapes, real type, the project's own
words and pictures. Where there is nothing to show, show less rather than filling the
frame with something invented.

## What leads depends on the frame

**A screen** is a phone, tablet or desktop frame, or a page of the project. The design
system leads: its components, its tokens, its spacing and its type, as `.designbook/CLAUDE.md`
lists them. Nothing invented.

**A post, a thumbnail or a poster** is a frame made at a fixed size. The moodboard leads:
read `.designbook/refs/` and the note under each reference in `.designbook/refs.json` before
anything else, and follow it. From the design system take the colours, and only the
colours, so it still looks like the company. Its type, its spacing and its layout are the
post's own, because a post that obeys an app's layout rules is a bad post.

## Anything you write twice becomes a piece

A badge, a stat block, a quote card, a footer line: the moment a thing is worth using
again, it goes in `.designbook/parts/` as its own file, with one line at the top saying what
it is, and the page imports it.

```astro
---
// A stat: one number and what it counts.
const { value, label } = Astro.props;
---
<div class="stat"><b>{value}</b><span>{label}</span></div>
```

```astro
import Stat from '/.designbook/parts/Stat.astro';
```

The list of what is already there is in `.designbook/CLAUDE.md` under "Pieces already made",
with a line on each. **Read it before writing anything.** The second post should be a
page of imports, not a page of new code: it is faster to write, it is consistent with
the first one, and it costs a fraction of the tokens.

## Reuse what the app has, whatever it is written in

**This is the first priority, before anything else.** The board's Components view and
`.designbook/studio.json` list every component the project already has, with its props and
its real path. Build out of those. Write a new component only when nothing in that list
can do the job, and say so when you do.

| The app is | Where its components are | What to do |
|---|---|---|
| Astro, Next, Vue, Svelte | `src/components`, `app`, `components` | Import them. A page on the board is a real page of the project. |
| SwiftUI | `*/Views`, `*/DesignSystem`, `*/Components` | Read the real values out of the Swift and rebuild the screen in HTML with those numbers. |
| Compose | `*/ui`, `*/designsystem`, `*/components` | The same: read the dp and the shapes, then draw in HTML. |

For a web project, write the page in the project's own language so it compiles with the
project's own dev server. For a native project the board cannot run Swift or Kotlin, so
the page is HTML, and its value comes from using the app's **real numbers** rather than
invented ones.

## Units: pt, dp and px are the same number here

The board is a browser, so everything is CSS pixels. The conversion that matters is that
at 1x **1pt (iOS) = 1dp (Android) = 1 CSS px**. So a 44pt button is `height: 44px`, and a
16dp margin is `margin: 16px`. Do not scale anything by 2 or 3: that is device pixels,
which is not what a design is specified in.

What does not convert is type, and that is deliberate:

- iOS body is **17pt**, secondary 15pt, caption 13pt. That is what Apple's text styles are.
- Android body is **14sp**, Material's scale.
- Web body is **16px**.

Do not unify them. Forcing one number on both platforms makes one of them wrong on every
screen in a way its own users feel without being able to name.

Two more that are worth getting right: a touch target is **44pt on iOS** and **48dp on
Android**, and a screen's side margin is whatever the app already uses, which is in the
tokens.

Frame sizes to use, set per file:

| | width | height |
|---|---|---|
| iPhone | 393 | 852 |
| Android phone | 360 | 800 |
| iPad | 834 | 1112 |
| Desktop web | 1440 | 900 |

## Writing a new page on the board

Only when a new page is wanted: a version to compare, or a frame that does not exist in
the project yet. One file each, in `.designbook/pages/`.

**A web project**, in its own language, so it can import the real thing:

```astro
---
// designbook: title=Hero, split | width=1440 | height=900 | group=hero
import BaseLayout from '/src/layouts/BaseLayout.astro';
---
<BaseLayout title="Hero, split">
  <section class="container-x">...</section>
</BaseLayout>
```

**A native screen**, as a standalone HTML file with the app's real measurements:

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>Today, cards</title>
<meta name="designbook-width" content="393">
<meta name="designbook-height" content="852">
<meta name="designbook-group" content="today">
<style>
  /* 17px here is DS.Typography.body, which is 17pt on the device. */
</style>
</head><body>...</body></html>
```

The `designbook:` comment or the `designbook-*` metas set the frame. Versions of one idea share a
`group` so the board puts them side by side. Write any new CSS inline: a page made here
is self-contained, so deleting it leaves nothing behind.

## Put them in a section of their own

Only when you made a set. A board is one horizontal line until somebody splits it, and a
set of versions is worth splitting out: add a section for it and list its frames in the
board file, so they are compared against each other rather than against the rest of the
board:

```json
"sections": [
  { "id": "hero", "name": "Hero ideas",
    "frames": ["exp:hero-split", "exp:hero-centred", "exp:hero-type-only"] }
]
```

A frame's id is `exp:<file name without its extension>` for a page made here and
`live:<route>` for a page of the project. A frame you do not list still appears, in the
first section.

## A frame at a size

A frame that is not a page of the app, a social post or a thumbnail for instance, is made
at the size it ships at. The `+` in the board's bar does this, and so can you.

In a project the board compiles pages for, write a page of that project and
declare the size in its designbook comment, so it can import the project's own components.
Import them from the project's root, never relative to the page: the design folder may
live outside the project, and `../../src/...` walks out of it and breaks every page on
the board at once.

```astro
---
// designbook: title=Story | width=1080 | height=1920
import BaseLayout from '/src/layouts/BaseLayout.astro';
---
```

Anywhere else, write an HTML file in `.designbook/pages/` with the same two numbers as metas
(`<meta name="designbook-width" content="1080">`).

Design to that size, and keep what you draw inside it. A frame made at a chosen size
keeps that size and crops whatever does not fit, because it would be cropped wherever it
was published too. Only a screen grows: a phone, a tablet or a desktop page carries
`grow=yes` and gets taller as its content does. A post, a thumbnail or a poster does
not. Its id on the board is `exp:<file name>` for a page of the
project and `canvas:<file name>` for an HTML one.

## Ask the board instead of working it out

The board answers on an address it writes into `.designbook/.port` while it is open. One
line does what reading and editing several files would:

```sh
B=localhost:$(cat .designbook/.port)/__api

curl -s $B/studio                       # every frame, its file, its size, what it is
curl -s $B/board                        # the board document: sections, frames, live
curl -s $B/project                      # the repo: components, stylesheets, live url
curl -s $B/palette                      # the colours, fonts and spacing it really uses

curl -s -X POST $B/frame/new    -H 'Content-Type: application/json' -d '{"title":"Story","width":1080,"height":1920}'
curl -s -X POST $B/frame/rename -H 'Content-Type: application/json' -d '{"page":"pages/03-story.astro","title":"Story, wide"}'
curl -s -X POST $B/frame/delete -H 'Content-Type: application/json' -d '{"page":"pages/03-story.astro"}'
curl -s -X POST $B/check        -H 'Content-Type: application/json' -d '{"page":"exp:03-story"}'
curl -s -X POST $B/measure      -H 'Content-Type: application/json' -d '{"url":"/@studio/pages/03-story.html","width":1080}'
curl -s -X POST $B/export       -H 'Content-Type: application/json' -d '{"page":"exp:03-story","format":"png","scale":2}'
curl -s -X POST $B/setup        -H 'Content-Type: application/json' -d '{}'
```

No `.port` file, or nothing answering on it, means no board is open on that repo: then
the files below are the way, and everything still works.
Making a frame, renaming one, throwing one away and asking for a check are all one call:
do not write the page file by hand to make a frame, and do not read `studio.json` to
learn what a frame is called.

## Say which frame you are working on

Before you change or make anything, write the frame ids you are about to work on, one
per line, and bring the board up:

```sh
printf '%s\n' exp:03-story-or-reel > .designbook/.working
echo pages > .designbook/.open
```

Those frames show that they are being designed, with an animation, instead of showing
the old design as though nothing were happening. When you are done:

```sh
rm -f .designbook/.working
```

Each of those frames then loads what you made. Remove the file even when the work failed,
or a frame is left spinning forever. A frame's id is in `.designbook/CLAUDE.md` beside its
name.

## The board looks it over by itself

A few seconds after a frame's file stops changing, the board draws the page and
measures it, and again when you delete `.designbook/.working`. You do not have to ask. To
ask anyway, for a frame you did not touch:

```sh
printf '%s\n' exp:03-story-or-reel > .designbook/.check
```

The board draws each page and measures what is actually on it: text that cannot be read
against what is behind it, anything cut off at an edge, text too small, a tap target
under 44, an image that did not load, a page wider than its frame. While it looks, the
frame shows a line sweeping down it; when it is done the board goes back to that frame
and fits it in the window, and what was found is listed in the panel for that frame and
kept in `.designbook/checks.json`.

Read `.designbook/checks.json` yourself and fix what it found, in the same file, then ask for
the check again. Do not hand over a design with a contrast or a cut-off problem still in
it.

## Finish

The board is already up, the frames have loaded what you made, and the check is clean.
Say in one line what changed, and name anything the check found that you decided to
leave. If you made more than one version, say in one
line what each is trying, so there is something to choose between.

## Bringing a frame into the project

A page of the project is already in the project: you changed its own file, and there is
nothing to move. Only a frame the board owns, something in `.designbook/pages/`, is
outside it.

Moving one in is three steps, in this order:

1. Read the project's own pages for the shape they use: its layout, its components, the
   folder its routes live in. `curl -s $B/project` lists them.
2. Write the screen as a real page of the project, in that folder, out of those
   components. Not a copy of the experiment's markup: the experiment was how it was
   decided, the project's own components are how it ships.
3. Scan again (`curl -s -X POST $B/setup -d '{}'`). The new page comes onto the board as
   a live frame, drawn by the project itself, and the experiment it came from can be
   thrown away: `curl -s -X POST $B/frame/delete -d '{"page":"pages/03-story.astro"}'`.

The board then shows the real thing, and the trash holds what it came from.

## When one version wins

Put it into the project's own page, which `.designbook/CLAUDE.md` names, following the
project's own patterns and its own components. Then ask whether to delete the ones that
lost.

**Change what was asked for, and nothing else.** A page that was pointed at is changed
where it lives. Versions made to compare are separate pages until one is chosen. A
component, a token, or a page nobody mentioned is not touched on the way past: say what
else you think should change, and let that be decided.
