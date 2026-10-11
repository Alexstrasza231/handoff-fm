# A real task, with honest usage gaps

For v0.1.2, DeepSeek implemented the novice home page and detail tabs. Codex implemented the
numeric recorder, task association and statistics, then reviewed and tested the integration.
A second real DeepSeek delegation wrote [the usage cheat sheet](../../examples/usage-note.md);
Codex corrected its opening sentence and ran the project checks. Neither replay nor subtitles
made additional model calls.

![Actual collaboration, anonymized offline projection](../media/v012-task-usage.png)

The screenshot is a captured excerpt of this actual Windows development task, **not the built-in
sample**. The [reviewed event projection](./task-usage-events.json) excludes prompts, paths, code
differences and outputs. Identities and tool-call IDs are aliased; timestamps are relative. Usage
was explicitly selected for this publication. The screenshot is a point-in-time recording, not
an account balance or a benchmark of model efficiency.

## Check the numbers

The cheat-sheet delegation supplied four `step_end.usage` records. Normalized input includes
cache; output includes any reported reasoning. Source retry totals are already included.

| Step | Input including cache | Output | Total | Cache read (input subset) |
| --- | ---: | ---: | ---: | ---: |
| 1 | 6,182 | 109 | 6,291 | 5,504 |
| 2 | 6,337 | 58 | 6,395 | 6,144 |
| 3 | 7,343 | 374 | 7,717 | 6,272 |
| 4 | 7,770 | 134 | 7,904 | 7,552 |
| Recorded sum | **27,632** | **675** | **28,307** | **25,472** |

The real live page and this offline projection both displayed those exact DeepSeek numbers.
Cache reads are already included in 27,632; adding them again would be wrong. Reasoning output
was not provided by that source, so the page leaves it unavailable.

The earlier UI delegation ran before usage capture was added, so its consumption is unknown.
DeepSeek's **current task** coverage correctly remains **partial** despite the four complete
samples from its later job. Codex capture also started partway through the task: the snapshot's
9,515,959 is the observed cumulative delta, not the lifetime session counter. The numeric
checkpoint and recorded sample were compared independently; both are input + output, with
cache and reasoning counted once. The task's recorded total was 9,544,266 at capture time.
Repeated large-context requests consume input repeatedly, including cached input. These numbers
do not describe unique words, a bill, or remaining account quota.

No chat, reasoning text or transcript path is in the public projection. It proves the recorded
event sequence and numeric receipt; it does not prove authorship of indirect shell edits.
File changes whose writer could not be isolated retain `unknown` evidence. The 173 tool calls
are unique recorded calls, not a contribution percentage. The captured task was still running,
so its elapsed time stops at the last selected record, not the reader's wall clock.

See [counting rules](../usage-tokens.md) and [中文案例](./task-usage.zh-CN.md).
