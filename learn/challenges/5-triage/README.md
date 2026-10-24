# triage: label every prompt, cheaply

The starter labels each prompt the person sends as `bug`, `feature` or `question`, by asking a model with a labelling guide, and adds the label to the prompt's context, where the main model reads it. It works. It also spends more than it needs to on every prompt, passes on whatever the model replied, and holds the prompt up when the call fails. Make it cheap and dependable.

```sh
npx claude-mod-lab@alpha learn triage
```

The first run copies the [starter](starter) to `workshop/triage/`; edit it there. The checks stand in for the model, so they spend nothing.

## 1. A clean label for the main model

The main model reads one line, `triage: ` and the label in lowercase, whatever the reply's case, spacing or punctuation. A reply that is none of the three labels adds nothing. The label is asked of `$.model.complete`, whose result says what the call cost.

## 2. The guide paid for once

Every request opens with the guide, the same text each time, as a block marked for the prompt cache, and the prompt comes after it. The label is asked of a Haiku model, with room for a word: at most 16 output tokens.

## 3. Never in the prompt's way

A call the model does not answer, or one that is refused, leaves the prompt as it was, with no label. The call is given a time limit of at most ten seconds.

## 4. Score it in a session

```sh
npx claude-mod-lab@alpha run --model haiku
```

Send a few short prompts, then open the explorer's Model workbench. `triage`'s calls are listed with what each cost: the first writes the guide to the cache, and each after it within five minutes reads it, paying only for the prompt. The challenge's page in the explorer shows the average per label. `MODEL=haiku` keeps the session's own turns cheap too; each prompt is still a turn of the main model.

<details>
<summary>Hints</summary>

- A prompt can be a list of blocks, `[{ text, cache: true }, { text }]`. A mark caches everything from the start of the request to the end of that block, so anything that varies from call to call belongs after it.
- Text before the mark that changes, such as the person's prompt, makes every request a new one: nothing is read back.
- `$.model.complete` resolves with `{ isAnswered: false, reason }` when the model does not answer; it rejects only for a request the engine refuses to send, or one a hook refuses.
- The time a hook spends waiting on a `$` call does not count against its ten-second budget, so a slow model call holds the prompt for as long as it takes, unless the request says otherwise. The request's type, `ModelCompleteRequest`, has a field for that.

</details>

<details>
<summary>Once it passes: why it works</summary>

The prompt cache keeps a request's opening, up to the marked block, for five minutes after its last use. The starter put the guide after the prompt, so no two requests opened alike and the guide was paid for in full each time. With the guide first and marked, the first label writes it to the cache and every label after it reads it there, at a fraction of the price, and only the prompt is new. A label is one word, so a small model and a small output limit lose nothing. A reply that is not a label is left out rather than passed on, since the main model acts on whatever it reads.

</details>
