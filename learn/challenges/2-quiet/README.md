# quiet: quiet, please

The starter reminds you to stretch every 20 minutes with a toast. `/quiet on` is meant to hold the reminders until `/quiet off`: the mod hooks `ui.toast` and, while quiet is on, answers its own toasts without showing them. But turn it on and the reminders keep coming. Make `/quiet on` hold them.

```sh
npx claude-mod-lab@alpha learn quiet
```

The first run copies the [starter](starter) to `workshop/quiet/`; edit it there.

## 1. Hold the reminders while quiet

While quiet is on, no reminder reaches the screen; while it is off, they do, and turning it off again brings them back. The checks run the clock forward an hour at a time.

<details>
<summary>Hints</summary>

- The hook is right. Ask whether it runs at all.
- Where is the reminder's toast raised from, and is any hook of the mod running at that moment?
- Not every call a plugin makes passes through its own hooks: which ones do depends on where the call is made from.

</details>

<details>
<summary>Once it passes: why it works</summary>

A plugin's own hooks see the calls it makes only while the hook making them, or the hook that set the timer making them, is still running. The reminder's toast comes from a timer, which fires long after the `session.start` hook that set it has returned, so the call goes through every other plugin's `ui.toast` hooks and the engine and skips quiet's own. The fix is to decide where the toast is raised: check `isQuiet` in the timer before raising it. Hooking your own calls works for calls made inside a hook, as in only-mine, and nowhere else. A hook kept beside the fix does no harm, but it never sees a reminder.

To watch it with the starter, set `REMINDER_MS` to ten seconds, `npx claude-mod-lab@alpha run`, then `/mod-lab intercept ui.toast watch others` and `/quiet on`. Each reminder is still recorded, with a chain that has no quiet in it: `mod-lab intercept (watch) > engine (core)`.

`$.command.register` refuses a name Claude Code already uses, such as `/focus` or `/sandbox`, which no check can see: the test kit does not know the session's own commands. In a session, the hook that called it throws, and what followed in that hook does not run.

</details>
