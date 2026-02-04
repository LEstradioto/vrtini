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

Open the UI at `http://0.0.0.0:4173`.

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

## Development

```bash
npm run build
npm run test:unit
npm run test:ui
```

## Automation

Local loop script:

- `scripts/codex-loop.sh`

## License

Apache-2.0
