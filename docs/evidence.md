# HandoffFM evidence model

HandoffFM exists to keep one question answerable after the fact: **what did this collaboration
actually do, and how sure are we?** This document defines the evidence vocabulary, states exactly
when attribution is proven and when it is not, and separates what is implemented and tested from
what is still unverified.

Read this together with [usage.md](./usage.md). Nothing here authorizes delegation or publication.

## 1. Vocabulary

Every record has an `actor` and an `evidence` level. The viewer and the exporter both preserve them;
an export never upgrades a level.

| `actor` | Meaning |
| --- | --- |
| `codex` | A Codex session, its hooks, or a Codex subagent |
| `deepseek` | The DeepSeek process started by `delegate`, or a change observed in its task window |
| `system` | HandoffFM itself, including collector repairs and `recording.gap` |
| `unknown` | The writer could not be established |

| `evidence` | Meaning |
| --- | --- |
| `observed` | HandoffFM saw this directly in its own operations or a trusted hook payload |
| `declared` | An agent said it, and the statement itself is the record (no independent check) |
| `unknown` | The fact was noticed, but attribution or completeness is not proven |

`codex`/`deepseek` as an actor means "attributed to", not "proven authored by". A record with
`actor: 'deepseek'` and `evidence: 'unknown'` is deliberately common: the change happened during
DeepSeek's work, but a generic shell write cannot prove who wrote it.

### The three levels applied

- **Observed** — HandoffFM's own act of capturing: a hook payload arrived and was attributed to an
  enabled project, the wrapper started/ended a run, an event was committed to the log. Observed
  says the record is faithful, *not* that the underlying work is good or complete.
- **Declared** — the agent's own text: a final message or completion statement. The statement is
  the record; nothing independently confirms it. `agent.message` and the text inside a delegated
  completion are declared.
- **Unknown** — a real observation whose *authorship* is not established. Shell writes, scripts,
  overlapping edits, and every DeepSeek file change are unknown. Unknown does not mean "no
  evidence"; it means "do not attribute this to a named writer".

The practical asymmetry to remember: Codex direct edits *can* reach `observed`; DeepSeek file
changes *cannot*.

## 2. Event kinds

| Kind | Actor(s) | Typical evidence | Notes |
| --- | --- | --- | --- |
| `session.started` | codex / deepseek | observed | Codex `SessionStart`; DeepSeek `session` event supplies the session ID |
| `task.started` | codex | observed | Carries the submitted prompt |
| `delegate.started` | codex | observed | Written by `delegate` with the title and task prompt |
| `tool.started` | codex / deepseek | observed, or unknown when the DeepSeek event was truncated | Tool name, call ID, and input as received |
| `tool.completed` | codex / deepseek | observed | Exit code and status when the producer supplied them |
| `file.changed` | codex / deepseek | observed only for an isolated explicit `apply_patch`; otherwise unknown | Snapshot diff plus content-addressed before/after blobs |
| `agent.message` | codex / deepseek | declared | The agent's final text, unverified |
| `delegate.completed` / `delegate.failed` | deepseek | observed | Wrapper lifecycle; a successful delegate is not an accepted change |
| `turn.completed` / `turn.interrupted` | codex | observed | Codex `Stop` and `Interrupt` hooks |
| `recording.gap` | system | unknown | A record was dropped, repaired, quarantined, or could not be captured |

## 3. Codex records

Hooks submit one JSON payload per event; the CLI reads it from stdin, resolves the enabled project,
and only then writes a record. If the project is not enabled, or the payload's working directory is
outside it (and the session is not explicitly bound), nothing is recorded — the hook is silent.

Attribution rules for Codex file changes:

- **Observed:** the tool is `apply_patch`, the changed path is named in the patch, no sibling
  operation was pending, and the pre/post snapshots show exactly that content change. This is the
  only case that claims `codex` authorship. If any condition fails, the record stays `unknown` —
  there is no "probably Codex" middle level.
- **Unknown (indirect or overlapping):** any other path — a shell command that writes files, a
  script, a formatter, or an edit that overlapped another in-flight tool. Overlap is symmetric: if
  two operations overlap, both stay `unknown`, including the one that finishes first.
- The reason string is recorded on every `file.changed` record so the distinction survives export.

Because `observed` requires isolation, a real session can produce `file.changed` records that are
all `unknown` even when every direct edit was an `apply_patch`. Read the `reason` string rather than
assuming; the level is the answer to "who wrote this?", not "did something change?".

Codex `agent.message` records come from the `Stop` hook's `last_assistant_message` and are `declared`
— the text is the agent's own account, not a checked fact.

The packaged hook surface is exactly the six events in `hooks/hooks.json`. The capture code also
understands Codex subagent start/stop payloads and would file them as `delegate.started` /
`delegate.completed` (with the text `declared`), but the bundled manifest does not register those
hook events, so no subagent records are produced by a default install.

## 4. DeepSeek records

`delegate deepseek` starts `dsh headless --json -`, writes the task file to stdin, and normalizes the
JSON event stream:

- `thinking`, `text`, and `status` events are discarded. Reasoning is never persisted.
- A `session` event supplies the DeepSeek session ID. A `status`/`turn_end` event supplies the
  completion reason, in either the string or `{kind}` object form.
- A `final` event supplies the answer printed to stdout, recorded as `declared`.
- Any event marked `truncated` is recorded with `evidence: 'unknown'` — a truncated stream cannot
  attest what happened.
- Oversized or unparseable lines become a `recording.gap`; the delegate keeps running.
- Child stderr is deliberately never persisted or relayed: DSH diagnostics can contain reasoning.

### Why DeepSeek file diffs are always candidates

DeepSeek's stdout notification is **not a pre-write barrier**. The DSH process writes files
asynchronously, so a `tool_result` for a write tool does not prove that this tool performed exactly
the change seen in the next snapshot, nor that no other writer ran in between. Therefore every
`file.changed` observed in a delegate window is recorded with `candidateActor: 'deepseek'` and
`evidence: 'unknown'`, with the reason "the external event stream is not a pre-write barrier".
There is no direct-tool exception, unlike Codex's isolated `apply_patch` case.

Changes not reported by a tool result are also captured at the end of the delegate window as a
task-window snapshot diff, again `unknown`, because the exact writer is not established.

### Reading a delegation

- Exit code `0` requires: child exit 0, a `final` message, and a completion reason that is absent or
  `completed`. Anything else writes `delegate.failed` and exits `1`. Success is about *this command*;
  it is not a statement about the code.
- A `delegate.completed` record means "the handoff is submitted for review" (交稿待检查). It does
  **not** mean the work is correct, complete, or accepted, and it does not mean tests passed.
- If the terminal event is missing, the wrapper still records `delegate.failed` plus a
  `recording.gap` noting that completion could not be verified, so an incomplete recording stays
  visible instead of looking successful.
- The parent link (`runId`, `taskId`, `parentTaskId`) is preserved. A parent session ID that is not
  a plain identifier is hashed, which separates the run; see [usage.md](./usage.md).

## 5. What the record cannot tell you

Keep these boundaries visible when you review or export records:

- **Snapshots are filtered.** Dependency and build directories, `.git`, `.work`, `.handoff-fm`,
  dotenv and credential files, key material, binary files, files over 1 MiB, and symlinks are
  excluded; scanning stops after 5000 files. Changes in excluded paths are never reported, and an
  excluded file can therefore change without any record.
- **Time is the time of observation.** `at` is the local clock when HandoffFM recorded the event,
  not necessarily when the file system changed. Exports show offsets relative to the first selected
  event.
- **Recovery keeps committed bytes, then marks.** A torn trailing fragment with no newline is
  truncated; every committed line before it is retained. Invalid or oversized inbox records are
  quarantined. Each damaging event produces exactly one `recording.gap`, but the discarded content
  is gone from the log (quarantined files remain for manual review).
- **A killed collector can recover without stealing a fresh lock.** Recovery removes only the
  exact nonce marker of a confirmed dead PID and then an empty directory. Live owners are never
  displaced by age. Empty incomplete lock directories recover after 10 seconds. Committed records
  were already fsynced. PID reuse is handled conservatively: a live PID remains busy.
- **Ordering is by sequence, not causality.** Dense, unique sequence numbers show commit order in
  the log, not wall-clock ordering of the underlying work.
- **A green command is not acceptance.** Tests, builds, `doctor`, or a delegate exit 0 never imply
  that a delegated change was reviewed, correct, or merged. "The command passed" (该命令通过) is the
  whole claim.
- **Captions are not statements.** The viewer's stage captions are deterministic humor.

## 6. Privacy posture

Default and opt-in are separate steps by design.

| Data | Default | Opt-in flag |
| --- | --- | --- |
| Prompts and titles | excluded | `--prompts` |
| File paths | excluded | `--paths` |
| Diffs | excluded | `--diffs` |
| Tool/agent outputs, exit codes, messages | excluded | `--outputs` |
| Roles, event kinds, evidence, sequence | included | — |
| Relative timing | included (relative, never absolute on export) | — |
| Run/session/task IDs | included as aliases (`run-1`, `instance-1`, `task-1`) | — |

- The default export carries no source text, no paths, no diffs, no outputs, and no wall-clock time.
- Opt-ins are independent and cumulative; `--prompts --paths` adds both and nothing else.
- Masking is best effort and is not a guarantee: bearer tokens, `sk-`/`ghp_`/`github_pat_`-style
  keys, `*_API_KEY=`/`PASSWORD=`/`SECRET=`/`TOKEN=` assignments, and secret-named object keys are
  redacted in stored records and exports. Secrets can still survive in free text, unusual formats,
  file contents, or diffs. **Always review the preview yourself before confirming or sharing**, and
  assume opted-in outputs and diffs may contain paths and secrets.
- The offline export is local, read-only, and non-executing: a `default-src 'none'` CSP with no
  `connect-src`, the bundle, styles and character sprites inlined, and no network fetch. Character
  attributions are retained inside the exported page.
- `.handoff-fm/` is added to `.gitignore` by `init` and is excluded from snapshots. Keep local
  records out of version control.

## 7. Verification status

Snapshot as of October 2026. What the current tests and probes cover, as implemented in this
repository (see the `tests/` directory for the exact assertions):

- Hook capture scoping, real tool identity, and exit-code recording.
- Evidence rules: an isolated `apply_patch` is `observed`; shell writes and overlapping edits stay
  `unknown`; simultaneous hook edits never claim authorship.
- DeepSeek normalization: `thinking` is discarded, truncated events never claim attribution, and
  completion reasons normalize identically across the string and object forms.
- Collector durability: deduplication across restarts, quarantine of invalid records, repair of a
  torn tail, exactly one `recording.gap` per damaging event, and stale-lock recovery.
- Snapshot exclusions for private, dependency, binary, oversized, and linked files.
- Export privacy: the default share contains no source text, private identifiers, paths, or
  wall-clock time.
- The watch service requires the token and a trusted Host/Origin, is read-only, and streams events.
- A real DSH wrapper delegation runs and is recorded in this development environment.

Exercised for real, in this project's own recorded history:

- On Windows with the Codex desktop app, trusting the plugin's exact hooks through the official CLI
  produces real hook records: sessions, prompts, `apply_patch` `tool.started`/`tool.completed`, and
  file changes. `doctor` reports `codexHooks: observed`.
- `delegate deepseek` has run real delegations through the configured DSH wrapper and recorded the
  normalized DeepSeek stream (`tool.started`/`tool.completed`/`file.changed`/`delegate.completed`).
- Every `file.changed` produced so far is `unknown` (candidate), which is the intended behavior, not
  a failure: the isolate conditions for Codex `observed` were not met in those sessions.

Honest limits, stated plainly:

- **Desktop hook acceptance is per-client and per-project.** The hook definitions and pipeline are
  implemented and the payload shape is tested, and the Windows Codex desktop app has delivered
  records here. Do not generalize that to every client, OS, or turn. Treat `codexHooks: observed`
  as per-project evidence that records are arriving, not as proof of completeness.
- **Desktop chat capture is not complete, and nested-tool capture is not orchestrated.** HandoffFM
  records exactly what the client delivers through the trusted hooks; it does not reconstruct chat
  history, and it does not wrap or intercept nested tool calls.
- **No Linux or macOS desktop validation is claimed.** Windows is the only platform exercised
  end-to-end. A Linux CLI/browser CI is intended to run fixture-driven tests; Linux Codex and DSH
  desktop runs remain untested.
- **No registry publication claim.** v0.1.0 targets the GitHub release artifact; there is no npm
  registry availability, and no adoption, popularity, or uniqueness claim.
- **Verification is a workflow, not a badge.** Run your own checks against your own project.

### Reproducing checks locally

```powershell
# Windows PowerShell
npm test                       # node --test via tsx over tests/
node dist/cli.js doctor --project C:\work\my-app
```

```sh
# POSIX
npm test
node dist/cli.js doctor --project ~/my-app
```

If child processes cannot be spawned in a restricted sandbox, the test runner fails with
`spawn EPERM` before any assertion runs. That is an environment limitation, not a passing or failing
suite — re-run it in a normal shell to get a real result.

`npm test` covers the unit and integration behavior listed above. It does not prove that a specific
Codex desktop build delivers hook payloads, and it does not prove that any delegated change is
correct. Add your own review and your project's checks on top.

## 8. Reviewing a handoff, step by step

1. `handoff-fm doctor` — confirm the environment and that records are arriving.
2. `handoff-fm watch` — read the run: actor, kind, and evidence level per record.
3. Treat every `unknown` as a question: who actually wrote this file?
4. Run the project's own checks against the changes; a delegate exit 0 is only "submitted for review".
5. Only then export: default preview first, then add individual opt-ins and `--confirm`.
6. Review the preview in full before sharing — masking is best effort, not a guarantee.
