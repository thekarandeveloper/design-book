#!/usr/bin/env bash
# Link the Design Book extension into VS Code, without packaging it.
#
# A .vsix would mean a publisher, a build step and a reinstall after every edit. A symlink
# means an edit plus a window reload. Every older copy is removed first, so a rename or a
# version bump never leaves two of them installed.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
version="$(node -p "require('$here/package.json').version")"
name="local.design-book-$version"

targets=()
for dir in "$HOME/.vscode/extensions" "$HOME/.vscode-insiders/extensions" "$HOME/.cursor/extensions"; do
  [ -d "$dir" ] && targets+=("$dir")
done

if [ ${#targets[@]} -eq 0 ]; then
  echo "No VS Code extensions folder found. Is VS Code installed?" >&2
  exit 1
fi

# Any earlier copy of this extension, whatever it was called or versioned.
remove_old() {
  local dir="$1"
  for old in "$dir"/local.design-book-* "$dir"/local.design-* "$dir"/local.canvas-* "$dir"/rachnalabs.design-book-* "$dir"/rachnalabs.design-* "$dir"/rachnalabs.rachna-canvas-*; do
    [ -e "$old" ] || continue
    [ "$old" = "$dir/$name" ] && continue
    rm -rf "$old"
    echo "removed $(basename "$old")"
  done
}

case "${1:-install}" in
  install)
    for dir in "${targets[@]}"; do
      remove_old "$dir"
      rm -rf "$dir/$name"
      ln -s "$here" "$dir/$name"
      echo "linked $dir/$name"
    done
    echo
    echo 'Now reload VS Code: Cmd+Shift+P, "Developer: Reload Window".'
    ;;
  uninstall)
    for dir in "${targets[@]}"; do
      remove_old "$dir"
      rm -rf "$dir/$name"
      echo "removed from $dir"
    done
    ;;
  *)
    echo "usage: install.sh [install|uninstall]" >&2
    exit 2
    ;;
esac
