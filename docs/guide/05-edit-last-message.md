# 05 · Edit your last message

Sent something wrong, or too soon? Hover your last message in the Chat lens and click **Edit** (the pencil).
Drover goes back to before that message with Claude Code's own Rewind (what Esc Esc does in the terminal) and
puts the message in the Composer: change it and send. It stays the same session.

- **Claude is working:** Edit stops it first (Esc), then goes back.
- **The message changed files:** Drover asks, in Claude's words, what to restore: **Conversation only** (the files
  stay as they are now), **Restore code and conversation**, or **Cancel**. Claude restores only edits its own tools
  made; files changed by hand or by a shell command stay.
- **Something typed in the Composer** stays below the message.
- **Until you send,** the Chat lens still shows the old message: Claude writes nothing for a rewind. Sending the
  new one replaces it.
- **Only the last message.** To go further back, use Esc Esc in the Terminal lens.

Each step is checked on Claude's screen (checked against Claude Code 2.1.296). If one does not match, Drover backs
out of Rewind and says why, with **Open terminal**.
