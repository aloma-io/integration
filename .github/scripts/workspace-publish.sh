#!/usr/bin/env bash
# Publishes workspace-sdk from the workspace-publish job of publish.yml (PLAT-461). A thin wrapper: it collects the facts
# and workspace-publish-decision.mjs decides.
#
# Input (environment): GITHUB_REF_NAME, the tag being released; WORKSPACE_PACKAGE_DIR, the package folder relative to
# the repository root (default workspace-sdk).
#
# - Skip only when the content of the package folder at the tag is identical to its content at the commit the latest
#   published version was built from (npm's gitHead). No gitHead, a gitHead not in the checkout, or a failed lookup
#   (other than E404) counts as changed.
# - Otherwise the patch version is raised from the latest one on npm and published; a version a person put into
#   package.json on purpose (higher than the latest on npm) is published as it is.
# - Every other outcome that does not publish exits non-zero, so the job goes red.
set -euo pipefail

TAG="${GITHUB_REF_NAME:?GITHUB_REF_NAME (the tag being released) is not set}"
DIR="${WORKSPACE_PACKAGE_DIR:-workspace-sdk}"
ROOT="$(git rev-parse --show-toplevel)"
DECISION="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/workspace-publish-decision.mjs"

ERR="$(mktemp)"
trap 'rm -f "$ERR"' EXIT
cd "$ROOT/$DIR"

# a) the package name and version, and the latest version on npm
NAME="$(node -p "require('./package.json').name")"
PKG="$(node -p "require('./package.json').version")"
if LATEST="$(npm view "$NAME" version 2>"$ERR")"; then
  :
elif grep -q E404 "$ERR"; then
  LATEST=0.0.0
else
  cat "$ERR" >&2
  echo "workspace-sdk: cannot read the latest version of $NAME from npm" >&2
  exit 1
fi
TARGET="$(node "$DECISION" target "$PKG" "$LATEST")"

# b) the commit the latest version was built from, and whether the folder is the same there
GITHEAD=""
if [ "$LATEST" != 0.0.0 ]; then
  GITHEAD="$(npm view "$NAME" gitHead 2>/dev/null || true)"
fi
KNOWN=no
IDENTICAL=no
if [[ "$GITHEAD" =~ ^[0-9a-f]{40}$ ]] && git -C "$ROOT" cat-file -e "$GITHEAD^{commit}" 2>/dev/null; then
  KNOWN=yes
  BUILT="$(git -C "$ROOT" rev-parse -q --verify "$GITHEAD:$DIR" 2>/dev/null || true)"
  NOW="$(git -C "$ROOT" rev-parse -q --verify "$TAG:$DIR" 2>/dev/null || true)"
  if [ -n "$BUILT" ] && [ "$BUILT" = "$NOW" ]; then IDENTICAL=yes; fi
fi

# c) never publish over, and never skip past, a version that exists
ONNPM=no
if ! EXISTING="$(npm view "$NAME@$TARGET" version 2>"$ERR")"; then
  if ! grep -q E404 "$ERR"; then
    cat "$ERR" >&2
    echo "workspace-sdk: cannot check $NAME@$TARGET on npm" >&2
    exit 1
  fi
  EXISTING=""
fi
if [ "$EXISTING" = "$TARGET" ]; then ONNPM=yes; fi

# d) decide
{ read -r ACTION; read -r REASON; } < <(node "$DECISION" decide "$IDENTICAL" "$KNOWN" "$PKG" "$LATEST" "$ONNPM")
case "$ACTION" in
  skip)
    MSG="workspace-sdk: $DIR/ at $TAG is identical to ${GITHEAD:0:12}, the commit $LATEST was built from; publish skipped"
    echo "$MSG"
    echo "::notice::$MSG"
    exit 0;;
  fail)
    echo "$REASON" >&2
    exit 1;;
esac

# e) set the version (no commit, no tag) and publish
echo "workspace-sdk: publishing $NAME@$TARGET (package.json $PKG, latest on npm $LATEST; $REASON)"
npm version "$TARGET" --no-git-tag-version
npm publish --access public --provenance
