# vrtini

Docker-based visual regression testing with Playwright, a web UI, and optional AI analysis.

## Features

- Cross-browser capture (Chromium/WebKit) with multi-viewport baselines
- Fast review UI with diff overlays and bulk approvals
- Fullscreen viewer with **multi-column mode** for long pages
- Cross-compare reports (browser vs browser)
- Optional AI analysis for quick triage

## Why

- Capture consistent screenshots across browsers and viewports.
- Review diffs in a fast UI built for triage.
- Automate approvals and cross-browser comparisons.

# AI-engineered

- Built with AI assistance (Claude Opus 4.5 and Codex 5.2), reviewed and tested manually.
- Currently tested on macOS with Docker Desktop, should work elsewhere but feedback is welcome. Open issues or PRs.

### Inspiration

- Thanks [BackstopJS](https://github.com/garris/BackstopJS) for the real project and inspiration!

## Install

### From source

```bash
git clone https://github.com/your-org/vrtini.git
cd vrtini
npm install
npm run build
npm link
```

### From npm (coming soon)

```bash
npm install -g @your-org/vrtini
```

## Quick start

```bash
cd /path/to/your/project
vrtini init
vrtini build
vrtini test
vrtini serve
```

Open the UI at `http://127.0.0.1:4173` (or `http://localhost:4173`).
To expose on LAN (`--host 0.0.0.0`), set `VRT_AUTH_TOKEN` first.
If you intentionally want an unauthenticated remote bind (not recommended), set `VRT_ALLOW_INSECURE_REMOTE=1`.

## Configuration

Config files live at the project root and follow this naming convention:

- `vrtini.config.json` — the default config
- `vrtini.<profile>.config.json` — a named profile (shows up as a tab in the web UI)

Examples included:

- `vrtini.config.minimal.json` — smallest valid config
- `vrtini.config.example.json` — every option documented
- `vrtini.base.config.example.json` + `vrtini.chrome.config.example.json` — `extends` pattern

Key options:

- `browsers`, `viewports`
- `scenarioDefaults` and per-scenario overrides
- `engines` and thresholds
- `crossCompare` for browser-to-browser diffs

### Profiles

Put as many `vrtini.<name>.config.json` files at the root as you need (e.g., `vrtini.chrome.config.json`, `vrtini.cross-webkit.config.json`). Each profile:

- Is auto-discovered by the web UI and listed as a sidebar tab.
- Can be selected on the CLI via `-c ./vrtini.<name>.config.json`.
- Writes to its own artifacts directory by default: `./.vrtini/<name>/baselines` and `./.vrtini/<name>/output`, so profiles never clobber each other. Override by setting `baselineDir`/`outputDir` explicitly.

### Extends

Any config may declare an `extends` field (string or array) to inherit from another file:

```json
{
  "extends": "./vrtini.base.config.json",
  "browsers": [{ "name": "chromium", "version": "130" }]
}
```

Paths are resolved relative to the file that declares `extends`. Merge rules: objects deep-merge, arrays replace, primitives replace. Chains are supported. Circular references throw.

This lets you factor viewports, engines, AI settings, and shared scenarios into a base file and keep each profile lean.

## CLI

| Command                 | Description                         |
| ----------------------- | ----------------------------------- |
| `vrtini init`           | Create example config               |
| `vrtini build`          | Build Docker images for your config |
| `vrtini test`           | Capture screenshots and compare     |
| `vrtini test -s <name>` | Test specific scenario(s)           |
| `vrtini test -q`        | Quick mode (skip expensive engines) |
| `vrtini approve`        | Approve scenario as baseline        |
| `vrtini approve --all`  | Approve all as baselines            |
| `vrtini cross-compare`  | Compare browser pairs               |
| `vrtini report`         | Regenerate HTML report              |
| `vrtini serve`          | Start the web UI                    |

## Web UI

- Project dashboard and image gallery
- Fullscreen viewer with compare modes
- Bulk approvals and filtering
- Cross-compare results with diff overlays
- Optional AI analysis panel

## Use Cases

### 1. Simple Project: one project, many URLs, one browser truth

Use this when you only need one browser/project as your source of truth.

Typical flow:

1. Create one project with multiple scenarios/URLs.
2. First run: `Run Tests` creates the initial screenshots.
3. Review and approve them as baselines.
4. Change the app.
5. Re-run `Run Tests`.
6. Review diffs and approve or reject them.

Rule of thumb:

- first run = baseline creation
- later runs = regression detection against approved baselines

If the app is simple and you do not need browser-to-browser auditing, tests alone are enough for day-to-day regression checking.

### 2. Complex Project: cross-browser and old-browser compatibility

Use this when `Chromium latest` is your source of truth, but you also need to keep `Chromium old`, `WebKit latest`, or `WebKit old` visually aligned.

Recommended project setup:

- `Latest Full (chromium)` for the main reference baseline
- extra projects for legacy/alternate browsers with their own approved baselines
- `Cross Compare` projects for browser-vs-browser auditing

There are two common workflows here.

#### A. Baselines already exist

This is the steady-state workflow after the system is already aligned.

1. Change the app.
2. Run tests for `Latest Full (chromium)`.
3. Run tests for the other browser projects.
4. Review diffs and approve/reject as needed.
5. Only run `Cross Compare` when you want to audit browser drift again or investigate suspicious differences.

In this state, tests are the main safety net. Cross-compare becomes an auditing tool, not a mandatory step on every change.

#### B. Baselines do not exist yet, or compatibility work is still in progress

This is the heavier workflow used while building backward compatibility.

1. Capture and approve the initial baselines per browser project.
2. Run `Cross Compare` against the chosen source of truth (`Chromium latest` is the usual reference).
3. Investigate the highest diffs first.
4. Patch app code, scenario config, or capture behavior until the alternate browser becomes visually acceptable.
5. Re-run tests for the affected project.
6. Re-run `Cross Compare` to verify the reconciliation.
7. Repeat until the browser-specific projects are stable.

Once this alignment work is complete, go back to the simpler steady-state workflow:

1. change app
2. run tests for all browser projects
3. review diffs
4. use cross-compare only when you need cross-browser auditing again

### Shortcuts (viewer)

| Key     | Action          |
| ------- | --------------- |
| `1`     | Baseline        |
| `2`     | Test            |
| `3`     | Diff            |
| `←` `→` | Navigate        |
| `+` `-` | Zoom            |
| `0`     | Fit to screen   |
| `A`     | Approve current |
| `R`     | Reject current  |
| `Esc`   | Close           |

## AI analysis

Copy `.env.example` to `.env` and set one of:

```
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
```

AI runs are optional and can be disabled per project.

## Docker

```bash
vrtini build                      # Build for your config
vrtini build --playwright 1.40.0  # Specific version
vrtini build --all-versions       # All supported versions
```

Use `host.docker.internal` instead of `localhost` in URLs.

## VNC (legacy browser debug)

Use the helper container to run an older Playwright/Chromium build with a VNC UI.
Tested on macOS with Docker Desktop.

```bash
docker build --platform=linux/amd64 -f docker/vnc/Dockerfile -t vrt-pw110-vnc docker/vnc
docker run --rm --platform=linux/amd64 \
  -p 6080:6080 \
  -e TARGET_URL=http://host.docker.internal:3000 \
  vrt-pw110-vnc
```

Then open `http://localhost:6080/vnc.html` in your browser.
Optional: set `BROWSER=webkit` to launch WebKit instead of Chromium.

## Development

```bash
npm run build
npm run lint
npm run format:check
npm run typecheck
npm run test:unit
npm run test:ui
```

Git hooks enforce secret scanning with `gitleaks` on commit (`.husky/pre-commit`) and run quality checks on push (`.husky/pre-push`: lint, format, typecheck, unit tests).
The pre-commit hook also runs `lint-staged` (ESLint + Prettier on staged files).

Install either:

```bash
brew install gitleaks
```

or use Docker (the hook falls back to Docker if available).

## Automation

Local loop script:

- `scripts/codex-loop.sh`

## License

Apache-2.0
