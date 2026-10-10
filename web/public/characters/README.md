# Character art (shipped raster assets)

`vite.config.ts` sets `publicDir: web/public`, so everything here is copied to `web-dist/` verbatim
and served from the site root. `src/export.ts` inlines every `characters/[a-z-]+.png` file as a data
URI into the offline export, so keep lowercase-and-dash file names and PNG format.

The sixteen poses are present and shipped (eight per side):

| Pose | Codex (dragon) | DeepSeek (whale maid) |
| --- | --- | --- |
| `idle` | `codex-idle.png` | `deepseek-idle.png` |
| `accept` | `codex-accept.png` | `deepseek-accept.png` |
| `read` | `codex-read.png` | `deepseek-read.png` |
| `edit` | `codex-edit.png` | `deepseek-edit.png` |
| `run` | `codex-run.png` | `deepseek-run.png` |
| `handoff` | `codex-handoff.png` | `deepseek-handoff.png` |
| `celebrate` | `codex-celebrate.png` | `deepseek-celebrate.png` |
| `error` | `codex-error.png` | `deepseek-error.png` |

`web/components.tsx` resolves `/characters/<side>-<pose>.png`, preferring the inlined asset map when
an offline export provides one. The viewer hides a pose until it loads and falls back to a neutral
"立绘待补" tile if a file is missing or fails to load, so the UI stays usable with art removed. No
placeholder SVG mascots are used anywhere in `web/`.

These sprites are display skins for "which side is which", not statements about the actual model
identity; the interface separately shows observed tool/model metadata and displays "未知" when it is
unavailable.

## Licensing — read [../../LICENSE-ASSETS](../../LICENSE-ASSETS)

Character artwork is **not** covered by the code's MIT license, and it is **not** original CC BY
artwork. Attribution and noncommercial terms apply, and they differ per asset:

- DeepSeek whale maid: original whale by 上善 / 上善无形, DeepSeek maid adaptation by ZipZipPipe;
  the source identifies this whale adaptation as **CC BY-NC-SA 4.0**. HandoffFM's chibi proportions,
  props and pose variants were adapted by Alexstrasza231 using OpenAI image generation (October 2026).
- White dragon: community GPT dragon design by ZipZipPipe, adapted for HandoffFM by Alexstrasza231
  using OpenAI image generation, under the source author's attribution-required, noncommercial-use
  permission. No separate CC license or MIT grant is claimed for it.

Keep the notice with the files when redistributing, and identify further changes. Users who need
different terms can replace these sprites with their own licensed artwork; the software stays MIT.
