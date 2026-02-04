# Roadmap

## Now

- Run the full scenario loop after the home-only configs are validated.
- Keep the Web UI review flow tight: metrics on passes, clear diff visibility, and stable cross-compare pairs.

## Done (Feb 2026)

### Fullscreen tall-image compare

- [x] Auto-columns based on viewport ratio
- [x] Linked scroll across baseline/test/diff
- [x] Toggle single vs multi-column
- [x] Fit logic without layout shift

### Cross-compare workflow

- [x] Approve/revoke per pair persisted to disk
- [x] Pair summaries and filters in UI
- [x] Report/UI parity

### Auto-thresholds from approvals

- [x] Capture diff %, pixels, viewport, scenario, browser pair
- [x] Compute P95 caps with min sample size
- [x] Apply softly under global ceilings
- [x] Review queue for auto-pass candidates

### Architecture

- [x] Core separation (config, paths, task planning)
- [x] Web test flow split: capture/compare/persist
- [x] Metadata contract + versioned schema

### Testing

- [x] Unit: config validation, filename/metadata, diff thresholds
- [x] Integration: CLI, cross-compare persistence, project service flow
- [x] UI: smoke + fullscreen + theme persistence
- [x] Regression fixtures: engines + small vrtini project

### Tooling

- [x] Husky pre-push for typecheck + unit tests
- [x] Keep pre-commit fast with lint-staged
- [x] CI workflow for typecheck, unit, build, UI
