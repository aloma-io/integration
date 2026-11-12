#!/usr/bin/env bash
# Publishes workspace-sdk from the workspace-publish job of publish.yml (PLAT-461).
#
# Input (environment): GITHUB_REF_NAME, the tag being released; WORKSPACE_PACKAGE_DIR, the package folder relative to
# the repository root (default workspace-sdk).
#
# - No file under the package folder changed since the previous release tag: say so and exit 0. That is the only skip.
# - Otherwise the patch version is raised from the latest one on npm and published; a version a person put into
#   package.json on purpose (higher than the latest on npm) is published as it is.
# - Every other outcome that does not publish exits non-zero, so the job goes red.
set -euo pipefail

TAG="${GITHUB_REF_NAME:?GITHUB_REF_NAME (the tag being released) is not set}"
DIR="${WORKSPACE_PACKAGE_DIR:-workspace-sdk}"
ROOT="$(git rev-parse --show-toplevel)"
SEMVER='^[0-9]+\.[0-9]+\.[0-9]+$'

# a) the previous release tag; none counts as changed
if PREVIOUS="$(git -C "$ROOT" describe --tags --abbrev=0 "$TAG^" 2>/dev/null)"; then
  # b) the only skip
  if [ -z "$(git -C "$ROOT" diff --name-only "$PREVIOUS" "$TAG" -- "$DIR/")" ]; then
    echo "workspace-sdk: no changes under $DIR/ since $PREVIOUS; publish skipped"
    echo "::notice::workspace-sdk: no changes under $DIR/ since $PREVIOUS; publish skipped"
    exit 0
  fi
else
  echo "workspace-sdk: no previous tag before $TAG; treating $DIR/ as changed"
fi

ERR="$(mktemp)"
trap 'rm -f "$ERR"' EXIT
cd "$ROOT/$DIR"

# c) the package name and version, and the latest version on npm
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
for v in "$PKG" "$LATEST"; do
  if ! [[ "$v" =~ $SEMVER ]]; then
    echo "workspace-sdk: '$v' is not a plain major.minor.patch version" >&2
    exit 1
  fi
done

# Numeric, part by part: 2.10.0 is higher than 2.9.0.
is_higher() {
  local a b i
  IFS=. read -r -a a <<<"$1"
  IFS=. read -r -a b <<<"$2"
  for i in 0 1 2; do
    if [ "${a[i]}" -gt "${b[i]}" ]; then return 0; fi
    if [ "${a[i]}" -lt "${b[i]}" ]; then return 1; fi
  done
  return 1
}

if is_higher "$PKG" "$LATEST"; then
  TARGET="$PKG"
else
  IFS=. read -r MAJOR MINOR PATCH <<<"$LATEST"
  TARGET="$MAJOR.$MINOR.$((PATCH + 1))"
fi

# d) never publish over, and never skip past, a version that exists
if ! EXISTING="$(npm view "$NAME@$TARGET" version 2>"$ERR")"; then
  if ! grep -q E404 "$ERR"; then
    cat "$ERR" >&2
    echo "workspace-sdk: cannot check $NAME@$TARGET on npm" >&2
    exit 1
  fi
  EXISTING=""
fi
if [ "$EXISTING" = "$TARGET" ]; then
  echo "workspace-sdk@$TARGET is already on npm; refusing to skip"
  exit 1
fi

# e) set the version (no commit, no tag) and publish
echo "workspace-sdk: publishing $NAME@$TARGET (package.json $PKG, latest on npm $LATEST)"
npm version "$TARGET" --no-git-tag-version
npm publish --access public --provenance
