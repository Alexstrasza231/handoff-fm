# Recorded Windows collaboration

v012-task-usage.png shows the v0.1.2 home page using an anonymous offline projection of the actual
development task. Usage was explicitly selected; prompts, paths, differences and outputs were
excluded. Both agents' task coverage remains partial. The reviewed numbers and limitations are
documented in ../cases/task-usage.md; ../cases/task-usage-events.json is the selected event projection.
Character artwork keeps the same per-asset terms below.

real-handoff.webm is an actual browser recording of a selectively exported real Codex → DeepSeek → Codex run, not the sample replay. The recording uses the replay's event selection controls to skip waits; the event timestamps are unchanged.

The shared component is examples/HandoffCard.tsx. The two diffs retain unknown attribution because the recorded operations overlap or have no pre-write barrier. The first TypeScript command reported a missing Intl.Segmenter library. A corrected command was then run; the final agent answer declares exit status 0. These Codex Bash hook responses contain stdout but no structured exit code, so the viewer does not upgrade that declaration to direct command evidence.

real-events.json is the exact selected export with aliased instance/task IDs and relative times. Prompts and private IDs are omitted; paths, the two code diffs and selected outputs were reviewed before publication. Model information is deliberately omitted by the export. The full raw local journal is not published.

The original desk.png is labelled sample replay. real-desk.png and real-handoff.webm show the real offline replay. Character artwork retains the per-asset attribution/noncommercial terms in LICENSE-ASSETS.
