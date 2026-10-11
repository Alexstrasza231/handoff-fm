# Real case: refresh loses the collaboration

Approved direction: demonstrate a useful real collaboration before adding more onboarding features.

The running project exposed a bug: `/api/runs` reverses Map insertion order, so a recently active older run can be hidden behind an inactive newer run. The browser also discards an explicitly selected run on refresh.

1. Reproduce both failures against the real collector and loopback server.
2. Delegate only the server ordering fix to DeepSeek. Order by last journal reception, preserve titles/counts, and keep authentication unchanged.
3. Codex adds tab-local retention of an explicitly selected live run. Invalid stored choices fall back to the latest run; demo and offline views do not overwrite the live choice.
4. Review the actual patch, run core/browser/build checks, verify the live page, and publish a concise bilingual case with links to source and regression tests.

No private raw logs or prompts are published. Tool records are evidence of operations, not proof of authorship or thought ownership. Existing unrelated example edits stay outside this change.
