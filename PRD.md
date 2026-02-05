# vrtini — Codebase Review

Visual regression testing tool — TypeScript + Svelte 5 + Fastify + Docker/Playwright.

Full audit covering security, performance, dead code, and code smells.

---

## Security (3 high, 4 medium)

| Severity | Issue                                                      | Location                                                      |
| -------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| **HIGH** | Command injection via string interpolation in `exec()`     | `src/commands/utils.ts:11` — ``exec(`${cmd} "${filePath}"`)`` |
| **HIGH** | Command injection via URL                                  | `web/server/index.ts:94` — ``exec(`${cmd} ${url}`)``          |
| **HIGH** | No validation on project `path`/`name` in creation API     | `web/server/api/projects.ts:43-50`                            |
| MEDIUM   | Zero authentication on all API endpoints                   | `web/server/api/*`                                            |
| MEDIUM   | No security headers (CSP, X-Frame-Options)                 | `web/server/index.ts`                                         |
| MEDIUM   | No rate limiting on expensive ops (AI analysis, test runs) | All API endpoints                                             |
| MEDIUM   | `JSON.parse()` on user input without try-catch             | `web/server/services/store.ts:32`, `project-service.ts:181`   |

The command injection in `utils.ts` and `index.ts` are the most urgent — a crafted filename or URL can execute arbitrary shell commands. Use `execFile` with an args array instead of template strings.

---

## Performance (15 issues)

### Memory leaks

- `App.svelte:15` — `hashchange` listener never removed on unmount
- `App.svelte:92-148` — `setInterval` polling (500ms) with fragile cleanup logic

### Missing throttle/debounce

- `FullscreenGallery.svelte:493` — unthrottled scroll handler
- `FullscreenGallery.svelte:481` — unthrottled mousemove during drag
- `FullscreenGallery.svelte:362` — unthrottled resize handler

### Expensive reactive computations

- `Project.svelte:741-743` — new `Set`/`Map` objects created in `$derived` on every reactive tick (9 instances)
- `Project.svelte:747-825` — multiple `.filter()` passes over same arrays for counts
- `FullscreenGalleryFooter.svelte:41-46` — iterates queue 3x separately instead of once
- `CompareSelector.svelte:41-102` — O(n^2) browser pair detection in `$derived`
- `ComparisonTable.svelte:31-40` — computing unique browsers with Set creation, iteration, sort on every render
- `ComparisonTable.svelte:43-71` — nested filter with repeated `toLowerCase()` on same strings

### Frequent object creation

- `App.svelte:82-193` — creating new `Map` objects every 500ms during test polling to trigger Svelte reactivity (`runningTests = new Map(runningTests)`)
- `Project.svelte:625-956` — creating new `Set` objects in event handlers without checking if update is needed
- `CompareSelector.svelte:127-171` — chain of derived computations causing cascading recalculations

### Missing virtualization

- `Project.svelte` image grid — renders all 56 items per page in DOM even if offscreen

---

## Dead Code

| Item                       | Location                                                                                                                | Verdict       | Rationale                                                                                                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm dep: `blockhash-core`  | `package.json:38`                                                                                                       | **ELIMINATE** | Never imported anywhere. Custom `src/phash.ts` implements dHash/aHash instead. Remove from package.json.                                                                          |
| `ComparisonTable.svelte`   | `web/client/src/components/` (587 lines)                                                                                | **ELIMINATE** | Zero imports in codebase. Early prototype superseded by inline rendering in Project.svelte. Not in ROADMAP.                                                                       |
| `ConfidenceScore.svelte`   | `web/client/src/components/` (121 lines)                                                                                | **ELIMINATE** | Zero imports. Backend confidence scoring (`src/confidence.ts`, `src/domain/scoring.ts`) is active but this UI component is orphaned. Rebuild from current design if needed later. |
| 11 re-export wrapper files | `src/config.ts`, `src/core/{ai-analysis,browser-versions,compare,types}.ts`, `src/lib/{config-manager,paths,errors}.ts` | **KEEP**      | Actively imported by command files and tests. Maintains stable public API surface. Prevents internal refactoring from breaking consumers. Minimal maintenance cost.               |

---

## Code Smells

### God components

- `Project.svelte` — **3,955 lines**, 48+ `$state` variables, handles project management, image display, cross-compare, AI analysis, custom comparison, fullscreen gallery, bulk operations, filtering, pagination
- `FullscreenGallery.svelte` — **2,050 lines**
- `Config.svelte` — **1,017 lines**

### Long functions (>50 lines)

- `registerCrossCompareCommand` — 291 lines (`src/commands/cross-compare.ts:363`)
- `registerTestCommand` — 182 lines (`src/commands/test.ts:271`)
- `registerInitCommand` — 79 lines (`src/commands/init.ts:123`)
- `registerBuildCommand` — 71 lines (`src/commands/build.ts:93`)
- `computeAutoThresholdCaps` — 74 lines (`web/server/services/project-service.ts:408`)
- `calculateWeightedScore` — 68 lines (`src/domain/scoring.ts:179`)
- `toComparisonResult` — 69 lines (`web/server/services/cross-compare-service.ts:309`)

### Prop drilling

- `App.svelte:233-235` passes 8+ props to `Dashboard` and `ProjectPage` (`navigate`, `runningTests`, `startTest`, `abortTest`, `testErrors`, `clearTestError`, `rerunImage`, `initialTab`)
- Gallery, modal, and comparison sub-components receive props through multiple layers
- Should use Svelte context API or stores for shared state

### Duplicated code

- Browser formatting logic (`formatBrowser`) duplicated across `cross-compare.ts`, `cross-compare-service.ts`, `CompareSelector.svelte`
- Error message extraction pattern (`err instanceof Error ? err.message : fallback`) copy-pasted in multiple files
- Image metadata parsing logic repeated in several locations

### Inconsistent error handling

- Pattern 1: try/catch with error state
- Pattern 2: `.catch(() => defaultValue)` silent swallow (`Project.svelte:478-479`)
- Pattern 3: `console.error` then continue
- No structured logging — raw `console.log` throughout (74+ occurrences)
- Should standardize on a single error handling pattern and a proper logger

### Magic numbers

- `DEFAULT_COMPARISON_THRESHOLD = 0.1` (`Project.svelte:76`)
- `PAGE_SIZE = 56` (`Project.svelte:77`)
- `CROSS_PAGE_SIZE = 24` (`Project.svelte:78`)
- Poll interval `500`ms (`App.svelte:145`)
- Debounce `200`ms (`Project.svelte`)
- `GRAY_FILL: RGBA = [128, 128, 128, 255]` (`src/domain/image-diff.ts:7`)
- Various hardcoded scoring thresholds (`src/domain/scoring.ts`)

### Mixed concerns / business logic in UI

- `Project.svelte` contains cross-compare filtering logic (lines 800+), image status calculations (lines 700+), acceptance merging, threshold calculations
- `CompareSelector.svelte:41-99` — complex browser pair detection algorithm in a UI component
- UI components should delegate to services/stores

### Excessive state management

- `Project.svelte:288-469` — 48+ separate `$state` variables with no grouping or store extraction
- Tracks: project, loading, error, baselines, tests, diffs, metadata arrays, acceptances, imageResults, autoThresholdCaps, scenarioCount, browserCount, viewportCount, configData, crossCompare state (11 vars), imageCacheKey, activeTab, tagFilter, currentPage, searchQuery, debouncedSearchQuery, comparing, compareResult, compareLeft, compareRight, threshold, analyzing (5 vars), compareFullscreen (7 vars), loadedImages, selectedImages, selectedCrossItems, lastSelectedIndex, showGallery, galleryStartIndex, bulkOperating (4 vars), toastMessage, toastType

### Inconsistent naming

- `crossCompareRunning` (camelCase) vs `cross-compare` (kebab-case in routes)
- Mixed styles for browser/diff naming across files

### Missing runtime type validation

- `web/client/src/lib/api.ts:41` — API responses cast with `as T` without runtime validation
- Backend uses Zod for config but not for API request/response bodies

---

## Priority Recommendations

1. **Fix command injection** — replace `exec()` template strings with `execFile()` + args array in `utils.ts` and `server/index.ts`
2. **Add input validation** on project creation API paths
3. **Delete dead code** — remove `blockhash-core`, `ComparisonTable.svelte`, `ConfidenceScore.svelte`
4. **Fix memory leak** — add cleanup for `hashchange` listener in `App.svelte`
5. **Add throttle/debounce** on scroll, mousemove, resize handlers in `FullscreenGallery.svelte`
6. **Break up `Project.svelte`** — extract cross-compare panel, image grid, bulk operations, comparison dialog into separate components; move business logic to stores/services
7. **Consolidate duplicated utilities** — `formatBrowser`, error message helpers, filename parsing into one shared module
8. **Single-pass counting** — replace multiple `.filter().length` calls with one loop
9. **Add `JSON.parse` error handling** in server services
10. **Standardize error handling** — create error handling utilities, replace raw `console.log` with proper logger
