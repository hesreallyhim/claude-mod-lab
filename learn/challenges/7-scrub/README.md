# scrub: redact a stream as it passes

`$.process.spawn` starts a child process and hands its output to the plugin that started it a little at a time, as the output arrives. The starter hooks `process.spawn` and redacts API keys in each piece on its way. Pieces are cut wherever the child happened to write, not at line ends, though, so a key the child wrote in two parts passes: half in one piece, half in the next, neither one a whole key. Make the mod redact whole lines, pass each line on as soon as it is complete, and leave everything else as it came.

```sh
npx claude-mod-lab learn scrub
```

The first run copies the [starter](starter) to `workshop/scrub/`; edit it there. A key is any of:

- `sk-` and at least 20 letters, digits, `-` or `_` (Anthropic's keys, and others');
- `ghp_` and 36 letters or digits (a GitHub token);
- `AKIA` and 16 capital letters or digits (an AWS access key id).

## 1. A key split across two pieces is redacted

A key the child wrote in two parts, one piece ending in its first half and the next starting with the rest, reaches the caller as `[redacted]`. So does a key inside one piece, and every key on every line.

## 2. Each line passes on as soon as it is whole

A line goes on to the caller as soon as the piece that ends it has arrived, before the next piece is asked for: the mod does not hold the output until the child ends. Every piece it passes on ends a line, but a last one with no newline.

## 3. Everything else as it came

stdout and stderr stay apart: a line on one is never joined to text from the other. A last line with no newline still arrives, when the child ends. Text without a key passes exactly, and how the child ended reaches the caller.

## 4. See it in a session

```sh
npx claude-mod-lab run
```

The lab's `process.spawn` probe has a command that writes a made-up key in two parts, a second apart. Run it:

```
/mod-lab process.spawn sh -c 'printf "key sk-ant-api03-k9Qw2Xc7"; sleep 1; printf "Vb1Nm4Lp8Rt5Yz3Hj6Gf0Dd, made up\n"'
```

The run lists each piece as it reached the lab, with when it came. With scrub loaded beneath the lab there is one piece, `key [redacted], made up`, a second in: scrub held the first half until the line was whole. The dispatch's chain shows scrub's link beneath the lab, with under a millisecond of its own time: the second it waited on the child is not counted against it. In a session without scrub (switch it off on the explorer's Workshop page, which reloads the session), the same run shows two pieces, the key cut in half between them. The explorer's Streams page draws both runs on a time axis.

<details>
<summary>Hints</summary>

- A hook on `process.spawn` is an `async function*`. `next(e)` is the stream of pieces from beneath; `for await` reads them, what the hook `yield`s is what the caller reads, and once the loop ends it returns the stream's `result`, how the child ended.
- A piece's `stream` says which pipe it came from, `stdout` or `stderr`. Keep what waits for its newline per pipe.
- When the loop ends, whatever still waits is a last line with no newline.

</details>

<details>
<summary>Once it passes: why it works</summary>

The pieces are the child's writes as they came off its pipe: one write can hold several lines, and a line written in parts arrives in parts. A mod that changes text by what it says, as a redaction does, has to see each unit of meaning whole. For a child's output that unit is the line, so the mod holds a partial line until its newline comes, per pipe, and passes each complete line on at once. The caller waits at most for the rest of a line. The example in the engine's own declarations redacts each piece as it comes, which misses a value split across writes.

What the hook yields is all the caller sees, and the loop is the child's life: a caller that stops reading ends the hook's loop, which ends the child. The hook's ten-second budget counts only its own code for each piece, never the wait for the next one, so a child that runs for minutes is no trouble. A child that writes a long line with no newline, such as a progress bar redrawn with `\r`, is held until the newline; a mod for such output would also pass the text on at a carriage return, or once it grows past the longest key.

</details>
