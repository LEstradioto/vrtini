---
name: openrouter-vision-review
description: Deprecated alias. Use openrouter-vision-compare for baseline/test/diff with chunked analysis.
---

# Deprecated

This skill was renamed to `openrouter-vision-compare`.

Use:

```bash
.codex/skills/openrouter-vision-compare/scripts/run-openrouter-vision.sh \
  --baseline /path/to/baseline.png \
  --test /path/to/test.png \
  --diff /path/to/diff.png \
  --route /my-route \
  --chunks 6
```

The old runner remains as compatibility alias.
