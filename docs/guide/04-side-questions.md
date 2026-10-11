# 04 · Ask on the side with /btw

`/btw <question>` asks a Claude session something about its conversation while it keeps working. It is Claude
Code's own command: no interruption, and the question and answer stay out of the transcript.

## How

In the Composer of a Claude pane, click the **/btw** key beside Esc (it puts `/btw ` before what you typed), or send:

```
/btw why did you pick that file?
```

A panel opens above the Composer: the question, **Answering…** with **Cancel**, then the answer with **Copy** and
close. Send is held while Claude answers, because Claude's own panel takes the keys meanwhile.

## What happens underneath

Claude draws the answer over its terminal, so Herdr reads it off the pane's screen, scrolls a long answer to its end,
then closes Claude's panel with Esc straight away: while that panel is open, Claude holds back the running turn's
updates.

Each pane keeps its questions as a thread while the app runs: earlier ones sit folded above the latest, and close
drops the whole thread. Claude itself also remembers earlier `/btw` exchanges when answering the next one.

## Limits

- The answer shows as Claude drew it: plain monospace text, no Markdown rendering.
- It depends on how Claude's screen looks (checked against Claude Code 2.1.295). If Herdr cannot read the answer,
  the panel says so and offers **Open terminal**, where Claude's own panel still shows it.
- A bare `/btw` only prints Claude's usage line.

## /btw or a normal message?

A normal message sent while Claude works is queued and read after the current tool call: it becomes part of the
task and can steer it. Use `/btw` for a question; use a message to change what Claude is doing; use
[a fork](03-fork-session.md) when the side task needs tools.
