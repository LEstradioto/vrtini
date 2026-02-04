# PRD - vrtini UI + Cross Compare

## Goal

Improve the vrtini web UI and cross-compare workflow to be more reliable, actionable, and easier to review at scale.

## Recent updates

- Added cross-compare pair filtering (`crossCompare.pairs`) to run a single browser pair per project.
- Hardened HTML report output (safe data attributes + delegated handlers).
- Persisted diff metrics on passes so the UI shows 0%/0px/SSIM even when matched.
- Standardized on Codex loop scripts; removed Claude loop helpers.
- Marked cross-compare workflow as complete in the roadmap.
- Marked remaining roadmap top-level items complete now that sub-tasks are finished.
- Added CLI integration test covering capture → compare → report flow.
- Cross compare items can be selected and deleted; rerun restores items (deletions clear on new run).
- Added image metadata index unit tests.
- Fullscreen compare shows status badges (Approved, Smart Pass, Match, Diff, Issue) and supports Smart Pass filter.
- Cross compare keeps diff images for matches so Smart Pass is visible.
- Column view no longer overflows; Fit Columns shortcut added (F).
- Diff/SSIM handling improved (downscale for SSIM, match reasoning, tall-page rule).
- Added per-card delete button in cross compare for single-click removal.
- Added a cross-compare rerun regression test to ensure Smart Pass diffs reappear after deletion.
- Fullscreen compare now preserves relative scroll position across baseline/test/diff and column changes.
- Linked scroll across baseline/test/diff now preserves image anchor when toggling views.
- Added Playwright UI smoke test for dashboard → project → compare → cross navigation.
- Expanded Playwright UI smoke test coverage to include fullscreen compare interactions.
- Extended fullscreen compare smoke test coverage for view shortcuts, zoom/pan, and column fit.
- Auto columns in fullscreen compare now derive from the capture viewport ratio when available.
- Added single/multi column toggle (C) in fullscreen compare.
- Preserved zoom/pan anchor across fullscreen column toggles; column mode zoom now respects zoom levels.
- Fullscreen compare now defaults column mode to Auto for tall-image handling.
- Added cross-compare pair summaries and pair-level filters in the UI.
- Persisted cross-compare approvals into results.json and added an approval persistence regression test.
- Cross-compare reports now regenerate from updated results (approvals/deletions) and show approved status in report filters.
- Added Smart Pass status, counts, and filters to HTML reports for cross-compare parity.
- Captured acceptance signals (diff %, pixel diff, viewport/scenario, browser pair) for future auto-thresholds.
- Computed auto-threshold P95 caps per scenario+viewport (min sample size) and exposed via images API.
- Applied auto-threshold caps during test runs when enabled, capped by global diff thresholds.
- Added an auto-threshold review queue in the UI for diffs that exceed global thresholds but fall within approval-based caps.
- Moved config schema, path rules, and task planning into `src/core` (re-exported for compatibility).
- Aligned CLI/core imports for config/paths/errors; core now owns error helpers.
- Split web test service flow into capture, compare, and persist helpers.
- Persisted image metadata alongside output/baseline/diff artifacts to avoid filename parsing drift.
- Versioned image metadata schema payloads and guarded loading for unsupported versions.
- Added config validation unit tests and split config schema to avoid load-time cycles.
- Added project service integration test covering config load/save and images metadata.
- Added Playwright UI coverage for theme persistence and contrast checks.
- Added a small 5-route vrtini fixture project for CI regression coverage.
- Added Husky pre-push hook to run typecheck and unit tests.
- Kept pre-commit fast by limiting lint-staged to eslint/prettier with cache on staged JS/TS.
- Added GitHub Actions CI workflow to run typecheck, unit tests, build, and UI tests.
- Excluded Playwright UI smoke tests from base TypeScript config to keep typecheck focused on core code.

## Current status

- Cross compare UI: selection + delete, Smart Pass filtering, badge in fullscreen compare.
- Column view: width fit + shortcut.
- Cross compare rerun now clears deletion list automatically.
- Cross compare configs can target a single pair for focused review.

## Roadmap (broken into tasks)

### Practical

- [x] Tall-image fullscreen compare
  - [x] Auto-columns based on viewport ratio
  - [x] Linked scroll across baseline/test/diff
  - [x] Toggle single vs multi-column
  - [x] Fit logic without layout shift
- [x] Cross-compare workflow
  - [x] Approve/revoke per pair persisted to disk
  - [x] Pair summaries + filters in UI
  - [x] UI/report parity
- [x] Auto-thresholds from approvals
  - [x] Capture signals (diff %, pixels, height, viewport, scenario, browser pair)
  - [x] Compute P95 caps per scenario+viewport (min sample size)
  - [x] Apply softly w/ global cap
  - [x] Review queue for auto-pass above global

### Technical (Architecture)

- [x] Core separation
  - [x] Move config schema/path rules/compare planning to `src/core`
  - [x] Web + CLI import from core consistently
- [x] Test orchestration
  - [x] Split capture/compare/persist in web test service
  - [x] Keep Docker/I/O in shell; pure task-plan layer
- [x] Metadata contract
  - [x] Persist metadata alongside outputs
  - [x] Version metadata schema

### Testing

- [x] Unit tests
  - [x] Config validation
  - [x] Filename/metadata mapping
  - [x] Diff thresholds + pixelmatch/odiff logic
- [x] Integration tests
  - [x] CLI capture → compare → report
  - [x] Cross-compare results + acceptances persistence
  - [x] Project service config + images
- [x] UI tests
  - [x] Smoke: dashboard/project/compare/cross-compare
  - [x] Fullscreen viewer: 1/2/3, zoom/pan, multi-column
  - [x] Theme persistence + contrast
- [x] Regression sets
  - [x] Small static fixture set for engines
  - [x] Small vrtini project (3–5 routes) for CI

### Tooling

- [x] Husky improvements
  - [x] Pre-push: `npm run typecheck` + `npm run test:unit`
  - [x] Keep pre-commit fast (format/lint only)
  - [x] Enforce full test runs in CI
