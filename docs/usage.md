# HandoffFM usage

HandoffFM records an already-authorized Codex + DeepSeek collaboration in one local project, replays
it in a loopback viewer, and exports an offline read-only copy of selected records.

This guide covers install, the CLI, watching, delegating to DeepSeek, and offline export. The
evidence model (what is actually proven) is in [evidence.md](./evidence.md). Nothing here
authorizes new delegation by itself: you decide what the agents may do, HandoffFM only observes it.

## 1. Requirements and install

| Item | Requirement |
| --- | --- |
| Node.js | 22.12 or newer (`engines.node >= 22.12.0`); `doctor` enforces this |
| DeepSeek CLI (`dsh`) | installed and already authenticated; needed for `delegate` only, and HandoffFM never reads credentials |
| Codex | a version that supports plugins and hooks, plus a trusted hook review flow |
| OS | Windows PowerShell and POSIX shells are both documented; Windows is the only platform exercised end-to-end so far |

Install the released bundle. It contains the built CLI (`dist/`) and the built viewer
(`web-dist/`), so no build step and no dev dependencies are required:

```sh
npm install -g https://github.com/Alexstrasza231/handoff-fm/releases/download/v0.1.2/handoff-fm-0.1.2.tgz
cd /path/to/your/project
handoff-fm init
handoff-fm doctor
```

The same tarball is what the tracked `dist/` and `web-dist/` directories in this repository are
built for, so the Codex plugin and the release artifact behave identically.

Working from a git checkout instead:

```powershell
# Windows PowerShell
npm ci
npm run build      # tsup -> dist/cli.js, vite -> web-dist/
node dist/cli.js doctor
```

```sh
# POSIX
npm ci
npm run build
node dist/cli.js doctor
```

Notes:

- `dist/cli.js` is the hook entry point and the `handoff-fm` bin. Rebuild after pulling changes.
- The offline export and the watch viewer need the web build output (`web-dist/`). If `web-dist/`
  is absent, `watch` answers `Resource unavailable` for the page and `export` fails reading
  `web-dist/index.html`; run `npm run build` first.
- Released v0.1.2 is a GitHub release artifact. It is not published to any package registry, so
  `npm install handoff-fm` or `npx handoff-fm` will not resolve.
- In the examples below, `handoff-fm <command>` stands for the global install; from a checkout use
  `node dist/cli.js <command>`.

## 2. CLI overview

```
handoff-fm <command> [options]
```

| Command | Purpose |
| --- | --- |
| `init` | enable one project directory and register it |
| `doctor` | check Node, the DeepSeek JSON interface, and whether Codex hook records have arrived |
| `watch` | serve the live viewer on loopback with a per-run access token |
| `delegate deepseek` | run one DeepSeek task and record it as part of the parent Codex session |
| `export` | write a preview, then a confirmed offline HTML copy, of one run |
| `collect` | drain queued records into the durable log and print all events |
| `hook` | internal: reads one hook JSON payload from stdin; not meant to be called by hand |

Global conventions:

- `--project PATH` selects an enabled project; without it the project is the current directory.
- Options are `--name value`; a bare `--name` becomes `true`.
- Every command returns non-zero on failure. `doctor` returns non-zero when Node is too old or the
  DeepSeek JSON interface is unavailable.

## 3. Init: enable exactly one project

```powershell
# Windows PowerShell — enable the current repository
node dist/cli.js init

# or an explicit path, with a non-PATH DeepSeek wrapper
node dist/cli.js init --project C:\work\my-app --dsh-command "C:\Tools\dsh\dsh.cmd"

# bind a desktop chat that lives in a different working directory
node dist/cli.js init --bind-session <ACTUAL_CODEX_SESSION_ID>
```

```sh
# POSIX
node dist/cli.js init
node dist/cli.js init --project /home/me/my-app --dsh-command /opt/dsh/bin/dsh
node dist/cli.js init --bind-session <ACTUAL_CODEX_SESSION_ID>
```

What `init` does:

- creates `.handoff-fm/` with `inbox/`, `objects/`, `pending/`, `quarantine/` and a `config.json`;
- adds `.handoff-fm/` to the project's `.gitignore` if it is not already present, so local records
  are not committed by accident;
- registers the resolved project path in the machine-local registry
  (`%USERPROFILE%\.handoff-fm\projects.json` or `$HANDOFF_FM_HOME/projects.json`).

`init` preserves an existing `config.json`; it never overwrites it. The flags explicitly extend
what is already there: `--dsh-command` sets `dshCommand`, and `--bind-session` appends to
`boundSessions` once (a duplicate session ID is not added twice). Re-running `init` with no flags
only re-registers the project. To change `dshCommand` by hand, edit `.handoff-fm/config.json` and
keep `boundSessions` intact:

```json
{ "version": 1, "root": "C:\\work\\my-app", "dshCommand": "C:\\Tools\\dsh\\dsh.cmd", "boundSessions": [] }
```

`--bind-session` is only needed when the Codex chat runs in a parent directory of this project; it
lets hook payloads from that exact session be attributed to this project. Bind only real session
IDs you have read from the current session context — never invent one.

`doctor` and `delegate` need to find `dsh`. If `dsh headless --help` works in your normal shell but
`doctor` reports `deepseekJSON: not available`, the path used by the desktop/Codex environment
differs — re-run `init` with `--dsh-command` pointing at the exact CLI path.

## 4. Install the Codex plugin and trust its hooks

The plugin manifest is [`../.codex-plugin/plugin.json`](../.codex-plugin/plugin.json); it points at
`./hooks/hooks.json` and the bundled skill. Adding the plugin is not the same as trusting its hooks.

```sh
# 1. add the GitHub marketplace, then the plugin
codex plugin marketplace add https://github.com/Alexstrasza231/handoff-fm
codex plugin add handoff-fm@handoff-fm

# 2. review the exact hook definitions and trust them
#    in the Codex client, open /hooks and approve each definition you want
```

Trust the exact **six** hooks this plugin defines. Some desktop clients expose their own trust UI
instead of `/hooks`; use whichever surface your client provides, and read the definitions there
before approving. The definitions you are approving are exactly the six events in
`hooks/hooks.json` (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`,
`Interrupt`), each running `node "${PLUGIN_ROOT}/dist/cli.js" hook` with a 3-second timeout.

- The hooks are observation-only: they never block, approve, or rewrite a tool call. If recording
  fails, the hook writes a short warning to stderr and leaves the tool run unaffected.
- Do not use any bypass, force, or skip-trust flag to get around hook review. If you are not ready
  to trust the hooks, leave them untrusted; you simply will not get records.
- After trusting, `doctor` shows `codexHooks: observed` once a real Codex session has produced at
  least one `tool.started` record in this project. On Windows with the Codex desktop app this has
  been observed with real `apply_patch` hook records. It is still per-project evidence that records
  are arriving, not proof that every client, OS, or turn is captured completely — see
  [evidence.md](./evidence.md).

## 5. Doctor

```powershell
node dist/cli.js doctor --project C:\work\my-app
```

```sh
node dist/cli.js doctor --project ~/my-app
```

It prints JSON and exits non-zero if a hard requirement is missing:

```json
{
  "node": "ok",
  "deepseekJSON": "ok",
  "codexHooks": "observed",
  "project": "C:\\work\\my-app"
}
```

- `node`: `ok`, or `Node 22.12+ required`.
- `deepseekJSON`: `ok` when `dsh headless --help` succeeds and mentions `--json`; otherwise
  `not available`. Fix the PATH or pass `--dsh-command` at `init`. A development machine where
  `dsh` is not on `PATH` legitimately reports `not available` and exits `1` even though delegation
  would work through an explicitly configured `dshCommand`.
- `codexHooks`: `observed` once a Codex `tool.started` record exists, else `not yet verified`. This
  says nothing about whether a specific turn was recorded completely.
- `doctor` exits non-zero when either `node` or `deepseekJSON` is not `ok`; `codexHooks` never
  changes the exit code.

## 6. Watch: the live local viewer

The home page shows Codex and DeepSeek, one recent action each, the task title, connection state,
and one row of recorded task usage. Missing usage stays unavailable. Model and instance IDs live in details.

- **查看详情** opens the **过程记录 / 用量明细** tabs. Click a character to filter to that side.
- **回放过程** opens playback position, speed, stepping and handoff/failure navigation.
- **更多** contains run selection, sample playback, sharing and caption/motion preferences.
- **看个例子** in the empty state enters a clearly labelled static sample; no model calls.

Stage captions are fixed fictional dialogue. Real quotes and command results remain in evidence.
See [recorded task usage](./usage-tokens.md) for sources, partial coverage, association and `--usage` exports.

```powershell
node dist/cli.js watch --project C:\work\my-app
node dist/cli.js watch --project C:\work\my-app --port 4500   # if 4417 is taken
```

```sh
node dist/cli.js watch --project ~/my-app
node dist/cli.js watch --project ~/my-app --port 4500
```

The process prints a one-time URL and stays in the foreground:

```
HandoffFM watching enabled project
http://127.0.0.1:4417/#token=<32-byte hex>
Keep this process running. The URL grants access to local records; do not share it.
```

Behavior worth knowing:

- The server binds `127.0.0.1` only, and rejects requests whose `Host` is not exactly
  `127.0.0.1:<port>` (403). An `Origin` header, when present, must be `http://127.0.0.1:<port>`.
  Use the printed URL; `localhost` or a LAN IP will be refused.
- Every `/api/*` request needs the token, either as the `token` query parameter or an
  `Authorization: Bearer <token>` header. The page reads the token from the URL fragment and sends
  it as a bearer token. Static files are served without a token but are still Host- and
  Origin-checked, and the data endpoints still require it.
- The service is read-only: non-GET requests get 405, and there is no command execution endpoint.
  It does not modify your project; it only runs the collector against `.handoff-fm/`.
- Port conflicts fail fast with `Port <n> is in use. Choose --port NUMBER.` Ports are validated to
  be integers in 1–65535. Pick another port and restart.
- Live updates use Server-Sent Events at `/api/stream`. The server replays events after the
  client's `Last-Event-ID`/`since` sequence number, sends a heartbeat every 300 ms, and drops a
  stream whose buffer exceeds 1 MiB. If you open the stream without `since`, it replays every
  recorded event first.
- On restart, records are durable: queued files in `.handoff-fm/inbox/` are drained into
  `.handoff-fm/events.jsonl` by the collector (also run by `watch`, `collect`, and `export`), and a
  reconnecting page resumes from its last sequence number. Stop with Ctrl+C; a stopped watcher does
  not lose already-recorded events.
- The viewer's stage captions are deterministic humor, not statements by either agent. Do not quote
  them as model output.

## 7. Delegate one task to DeepSeek

`delegate` streams a bounded task text over stdin to `dsh headless --json -`, records the normalized
event stream, prints DeepSeek's final answer to stdout, and prints the run/task IDs to stderr. It
does not grant DeepSeek any new permission: keep your existing tool and scope restrictions in place
before running it.

### 7.1 Write the task file

Write the bounded task text to a project-local file. A gitignored location such as `.handoff-fm/`
keeps the task file out of snapshots and out of Git.

```powershell
# Windows PowerShell
New-Item -ItemType Directory -Force .handoff-fm | Out-Null
@'
Summarize the failing test in tests/store.test.ts and propose the smallest fix.
Do not commit. Report the files you would touch and why.
'@ | Set-Content -Encoding utf8 .handoff-fm\task.md
```

```sh
# POSIX
mkdir -p .handoff-fm
cat > .handoff-fm/task.md <<'EOF'
Summarize the failing test in tests/store.test.ts and propose the smallest fix.
Do not commit. Report the files you would touch and why.
EOF
```

The task must be non-empty and at most 128 KiB.

### 7.2 Use the actual parent session ID

`--parent-session` is required and must be the real Codex session ID of the turn that is
delegating. Read it from the current session/hook context; do not invent it. `--parent-turn` is
optional — pass the real turn ID when you have it, and omit it otherwise.

```powershell
# Windows PowerShell
node dist/cli.js delegate deepseek `
  --task-file .handoff-fm\task.md `
  --title "Fix store test" `
  --parent-session <ACTUAL_CODEX_SESSION_ID> `
  --parent-turn <ACTUAL_CODEX_TURN_ID> `
  --project C:\work\my-app
```

```sh
# POSIX
node dist/cli.js delegate deepseek \
  --task-file .handoff-fm/task.md \
  --title "Fix store test" \
  --parent-session <ACTUAL_CODEX_SESSION_ID> \
  --parent-turn <ACTUAL_CODEX_TURN_ID> \
  --project ~/my-app
```

Why the exact ID matters: records are grouped by `runId`. When the parent session ID is a plain
identifier (`A–Z a–z 0–9 _ -`, up to 160 characters) it is used as the run ID verbatim, so Codex and
DeepSeek records land in one replayable run. Anything else is hashed, and the delegation would
appear as a separate run with no visible parent link. Use `--parent-session` with the session ID as
Codex reports it.

### 7.3 What you get back

- stdout: DeepSeek's final answer (written through unchanged).
- stderr: `HandoffFM run: <runId>; task: <taskId>` — the run ID for `watch` and `export`.
- exit code: `0` only when the process exited 0, a final message arrived, and the completion reason
  was absent or `completed`. Any other combination exits `1` and records `delegate.failed`.

A successful exit means the handoff is **submitted for review** (交稿待检查), not accepted. Exit code
`0` only says *that command* passed. Inspect the changed files with your own tools, run your
project's checks, and keep recording your own edits through the hooks.

### 7.4 Continue an existing DeepSeek session

Pass `--session-id` to reuse an existing DeepSeek session instead of starting a fresh one. Read the
real session ID from the records rather than guessing it — DeepSeek's `session` event carries it:

```powershell
# Windows PowerShell — list the recorded session IDs for this run
node dist/cli.js collect --project C:\work\my-app |
  ConvertFrom-Json |
  Where-Object { $_.actor -eq 'deepseek' -and $_.kind -eq 'session.started' } |
  Select-Object -Last 1 sessionId, runId
```

```sh
# POSIX — same, without extra tooling
node dist/cli.js collect --project ~/my-app \
  | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{for(const e of JSON.parse(s))if(e.actor==="deepseek"&&e.kind==="session.started")console.log(e.runId,e.sessionId)})'
```

Then continue that same conversation with a second bounded task:

```sh
node dist/cli.js delegate deepseek \
  --task-file .handoff-fm/task2.md \
  --title "Follow-up on the same session" \
  --parent-session <ACTUAL_CODEX_SESSION_ID> \
  --session-id <ACTUAL_DEEPSEEK_SESSION_ID> \
  --project ~/my-app
```

Both tasks are recorded under the same parent `runId` (grouped by the Codex session), while the
DeepSeek session ID shows that the second task continued the first conversation.

## 8. Offline export: preview first, then confirm per category

`export` reads only local records, runs no scripts, and makes no network requests. The output HTML
carries a CSP of `default-src 'none'` with no `connect-src`, so the exported file cannot phone home
or execute page logic beyond its own bundle.

```powershell
# 1. default preview — roles, generic event types, relative timing only
node dist/cli.js export <RUN_ID> --output C:\work\share\run.html --project C:\work\my-app

# 2. inspect the preview, then opt in to individual categories and confirm
node dist/cli.js export <RUN_ID> --output C:\work\share\run-confirmed.html --project C:\work\my-app `
  --prompts --paths --diffs --outputs --confirm
```

```sh
# 1. default preview
node dist/cli.js export <RUN_ID> --output ~/share/run.html --project ~/my-app

# 2. opt in per category and confirm
node dist/cli.js export <RUN_ID> --output ~/share/run-confirmed.html --project ~/my-app \
  --prompts --paths --diffs --outputs --confirm
```

How the switches behave:

| Flag | Adds to the export |
| --- | --- |
| (none) | actor, event kind, sequence, evidence level, aliased run/session/task IDs, relative time only |
| `--prompts` | task prompt and title text |
| `--paths` | file paths on `file.changed` records |
| `--diffs` | stored diffs on `file.changed` records |
| `--outputs` | tool/agent text, output, exit code, status, failure message and completion reason |
| `--confirm` | writes the real output path instead of a preview |

Practical rules:

- Preview is the default and is safe by construction: fields that were not opted in are not copied
  into the export at all. `at` becomes a relative offset from the run's first event, and run,
  session and task IDs become `run-1`, `instance-1`, `task-1` aliases.
- Preview writes `<output>.preview.html` and never overwrites: the file is created exclusively, so
  an existing preview makes the command fail. Delete the old file or choose a new `--output`.
- `--confirm` only changes the destination path; it does not add categories. To both preview and
  confirm, repeat the command (preview first, then the same command with `--output` pointing at the
  confirmed name and `--confirm`).
- Opted-in prompts, paths, diffs and outputs can contain secrets, absolute paths, tokens pasted
  into a task, or credentials echoed by a tool. Masking (bearer tokens, `sk-`/`ghp_`-style keys,
  `*_API_KEY=...`/`PASSWORD=`/`SECRET=`/`TOKEN=` assignments, and secret-named keys) is best
  effort only. Review the preview yourself, in full, before you confirm or share.
- The viewer's `/api/export` endpoint mirrors this: `?run=<id>` plus the same flags, always read-only
  and authenticated by the watch token.

## 9. Where records live

Everything is project-scoped and local:

```
<project>/.handoff-fm/
  config.json        project config (dshCommand, boundSessions)
  CONNECT.md         local setup reminder written by init
  inbox/             queued records awaiting collection
  objects/           content-addressed blobs of file contents/diffs
  pending/           in-flight tool bookkeeping
  quarantine/        records rejected by validation, kept for review
  events.jsonl       the durable, append-only event log (one JSON object per line)
  journal.lock       exclusive collector directory with a PID + nonce owner marker
```

- `.handoff-fm/` is added to `.gitignore` by `init`; keep it that way. The global registry
  (`~/.handoff-fm/projects.json`) also stays on the machine, never in the repository.
- `hook` records only for projects that were both `init`-ed and are in scope for the payload's
  working directory (or explicitly bound to the session). Unrelated projects are simply not
  recorded — the hook is silent by design.
- Records are append-only. Atomic directory creation and a unique PID + nonce marker identify the
  collector. A live owner is never displaced by age. Recovery removes only an observed dead owner's
  exact marker and an empty directory; a half-created empty lock recovers after 10 seconds. A fresh
  owner's marker prevents a delayed reclaimer from deleting its directory. Deduplication by record
  ID is persisted in the log itself, so it survives restarts.
- Collection also repairs a torn tail: an uncommitted trailing fragment with no newline is
  truncated away while every committed line is retained, then the damage is marked with exactly one
  `recording.gap`. Invalid or oversized inbox records are quarantined and produce the same single
  `recording.gap` instead of disappearing silently.
- Snapshots exclude dependency and build directories (`node_modules`, `dist`, `web-dist`, `build`,
  `coverage`, `test-results`, `playwright-report`, `.git`, `.work`, `.handoff-fm`), dotenv and
  credential files, key material, binary files, files over 1 MiB, and symlinks; they stop after
  5000 files. Changes in excluded paths are never claimed.

## 10. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `HandoffFM: recording gap; tool execution is unaffected.` | A hook payload could not be read or attributed. The tool run was untouched. Check `doctor`, then that the project is enabled and in scope. |
| `codexHooks: not yet verified` | No Codex `tool.started` record in this project. Confirm the plugin is added, the hooks are trusted, and the session's working directory is inside the project (or bind the session). |
| `deepseekJSON: not available` | `dsh headless --help` failed or lacks `--json` (this also makes `doctor` exit 1). Fix PATH or re-init with `--dsh-command`. |
| `Port 4417 is in use.` | Another watcher holds the port. Stop it or pass `--port`. |
| `Resource unavailable` on the page | The web build is missing; run `npm run build` so `web-dist/` exists (not needed for a release install). |
| 403 `Invalid Host` | You opened `localhost` or a LAN address. Use `http://127.0.0.1:<port>/#token=<token>`. |
| 401 `Access token required` | The token is missing or wrong. Re-copy the printed URL, including everything after `#`. |
| `Unsafe DSH path or argument` | A Windows `.cmd`/`.bat` command path contains shell metacharacters, or a delegate argument is not a plain identifier. Point `--dsh-command` at a clean path; task text always travels over stdin, never as an argument. |
| `Run has no recorded events` | The run ID does not exist in this project, or the log has no committed events for it. Check `/api/runs` or `collect`. |
| Preview fails with `EEXIST` | `<output>.preview.html` already exists. Delete it or use a new `--output`. |
| `delegate` exits 1 | DeepSeek exited non-zero, sent no final message, or reported a non-`completed` reason. The failure is recorded as `delegate.failed`; read the recorded reason before retrying. |
| `HandoffFM: journal unlock delayed; committed records are safe.` | Windows delayed owner-marker cleanup. The next collection retries release; committed records are already fsynced. Live PID owners are never removed by age. |

## 11. Related documents

- [../README.md](../README.md) and [../README.zh-CN.md](../README.zh-CN.md) — project overview and
  quickstart.
- [evidence.md](./evidence.md) — evidence levels, attribution rules, and what current tests do and
  do not establish.
- [../skills/handoff-fm/SKILL.md](../skills/handoff-fm/SKILL.md) — the packaged skill that drives
  this workflow from Codex.
- [../.codex-plugin/plugin.json](../.codex-plugin/plugin.json) and
  [../hooks/hooks.json](../hooks/hooks.json) — the exact plugin and hook definitions you review.
