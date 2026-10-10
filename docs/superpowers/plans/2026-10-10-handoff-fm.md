# HandoffFM implementation plan

> For agentic workers: use subagent-driven-development / executing-plans. The human approved the full plan in this conversation.

Goal: Observe the existing Codex desktop + DeepSeek workflow, retain evidence, and replay it through a cute whale / dragon broadcast desk.
Architecture: Project-scoped hook and delegate producers -> atomic inbox -> single JSONL collector -> authenticated loopback SSE -> React viewer and offline export. No model calls by viewer/replay/export.
Tech: Node >=22.12, TypeScript, React, Vite, Playwright. Independent new repository on codex/v0.1.0.

- [x] T1 Write failing tests for scope/privacy, durable deduplication and normalized events; implement collector, hooks, snapshot evidence and CLI init/doctor.
- [x] T2 Implement/test delegate adapter against DSH JSON source; probe real DeepSeek; install concrete Codex plugin and verify trusted desktop hooks. Actual desktop apply_patch and CLI collaboration events arrived; nested tool delivery is incomplete and documented. Synthetic inputs are fixture tests, not desktop acceptance.
- [x] T3 Give DeepSeek bounded UI/examples/documentation tasks and verify actual edits. Per the human's later art direction, ship sixteen classic community character pose adaptations, with per-asset attribution/noncommercial terms instead of the original CC BY design proposal.
- [x] T4 Test-first loopback API, SSE restart/reconnect, selective offline export and injection escaping; integrate viewer/replay with actual data.
- [x] T5 Browser tests, Windows real collaboration chain, independent spec/code review, bilingual documentation, actual recording and installation smoke check.
- [ ] T6 Public Alexstrasza231/handoff-fm MIT code + separately licensed classic community character adaptations (see LICENSE-ASSETS); source and v0.1.0 package; Windows/Linux CI; verify published install and plugin commands.

Tracking policy: tool output is evidence, final agent messages are declarations; shell/overlap/truncated evidence has unknown attribution. No percent authorship. Exclude secrets/build/binary/>1MiB, no hidden reasoning. Export defaults contain generic roles/kinds/relative time only, details are opt-in and previewed. Unknown history stays unknown.
