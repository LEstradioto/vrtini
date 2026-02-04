# Performance + UI Testing Review

## Summary

This captures the hard review findings so we can address them later without losing context.

## Findings

### Major

- **Sync PNG decode/write blocks the event loop**
  - Files: `src/compare.ts` (sync `readFileSync`, `PNG.sync.read/write`)
  - Impact: API endpoints and CLI comparisons stall under load.
  - Fix: move decode/encode to worker threads or async queue; avoid sync IO on hot path.

- **Comparisons run fully sequential in large suites**
  - Files: `src/commands/test.ts`, `src/commands/cross-compare.ts`
  - Impact: linear slowdown for large scenario sets.
  - Fix: introduce bounded concurrency (p-limit / worker pool), batch by viewport.

- **UI tests cannot start web server in restricted environments**
  - File: `playwright.config.ts`
  - Impact: `EPERM` when binding to `0.0.0.0:4173`; UI tests fail here.
  - Fix: allow host/port override or fallback to `127.0.0.1` when bind fails.

### Minor

- **Diff image written even for matches**
  - File: `src/compare.ts`
  - Impact: unnecessary disk IO on large suites.
  - Fix: generate diff only when needed, or keep in-memory for match-only metrics.

- **O(n²) list membership in UI**
  - File: `web/client/src/pages/Project.svelte`
  - Impact: slow filtering on big projects.
  - Fix: precompute `Set` for baselines/diffs and use `set.has`.

- **Search filter lacks debounce**
  - File: `web/client/src/pages/Project.svelte`
  - Impact: expensive re-filter on every keystroke.
  - Fix: debounce 150–250ms.

## Test Notes

- `npm run build:all` succeeds (Svelte a11y warnings present).
- `npm run test:ui` fails in this environment due to `EPERM` binding to `0.0.0.0:4173`.
  Use host override or local machine where bind is allowed.
