# steady: keep the system prompt steady

The starter tells the model which git branch it is on by adding a section to the system prompt. The section names the time it checked, and the branch can change, so the system prompt reads differently on every request. This defeats prompt caching: the system prompt opens every request, and the API's prompt cache matches requests from their start, so a system prompt that changes leaves nothing after it to be read from the cache, the whole conversation included. Tell the model the branch with each prompt instead, and keep the system prompt the same from one request to the next.

```sh
npx claude-mod-lab@alpha learn steady
```

The first run copies the [starter](starter) to `workshop/steady/`; edit it there.

## 1. The same system prompt on every request

Two requests, with the branch changed between them, compose the same system prompt.

## 2. The model still knows the branch

Each prompt goes on to the model with the branch as it was when the prompt was sent.

<details>
<summary>Hints</summary>

- A mod reaches the model through a command's text, a tool's result, a `prompt.compose` section, and context added to a prompt at `prompt.submit`. The scratch mod's rewrite pattern adds a line of context to each prompt.
- At `prompt.submit`, `e.context` is a list of lines the model reads with that prompt. Hand `next` a copy with yours added.

</details>

<details>
<summary>Once it passes: why it works</summary>

Context added at `prompt.submit` travels with that one prompt, at the end of the conversation, where a change leaves the cached prefix intact. The rest of the request, system prompt and history, reads the same as last time and comes from the cache. The engine's own sections are split for the same reason: `scope: 'shared'` sections, which read the same for everyone, come first, and `session` ones after them. A section a mod adds to the system prompt belongs there only when it stays the same for the whole session.

</details>
