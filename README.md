# Design Book

A board is a file. `Rachna Labs.designbook` is the board, and the `.designbook/` folder beside it
holds everything the board shows. Opening the file opens the board, the way a design file
does in any other tool, so a board is a thing in the repo you double-click rather than a
setting hidden somewhere.

What is on the board is the project itself: its real pages, served live by the project's
own dev server, plus the pages written into `.designbook/pages/`. Edit a source file and the
frame redraws. Open several repos in one window and each board is its own tab.

It comes with its Claude skill, so an agent working in that repo already knows how the
board is laid out, which components exist, what the moodboard decided, and how to check
its own work.

## The board file

```json
{
  "designbook": 1,
  "name": "Rachna Labs",
  "live": { "cwd": "../Website", "command": "npm run dev" },
  "sections": [
    { "id": "live", "name": "The site, live", "frames": ["live:/", "live:/terms/"] },
    { "id": "hero", "name": "Hero ideas", "frames": ["exp:hero-split", "exp:hero-type-only"] }
  ],
  "frames": { "live:/": { "width": 1440, "height": 7990 } }
}
```

By default there is one section: every page in one horizontal line, however long it
gets, which is what a board of screens is for. The board is split only when you split it:
`+ section` draws a line across the whole board, and everything under that line belongs
to it. A board with one section has no line at all.

A section lays its frames out left to right in the order listed. `+ section` adds one,
drag a frame by its title into another band to move it, double-click a band's name to
rename it; each of those rewrites the board file. Edit the file instead and the board
follows without a reload, which is how Claude puts a set of variations it just made into
a section of its own.

A frame nobody has placed joins the first section, so a route added to the project lands
on the line that is already there. A frame id is `live:<route>` for a page of the project
and `exp:<file name>` for an experiment.

## New frames

The `+` in the bar makes a frame at a size something actually ships at: phones, tablets,
desktops, an Instagram post, a story, a YouTube thumbnail, a link preview, A4, or any
size you type. It lands next to the frame you had selected when you made it, and the
board goes to it; with nothing selected it goes last, where new work goes. In a project
the board compiles experiments for it is a page of that
project (`.designbook/pages/<name>.astro`), so it can import the project's own layouts and
components; elsewhere it is a plain HTML file. Either way it declares its own size, so
the frame is exactly that size and stays it: whatever is designed in a 1080 x 1920 story
is designed at 1080 x 1920, and nothing is reinterpreted later.

A frame made here is numbered as it is made, in its name and in its file: `03 Story or
reel`, `03-story-or-reel.astro`. Double-click its name on the board to rename it; the
file is renamed with it, the number stays, and every mention of it on the board moves
across. Select it and press Delete to throw it away: the file goes to `.designbook/.trash/`,
where it can be fished back out. A page of the project can be neither renamed nor deleted
here: its name is its route and its file is the project's.

Selecting a frame gives its size as a list, and the first thing in it is **Fit the
content**: the frame becomes as tall as whatever is in it, however long that is. It is a
standing choice, not a one-off measurement, so a screen that grows by a section grows
with it the next time the board hears that something changed. Choosing a size from the
list, or dragging the frame's edge, is choosing a size, and that stops it fitting.

The height comes from drawing the page in the same headless browser that checks and
exports a frame, at the address the board shows it at. It used to be done by copying the
page into a hidden iframe and asking it how tall it was, which cannot work for a page
that draws itself after it loads: served from somewhere else its own scripts never
settle, and the answer came back as one screenful. A page its dev server has never served
can take most of a minute to answer the first time, and the size says `measuring` while
it does.

**The `...` on a frame's name, the right button, or the panel** of a chosen frame: three
ways to the same things, because inside an editor's panel the right button belongs to
the editor and a board cannot rely on it. What they offer:
copy its name, export it, load the page again, fit the content, check it, rename it,
throw it away.

The menu opens on the **press** of the right button rather than on the contextmenu event
that usually follows it, because inside an editor's panel the board is a page inside a
page and the editor can take that event before the board ever sees it. The press arrives
either way. The `...` shows itself when the name is hovered or the frame is chosen, and
the panel carries the same row, so nothing lives only in a menu.

Because of that, a frame carries nothing but its name. A row of buttons over every frame
is a row you read past, and the board is for looking at the work.

A frame shows nothing but its name, and the number of things the last check found if
there were any.

## Export

`export` opens a dialog, because every one of these is a real decision about a file
somebody is about to post, print or send:

| | |
|---|---|
| Format | PNG, JPEG, WebP or PDF |
| Size | 1x to 4x, with the pixel size it comes to |
| Behind it | as designed, white, or transparent |
| Quality | for JPEG and WebP |
| Whole page | the page however tall it runs, instead of the frame |

It is drawn by puppeteer-core driving the Chrome already on the machine, which is the
same engine that drew what is on the board, so the file and the frame agree. Files land
in `.designbook/exports/` and are shown in Finder. A live page can take most of a minute,
because the slow part is the project's dev server rendering a page it has not seen.

## Opening it

Double-click any `.designbook` file. With none in the workspace yet, the Design Book icon in the
activity bar lists the git repos to make one in, or any folder you pick; the status bar at
the bottom reopens the board you were on.

## Install

```sh
./install.sh            # removes every older copy, then symlinks the current one
./install.sh uninstall
```

Then reload the window: `Cmd+Shift+P`, "Developer: Reload Window".

## Giving it to somebody else

Before it is on the Marketplace, the whole thing is one file. `./publish.sh pack` writes
`design-book-<version>.vsix` into the workspace's `.build/`, around 220 KB. Send that
file: in VS Code, Extensions, the `...` menu, **Install from VSIX**, or on the command
line `code --install-extension design-book-<version>.vsix`. Then reload the window.

What that machine needs: VS Code or Cursor, Node (the board runs on it), and Chrome if
frames are to be exported, checked or fitted. The first time a board is opened the
extension fetches what the board runs on, around 150 MB, once, with a notification
saying so. The Claude skill installs itself at the same time, so an agent on that
machine knows the rules without being told.

An update is another file, installed over the old one. From the Marketplace it is
automatic instead, which is the whole reason to publish it:
`00-Shared/03-Tools/runbooks/vscode-marketplace.md`.

## Finding something

One icon at the end of the bar, which opens into a box when it is pressed: a board is
for looking at the work, and a search box sits there empty most of the day. The names of frames come first,
because that is what anybody remembers; under them, what is written inside the frames,
found by reading the file behind each one. Pressing a result takes the board to that
frame and fits it in the window. Typing waits for a pause rather than asking on every
letter, and a frame found by its name is not listed twice.

## The tab

One floating bar over the work: Screens, Design system, Moodboard, then `+` for a new
frame. Components are not in it: you go there to take one rather than to look at it, so
they sit on their own button in the bottom right corner, opposite the board's own
controls. No sidebar, because a column of four words that never change costs width on
every screen.

Top right, on its own, is scan again. The repo keeps being worked on while the board is
open, and a screen somebody added is not on the board until something looks for it. That
button looks, and brings in whatever is new: a screen already on the board keeps the page
it has, edits and all.

There is no board switcher in the bar. A board is a file: another board is another
`.designbook` file, opened like any other file, and the tab already carries its name.

## What is detected and what is created

Nothing is moved. A repo keeps its files where they are.

| Found where it is | How |
|---|---|
| Pages the project serves | read from how the project is laid out: Astro, Next (both routers), Nuxt, SvelteKit, Remix, or the one address of a Vite app. Each one is a frame of the real page, drawn by the project's own dev server |
| Screens in the repo | every `.html`, and every `.jsx`, `.tsx`, `.vue` and `.svelte` that is a screen rather than a piece of one. Tests, stories, types, barrels, hooks and config are left out |
| Components | files in folders named components, ui, views, screens or design system (jsx, tsx, vue, svelte, swift, kt) |
| Design system | token and theme files, and any stylesheet declaring three or more custom properties, read whether it is written a line at a time or all on one |

A screen is drawn by whoever can draw it faithfully, and by nobody else.

A project that serves its own pages (Astro, Next, Nuxt, SvelteKit, Remix) draws them. A
**Next** project draws its own components too: one dev only route is written into its app
at `app/designbook/[...path]/`, holding a plain map of the screens found, and each frame
asks that project for one of them. What comes back is the real screen, with the project's
own Tailwind build, its fonts, its root layout and its aliases. Delete the folder to turn
it off; the board writes it again when it next scans, and it is added to `.gitignore`
because it is ours and not the project's.

A project with no routes in its files, a Vite app or a React library, has its screens
compiled by the board's own server and mounted in the frame, from where the file lies, so
saving one redraws it. Anything that can only be drawn by a compiler nobody here has is
left out, with the reason on the board rather than a frame full of guesswork.

A frame never grows a scrollbar. The route written into a Next project takes the bar
away for good, because a page that hides the bar and gives it back, which anything with
a preloader or a scroll lock does, changes the width every time it does, and a width
that changes changes the height, and the frame jumps. A frame showing its full content
also refuses to scroll at all, and is measured a few pixels over rather than under.

A screen drawn by the board is drawn in the project's own design: the stylesheets the
project puts behind every one of its screens, found where it says so in its entry file,
are imported through the same compiler the screen is, so a css module, an `@import` and
a preprocessor behave as they do in the project.

Scanning again also takes frames off. A page made from a file that has gone, or from one
the rules would not make a page from any more, goes to `.designbook/.trash` and out of
its section. A page written by hand is never touched: a page is only ever this board's
to retire if it carries the line saying which file it was made from.

A frame never shows an error page. A screen that will not compile, or that needs data
before it can draw, says so in one quiet line inside its own frame, and the whole reason
is in the log.

Sections follow the folders the screens came from: the deepest folder that holds more
than one frame becomes a section, a folder with a single screen in it joins the folder
above, and whatever is left over joins one section at the end. Twenty sections of one
frame is a list, not a board.

Created beside the repo's own files:

```
<repo>/<name>.designbook   the board: its sections, its frames, the project it watches
<repo>/.designbook/
  CLAUDE.md            the rules, for whoever writes the next screen
  pages/*.json         screens made here, edited visually
  pages/*.astro        experiments: real pages of the project
  refs/                moodboard files, anything dropped in
  refs.json            one note per reference
  studio.json          GENERATED: the index an agent reads
  tokens.css, components.css, components/, catalog.jsx   optional overrides
```

A board from before this was called Design Book opens as it is: its `.design` or
`.canvas` folder is renamed to `.designbook`, the board file is renamed with it, and the
two dev routes in the project are rewritten under the new name and the old ones removed.
Nothing inside is touched, so the sections, the frame sizes, the pages and the references
are exactly as they were. The skill moves too: the old `~/.claude/skills/design` goes if
it is the one this wrote.

A board set up by an older version keeps its name and its frame sizes in
`studio.config.json` and `canvas.json`; both are absorbed into the board file the first
time it opens, and removed, so there is one place to look rather than three.

Nothing is installed in the repo. The board's app, React, Puck and the default component
kit all live inside this extension.

## The two kinds of editing

**Screens made here are edited visually.** Open one and drag components in, reorder them,
change their props. What is saved is that screen's JSON file. No code is rewritten.

**Components are edited as code.** Click a tile, or Option-click a component on the
board, and its source opens in VS Code. Change it and every screen on the board updates
at once, with no reload.

That split is deliberate. Tools that rewrite component source from visual edits scatter
values through the code, which is the drift a design system exists to prevent.
Composition is safe to do visually; a component's internals are not.

## Keys

Pinch or ctrl-wheel to zoom, drag the background to pan, drag a frame's title to move it
into a section, `1` to fit, `2` to zoom to the selected frame, `0` for 100%, Escape to
deselect. Scrolling pans the board; over the frame you have chosen, if its page is taller than
it, the wheel scrolls the page inside instead. `S` cuts a region, the arrows walk up and down
the elements of a chosen frame, Alt measures.

**Double-click a frame to go inside it.** A frame is a page running in an iframe, and an
iframe takes the pointer or it does not: while it has it, every click, every scroll and
the right button belong to that page and the board never hears them. So going in is
something you do on purpose, and Escape comes back out. Choosing a frame with one click
still gives you its panel, its menu and its handles.

How much a label says depends on the zoom. Under 22% a frame is a shape and only the
section names show; from 22% the frame's name comes back; from 45% its route and its size
come back too. The frame you have selected says everything at any zoom. A section's name
is tucked into the left edge of the viewport, flush against it, and held there while any
part of that section is on screen, so panning never leaves you looking at frames that
belong to nothing and never leaves a name floating over the work.

## Keeping the board in step with the default branch

The board's files are shared work, so they live on the repo's default branch, whatever branch
you are on. A pill in the bar says where that stands and is the one place to turn it on (it
asks once per repo, on each machine, and does nothing before that). From then on, a few
seconds after you stop changing something, it fetches origin, brings in what others did,
merges where you both changed one file, commits and pushes. Only the board's files go:
`*.designbook`, `pages/`, `refs/`, `parts/`, `gen/`, `refs.json`.

How, without a second working copy: the commit is made from git's plumbing. A temporary
index is loaded with origin's tree, the changed files are written into it, and that is
committed with origin's commit as its parent, then pushed. Nothing is checked out, so it
costs no disk, does not care how big the repo is, and the checkout you work in is never
involved. It never pushes your branch, and never pushes the default branch as it is on your
machine, which may carry commits you have not published. It never forces: a refused push is
fetched, merged and tried again, and then said out loud (a protected branch shows the
server's own words).

**Nobody's work is lost, in any case.** Nothing in it deletes a file. A file that is to be
replaced or taken away is first moved to `.designbook/.trash/sync/<time>/`, and nothing
empties that folder. A file is only overwritten if it is still exactly what was compared a
moment ago, so an edit made while it works is never written over. A deletion is shared only
if the board did it (the delete in the menu); a file that vanished any other way, by a git
reset or a checkout or a wiped folder, is put back. A change to more than ten files at once,
which is what a reset or a checkout of an old branch looks like and not what drawing looks
like, is held in the bar with the list, with "Send them" and "Put them back". Two people
changing the same lines of one file is never settled for them: both are kept and the pill
asks, with "Keep mine" and "Take theirs", and what is not chosen goes to the trash.

While an agent is working (`.designbook/.working`), others' changes still come in and nothing
of yours goes out until it finishes, so nobody receives half a page. Files over 8 MB are left
out and said so. The board's files are also excluded from `git status` on this machine only,
in the repo's own `.git/info/exclude`, so they do not look like changes on a branch of your own.

## Native projects are read from their code

A SwiftUI or Compose design system lives in Swift and Kotlin, not in a stylesheet, so it is
read from there. The generated section of `.designbook/CLAUDE.md` says what the code decides:
each colour role resolved to hex in light and dark (`theme.primary` is `#2E7BF6` and
`#4A82D6`, found by following `brand.light.level5` and `brand.dark.level8` to their hex),
the type scale as the code sets it, spacing, radii, opacity, elevation and timings, and the
colours in asset catalogues. A name that points at another constant is followed, so the
iOS `DS.Spacing.cardHorizontal` comes out as the 18 it is defined as in the shared Kotlin.
It is rebuilt when those files change, which is what keeps it from being older than the
code, and it replaces reading three or four token files before each screen.

It also lists the modes the app opens in: every launch argument and variable it reads, and
the line that reads it. An app often opens on a different screen depending on a flag or a
missing key (a catalogue when no backend is configured, onboarding when nobody is signed in),
and which one is "the app" has to be settled before anything is drawn. Pages of the board
have their scrollbars taken away, since a frame is a picture of a screen: the page still
scrolls, but a bar no longer takes its own width and makes the page wider than its frame.

A page built from code says which code (`<meta name="designbook-source" content="a.swift,b.swift">`),
and when any of those files is newer than the page the frame is marked "Code changed".

## Choosing things inside a frame

Choose a frame, and hover anything on it: it is outlined with its name and its size. Click
to choose it, shift-click to add up to six (they are numbered), the arrows walk up and down
the tree, Escape lets go. Hold Alt over another element and the distance to the chosen one
is drawn across the gap. `S` cuts a region of the frame instead of an element, which is the
way to pick something on a screen that has no elements to pick.

Right-click an element and the menu is about it: a picture of it on the clipboard (alone, or
with the frame around it and a box on it), the same as a prompt (where it is, what it is,
the file and line it was written on, what it looks like, what is wrong with it), drawing on
the picture first, its states side by side (hover, focus, pressed, disabled), the same
element at 390, 768 and 1440, and a note to remember how it looks now. Remembering also
takes a snapshot of the project's files; later the picture before and the picture now sit
side by side, with the files that changed between them, and one button puts those files
back. Nothing is committed and nothing is deleted, and putting them back can be undone.

The panel beside the frame's own has the picture, the file and line, the type and colour
and spacing with the project's own names for them (`--brand`, not `#2e7bf6`), what its check
found, one-line asks to start from, a note, and a reference picture to put beside it. It
also says which model the change needs. A colour or a line of text goes to `design-edit`
on the smallest one, a change to a component to `design-build` on the middle one, and the
prompt names the agent, so the work goes there without anybody switching. Both agents are
installed in `~/.claude/agents/` and hand back two lines.

**How fast it is, and why.** A page of the board's own is on the board's origin, so it is read
in place: the same functions run in its iframe and the first outline is there in about 130 ms,
with no browser started. A frame running a project's own dev server is another origin and has to
be read by the headless browser, which takes as long as the site takes to draw itself (a loader
counts), so that page is opened in the background once the pointer has rested on its frame for a
third of a second: after the pointer has been on it for nine seconds the first outline took 2.2 s,
and from cold, on a site with a heavy loader, it took 19 s.

How it works, because it matters: a frame running a project's own dev server is another
origin and cannot be read from the board. So the headless browser opens the same address at
the same width, waits for it to stop moving (a loader is not the page), reads every element
and keeps the page open for a couple of minutes. What it finds is what is on the board
because it is the same engine, and nothing is written into the project. The file and line
come from the framework's own trail (React 19 keeps the stack of the call that made each
element, Astro writes the file onto it, Svelte and Vue keep a location) turned into the
file somebody wrote by the bundle's source map. It was checked against a real Next 16
project: the link named "Work" resolves to the line it is written on.

A page that is taller than its frame scrolls when you choose the frame and use the wheel.
One on another origin cannot be asked where it is scrolled to, so the board says so and
offers to put it back at the top, or to show the full content, where everything can be
chosen. A screen that scrolls down is what a screen is for; one that is wider than its frame
gets a mark on its name and a line in its check naming what is wider.

## Claude

Two halves, and the first matters more.

**Automatic.** Every time a board is opened, the board checks the `CLAUDE.md` at the
root of the repo the board sits in, and writes its block there if it is missing or out of
date. The block is between `<!-- design-book:start -->` markers, so it is replaced in
place rather than stacked up, and nothing else in the file is touched. It says where the
board and its folder are, that a component is taken before one is written, that a value
comes from the design system rather than from thin air, that a reference carries a
decision, what an experiment is and that three variations go in a section of their own,
and that a page of the project is never redrawn inside `.designbook/`. It points at
`.designbook/CLAUDE.md` for what is on the board right now and `.designbook/studio.json` for the
index.
Every Claude session in that repo therefore starts already knowing the design system,
the components the repo has and the references with their notes. Nothing is explained
twice, in this session or any later one.

**The arrow.** Every screen on the board has a `-> Claude` button. Pressing it opens
Claude Code, puts that screen's file along with the rules and the index into its input
as @-mentions, and focuses the input. Whatever is typed next is about that screen with
every reference in reach.

It works through Claude Code's own commands (`sidebar.open`, `insertAtMention`,
`focus`). `insertAtMention` takes no arguments and mentions whatever file is in the
active editor, so each reference is sent by opening its file and running it. Without the
Claude Code extension installed it falls back to writing `.designbook/task.md` and starting
the CLI on it.

`.designbook/studio.json` is around 2,500 tokens: the kit's components with their props,
plus the repo's own components and token files grouped by folder. It is read instead of
opening the files.

A screen comes back as 60 to 120 lines of JSON that cannot break the design system,
instead of several hundred lines of hand-written markup that can.

## Where things are

One file, one job, so a change has one place to go.

```
extension.js            the wiring: commands, the sidebar, the status bar
skills/design-book/SKILL.md  the Claude skill, installed into ~/.claude/skills
src/state.js            what every part shares: the log, the servers, the tabs
src/boards.js           finding a board, and making the two halves of one
src/server.js           the board server for a board, and talking to it
src/board-editor.js     the board as an editor tab, and the webview it holds
src/claude.js           the pointer in CLAUDE.md, and the arrow on a frame

app/src/studio/
  App.jsx               the bar, the views, the board picker
  Board.jsx             the board: zoom, pan, selection, sections, dragging
  PagesBoard.jsx        what is on the board: the frames, their layout, their actions
  ExportDialog.jsx      the export options
  Gallery.jsx           components, as tiles
  SystemPage.jsx        the design system: the palette and the tokens
  Moodboard.jsx         references
  Editor.jsx            the visual editor for a screen the board owns
  frames.js             the sizes a new frame can be made at
  api.js                every call to the board server, in one place
  shell.css             the studio's own chrome. Every class starts with `st-`

app/tools/
  studio-plugin.js      the dev server: the API, the catalog, the watcher
  board.js              the `.designbook` document: its sections and its frames
  live.js               the project's own dev server, found or started
  project.js            what the repo has: components and stylesheets
  palette.js            every colour, font and icon the repo actually uses
  preview-route.js      the two dev-only routes written into the project
  rules.js              `.designbook/CLAUDE.md`, written from live data
  export.js             a frame as a PNG, JPEG, WebP or PDF
```

## Keeping it quick

Three things cost more than everything else put together, and each one is now measured
rather than assumed.

**Moving the board is one transform.** Pan and zoom are not React state: the move is
written straight onto the layer that holds the frames, and React is told once a drawn
frame, for the labels and the readout. A trackpad sends around a hundred wheel events a
second, and they are gathered up and applied once per frame. What a wheel, a notch and a
pinch each mean is worked out against the numbers Figma uses, so a mouse and a trackpad
both feel right. Measured over a pan of a hundred and twenty events on a board of
eighty frames: 0.26s of work before, 0.17s after; a zoom of sixty, 0.15s before, 0.05s
after.

**A name nobody can see is not drawn.** Labels outside the window are skipped, so the
cost of moving a board of eighty frames is the cost of the dozen you are looking at.

**A frame that is far away goes to sleep.** A live frame is a whole application running
in an iframe, and a board of eighty is eighty of them at once. A frame wakes half a
screen before it is reached and sleeps five seconds after it leaves; the one you have
chosen never sleeps. Measured on a board of sixty frames that keep drawing: sixty
iframes alive and twenty percent of a core while nobody touched it, against six alive
and seven percent after.

**Frames are pictures until they are worth running.** Zoomed out to see the whole board, a
frame is a few hundred pixels across and running it would be running eighty applications to
draw eighty thumbnails. So a frame is one of three things, worked out from where the board is
looking and not asked of the browser: running (in view, big enough, and one of six), a
picture of itself (in view but too small, or beyond the six), or nothing at all (out of
view, not in the page). The picture is drawn once by the headless browser and kept outside
the repo, and it is also what a frame shows while its page loads, so waking one never
flashes white. This is how tldraw works out what to render, and how Figma and Framer show a
frame that is too small to read. Measured on a board of fourteen: fourteen iframes at Fit,
none after; two at 100%, and a frame five seconds out of view is gone.

## What the board does not do

Four things it used to do, which cost most of its speed and all of its stillness:

It watched the two files it writes itself, `.designbook/studio.json` and `.designbook/CLAUDE.md`.
Every rebuild wrote them, which started another rebuild, which walked the project, read
every colour in it, asked the dev server about every route and told every window that
something had changed. Several times a second, for as long as a board was open. Now it
ignores its own output, and only a change in the project itself makes it look at the
project again.

It measured every frame whose height nobody had chosen, all of them, in title order,
each one a real page load. Now it measures only the frames you can see, one at a time,
and a height it has worked out is saved, so it never does it twice.

A frame that fits its content measured itself because of the last measurement. The
height went into the board file, the board file is watched, every window was told
something had changed, and something changed was the reason to measure again; a page
with an animation on it never came back the same twice, so it never stopped. Now a
measurement is never the reason for the next one: the board does not hear its own saves,
a fit frame measures again only when the project itself has changed since it last did
and not for another half minute after that, and a height within 24 pixels, or one per
cent of a long page, is a height it already has.

It asked whether a page was being served and then loaded it, one after the other, so a
page that takes a dev server half a minute took a minute. Now it loads and asks at the
same time, behind the waiting card, and an answer of yes is remembered for ten minutes.

## More than one board at once

Each board gets its own server, and two tabs on the same board share it. A board whose
tab is closed keeps its server for a minute, so a window reload costs nothing, and then
it is stopped. Four servers is the limit: starting a fifth stops whichever of the idle
ones has been idle longest. Nothing is left running after the window closes.

One process for every board, rather than one each, would be better still, and it is a
real piece of work: the dev server would need a registry of boards, a per-board
component catalog as a separate virtual module, and every route namespaced by board.

## The Claude skill comes with it

The skill is the half of this that lives outside the editor: it is what makes an agent
build the right thing on a board rather than guess at it. It ships inside the extension
at `skills/design-book/SKILL.md` and is written to `~/.claude/skills/design-book/SKILL.md` when the
extension starts, so installing the extension installs the skill, and an update to the
extension updates it.

A skill somebody has edited is never overwritten: the version last written is remembered
beside it, and an edited one is left exactly as it is with the new one put next to it as
`SKILL.design-book.md`. "Design Book: Reinstall the Claude Skill" puts ours back on purpose.

## How it is put together

`extension.js` is the tree, the custom editor for `.designbook` files and a small HTTP client,
in plain JavaScript with no dependencies. `app/` is the board: Vite, React and Puck, with its own `node_modules`
installed once here. One Vite server runs per repo, rooted at the app with that repo and
its `.designbook` folder passed in, which is why no repo needs its own install.
`templates/designbook/` is what a new board is copied from.

The tab is one iframe over that server, relaying messages both ways: a webview cannot
host a Vite app, because its module graph, its HMR socket and its routing need a real
origin. The custom editor is read-only as far as VS Code is concerned, because the board
writes itself through the board server and there is never a dirty buffer to reconcile.
