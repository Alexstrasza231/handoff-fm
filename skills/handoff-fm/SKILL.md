---
name: handoff-fm
description: Record an already-authorized Codex and DeepSeek collaboration in an enabled local project, preserving parent task links and real evidence. Use for HandoffFM setup or when the user asks to observe a DeepSeek delegation. Does not authorize new delegation by itself.
---

Use the packaged CLI to initialize only the requested project, register its actual Codex session ID if the chat lives in a different working directory, and start the local watch page. Show the user how to review/trust the project's observation hooks; do not bypass hook trust.

Before an authorized DeepSeek task, write its bounded task text to a project-local task file. Preserve existing tool/scope restrictions. Invoke `handoff-fm delegate deepseek --task-file PATH --title TITLE --parent-session ACTUAL_SESSION_ID --parent-turn ACTUAL_TURN_ID --project PROJECT`. Read those identifiers from the current hook/session context; omit parent-turn if unavailable, never invent identifiers or label an unknown parent as Codex. Set the DSH command path during init if it is not on PATH. Reuse existing DSH credentials; do not read authentication files.

The wrapper returns the actual final answer and exit status while recording JSON events. Inspect the changed files and run appropriate existing checks; the delegate's successful exit means 'submitted for review', not acceptance. Continue recording your own edits through hooks. Plain shell changes and overlapping writes may have unknown attribution. Keep these labels visible.

The viewer's stage captions are deterministic humor, not agent statements. No hidden reasoning, full-history scan or automatic publication of prompts/source. Select and preview each category before an offline export.
