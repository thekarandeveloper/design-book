# What breaks when you actually use this

Found while designing with the board, not while building it. Each one cost real time on a
real job, so each one is written as what happened, what it looked like, and what to do
until it is fixed.

The numbered items are the written-up ones, worst first. Under **Captured** at the bottom
are the raw ones, put there by `note.sh` from whatever repo the fault happened in, which
is how a fault gets recorded the moment it bites rather than being remembered later. One
gets cleared each weekend: promote it to a number, fix it, release.

## 1. A page's `<style>` stops being rebuilt

**The worst one.** Edit the markup in a `.designbook/pages/*.astro` file and the frame
updates. Edit that page's `<style>` block and the frame keeps drawing with the rules from
an earlier build. Nothing says so: there is no error, the check runs, the export runs, and
the picture is simply wrong.

Seen on 2026-11-15 in `Sakhi/02-Platforms/01-iOS`. A header row was changed from
`display: grid` to `display: flex` three times over; every render kept the grid, stacking
three controls vertically down the middle of the sheet. The markup changes in the same file
took effect on every save.

Does not fix it: saving again, `POST /__api/check`, `POST /__api/setup`, deleting
`.designbook/.working`, writing the frame id into `.designbook/.check`. Nothing did,
because nothing on that list was the problem.

**Fixed on 2026-11-21.** The board's pages are reached through a symlink, and Vite
resolves a module id to its real path. So Astro compiled the page under the symlink path
and was then asked for that page's `<style>` under the resolved path, which to it is a
different module: *"No cached compile metadata found for `01-p.astro?astro&type=style`.
The main Astro module should have compiled and filled the metadata first."* The page's own
styles were never compiled at all. The markup came from the page module, which was fine,
which is exactly why only the styles went stale and nothing anywhere said so.

`resolve.preserveSymlinks: true` in the board's Astro config. Both ids are then the same
id. Two tests in `app/tools/selftest.mjs` hold it: that a scoped style compiles, and that
editing it shows on the next render. Both fail without the line.

**The workaround is withdrawn.** Putting the rules in a part inside `<style is:global>`
was the only thing that worked, and it pushed every page's styles into shared global CSS,
which is the opposite of what scoped styles are for and made item 5 bite more often. Write
scoped styles on the page now.

## 2. A part's scoped styles cannot reach slotted markup

A part that takes `<slot name="header" />` cannot style what comes through the slot: the
slotted elements carry the page's scope id, not the part's, so `.hdr { ... }` in the part's
scoped block never matches. This is how Astro scoping works, so it is not a bug, but a
slot is the natural shape for this tool and the kit's docs do not mention it. The rules
have to be in `<style is:global>`, which then applies to every frame on the board.

## 3. A new page file draws nothing until something asks it to

Write a new `.astro` into `.designbook/pages/` and it is registered at once: it appears in
`/__api/studio`, it can be moved into a section, it checks and it exports. But its `poster`
stays `null`, and the board shows an empty frame, which reads as "my work is not showing".

`POST /__api/check` does **not** make a poster. Writing the frame ids into
`.designbook/.check` does. A frame made through `POST /__api/frame/new` gets one.

Suggested fix: give a page a poster the first time it compiles, however it was created.

## 4. `POST /__api/element` always reports `attrs: {}`

Every element comes back with an empty `attrs` map, including elements that plainly carry
`data-*` attributes in the source and are matched by `[data-...]` selectors at render time.
It makes the endpoint useless for the one thing it is reached for: finding out whether the
attribute a rule depends on is really on the element.

## 5. `is:global` in one page reaches every frame

A page that declares `<style is:global>:root { --x: 1 }</style>` changes every other frame
on the board, because the board serves one stylesheet. Expected from Astro, surprising on a
board where each frame is meant to be its own screen. One page's sheet position moved every
other page's sheet before this was understood.

Suggested fix: a line in the kit's docs, or scope a page's globals to that page's frame.

## 6. An export freezes every animation at its first frame

`POST /__api/export` screenshots the page with its CSS animations held at 0%, so motion
cannot be checked from a still: a loop that begins invisible, which is the natural way to
write a repeating glow, photographs as nothing at all. Negative `animation-delay` does not
move it either.

Until it is fixed, write a repeating animation so that **0% is the state worth seeing**,
and say in the hand-over that the motion has to be watched on the board rather than in the
picture. A one-frame-per-second capture, or honouring the delay, would make motion
reviewable the way layout already is.

## 7. A frame's poster is not rebuilt when its page changes, so a zoomed-out board shows the old design

The board draws a live frame when you are close enough to read it, and a cached **poster**
when you are not. The poster is not rebuilt when the page behind it changes. Zoom out and
you are looking at an earlier version of the whole board, with nothing to say so: the
titles are right, the sections are right, and the pictures are of work that was replaced
hours ago.

Seen on 2026-11-19 in `07-Dev-Kit`, on a board of 57 frames that had been regenerated
several times over an afternoon. **42 of the 57 posters were between one and two hours
older than the file they stand for.** Zoomed in, every frame was the current design; zoomed
out, most of the board was the design before it.

Measuring it takes one call, because `/__api/studio` gives each frame a `poster` as a
millisecond timestamp:

```sh
curl -s localhost:$(cat .designbook/.port)/__api/studio \
  | python3 -c 'import sys,json,pathlib
d=json.load(sys.stdin); root=pathlib.Path(".designbook")
for f in d["frames"]:
    src = root / f["file"]
    if src.exists() and f["poster"]/1000 < src.stat().st_mtime - 2:
        print(f["file"], int(src.stat().st_mtime - f["poster"]/1000), "s behind")'
```

Does not fix it: saving the page again, `POST /__api/check`, writing every frame id into
`.designbook/.check` and letting the check run to the end, `POST /__api/export` on the
frame, or waiting. A full check over all 57 frames left the count at exactly 42 before and
after, and it was still 42 after several minutes of sitting idle. Note that this
contradicts issue 3 above, which says `.designbook/.check` makes a poster: it makes one for
a frame that has **none**, and does not replace one that is out of date.

A few posters do refresh on their own, so something rebuilds them opportunistically. Over
the same afternoon the count moved from 46 stale to 42 and then stopped. Whatever that
trigger is, it is not reachable from the API.

Until it is fixed: **do not judge a board, and do not hand one over, from the zoomed-out
view.** Open the frames, or render the pages yourself and look at those. On a bulk
regeneration this matters most, because that is exactly when every poster goes stale at
once and the board looks like nothing you did had any effect.

**Fixed on 2026-11-21.** Two halves, and either one alone left it broken.

The server kept the picture. The watcher already knew which frames a changed file belongs
to, because it re-checks them, and `forgetPoster` already existed with the right comment
on it. Nothing called it except an explicit "draw it again" from the board. So the picture
on disk stayed, `/__api/studio` reported it as current, and that is what a zoomed-out
board drew. It is thrown away now at the moment the page changes, which is the same moment
the live frame is rebuilt.

The board never asked again. A frame asks for a picture only while it has none, and it
learned "it has none" once, when it was first drawn. A picture that went away afterwards
left the frame still holding the old one for as long as the board stayed open. It now
goes back to asking when the picture goes, and refetches when its time moves.

Held by `app/tools/livetest.mjs`, which starts a real board server against a throwaway
board, draws a picture, edits the page and checks the picture is gone. That one fails if
either half is put back.

This also settles the contradiction with item 3 noted above: nothing is special-cased for
a frame that has no picture any more, because a stale picture is now no picture.

## 8. Opening a board writes a starter page into a project that already has frames

Opening `AppKit.designbook` put a new `pages/01-screen.astro` into
`.designbook/pages/`, holding the stock template: a frame titled "A screen" with the
placeholder line "This is a page of the board, written in components." The board already
held 57 frames of real work. The file's timestamp is the moment the board was opened.

It is not listed in any section, so it lands in the first band and reads as a finished
screen somebody forgot about. It is also the only `.astro` among 57 `.html` pages, so a
generator that sweeps its own output by extension leaves it behind forever.

Deleting it through `POST /__api/frame/delete` works, but the id is `exp:01-screen` and
**not** the `pages/01-screen.astro` that `/__api/studio` prints as its `file`. Passing the
file path returns `{"error":"no such frame"}`, which reads as "this frame does not exist"
rather than "that is not how you name it".

**Fixed on 2026-11-21.** The guard asked whether *this pass* had converted anything, and
converting nothing is the normal case for a board whose frames were all written by hand. It
now asks whether the `pages/` folder is empty, which is what "a board with nothing on it"
was always meant to mean. `app/tools/setup.js`, and two tests in `app/tools/selftest.mjs`
hold it: a board that already has pages gets no starter, a board with none still gets one.

Still open, and the reason this item stays: a frame's `file` is not accepted where its id
is. `/__api/studio` hands out `pages/01-screen.astro`, `POST /__api/frame/delete` wants
`exp:01-screen`, and passing the first returns `{"error":"no such frame"}`, which reads as
"this frame does not exist" rather than "that is not how you name it".

## 9. The board's history committed nothing where any folder above it was a symlink

**Fixed on 2026-11-21, and it is why `designbook.saveHistory` exists.**

`history.js` works out the board's own paths relative to the repo root, and compares two
strings that are not the same string: `git rev-parse --show-toplevel` answers with every
symlink resolved, while the board holds the path the editor opened. Where any folder above
the repo is a link, and on macOS `/tmp` and `/var` always are, every one of the board's
paths came out starting with `../` and was dropped as "outside the repo".

What made it worse than a silent no-op: an empty pathspec does not mean "nothing" to git,
it means **everything**. `git status --porcelain --` with no paths answers with the whole
repo, so the board would have taken somebody's unrelated changed files as its own, and
`git add --` with no paths quietly adds nothing, so the commit then failed on whichever of
them git had never seen. Against the one promise at the top of that file: only the board's
own files, named explicitly, every time.

Both halves are fixed: the paths are resolved on both sides before they are compared, and
an empty pathspec now means the board does nothing at all rather than reaching for the
repo. Four tests in `app/tools/selftest.mjs` hold it, including one that fails if the
board ever commits a file that is not its own.

Found while making the history optional, not while using the board: on Karan's own paths
nothing above the repo is a link, so it never showed there.

---

Items 1 to 6 written 2026-11-15 from the Sakhi iOS board, while drawing three options for
the calendar sheet's month header. Items 7 and 8 written 2026-11-19 from the AppKit board
in `07-Dev-Kit`, while redrawing all 57 of its screens. Item 9 written 2026-11-21, found
while making the history optional.

## Captured

Written here by `note.sh` from whatever repo the board was being used in, so a fault is
recorded the moment it bites instead of being remembered later. Raw on purpose. Fixing one
means promoting it: give it a number above, say what it looked like and what did not fix
it, then delete it from here.
