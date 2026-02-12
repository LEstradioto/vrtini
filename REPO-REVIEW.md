# vrtini Repository Review

Updated: 2026-02-12
Scope: repository capabilities, architecture, developer workflow, constraints, and risk

## 1. What This Repo Is

`vrtini` is a Docker + Playwright visual regression platform with:

- a CLI for capture/compare/report workflows
- a Fastify API server
- a Svelte web UI for triage and approvals
- optional AI analysis for diff classification/recommendation
- browser-to-browser cross-compare workflows

Core stack:

- Runtime: Node 20+, TypeScript (ESM)
- Capture: Docker containers running Playwright
- Compare engines: pixelmatch, odiff, SSIM, pHash
- UI/API: Svelte 5 + Vite + Fastify

## 2. Architecture Map

### Core runtime (`src/`)

- `src/commands/*`: CLI command surface (`init`, `build`, `test`, `approve`, `report`, `serve`, `cross-compare`, `list-browsers`)
- `src/docker.ts` + `src/lib/docker-*`: Docker orchestration and container execution
- `src/compare.ts`: image comparison pipeline and normalization
- `src/engines/*`: metric engines and unified confidence
- `src/domain/*`: pure logic (scoring, classification, report assembly, image diff helpers)
- `src/ai-analysis.ts` + `src/adapters/*`: provider abstraction and AI analysis calls
- `src/core/paths.ts`, `src/core/config-schema.ts`: canonical paths and config schema

### Server (`web/server/`)

- Route layer: `web/server/api/*`
- Service layer: `web/server/services/*`
- Plugins: `project` loader, optional bearer auth, rate limit

### Client (`web/client/`)

- Pages: dashboard/project/config
- Review surfaces: image grid/list, fullscreen viewer, compare/cross-compare panels
- AI surfaces: analysis modal, provider settings/validation, triage actions

### Shared contracts (`web/shared/`)

- API interfaces + Zod schemas for client/server response validation

## 3. End-to-End Workflows

### 3.1 Standard regression run

1. `vrtini test` triggers capture in Docker.
2. Screenshots are written to `.vrt/output`.
3. Baselines are read from `.vrt/baselines`.
4. Diffs + metrics are computed.
5. `last-results.json`, metadata indexes, and report output are written.
6. UI loads status and enables approve/reject/flag actions.

### 3.2 Approval and baseline maintenance

- Single/bulk approve copies test image to baseline.
- Reject removes test/diff artifacts for an item.
- Revert removes baseline to force re-baselining.
- Acceptance records are persisted in `.vrt/acceptances.json`.

### 3.3 Cross-compare (browser vs browser)

- Pair generation is automatic from configured browsers/versions.
- Per-pair reports + `results.json` are generated under `.vrt/output/cross-reports`.
- Item-level approval and flagging are persisted (`cross.json`, `cross-flags.json`).
- Outdated detection marks items when source screenshots changed after report generation.
- Revalidation reruns only outdated/selected items.

### 3.4 AI workflows

- Run-time providers: `anthropic`, `openai`, `openrouter`, `google`.
- Two paths:
  - automatic analysis on diffs based on thresholds
  - manual triage (single/multi) from UI and cross-compare
- AI results persist on cross items and appear as recommendation badges.
- Provider credential validation endpoint gives immediate feedback (valid/invalid/reachable).

## 4. Feature Inventory (What Developers Can Do Today)

### 4.1 CLI

- Initialize project scaffolding (`init`)
- Build required Docker Playwright images (`build`)
- Run captures/comparisons (`test`)
  - scenario filters
  - quick mode (pixelmatch-only)
  - optional AI analysis modes
- Approve baselines (`approve`, including `--all`)
- Generate standalone HTML reports (`report`)
- Start web UI (`serve`)
- Run browser-to-browser compare (`cross-compare`)
- Inspect supported browser versions (`list-browsers`)

### 4.2 Config system

- Strict schema validation (Zod)
- Browser config with optional version pinning
- Scenario defaults + per-scenario overrides
- Engine toggles and thresholds
- Cross-compare normalization strategy (`pad`/`resize`/`crop`)
- Auto-thresholds (derived from acceptance history)
- Optional DOM snapshot capture
- AI provider + thresholds + auto-approve rule config

### 4.3 Web UI triage

- Test/baseline/diff browsing in grid/list
- Search + tag/status filtering
- Bulk select and bulk actions
- Fullscreen review with keyboard controls
- Multi-column viewing for long screenshots
- Flagging (regular and cross-compare)
- Cross-compare status badges (approved/unapproved/flagged/outdated/AI recommendation)
- Compare tool for ad-hoc left/right diffing
- Config editor with autosave and validation feedback

### 4.4 API surface

- Project CRUD
- Config get/save + schema metadata
- Image listing/streaming + thumbnail generation
- Approve/reject/revert/flag endpoints
- Test run/rerun/abort/status/SSE progress
- Cross-compare run/list/get/clear/delete-items/approve/flag
- AI provider status + provider validation + analysis + cross AI triage

## 5. Regression Workflow Value (Why This Helps Developers)

- Deterministic screenshots via containerized Playwright versions.
- Multiple similarity engines reduce false conclusions from one metric.
- Unified confidence + detailed metrics support faster approve/reject calls.
- Flags allow "not now, review later" triage without losing context.
- Cross-compare highlights browser-specific drift before release.
- Outdated detection prevents trusting stale cross reports after re-runs.
- Autosave config flow shortens high-friction tuning loops.

## 6. Current Constraints (What It Cannot Do Yet)

- Browsers are limited to `chromium` and `webkit` in config schema (no `firefox`).
- No distributed worker queue; runs are local-process and host-resource bound.
- Persistence is filesystem/JSON based (no DB transactions, no multi-user locking).
- Optional auth is a single bearer token; no users/roles/teams model.
- AI is advisory and external-provider dependent; deterministic pass/fail remains non-AI.
- No built-in baseline branch management or VCS-aware baseline promotion workflow.
- Cross-compare is pairwise browser-vs-browser, not full combinatorial trend analytics.
- Provider validation checks reachability/auth only, not model quality/safety fit.

## 7. Quality, Security, and Operational Guardrails

- CI gates:
  - gitleaks scan
  - lint
  - format check
  - typecheck
  - unit tests
  - build
  - UI tests
- Current test inventory: 17 `*.test.ts` files across core/domain/engine units, server service tests, and integration/UI flows.
- Git hooks:
  - pre-commit secret scan + lint-staged
  - pre-push lint/format/typecheck/unit-tests
- Server protections:
  - CSP and security headers
  - path restrictions for file serving
  - input validation on project create/update
  - rate limiting on expensive operations
  - optional bearer auth via `VRT_AUTH_TOKEN`

## 8. Architectural Assessment (`decomplect` lenses)

### 8.1 Simplicity (Rich Hickey lens)

Strengths:

- Core comparison/scoring/classification logic is mostly factored into pure modules.
- Config schema is explicit and centralized.
- Paths and naming conventions are consolidated.

Complexity hotspots:

- Very large UI components/pages (`Project.svelte`, `CrossComparePanel.svelte`, `FullscreenGallery.svelte`).
- Large service modules (`cross-compare-service.ts`, `project-service.ts`) with mixed concerns.

### 8.2 Functional Core / Imperative Shell

Strengths:

- Good pure-core pockets in `src/domain/*` and parts of `src/engines/*`.
- Imperative shells isolate I/O in server services and command handlers.

Gaps:

- Some orchestration files still combine policy + side effects in one layer.
- UI pages own heavy business logic that should move to dedicated stores/services.

### 8.3 Coupling / Cohesion

Strengths:

- Shared API contracts reduce client/server drift.
- Clear route/service split on the server.

Risks:

- Large components increase implicit coupling and regression risk per edit.
- Cross-compare persistence/update logic is concentrated in one long module.

## 9. Current Technical Debt and Priority Improvements

### High priority

1. Align CLI identity metadata (`src/cli.ts` still shows `vrt` and `0.1.0` while package/bin is `vrtini@0.1.1`).
2. Split large UI components into feature stores + focused presentational components.
3. Split `cross-compare-service.ts` into persistence, summarization, and mutation modules.

### Medium priority

1. Expand targeted tests for:
   - `ai-triage` route behavior and persistence
   - provider validation edge cases
   - fullscreen AI modal/badge interactions
2. Standardize API error shapes and handling paths where raw parse/load fallback is currently lenient.
3. Add maintenance checklist to keep this review synced with current repo state.

## 10. Practical Developer Notes

- To test localhost targets from Dockerized browsers, use `host.docker.internal`.
- Store artifacts and state under `.vrt/`:
  - `baselines/`, `output/`, `output/diffs/`, `output/cross-reports/`
  - `acceptances.json`, `flags.json`, `cross*.json`
- For faster local loops use `quickMode`; for release confidence use full engines + cross-compare + UI review.

## 11. Bottom Line

This repo is already a capable visual regression platform with strong practical workflows:

- deterministic capture
- deep metric comparison
- cross-browser triage
- AI-assisted review
- solid CI/secret-scanning gates

The main challenge is not missing core functionality; it is maintainability at scale. The next step is architectural slimming (UI/service decomposition) so new regression features can ship faster with lower break risk.
