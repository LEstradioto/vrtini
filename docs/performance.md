# Performance Profiling Guide

This is a lightweight, repeatable workflow for profiling the UI and capturing data
that we can analyze later.

## 1) Run A Production Build (Most Accurate)

```bash
npm run serve
```

This builds both server + client and serves the production bundle.

If you only want client dev-mode (good for Svelte source mapping), use:

```bash
npm run dev:client
```

## 2) Chrome DevTools Performance Capture

1. Open the app in Chrome.
2. Open DevTools and go to **Performance**.
3. Click **Record**.
4. Perform the slow action (e.g., filter, paginate, select all, open cross-compare).
5. Click **Stop**.

What to look at:

- **Main thread flame chart**: long tasks are the bottleneck.
- **Bottom-up**: top time consumers.
- **FPS**: frame drops reveal rendering bottlenecks.
- **Screenshots**: correlate UI changes with timing spikes.

## 3) Rendering + Layout Diagnostics

In DevTools:

- **More Tools → Rendering**
  - Enable **Paint flashing** (see repaints).
  - Enable **Layout Shift Regions** (see layout churn).
- **Performance Monitor** for real-time CPU/memory/DOM nodes.

## 4) Memory Snapshot (If Slowdown Builds Over Time)

DevTools → **Memory**:

- Take a snapshot before the slow action.
- Take another after.
- Look for large retained objects or growing arrays.

## 5) Data To Save For Review

When you’re done, export:

- A **Performance trace** JSON (DevTools Performance → Save Profile).
- A quick **note** with:
  - What you did (steps)
  - How big the dataset is (number of items/cards)
  - Which filters/tabs were active
  - Browser + OS version
  - The exact commit hash you’re on

## 6) How To Share With Me Later

You can send:

- The trace JSON file
- The reproduction steps
- The commit hash

With that, I can do:

- Long-task analysis
- Layout/repaint breakdown
- DOM size and rendering hotspots

If you want a script to summarize traces into a small text report, say the word
and I’ll add one (we can extract long tasks and heaviest functions).
