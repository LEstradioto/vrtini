# Manual test plan (post-refactor smoke)

Run this **after** the refactoring backlog is fully landed. The Vitest suite (374 tests) covers comparison logic and persistence, but the live pipeline — Docker capture, SSE, abort, profile switching, AI vision — is not in CI. This is the gate before tagging a release.

## How to use

- Run each block in order; each row is independent and bisectable if it fails.
- "Expected" is the literal pass/fail criterion — if the observed behavior differs in any way, write it down and stop the block.
- Two columns: **Before** (commit on `main` before the refactor session) and **After** (HEAD after all sessions land). Same command, same fixture, compared by eye + diff of artifact JSON.

---

## Block 1 — Web run end-to-end (highest value)

Exercises: SSE progress, capture diagnostics (commit L), terminal-state helpers (commit M), atomic JSON writes, profile resolution, image metadata persistence.

| #   | Action                                                  | Expected                                                                                                          |
| --- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1.1 | Start `vrtini server`, open the project in the UI       | Sidebar shows project + at least one profile sub-tab                                                              |
| 1.2 | Click "Run test" on the default profile                 | SSE stream starts; `phase` cycles `capturing` → `comparing` → `done`                                              |
| 1.3 | While running, watch the progress bar                   | `progress` increments monotonically; `total` matches scenarios × browsers × viewports                             |
| 1.4 | After completion                                        | `status === 'completed'`, `completedAt` is set, `timing.totalDuration` is populated                               |
| 1.5 | Inspect `.vrtini/<profile>/output/.image-metadata.json` | Schema version present, every captured filename has an entry, atomic write left no `.tmp` files behind            |
| 1.6 | Re-run the same test                                    | Diff thumbnails update, no stale diffs from previous run remain                                                   |
| 1.7 | Open a result with a known intentional regression       | Report shows pixel/SSIM/phash metrics, diff image renders, capture warnings (if any) appear in the warnings strip |

## Block 2 — Abort mid-run (catches the "abort wins" rule)

Exercises: commit M's `markAborted` / `markFailed` precedence, container teardown, signal plumbing.

| #   | Action                                                               | Expected                                                                                       |
| --- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 2.1 | Start a long run (≥ 8 scenarios, slow site)                          | Progress visible, `containerIds` populated                                                     |
| 2.2 | Click abort while in `capturing` phase                               | `status` flips to `aborted` within ~2s, `completedAt` set, no further progress events          |
| 2.3 | `docker ps` immediately after                                        | No `vrtini-playwright` containers from this run still alive                                    |
| 2.4 | Repeat 2.1–2.2 but abort during `comparing` phase                    | Same as above; partial `results` array may exist but status must be `aborted`, not `completed` |
| 2.5 | Force a capture failure (kill the target server mid-run), then abort | `status === 'aborted'` (not `failed`) — abort wins over the post-abort error                   |

## Block 3 — Cross-compare run

Exercises: cross-compare-job-service terminal helpers, the `runCrossCompare` plan + per-item split (commit F).

| #   | Action                                                                           | Expected                                                                                                      |
| --- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 3.1 | Configure two baselines (or two captured runs), launch cross-compare from the UI | SSE shows `pairIndex` / `pairTotal` advancing                                                                 |
| 3.2 | On completion                                                                    | `status === 'completed'`, `progress === total`, `phase === 'done'`, `reports` array length matches pair count |
| 3.3 | Inspect a generated cross-report HTML                                            | Pairs render side-by-side, acceptances and engine metrics present                                             |
| 3.4 | Trigger a known regression in one of the runs                                    | Cross-report flags it as a failing pair with non-zero diff                                                    |

## Block 4 — Graceful shutdown

Exercises: the SIGTERM hook (commit `1abc966`), `abortAllRunningJobs`, `markAllRunningJobsAsFailed`.

| #   | Action                                                | Expected                                                                                                                                               |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4.1 | Start a test job and a cross-compare job concurrently | Both report `status === 'running'`                                                                                                                     |
| 4.2 | Send `SIGTERM` to the server PID                      | Server exits within the configured grace window (no infinite hang)                                                                                     |
| 4.3 | After exit, `docker ps`                               | No leaked `vrtini-playwright` containers from either job                                                                                               |
| 4.4 | Restart server, query the persisted job records       | TestJob is `aborted`; CrossCompareJob is `failed` with `error: "Server shutting down"` (current behavior — the asymmetry is intentional, see commit M) |

## Block 5 — AI vision analysis

Exercises: the chunking pipeline (commit I), aggregation (commit J), provider selection from env, OpenRouter base-URL allowlist.

| #   | Action                                                                                     | Expected                                                                                           |
| --- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| 5.1 | Pick a short page (< 2× viewport height), trigger AI analyze                               | Single-chunk path; result has one chunk in `details`, no aggregation reasoning                     |
| 5.2 | Pick a tall page (> 4× viewport), trigger AI analyze                                       | Multi-chunk path; `details` shows multiple `Chunk N: …` lines, `reasoning` mentions weighted score |
| 5.3 | With `recommendation === 'approve'` from chunks but one chunk reports `severity: critical` | Final `recommendation` downgrades to `review`                                                      |
| 5.4 | Set OpenRouter `baseUrl` to a non-allowlisted host                                         | Provider creation throws (allowlist enforced)                                                      |
| 5.5 | Cancel an analyze mid-flight                                                               | No stuck chunked image temp dir under `/tmp/` (cleanup runs in `finally`)                          |

## Block 6 — DOM snapshot / DOM diff

Exercises: `docker/dom-snapshot.js`, `src/engines/dom-diff.ts`, classification → scoring.

| #   | Action                                               | Expected                                                                                                    |
| --- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 6.1 | Enable `domSnapshot.enabled = true` in config, run   | `.snapshot.json` files appear next to PNGs in output dir                                                    |
| 6.2 | Introduce a text-only change in the dummy app, rerun | Report's DOM insights section shows text findings; pixel diff may also flag, but DOM finding is independent |
| 6.3 | Move an element 10px right (layout shift)            | Layout finding registered                                                                                   |
| 6.4 | Change a color                                       | Style finding registered                                                                                    |
| 6.5 | Disable `domSnapshot`, rerun                         | No `.snapshot.json` written; capture diagnostic warning _not_ triggered                                     |

## Block 7 — Profiles

Exercises: `listProfileConfigs`, `extends` resolution, per-profile baseline/output dirs.

| #   | Action                                                   | Expected                                                               |
| --- | -------------------------------------------------------- | ---------------------------------------------------------------------- |
| 7.1 | Add a second `vrtini.<name>.config.json` at project root | Sidebar gains a sub-tab for the new profile                            |
| 7.2 | Switch profile in the sidebar                            | URL/state reloads; baselines and outputs come from `./.vrtini/<name>/` |
| 7.3 | Profile config uses `extends: "./vrtini.config.json"`    | Inherited fields merge; arrays in child replace arrays in parent       |
| 7.4 | Two profiles, run sequentially                           | Neither overwrites the other's baselines                               |
| 7.5 | Add a circular `extends` chain                           | Config load fails fast with a clear error, not a stack overflow        |

## Block 8 — Auto-thresholds

Exercises: `computeAutoThresholdCaps`, `resolveDiffThresholds` (commit K).

| #   | Action                                                                  | Expected                                                                |
| --- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 8.1 | Disable auto-thresholds, run                                            | Thresholds come from `scenario.diffThreshold` ?? `config.diffThreshold` |
| 8.2 | Enable auto-thresholds, accept ≥ 5 acceptances per (scenario, viewport) | Subsequent runs apply the p95 cap (never raises above user threshold)   |
| 8.3 | < 5 acceptances for a group                                             | No cap applied for that group; user threshold used as-is                |

## Block 9 — Smart-pass / acceptance ledger

Exercises: acceptance write path, smart-pass diff restoration.

| #   | Action                                 | Expected                                                                                                                                  |
| --- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 9.1 | Approve a diff via UI                  | Acceptance JSON updated atomically; `acceptances.json` has new entry                                                                      |
| 9.2 | Rerun — same diff appears again        | Smart-pass kicks in; result marked passed; diff PNG restored from cache (covered by `cross-compare-service.test.ts`, but verify visually) |
| 9.3 | Approve, then change the diff slightly | Smart-pass does _not_ match; result stays failed                                                                                          |

## Block 10 — CLI smoke (non-web entrypoints)

Exercises: `src/commands/test.ts`, `src/commands/cross-compare.ts`. Web flow doesn't cover these.

| #    | Action                                   | Expected                                                                  |
| ---- | ---------------------------------------- | ------------------------------------------------------------------------- |
| 10.1 | `npx vrtini test` from the dummy app dir | Exits 0 on match, non-zero on regression; HTML report written             |
| 10.2 | `npx vrtini cross-compare <a> <b>`       | Cross-report HTML written; exit code reflects pass/fail                   |
| 10.3 | `npx vrtini test --quick`                | Skips phash + heavier engines; runs faster                                |
| 10.4 | `npx vrtini build`                       | Builds the playwright Docker image, tags it `vrtini-playwright:<version>` |
| 10.5 | `npx vrtini --help`                      | All commands listed, no stale `vrt` strings in output                     |

## Block 11 — Operational gaps regression check

Exercises: SSE timeout, AI rate limit, thumbnail concurrency cap (commit `1abc966`).

| #    | Action                                     | Expected                                                                          |
| ---- | ------------------------------------------ | --------------------------------------------------------------------------------- |
| 11.1 | Open the UI, wait > 5 minutes idle         | SSE stream stays open or reconnects cleanly; no zombie connections in server logs |
| 11.2 | Trigger 50 AI analyses in quick succession | Rate limiter throttles; no 429s bubble up to UI; user-visible queue behavior      |
| 11.3 | Open a project with 200+ thumbnails        | UI does not OOM; concurrency cap on PNG decode holds                              |

---

# Dummy "golden app" roadmap

Goal: ship a tiny app _inside this repo_ (e.g. `fixtures/golden-app/`) that exercises every detection vector vrtini supports. If a refactor breaks the user-visible behavior, the dummy app's regression suite catches it without needing access to a real consumer repo.

## Why bake it in

- Detached fixtures rot. A `fixtures/` dir checked into the same repo is reviewed alongside the code that consumes it.
- It doubles as a demo for new users: `vrtini test --config fixtures/golden-app/vrtini.config.json`.
- It lets the manual test plan above be **scripted** later — a Playwright-driven runner that visits each variant and asserts vrtini's output.

## Layout

```
fixtures/golden-app/
  vrtini.config.json           # baseline profile
  vrtini.regressions.config.json # second profile, points at /broken/* variants
  public/
    index.html                 # link hub to every variant
    static/                    # variant 1 — pure static page
    text/                      # variant 2 — text-heavy
    layout/                    # variant 3 — flexbox grid (and broken sibling)
    color/                     # variant 4 — palette swap
    typography/                # variant 5 — webfont + fallback flake
    tall/                      # variant 6 — > 5× viewport (chunking)
    forms/                     # variant 7 — inputs, focus rings, labels
    images/                    # variant 8 — raster + svg + lazy-loaded
    media/                     # variant 9 — video poster, controls
    animation/                 # variant 10 — pinned to t=0, no JS
    masked/                    # variant 11 — dynamic content (clock, IDs) with mask helpers
    spa/                       # variant 12 — multi-route SPA (scenarios array)
    responsive/                # variant 13 — mobile/tablet/desktop breakpoints
    rtl/                       # variant 14 — direction:rtl
    iframes/                   # variant 15 — nested iframe content
    shadow-dom/                # variant 16 — custom elements + shadow roots
  broken/                      # mirror of public/ with one regression per variant
    static-shifted-1px/
    text-typo/
    layout-stacked/
    color-off-by-5/
    ...
  serve.mjs                    # tiny http server (no framework, no build)
  scenarios.md                 # human-readable map: variant → expected detection
```

A static `serve.mjs` (Node `http`, no deps) keeps the fixture self-contained and avoids dragging Vite/Next into the repo.

## What each variant exercises

| Variant        | Captures                                                       | Detection vectors                                                                                                  |
| -------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **static**     | A page that should be byte-identical run-to-run                | Baseline noise floor; if this ever flags a diff, something is fundamentally broken                                 |
| **text**       | A paragraph + heading; broken twin has a typo                  | DOM text-finding; pixel diff in glyph region                                                                       |
| **layout**     | Flexbox grid; broken twin shifts one card down                 | Layout-shift finding (DOM diff), large pixel diff                                                                  |
| **color**      | Two palettes; broken twin is off by ΔE ~5                      | Style finding (DOM); SSIM > 0 but phash near-match (catches engine asymmetry)                                      |
| **typography** | Webfont + system fallback                                      | Font-loading race regression — needs a deterministic preload to be a _real_ test, not a flake source               |
| **tall**       | > 5× viewport (~5000px)                                        | Vision-chunking pipeline; `prepareChunkedImages` slicing, `aggregateChunkAnalyses` with N≥3                        |
| **forms**      | Inputs, labels, focus states (forced via `:focus-visible` CSS) | Spacing finding; native control rendering across browsers                                                          |
| **images**     | One raster, one SVG, one CSS background                        | Background finding; lazy-load determinism (force `loading="eager"`)                                                |
| **media**      | `<video>` poster only (no autoplay)                            | Cross-browser poster rendering; tests "no false positive on identical poster"                                      |
| **animation**  | CSS animations pinned via `animation-play-state: paused`       | Confirms vrtini's animation-disable directive works; without it, every run flakes                                  |
| **masked**     | Real-time clock, random UUIDs, current date                    | Tests the **mask** mechanism — black out regions before comparing. If masks fail, this variant flakes 100% of runs |
| **spa**        | 4 routes, each a scenario                                      | Scenarios array, navigation timing, per-scenario `diffThreshold` overrides                                         |
| **responsive** | Same page at 375px / 768px / 1440px                            | Viewport matrix; auto-thresholds compute _per_ (scenario, viewport) — needs ≥3 to validate grouping                |
| **rtl**        | `dir="rtl"` mirror of layout variant                           | Catches CSS logical-property regressions, font-shaping diffs                                                       |
| **iframes**    | Cross-document content                                         | Capture quirks: some browsers blank iframes in screenshots; documents the actual behavior                          |
| **shadow-dom** | `<my-card>` with shadow root                                   | DOM snapshot must traverse shadow boundaries, or text findings will silently miss                                  |

## What it must _not_ contain

- Network calls to the open internet (every byte must be local — fixtures break the moment a CDN changes).
- `<script>` blocks beyond pinning state (clock, animations). Logic in fixtures = flaky baselines.
- Anything time-of-day or timezone-dependent without a mask. The `masked` variant is the _only_ place dynamic content lives, and it's there specifically to validate masking.
- Web fonts loaded via `@import` from external hosts. Self-host or use `font-display: block` + preload.

## Determinism checklist (the "make it boring" rules)

Every variant must:

1. Set `Date.now` and `Math.random` to a fixed seed (or avoid using them). A 3-line `<script>` at the top of `index.html` does this.
2. Use `font-display: block` + `<link rel="preload">` for any custom font, so the fallback never appears in a screenshot.
3. Disable `prefers-reduced-motion` opt-out paths — assume motion is always reduced.
4. Use `image-rendering: pixelated` or fixed dimensions on raster images so cross-browser scaling doesn't flake.
5. Boot via static HTML; if a variant needs JS, the JS must be sync and complete before `DOMContentLoaded`.

## Build-out order (smallest → largest investment)

| Phase  | Variants                             | Why this order                                                                                    |
| ------ | ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| **P0** | static, text, layout, color          | Covers 70% of real regressions. Until these four pass deterministically, no other variant matters |
| **P1** | tall, masked, responsive             | Covers chunking, masks, viewport matrix — the three areas where vrtini does novel work            |
| **P2** | forms, images, typography, animation | Cross-browser rendering edge cases                                                                |
| **P3** | spa, rtl, shadow-dom, iframes, media | Long tail; nice-to-have but each one is a rabbit hole                                             |

## Success criteria

The dummy app is "done" when:

1. `vrtini test fixtures/golden-app/` against `public/` passes with **zero diffs** on three consecutive runs (proves determinism).
2. `vrtini cross-compare public/ broken/` reports the _exact_ expected variant set as failing — no false positives, no missed regressions. The expected set is documented in `scenarios.md`.
3. The full run completes in under 60s on a developer laptop (otherwise the manual test plan above gets skipped).
4. The fixture is checked into git with baselines (`.vrtini/default/baselines/`) so a fresh clone can run `vrtini test` and verify clean.

## Open questions before building

- One repo or a sibling? Sibling repo (`vrtini-fixtures`) keeps `vrt` itself smaller, but couples release cycles. Recommendation: **in-repo under `fixtures/`** until it grows past ~5MB of baselines, then split.
- Do we ship baselines per-browser (Chromium / Firefox / WebKit) or only Chromium? Three browsers triples baseline size and reveals real cross-browser drift; one browser is faster to maintain. Recommendation: **Chromium only at P0/P1**, expand at P2.
- Should the dummy app be Playwright-driven (visit + assert) or just a static fileset? Static is simpler and exercises capture; Playwright-driven exercises waitFor / interaction. Recommendation: **static at P0**, add a Playwright variant under `spa/` for P3.
