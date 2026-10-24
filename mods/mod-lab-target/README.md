# mod-lab-target

A companion to mod-lab whose hooks fail on purpose, so `/mod-lab verify` can check, in the session it runs in, what a failed hook leaves standing. mod-lab lists it as a dependency, which puts its hooks beneath the lab's wherever both load, where the lab reads their outcomes off each call's chain.

Its hooks answer only paths under `/dev/null/mod-lab-target/`, which cannot exist; every other call passes untouched.

| A call to | What mod-lab-target's hook does | The outcome the chain should show |
| --- | --- | --- |
| `$.fs.exists('/dev/null/mod-lab-target/skipped')` | throws before `next`, with no `.catch` | `skipped`: the chain beneath answers |
| `$.fs.exists('/dev/null/mod-lab-target/caught')` | throws before `next`; its `.catch` answers `true` | `caught`: the handler's answer stands |
| `$.fs.exists('/dev/null/mod-lab-target/kept')` | calls `next`, then throws, with no `.catch` | `kept`: what `next` settled to stands |
| `$.fs.exists('/dev/null/mod-lab-target/arm-timer')` | sets a timer and returns; the timer calls `$.fs.exists('/dev/null/mod-lab-target/from-timer')`, which its own hook notes if it sees it | `passed` |
| `$.fs.read('/dev/null/mod-lab-target/report')` | answers whether its own hook saw the timer's call, as JSON | `returned` |

The timer's call comes after the hook that set it returned, and a plugin's own hooks skip a call made from a timer once that hook has returned, so the report says it was not seen.

```sh
npx claude-mod-lab run    # loads it; then /mod-lab verify
claude plugin test mods/mod-lab-target
```

## Install

From a terminal:

```
claude plugin marketplace add hesreallyhim/claude-mod-lab
claude plugin install mod-lab-target@claude-mod-lab
```

It is of use only beside mod-lab, beneath which `/mod-lab verify` reads its hooks; installing mod-lab installs it too.
