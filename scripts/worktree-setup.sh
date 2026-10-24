#!/bin/sh
# Prepares a git worktree of this repository to work in like the main checkout:
# links the main checkout's node_modules into it, so the pre-commit hook (which
# puts ./node_modules/.bin on PATH), npx and the npm scripts find their tools,
# then checks the tools a change to the explorer needs. Run it from the
# worktree's root; in the main checkout it only runs the checks.
set -e
common="$(git rev-parse --path-format=absolute --git-common-dir)"
main="$(dirname "$common")"
if [ "$(git rev-parse --show-toplevel)" != "$main" ]; then
  [ -d "$main/node_modules" ] || { echo "no node_modules in $main: run npm install there first" >&2; exit 1; }
  [ -e node_modules ] || ln -s "$main/node_modules" node_modules
  # .gitignore's node_modules/ matches a folder, not a link; the shared exclude file keeps the link out of every worktree's commits.
  grep -qx '/node_modules' "$common/info/exclude" 2>/dev/null || echo '/node_modules' >>"$common/info/exclude"
fi

status=0
check() {
  if eval "$2" >/dev/null 2>&1; then echo "ok   $1"; else echo "MISSING $1" && status=1; fi
}
check 'lint-staged, for the pre-commit hook' 'test -x node_modules/.bin/lint-staged'
check 'prettier, eslint and tsc' 'test -x node_modules/.bin/prettier && test -x node_modules/.bin/eslint && test -x node_modules/.bin/tsc'
check 'playwright-core and typescript' 'node -e "require.resolve(\"playwright-core\"); require.resolve(\"typescript\")"'
check 'claude, for npm run e2e-page' 'command -v claude'
check 'Google Chrome, for screenshots and e2e-page' 'test -d "/Applications/Google Chrome.app" || command -v google-chrome'
check 'node_modules kept out of git' 'test -z "$(git status --porcelain node_modules)"'
exit $status
