# The live collaboration disappeared on refresh

[中文](./refresh-selection.zh-CN.md) · [Server regression](../../tests/run-order.test.ts) · [Browser regressions](../../tests/browser/run-selection.spec.ts)

[Reviewed real event sequence](./refresh-events.json): 99 records covering dispatch through submission, with all content fields excluded, aliased IDs and relative times. [Screenshot](../media/refresh-case.png) shows this projection. Original evidence levels remain unchanged.

This was an actual issue found while using HandoffFM to develop HandoffFM on Windows. An older collaboration was receiving new records, but refreshing the viewer selected a different, inactive run. Manually selecting a run also failed to survive refresh.

## The useful question

“Which collaboration am I watching, and did that helper's patch actually pass review?” When several tasks overlap, a cute mascot is useful only if the records underneath it answer this question. This case gives the viewer a concrete job: keep the right collaboration visible, open the handoff evidence, then check the modification and validation separately.

| Step | Actual work | How to check it |
| --- | --- | --- |
| Codex reproduces | Added a real collector/server regression and a real browser refresh regression; both failed before the fix. | The tests below preserve these failures. |
| Codex → DeepSeek | Delegated only the backend run-ordering fix through the HandoffFM wrapper. | The local record contains the dispatch and DeepSeek tool events. |
| DeepSeek changes the server | Reinsert each run on received activity before reversing the Map. Preserve the title, count and original timestamp. | [Server source](../../src/server.ts); no authentication changes. |
| Codex changes the browser | Keep only the explicitly selected live run in tab-local session storage. Reject unavailable saved choices. Sample/offline views do not replace that choice. | [Selection logic](../../web/data.ts), [viewer](../../web/App.tsx). |
| Codex reviews | Run core tests, browser tests, type checking and the build, rather than treating a submitted patch as accepted. | Reproduce with the commands below and inspect GitHub CI. |

## Why it failed

`Map.set(existingKey, value)` changes the value but does not move the key. Reversing a Map therefore put the **last-created run** first, not the run with the **last-received activity**. Sorting by the producer's clock would also be wrong when clocks move backwards.

The regression uses deliberately small reproduction data, **not a fabricated agent session**:

```text
Journal reception: A starts → B starts → A receives another event
Before:            B, A
After:             A, B
```

Run A's final event has an older producer timestamp. It still comes first because journal reception order is authoritative. Separately, if a user selects B, refreshing keeps B: automatic recency and explicit user intent are different choices.

## Reproduce the checks

From a source checkout with Node.js 22.12+:

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:browser
```

The server test enqueues and collects real events and calls the authenticated loopback API. Browser tests use the same server, not a mocked response. They select the older task, refresh, open the sample, refresh again, and check a removed saved run falls back safely.

To observe your own task: start `handoff-fm watch`, ask Codex to delegate a bounded fix through `handoff-fm delegate deepseek`, and use **Replay latest handoff / 重播最近交接**. Open the packet for the actual task and result; use **Latest change / 查看最近修改** for recorded differences. A successful command proves that command passed; check the relevant tests before accepting the work.

## Evidence boundary

During this delegation, DeepSeek's sandbox rejected the normal `tsx` test command with `spawn EPERM`. Its submission reported a Node-native fallback check. Codex independently ran the standard `npm run check` and browser suite locally. This is why a submitted patch and its accepted verification stay separate.

This case does not claim a speedup, saved tokens, or complete coverage of every desktop operation. The wrapper's external tool stream is not a pre-write barrier, so candidate file changes retain `unknown` attribution, especially during concurrent edits. DeepSeek's test environment and Codex's validation environment can differ; the final checks must be reproduced rather than inferred from a character pose. Private task prompts, absolute paths and raw outputs are not part of this public case.
