# receipt: a tool the model can call

The starter gives the model a tool, `total`, that adds up a list of items, each with a unit price and a quantity. In a session it does not work. Make it work: registered so the model sees it from the start, answered with the total as text, and refusing what it cannot add up, with a reason the model can act on.

```sh
npx claude-mod-lab learn receipt
```

The first run copies the [starter](starter) to `workshop/receipt/`; edit it there.

## 1. Registered for the model to see

The tool is registered as `total` when the session starts, with its schema in the model's tool list from the start rather than behind a search.

## 2. Answered with the total

The mod answers a call with text that gives the total to two decimal places: for the checks' five teas at 2.50 and four scones at 1.25, `17.50`.

## 3. Refused when it cannot be added up

A call without a list of items, or with an item whose price or quantity is not a number, is answered with `{ deny }`. The reason starts with `receipt:` and names the item it could not use.

<details>
<summary>Hints</summary>

- `$.tool.register` takes a field that says where the tool waits. The explorer's page for `ToolSpec` describes it.
- The model calls a registered tool as `mcp__<plugin>__<name>`. When nothing answers a call, the checker says that no hook answered `tool.call`.
- In a session, a registered tool's answer must be a string (or a list). An object is refused once the hook returns, as `a result that does not match its output shape ... expected string, received object`. The test kit lets it through, which is why the checks look for text.

</details>

<details>
<summary>Once it passes: why it works</summary>

A tool registered without `isDeferred: false` waits behind ToolSearch: the model sees its name and has to load the schema before calling it. With `isDeferred: false` the schema is sent with every request, so the model can call the tool at once, at the cost of the schema's tokens on each request. The answer is what the model reads, so it is text. A `{ deny }` goes back to the model as the tool's error, so its reason is written for the model: what was wrong and with which item, so that it can call again correctly.

</details>
