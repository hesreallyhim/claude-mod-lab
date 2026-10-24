#!/bin/sh
# Starts the explorer from one design branch (refs/heads/design/<round>/<key>), so a
# person can use the design, not only look at its renders, before choosing.
#
#   scripts/try-design.sh <round>/<key>              the explorer's server on its own, at PORT (default 4977)
#   RECORDED=1 scripts/try-design.sh <round>/<key>   the session the renders show, from scripts/shots.mjs
#   scripts/try-design.sh                            lists the design branches
#
# For the live parts, start a session in the same worktree whose bridge connects to that
# server through its bridge file: MOD_LAB_BRIDGE_FILE=~/.claude-mod-lab/bridge.json npx claude-mod-lab run
# (on a branch whose launcher has no run, its --help names the command). The design's worktree is reused
# if it is still there; otherwise the branch is checked out under .claude/worktrees/, inside
# the checkout, where Node finds the checkout's node_modules.
set -e
port="${PORT:-4977}"
if [ -n "$RECORDED" ]; then
  LAUNCH="node scripts/shots.mjs --serve $port --types \"${MOD_LAB_TYPES:-/tmp/mod-lab-design/claude-code.d.ts}\""
else
  LAUNCH="MOD_LAB_PORT=$port node web/server.mjs"
fi

key="$1"
if [ -z "$key" ]; then
  echo "usage: $0 <round>/<key>"
  git for-each-ref --format='%(refname:short)' refs/heads/design | sed 's#^design/#  #'
  exit 2
fi
branch="design/$key"
git rev-parse --verify -q "refs/heads/$branch" >/dev/null || { echo "no branch $branch" >&2; exit 2; }

wt="$(git worktree list --porcelain | awk -v b="refs/heads/$branch" '$1 == "worktree" { w = substr($0, 10) } $1 == "branch" && $2 == b { print w }')"
if [ -z "$wt" ]; then
  wt="$(git rev-parse --show-toplevel)/.claude/worktrees/try-$(echo "$key" | tr / -)"
  git worktree add -q "$wt" "$branch"
fi
echo "→ $branch in $wt"
cd "$wt"
exec sh -c "$LAUNCH"
