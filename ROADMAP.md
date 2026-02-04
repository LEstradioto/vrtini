# Roadmap — Performance, UI Testing, Design

## Performance

- [ ] Profile compare pipeline (CPU + disk I/O) on large suites
- [ ] Avoid sync PNG decode/write on hot paths
- [ ] Add bounded concurrency for compare tasks
- [ ] Skip diff image writes when not needed (optional)
- [ ] Add basic telemetry (time per scenario + totals)

## UI Testing

- [ ] Make UI tests runnable without privileged bind (configurable host/port)
- [ ] Run UI smoke suite in CI with retries on infra errors only
- [ ] Add coverage for project filtering, batch approve, cross-compare viewer
- [ ] Add a stress fixture set to catch UI performance regressions

## Design

- [ ] Card hierarchy cleanup (status, tags, primary actions)
- [ ] Stronger contrast defaults for light/dark themes
- [ ] Compact filters + batch actions row
- [ ] Multi-column viewer controls clarity (labels + tooltips)

## Tooling

- [ ] Update docs for performance + UI testing workflow
- [ ] Add perf troubleshooting section (CPU, memory, I/O)
