# Simple Stage Implementation Plan

> Execute inline with a bounded DeepSeek UI delegation; the user authorized this direction and requested implementation.

**Goal:** A compact, playful viewer whose recorded participants and actions are immediately legible.

**Architecture:** Keep the collector, API and event schema. Add pure presentation helpers, progressively disclose existing evidence/history, and restyle the recorded-event stage. DeepSeek owns stage component styling and captions; Codex owns integration and validation.

**Tech Stack:** Existing TypeScript, React, Vite, Node test runner and Playwright.

- [ ] Add failing presentation and browser assertions. Test wrapped prompt titles, recent event identities, unknown attribution and compact evidence/replay flow. Run `node node_modules/tsx/dist/cli.mjs --test tests/presentation.test.ts` and `npx playwright test tests/browser/simple-stage.spec.ts --workers=1`; confirm missing behavior.
- [ ] Implement `web/presentation.ts` for title cleanup, recent activity indexes and latest handoff location. Delegate only `web/components.tsx` stage/card sections, `web/styles.css`, and `web/helpers.ts` subtitle function to DeepSeek; preserve Timeline/EvidencePanel and evidence semantics.
- [ ] Integrate in `web/App.tsx`: concise current title, more menu, latest diff, latest handoff replay, recent activity, expandable history and evidence. Keep all raw fields available. Update existing browser helpers to reveal intentionally collapsed controls, preserving their substantive assertions.
- [ ] Run `npm run check`, `npm run test:browser -- --workers=2`, inspect the actual `127.0.0.1:4417` page after rebuilding, and save a screenshot. Fix failures before declaring success.
- [ ] Update bilingual usage notes and check `git diff --check`. Deliver the revised local page; do not publish a new release as part of this UI iteration.
