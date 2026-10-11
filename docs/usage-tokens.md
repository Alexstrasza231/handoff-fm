# Recorded task usage (v0.1.2)

The home page answers three questions: who just did what, how much usage has been recorded for
this task, and where to inspect the evidence. Open **查看详情** for **过程记录** (process records)
or **用量明细** (usage details). Click a character to filter process records to Codex or DeepSeek.
**回放过程** replays records without executing tools. **看个例子** is a labelled static sample.

The default scope is the latest recorded Codex user instruction and explicitly linked DeepSeek
jobs. The usage tab also offers the recorded session cumulative scope. These are consumed Tokens,
not money, a bill, account quota, or remaining allowance. Elapsed time includes waiting and tools;
it cannot be interpreted as model thinking time. Tool calls are unique `(actor, session, callId)`.

## Sources and missing data

- DeepSeek: `dsh headless --json` → `status`, `phase: step_end`, `usage`. Each committed step already
  includes retry consumption. We replace the same task/turn/step sample and sum distinct steps.
  No turn-end or retry event is added again. Uncached `inputTokens` is normalized to input including
  `cacheReadTokens` and `cacheWriteTokens`; an exact reported total can establish prompt input when
  a cache breakdown is absent. Without enough data we leave the total unavailable.
- Codex: the current enabled project's trusted Hook supplies `transcript_path` and turn ID. While
  `watch` is running, a numeric-only adapter reads at most 256 KiB per source per tick, up to four
  sources; initial seek covers at most the last 2 MiB. It retains only explicit task boundaries and
  nonnegative usage counters. The current turn is calculated from observed cumulative deltas, never
  from the entire session lifetime. Incomplete initial coverage is labelled partial. The
  [official Hooks documentation](https://learn.chatgpt.com/docs/hooks) warns that transcript format
  may change: an unrecognized format supplies no numbers.

Input includes cache; output includes reasoning. The detail breakdowns are subsets and are never
added again to `input + output`. Absent fields show **未提供 / 尚未采集**. **部分数据** means the visible
sum is only the known recorded portion. Starting `watch` late does not manufacture past usage.
Old recordings have no usage until real samples are present.

Registration/checkpoints in `.handoff-fm/usage-sources/`, `usage-turns/` and `usage-paths/` are private local metadata.
They contain source paths, offsets, IDs, hashes and numeric state, never conversation or reasoning
text. Only paths delivered by scoped trusted Hooks are registered; no other sessions are scanned.
Registered transcripts are excluded from ordinary snapshots and file-tool evidence. Oversized
lines are discarded without checkpointing their contents. Log replacement/truncation does not
replay old counters as new consumption; it preserves the prior known sum, marks partial and
establishes a new baseline for future increments. If a bounded replacement probe misses the task
boundary, attribution is withheld until an explicit boundary is observed. Unavailable snapshots
produce a recording gap, never a fabricated file diff. Checkpoints survive collector restarts.

## Association and sharing

Pass the actual `--parent-turn` whenever available. When absent, automatic association is allowed
only if that exact parent session has one recorded active task. Zero or multiple active tasks leave
the DeepSeek job unassociated: its samples appear in session cumulative usage and unassociated
details, never in the current-task total. Concurrent callers cannot borrow another session's task.

Replay usage is computed only from the visible event prefix. Sampling does not move characters,
trigger a handoff or change stage captions. Received journal order chooses the latest value for
each sample key, so reconnects and duplicate delivery do not multiply consumption.

Sharing defaults to **no usage data**. The **用量数据** checkbox / CLI `--usage` opts in; preview and
offline export use the same projection. Only whitelisted numeric fields, coverage, source and
aliased sample/task identifiers are exported; source paths and raw logs never are. Review selected
content yourself before distributing it.
