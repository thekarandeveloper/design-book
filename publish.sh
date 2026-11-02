#!/usr/bin/env bash
# Publish Design Book to both places an editor looks.
#
# VS Code reads the Visual Studio Marketplace. Cursor, VSCodium and the rest read Open
# VSX. They are two registries with two accounts, and an extension that is only in one
# is missing for half the people who would use it, so both are done together.
#
#   VSCE_PAT=...  a token from the Azure DevOps organisation behind the publisher
#   OVSX_PAT=...  a token from open-vsx.org
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"
version="$(node -p "require('./package.json').version")"
# The workspace's own build folder, never a repo: `make` and every other script here
# put what they make in the same place.
build="$here/../../../.build"
out="$build/design-book-$version.vsix"
mkdir -p "$build"

echo "Packaging $version"
npx --yes @vscode/vsce@latest package --no-dependencies --out "$out"

case "${1:-both}" in
  pack) echo "Packaged only: $out" ;;
  code)
    npx --yes @vscode/vsce@latest publish --packagePath "$out"
    ;;
  ovsx)
    npx --yes ovsx@latest publish "$out"
    ;;
  both)
    npx --yes @vscode/vsce@latest publish --packagePath "$out"
    npx --yes ovsx@latest publish "$out"
    ;;
  *)
    echo "usage: publish.sh [pack|code|ovsx|both]" >&2
    exit 2
    ;;
esac
