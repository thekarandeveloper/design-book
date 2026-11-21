# Design Book

Your project's screens on one canvas, inside VS Code. A `.designbook` file is a board you
double-click like any other file; the `.designbook/` folder beside it holds what the board
shows.

The frames are the real thing. A page of your app is served by your own dev server and
redraws when you save; a screen written on the board is a real file in the repo. Nothing is
exported, nothing is kept in a cloud, nothing is a picture of your work.

It comes with a Claude skill, so an agent working in that repo already knows the board, the
components, the design system and the references, and can draw on the board itself.

---

## Getting started

### 1. Make a board

Install, then reload the window (`Cmd+Shift+P`, "Developer: Reload Window"). Press the
**Design Book** icon in the activity bar. It lists the git repos in your workspace: pick one
and it writes two things next to each other.

```
Plate.designbook        the board: its name, its sections, its frames
.designbook/            what the board shows
```

Press the file. The board opens.

The first scan reads the repo as it is. A Next, Astro, Vite or SvelteKit app becomes one
frame per route. An iOS or Android project becomes one frame per screen, drawn from the
code. Nothing is moved and nothing is rewritten.

### 2. Look around

| Where | What |
|---|---|
| Top left | Reload: read the repo again and redraw every frame |
| Top centre | **Screens**, **Design system**, **Moodboard**, and search |
| Top right | `+`, which adds this view's thing: a frame, a token, a reference |
| Bottom left | Fit: the whole board in the window |
| Bottom right | The board's menu: grid, bezel, device, history |

Scroll to pan, pinch or ctrl-scroll to zoom, `1` to fit, `0` for 100%. Click a frame to
select it; a bar appears along the bottom with what you can do to it. Double-click to go
*inside* a frame, where the clicks belong to the page itself, and Escape to come back out.

### 3. Your first frame

Press `+`. Pick a size something actually ships at (a phone, a desktop, an Instagram story,
A4) or type one. The frame lands next to whatever you had selected.

In a web project it is an Astro page in `.designbook/pages/`, so it can import your own
components and styles. Elsewhere it is plain HTML. Either way it declares its own size, so
a story designed at 1080 x 1920 stays 1080 x 1920.

### 4. Design it with Claude

Select the frame and press **Copy** in the bottom bar. What lands on your clipboard is a
prompt that names the frame, its file, the line, the element you had chosen and the tokens
behind it. Paste it to Claude and ask for the change.

Claude edits the file. The frame redraws as it saves. You never reload.

Two pages are the law for anything designed here, and the skill holds Claude to them:

- **Design system** is every colour the project declares, read out of its own stylesheet,
  and every face it loads. Click a colour to change it and the value is written back to the
  line that declared it. Right-click to copy its name, its `var(...)`, or its value.
- **Moodboard** is `.designbook/refs/`: drop in screenshots, videos, a link. Click one to
  copy its file name, which is how you point at it in a prompt. Right-click for copy or
  delete. The one line of note under a tile is a decision to follow, not a mood.

### 5. Devices

Select a frame and open the board menu, bottom right. **Bezel** draws the real device
around every frame that has one: the phone's band, its corners, its island; a MacBook with
Chrome's own window above the page. **Device** shows that frame's section on something
else, so a screen written for a phone can be looked at on a MacBook and back again.

### 6. History

Every change the board makes is committed, locally, to the branch you are already on, a few
seconds after you stop. Only the board's own files, named explicitly, and nothing is ever
fetched or pushed. Whatever you have staged elsewhere stays staged.

**History**, in the board menu, is that list. Going back writes the old files over the
current ones and commits on top, so nothing is reset and everything since is still there.

### 7. Export

**Export** in the frame's menu asks the questions that matter for a file somebody is about
to post or print: PNG, JPEG, WebP or PDF; 1x to 4x; the background as designed, white or
transparent; the frame or the whole page however tall it runs. It is drawn by the Chrome
already on your machine, the same engine that drew the board, so the file and the frame
agree. Files land in `.designbook/exports/`.

---

## The board file

```json
{
  "designbook": 1,
  "name": "Plate",
  "live": { "cwd": "../02-Web", "command": "npm run dev" },
  "sections": [
    { "id": "web", "name": "Website", "frames": ["live:/", "live:/foods/"] },
    { "id": "app", "name": "App", "frames": ["exp:12-above-goal"] }
  ],
  "frames": { "live:/": { "width": 1440, "height": 7990 } }
}
```

One section to start with: every frame in one line, however long it runs. Split it when you
want to, and a section lays its frames out left to right in the order listed. Drag a frame
by its title into another section; double-click a section's name to rename it. Each of those
rewrites this file, and editing the file by hand moves the board with no reload, which is how
Claude puts a set of variations into a section of its own.

A frame id is `live:<route>` for a page of the project, `exp:<file>` for a page written on
the board.

## What it reads

| Project | What becomes a frame |
|---|---|
| Next, Astro, Vite, SvelteKit, Remix | one per route, served by your dev server |
| iOS (SwiftUI) | one per screen, drawn from the code, with the real fonts and colours |
| Android (Compose) | the same |
| Any repo | `.designbook/pages/*.astro` and `*.html` |

Colours, fonts and spacing come from the project's own stylesheets and token files. A
native project is read from its source: the board does not build the app, open a simulator
or take screenshots of it.

## Two kinds of editing

Screens made on the board are edited visually: drag components in, reorder them, change
their props, and what is saved is that screen's file. Components are edited as code: click
one and its source opens in VS Code, and every frame using it updates at once.

That split is on purpose. Rewriting component source from visual edits scatters values
through the code, which is the drift a design system exists to prevent. Composition is safe
to do visually; a component's internals are not.

## For Claude, and for any agent

The board answers on an address it writes to `.designbook/.port` while it is open:

```sh
B=localhost:$(cat .designbook/.port)/__api

curl -s $B/studio          # every frame: its file, its size, what it is
curl -s $B/palette         # the colours, fonts and spacing the project really uses
curl -s $B/history         # the board's own commits

curl -s -X POST $B/frame/new     -d '{"title":"Story","width":1080,"height":1920}'
curl -s -X POST $B/frames/rename -d '{"frames":[{"page":"exp:03-story","title":"Story"}]}'
curl -s -X POST $B/frame/delete  -d '{"page":"exp:03-story"}'
curl -s -X POST $B/check         -d '{"page":"exp:03-story"}'
curl -s -X POST $B/export        -d '{"page":"exp:03-story","format":"png","scale":2}'
```

Nothing is destroyed by any of these: a deleted frame or reference goes to
`.designbook/.trash/`.

The skill ships with the extension and is installed into `~/.claude/skills/design-book/`.

## Keys

| | |
|---|---|
| `1` / `2` / `0` | fit the board, fit the frame, 100% |
| Escape | deselect, or leave a frame you went inside |
| Double-click a frame | go inside it |
| Drag a frame's title | move it to another section |
| Alt | measure between two things |
| Arrows | walk the elements of the chosen frame |

## What it does not do

It does not build your app, run your tests, or open a simulator. It does not rewrite your
components from a visual edit. It does not push anything anywhere. It does not keep a copy
of your work outside the repo.

## Install

From the Marketplace, or build it yourself:

```sh
./install.sh            # removes every older copy, then symlinks the current one
./publish.sh pack       # a .vsix to send somebody
```

Then reload the window.

---

Made by [Rachna Labs](https://www.rachnalabs.com).
