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

- Minimal example: `vrt.config.minimal.json`
- Full reference: `vrt.config.full.json5`

Key options:

- `browsers`, `viewports`
- `scenarioDefaults` and per-scenario overrides
- `engines` and thresholds
- `crossCompare` for browser-to-browser diffs

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
