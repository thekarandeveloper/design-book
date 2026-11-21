#!/usr/bin/env bash
# What the board did wrong, written down where it will be read again.
#
# Design Book is used from every repo on this machine, and its faults show up there, not
# here. Whoever notices one runs this, from wherever they are:
#
#   "$HOME/.designbook-note" "the frame kept drawing the old styles after three saves"
#   "$HOME/.designbook-note" --file pages/03-month.astro "the poster never refreshed"
#
# It appends to KNOWN-ISSUES.md under "Captured", with the date, the version and the repo
# filled in, and never rewrites a line that is already there. The same sentence twice
# records that it happened again rather than writing a second entry, because what bites
# twice is what to fix first.
#
# The symlink is made by install.sh and again whenever a board opens, so the command above
# works from any folder without anybody knowing where this repo lives.
set -euo pipefail

# This is reached through ~/.designbook-note, so the script has to follow the link back
# to the repo rather than trusting the folder it was called from.
src="${BASH_SOURCE[0]}"
while [ -L "$src" ]; do
  dir="$(cd -P "$(dirname "$src")" && pwd)"
  src="$(readlink "$src")"
  case "$src" in /*) ;; *) src="$dir/$src" ;; esac
done
here="$(cd -P "$(dirname "$src")" && pwd)"
issues="$here/KNOWN-ISSUES.md"

file=""
while [ $# -gt 0 ]; do
  case "$1" in
    --file) file="${2:-}"; shift 2 ;;
    -h|--help)
      echo 'usage: note.sh [--file <path>] "what happened"' >&2
      exit 0 ;;
    *) break ;;
  esac
done

what="${*:-}"
[ -n "$what" ] || { echo 'usage: note.sh [--file <path>] "what happened"' >&2; exit 2; }

version="$(node -p "require('$here/package.json').version" 2>/dev/null || echo '?')"

# Where it happened, as a path anyone can read. The folder the session is in, not the git
# root: a board usually sits in a subfolder of a repo, and "00-Shared" instead of
# "00-Shared/07-Dev-Kit" is too coarse to find the board again on a Saturday. This file is
# public, so $HOME is written as ~ rather than as somebody's home folder.
where="$(pwd)"
case "$where" in "$HOME"/*) where="~${where#"$HOME"}" ;; esac

python3 - "$issues" "$what" "$where" "$version" "$file" <<'PY'
import datetime, fcntl, pathlib, re, sys

issues, what, where, version, file = (sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
path = pathlib.Path(issues)
today = datetime.date.today().isoformat()

HEAD = "## Captured"

# One sentence, one entry. Two sessions hitting the same fault in two repos is the same
# fault, so the text alone is the key: case and spacing do not make it a different one.
key = lambda s: re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()

# The lock stays on disk between runs on purpose. Removing it is the classic race: a second
# run opens it, a first run deletes it, and the two then hold locks on different inodes.
lock = path.with_suffix(".lock")
with open(lock, "a") as handle:
    fcntl.flock(handle, fcntl.LOCK_EX)

    text = path.read_text()
    if HEAD not in text:
        text = text.rstrip("\n") + f"""

{HEAD}

Written here by `note.sh` from whatever repo the board was being used in, so a fault is
recorded the moment it bites instead of being remembered later. Raw on purpose. Fixing one
means promoting it: give it a number above, say what it looked like and what did not fix
it, then delete it from here.

"""

    before, _, after = text.partition(HEAD)
    body = after.split("\n", 1)[1] if "\n" in after else ""

    # Already here? Then today is another sighting, not another entry.
    hit = None
    for block in re.finditer(r"^### (.+)$", body, re.M):
        if key(block.group(1)) == key(what):
            hit = block
            break

    if hit:
        end = body.find("\n### ", hit.end())
        end = len(body) if end == -1 else end
        chunk = body[hit.start():end]
        seen = re.search(r"^Seen again: (.+)$", chunk, re.M)
        dates = [d.strip() for d in seen.group(1).split(",")] if seen else []
        # The day it was first written counts as a sighting too, so a session that hits the
        # same fault three times in one afternoon does not write the date three times.
        first = re.search(r"^(\d{4}-\d{2}-\d{2}) ", chunk, re.M)
        if today in dates or (first and first.group(1) == today):
            print(f"already logged today: {what}")
            raise SystemExit(0)
        if seen:
            chunk = chunk[:seen.start()] + f"Seen again: {', '.join(dates + [today])}" + chunk[seen.end():]
        else:
            chunk = chunk.rstrip("\n") + f"\nSeen again: {today}\n"
        body = body[:hit.start()] + chunk + body[end:]
        print(f"seen again ({today}): {what}")
    else:
        entry = f"### {what}\n{today} · v{version} · {where}"
        if file:
            entry += f" · {file}"
        body = body.rstrip("\n") + "\n\n" + entry + "\n"
        print(f"logged: {what}")

    path.write_text(before + HEAD + "\n" + body.rstrip("\n") + "\n")
PY
