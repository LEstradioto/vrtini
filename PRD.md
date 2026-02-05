# PRD — vrtini Performance + UI Test Reliability

## Summary

Make vrtini fast on large suites, keep UI responsive under heavy data, and harden UI tests to reduce flakiness. Add a design pass to improve clarity and visual hierarchy.

## Goals

- Speed up compare pipeline and cross-compare runs for large projects.
- Keep the UI responsive with thousands of images.
- Improve UI test reliability and coverage.
- Raise visual quality and consistency.

## Initial Tasks (from Performance Review)

1. Replace sync PNG decode/write with async pipeline or worker pool (`src/compare.ts`).
2. Add bounded concurrency for compare loops (`src/commands/test.ts`, `src/commands/cross-compare.ts`).
3. Fix UI test server binding for restricted environments (`playwright.config.ts`).
4. Avoid diff image writes for matches when not needed (`src/compare.ts`).
5. Optimize UI list membership checks with Sets (`web/client/src/pages/Project.svelte`).
6. Add debounce to text filter (`web/client/src/pages/Project.svelte`).

## Progress

- 2026-02-04: Replaced sync PNG decode/write in `src/compare.ts` with async parse and streamed diff writes.
- 2026-02-04: Added bounded concurrency for compare loops in `src/commands/test.ts` and `src/commands/cross-compare.ts`.
- 2026-02-04: Defaulted Playwright UI server binding to loopback for restricted environments.
- 2026-02-04: Skipped diff image writes for matches unless `keepDiffOnMatch` is enabled.
- 2026-02-04: Optimized Project list membership checks with derived Sets in `web/client/src/pages/Project.svelte`.
- 2026-02-04: Added debounced image search filtering in `web/client/src/pages/Project.svelte`.

## Non‑Goals

- New comparison engines.
- Major feature additions outside performance/testing/design.

## Requirements

### Performance

- Reduce total compare time for large suites.
- Avoid blocking the event loop in API paths.
- Keep memory usage stable during cross-compare runs.

### UI Testing

- UI smoke suite runs reliably in CI.
- Failures are actionable and reproducible.
- Add coverage for critical paths (projects, compare, fullscreen, cross-compare).

### Design

- Clearer hierarchy in cards and filters.
- Stronger contrast and theming consistency.
- Cleaner layout for large tables/lists.

## Acceptance Criteria

- Cross-compare runs are measurably faster on large suites.
- UI remains responsive with 1k+ images.
- UI tests run reliably (no flaky failures across multiple runs).
- Design changes are reflected in the UI and documented.

## Success Metrics

- Compare time per 1k images reduced by at least 30%.
- UI test flake rate under 1%.
- Lighthouse/UX checks show no major regressions.
