# temp: the terminal clip in README.md (docs/media/start.gif), recorded with vhs.
# Written while rewriting the README (October 2026); kept so it can be taken again.
# Hidden setup: `npx` is a shell function that runs this checkout's launcher,
# since the package may not be on npm yet, and Claude Code loads no user
# settings, so your own plugins and status line stay out of the picture. Variables
# a parent Claude Code session sets (CLAUDE*, ANTHROPIC*, MCP_*) are unset first.
# Run from the repository's root: vhs scripts/readme-terminal.temp.tape

Output "/tmp/readme-media/start.gif"

Set Shell "bash"
Set FontSize 15
Set Width 1240
Set Height 760
Set Padding 18
Set Theme "Catppuccin Mocha"
Set TypingSpeed 55ms

Hide
Type `for v in $(env | grep -oE '^(CLAUDE|ANTHROPIC|MCP_)[A-Z_]*'); do unset $v; done`
Enter
Type `export REPO="$PWD" BROWSER=true ENABLE_CLAUDEAI_MCP_SERVERS=false PS1='$ '`
Enter
Type `npx() { shift; node "$REPO/bin/claude-mod-lab.mjs" "$@"; }`
Enter
Type "mkdir -p /tmp/mlab-demo && cd /tmp/mlab-demo && printf '# Demo project' > README.md && clear"
Enter
Sleep 500ms
Show

Sleep 600ms
Type "npx claude-mod-lab run --new --setting-sources project,local"
Sleep 500ms
Enter
Sleep 11s

Type "/mod-lab"
Sleep 400ms
Enter
Sleep 3s

Type "/mod-lab fs.read README.md"
Sleep 500ms
Enter
Sleep 5s

Hide
Ctrl+C
Ctrl+C
Sleep 2s
