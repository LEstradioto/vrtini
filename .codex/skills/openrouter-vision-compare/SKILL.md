---
name: openrouter-vision-compare
description: Compares baseline/test/diff screenshots with OpenRouter Gemini and supports vertical chunk analysis for long pages.
---

# OpenRouter Vision Compare

## Overview

Use this skill to run structured visual comparison between `baseline` and `test` screenshots (optionally with a `diff` map), using OpenRouter Gemini models.

This version supports chunked analysis for very tall pages (`--chunks` or `--chunk-height`) and produces an aggregated verdict.
It also estimates a global vertical offset before chunking to reduce false positives from long-page vertical drift.

## When To Use

- You want Gemini to validate whether a Smart Pass candidate is reasonable.
- You need AI comparison of two screenshots instead of single-image design critique.
- You want deeper analysis on long pages with chunked review.

## Security Setup

1. Store credentials in the project root `.env` file.
2. Required key:
   `OPENROUTER_API_KEY=...`
3. Lock file permissions:
   `chmod 600 .env`

Detailed note: `references/env-security.md`

## Commands

### Compare full image (baseline vs test)

```bash
.codex/skills/openrouter-vision-compare/scripts/run-openrouter-vision.sh \
  --baseline /path/to/baseline.png \
  --test /path/to/test.png \
  --route /my-route
```

Note: by default the comparison uses only `baseline + test`.  
`diff` is optional and only included when explicitly enabled with `--use-diff 1`.

### Compare using vertical chunks (recommended for long pages)

```bash
.codex/skills/openrouter-vision-compare/scripts/run-openrouter-vision.sh \
  --baseline /path/to/baseline.png \
  --test /path/to/test.png \
  --route /my-route \
  --chunks 6
```

Optional diff helper:

```bash
.codex/skills/openrouter-vision-compare/scripts/run-openrouter-vision.sh \
  --baseline /path/to/baseline.png \
  --test /path/to/test.png \
  --diff /path/to/diff.png \
  --use-diff 1 \
  --route /my-route \
  --chunks 6
```

### Legacy single-image critique mode

```bash
.codex/skills/openrouter-vision-compare/scripts/run-openrouter-vision.sh \
  --image /path/to/screenshot.png \
  --route /my-route
```

## Output

Default output path:

- `tmp/ui-quality/manual/vision-issues.json` (or custom `--out`)

Comparison mode output includes:

- `aggregate.verdict` (`approve|review|reject`)
- `aggregate.confidence`
- `chunks[]` with per-chunk verdict and findings
- flattened `issues[]`

## Notes

- Never log or commit secrets.
- Keep keys in env only.
- For tall pages, chunked mode usually yields better diagnostic granularity.
