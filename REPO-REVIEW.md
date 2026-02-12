# VRTINI Repository Review (Current Snapshot)

Updated: 2026-02-12  
Branch: `main`  
Head: `0eae211`  
Merged feature line: `codex/height-mismatch-trim` via `eddc864`

## 1. Identity

- Name: `vrtini`
- Root package version: `0.1.1` (`package.json`)
- Client package version: `0.1.1` (`web/client/package.json`)
- License: Apache-2.0
- Stack:
  - CLI/engine: TypeScript + Node (ESM)
  - Web server: Fastify
  - Web client: Svelte 5 + Vite
  - Screenshot runtime: Docker + Playwright
- Core goal: visual regression capture/compare/review with optional AI triage and cross-browser comparison.

## 2. What Shipped Recently (Merged to `main`)

This section focuses on the work that was on the feature branch and is now in `main`.

### Cross/fullscreen AI + triage UX

- Added AI triage action in fullscreen cross-compare flow.
  - Commit: `82257c9`
- Added visible AI recommendation badge in fullscreen compare header.
  - Commit: `22ac16e`
- Compacted AI regression score into fullscreen metric row (with pHash coloring).
  - Commit: `d06135b`
- Cross fullscreen now opens AI analysis modal and supports subtle pulsing AI badge affordance.
  - Commit: `c0bbea4`
- Raised AI analysis modal z-index so it appears above fullscreen overlay.
  - Commit: `d48257c`
- AI badges in cross grid/list are clickable and open analysis modal.
  - Commit: `d48257c`
- Removed cross pair-filter strip (kept search + status filters), moved long pair summary row lower in layout.
  - Commit: `d48257c`

### Config page reliability and autosave

- Added autosave workflow for config with debounced saves and clearer save-state behavior.
  - Commit: `0ccb235`
- Added invalid/corrupted config handling and safer editor normalization path.
  - Commit: `1ddc3ee`
- Fixed autosave-related freeze loop behavior.
  - Commit: `a8cb74d`
- Added live provider status and provider credential validation behavior.
  - Commits around: `006bdb4`, `0ccb235`, `1ddc3ee`

### AI provider/platform improvements

- Added provider support for `openrouter` and `google` in addition to `anthropic` and `openai`.
  - Commit: `01d32c0`
- Added cross-compare AI triage API route and persistence flow.
  - `web/server/api/ai-triage.ts`

### Quality gates / release

- CI now enforces secret scan, lint, format check, typecheck, unit tests, build, and UI tests.
  - Commit: `09699d3`
  - Workflow: `.github/workflows/ci.yml`
- Version bumped to `0.1.1`.
  - Commit: `ed2bcda`
- Merge to `main` completed and pushed.
  - Merge commit: `eddc864`
  - Post-merge format fix commit: `0eae211`

## 3. CLI Surface (Actual Command Set)

Registered commands are:

- `init`
- `build`
- `cross-compare`
- `list-browsers`
- `test`
- `approve`
- `serve`
- `report`

Source:

- `src/cli.ts`
- `src/commands/*.ts`

Important notes:

- Binary entrypoint is `vrtini` (package bin), but commander program name still shows `vrt` and version `0.1.0` in `src/cli.ts`.
- README examples use `vrtini` commands and are correct from user perspective.

## 4. Web/API Surface

### Server APIs present

In `web/server/api`:

- `projects.ts`
- `config.ts`
- `images.ts`
- `compare.ts`
- `cross-compare.ts`
- `acceptance.ts`
- `analyze.ts`
- `ai-triage.ts`
- `test.ts`

### Client UX capabilities now

- Fullscreen gallery:
  - compare mode, keyboard navigation, zoom, multi-column mode
  - flag banner and flag/unflag actions
  - AI badge + AI score in metrics row
  - direct AI analysis open path in cross compare context
- Cross compare panel:
  - search by scenario/viewport
  - status filter chips (all/diffs/matches/smart/approved/flagged/unapproved/outdated/AI recommendation states)
  - grid/list view and sort toggle
  - per-item actions (approve, flag, rerun tests, delete)
  - AI badge click opens analysis modal
- Config page:
  - autosave
  - invalid-config safeguards and error state
  - AI provider settings with live credential validation feedback

## 5. AI Capability Snapshot

Supported providers (schema and runtime):

- `anthropic`
- `openai`
- `openrouter`
- `google`

Relevant files:

- `src/ai-analysis.ts`
- `src/adapters/*.ts`
- `web/server/api/analyze.ts`
- `web/server/api/ai-triage.ts`
- `web/client/src/components/AISettings.svelte`

## 6. Verification Status (Latest Local + Push Gates)

### Local checks run before publish

- `npm run lint` passed
- `npm run typecheck` passed
- `npm run test:unit` passed
  - 17 test files
  - 346 tests
- `npm run build:all` passed

### Secret scanning

- Full gitleaks Docker scan executed across repository history.
  - Result: no leaks found
  - Scan reported: 143 commits scanned

### Pre-push gates (enforced and passed)

Push to `origin/main` passed with:

- lint
- format:check
- typecheck
- unit tests

## 7. Current Risks / Technical Debt

These are current, observable issues (not historical guesses):

### A. CLI version/program metadata mismatch

- `src/cli.ts` still reports commander version `0.1.0` and program name `vrt`.
- Package version is `0.1.1`, and users invoke `vrtini`.
- Impact: help/version output inconsistency.

### B. Svelte build warnings remain

`build:client` succeeds, but warnings include:

- a11y warnings on non-interactive elements with click handlers
- many unused CSS selector warnings in large page/component files
- some state initialization warnings (`state_referenced_locally`)

Impact:

- no immediate runtime failure
- maintainability and accessibility debt remains

### C. `REPO-REVIEW.md` is manually maintained

- Without a maintenance checklist, this file drifts quickly as features land.

## 8. Recommended Next Steps

Priority order:

1. Fix CLI metadata mismatch in `src/cli.ts` (name/version).
2. Burn down a11y warnings in `Dashboard.svelte`, `CrossComparePanel.svelte`, `ImageGrid.svelte`, `AIAnalysisModal.svelte`.
3. Remove or consolidate dead/unused CSS selectors flagged by Svelte compiler.
4. Add a lightweight “release checklist” section in this file and update it per merge.
5. Consider adding targeted tests for:
   - `web/server/api/ai-triage.ts`
   - provider validation route behavior in `web/server/api/analyze.ts`
   - cross-compare UI interactions (badge-click to modal, fullscreen AI flow)

## 9. Publish Readiness (Current)

Based on the checks executed in this cycle:

- Branch work is merged to `main`.
- `main` is pushed.
- Security scan passed.
- Lint/format/typecheck/unit-test/build gates passed.

From an engineering gate perspective, the repository is in a publishable state for this revision (`0.1.1`), with the caveat that frontend warning debt should be cleaned incrementally.
