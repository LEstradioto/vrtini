<script lang="ts">
  import type { ImageMetadata } from '../lib/api';
  import { formatBrowserLabel } from '../../../shared/api-types';

  interface Props {
    baselines: ImageMetadata[];
    tests: ImageMetadata[];
    diffs: ImageMetadata[];
    onCompare: (left: { type: string; filename: string }, right: { type: string; filename: string }) => void;
    comparing: boolean;
  }

  let { baselines, tests, diffs, onCompare, comparing } = $props<Props>();

  let leftType = $state<'baseline' | 'test'>('baseline');
  let rightType = $state<'baseline' | 'test'>('test');
  let leftFile = $state<string>('');
  let rightFile = $state<string>('');

  // Search/filter state
  let leftSearch = $state('');
  let rightSearch = $state('');
  let leftOpen = $state(false);
  let rightOpen = $state(false);
  let leftHighlight = $state(-1);
  let rightHighlight = $state(-1);

  // Quick compare state
  let quickCompareOpen = $state(false);
  let selectedQuickPair = $state<string>('');

  // Browser pair detection - group images by scenario+viewport, find pairs with different browser versions
  interface BrowserPair {
    key: string;
    label: string;
    left: ImageMetadata;
    right: ImageMetadata;
    leftSource: 'baseline' | 'test';
    rightSource: 'baseline' | 'test';
  }

  function detectBrowserPairs(): BrowserPair[] {
    const pairs: BrowserPair[] = [];
    const allImages = [
      ...baselines.map(img => ({ ...img, source: 'baseline' as const })),
      ...tests.map(img => ({ ...img, source: 'test' as const })),
    ];

    // Group by scenario+viewport
    const groups = new Map<string, typeof allImages>();
    for (const img of allImages) {
      const key = `${img.scenario}_${img.viewport}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(img);
    }

    // Find pairs with different browser/version combinations
    for (const [groupKey, images] of groups) {
      if (images.length < 2) continue;

      // Get unique browser+version combinations
      const browserVersions = new Map<string, typeof images[0]>();
      for (const img of images) {
        const bv = `${img.browser}-v${img.version || 'latest'}`;
        // Prefer test images over baseline for same browser version
        if (!browserVersions.has(bv) || img.source === 'test') {
          browserVersions.set(bv, img);
        }
      }

      const versions = Array.from(browserVersions.entries());
      if (versions.length < 2) continue;

      // Create pairs for each combination
      for (let i = 0; i < versions.length; i++) {
        for (let j = i + 1; j < versions.length; j++) {
          const [bv1, img1] = versions[i];
          const [bv2, img2] = versions[j];

          // Sort so newer version is on right (if version is a number)
          const v1 = parseInt(img1.version || '999');
          const v2 = parseInt(img2.version || '999');
          const [left, right] = v1 > v2 ? [img2, img1] : [img1, img2];

          pairs.push({
            key: `${groupKey}__${left.filename}__${right.filename}`,
            label: `${left.scenario} ${left.viewport}: ${formatBrowserLabel(left.browser, left.version)} vs ${formatBrowserLabel(right.browser, right.version)}`,
            left,
            right,
            leftSource: left.source,
            rightSource: right.source,
          });
        }
      }
    }

    return pairs.sort((a, b) => a.label.localeCompare(b.label));
  }

  let browserPairs = $derived(detectBrowserPairs());

  function selectQuickPair(pairKey: string) {
    const pair = browserPairs.find(p => p.key === pairKey);
    if (!pair) return;

    leftType = pair.leftSource;
    rightType = pair.rightSource;
    leftFile = pair.left.filename;
    rightFile = pair.right.filename;
    leftSearch = getDisplayLabel(pair.left.filename, pair.leftSource === 'baseline' ? baselines : tests);
    rightSearch = getDisplayLabel(pair.right.filename, pair.rightSource === 'baseline' ? baselines : tests);
    selectedQuickPair = pairKey;
    quickCompareOpen = false;

    // Trigger comparison immediately
    onCompare(
      { type: pair.leftSource, filename: pair.left.filename },
      { type: pair.rightSource, filename: pair.right.filename }
    );
  }

  // Group images by scenario/viewport for easier selection
  function groupByScenario(images: ImageMetadata[]): Map<string, ImageMetadata[]> {
    const groups = new Map<string, ImageMetadata[]>();
    for (const img of images) {
      const key = `${img.scenario} / ${img.viewport}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(img);
    }
    return groups;
  }

  let leftOptions = $derived(leftType === 'baseline' ? baselines : tests);
  let rightOptions = $derived(rightType === 'baseline' ? baselines : tests);

  // Filter options based on search
  function filterOptions(options: ImageMetadata[], search: string): ImageMetadata[] {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter(img =>
      img.filename.toLowerCase().includes(q) ||
      img.scenario.toLowerCase().includes(q) ||
      img.browser.toLowerCase().includes(q) ||
      (img.version && img.version.toLowerCase().includes(q)) ||
      img.viewport.toLowerCase().includes(q)
    );
  }

  let leftFiltered = $derived(filterOptions(leftOptions, leftSearch));
  let rightFiltered = $derived(filterOptions(rightOptions, rightSearch));

  let leftGroups = $derived(groupByScenario(leftFiltered));
  let rightGroups = $derived(groupByScenario(rightFiltered));

  // Flatten groups for keyboard navigation
  function flattenGroups(groups: Map<string, ImageMetadata[]>): ImageMetadata[] {
    const result: ImageMetadata[] = [];
    for (const images of groups.values()) {
      result.push(...images);
    }
    return result;
  }

  let leftFlat = $derived(flattenGroups(leftGroups));
  let rightFlat = $derived(flattenGroups(rightGroups));

  function handleCompare() {
    if (!leftFile || !rightFile) return;
    onCompare(
      { type: leftType, filename: leftFile },
      { type: rightType, filename: rightFile }
    );
  }

  // Format browser version for display
  function formatVersion(img: ImageMetadata): string {
    if (img.version) {
      return `${img.browser} v${img.version}`;
    }
    return img.browser;
  }

  // Get display label for selected file
  function getDisplayLabel(filename: string, options: ImageMetadata[]): string {
    const img = options.find(o => o.filename === filename);
    if (!img) return '';
    return `${img.scenario} / ${img.viewport} - ${formatVersion(img)}`;
  }

  // Keyboard navigation
  function handleKeydown(side: 'left' | 'right', e: KeyboardEvent) {
    const isOpen = side === 'left' ? leftOpen : rightOpen;
    const flat = side === 'left' ? leftFlat : rightFlat;
    const highlight = side === 'left' ? leftHighlight : rightHighlight;

    if (e.key === 'Escape') {
      if (side === 'left') leftOpen = false;
      else rightOpen = false;
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        if (side === 'left') leftOpen = true;
        else rightOpen = true;
      }
      const next = Math.min(highlight + 1, flat.length - 1);
      if (side === 'left') leftHighlight = next;
      else rightHighlight = next;
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = Math.max(highlight - 1, 0);
      if (side === 'left') leftHighlight = prev;
      else rightHighlight = prev;
      return;
    }

    if (e.key === 'Enter' && isOpen && highlight >= 0 && highlight < flat.length) {
      e.preventDefault();
      const img = flat[highlight];
      if (side === 'left') {
        leftFile = img.filename;
        leftSearch = getDisplayLabel(img.filename, leftOptions);
        leftOpen = false;
      } else {
        rightFile = img.filename;
        rightSearch = getDisplayLabel(img.filename, rightOptions);
        rightOpen = false;
      }
    }
  }

  function selectImage(side: 'left' | 'right', img: ImageMetadata) {
    if (side === 'left') {
      leftFile = img.filename;
      leftSearch = getDisplayLabel(img.filename, leftOptions);
      leftOpen = false;
    } else {
      rightFile = img.filename;
      rightSearch = getDisplayLabel(img.filename, rightOptions);
      rightOpen = false;
    }
  }

  // Close dropdown when clicking outside
  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.search-dropdown')) {
      leftOpen = false;
      rightOpen = false;
    }
  }
</script>

<svelte:window onclick={handleClickOutside} />

<div class="compare-selector">
  <!-- Quick Compare Section -->
  {#if browserPairs.length > 0}
    <div class="quick-compare-section">
      <h4>Quick Compare (Browser Versions)</h4>
      <div class="search-dropdown">
        <input
          type="text"
          class="search-input quick-search"
          placeholder="Select browser pair to compare..."
          value={selectedQuickPair ? browserPairs.find(p => p.key === selectedQuickPair)?.label || '' : ''}
          readonly
          onclick={() => { quickCompareOpen = !quickCompareOpen; }}
        />
        {#if selectedQuickPair}
          <button class="clear-btn" onclick={() => { selectedQuickPair = ''; leftFile = ''; rightFile = ''; leftSearch = ''; rightSearch = ''; }}>×</button>
        {/if}
        {#if quickCompareOpen}
          <div class="dropdown-list">
            {#each browserPairs as pair}
              <button
                class="dropdown-item"
                class:selected={selectedQuickPair === pair.key}
                onclick={() => selectQuickPair(pair.key)}
              >
                {pair.label}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>
    <div class="section-divider">
      <span>or select manually</span>
    </div>
  {/if}

  <div class="selector-row">
    <div class="selector-col">
      <h4>Left Image</h4>
      <div class="type-toggle">
        <button
          class="toggle-btn"
          class:active={leftType === 'baseline'}
          onclick={() => { leftType = 'baseline'; leftFile = ''; leftSearch = ''; }}
        >
          Baselines
        </button>
        <button
          class="toggle-btn"
          class:active={leftType === 'test'}
          onclick={() => { leftType = 'test'; leftFile = ''; leftSearch = ''; }}
        >
          Tests
        </button>
      </div>
      <div class="search-dropdown">
        <input
          type="text"
          class="search-input"
          placeholder="Type to search..."
          bind:value={leftSearch}
          onfocus={() => { leftOpen = true; leftHighlight = -1; }}
          onkeydown={(e) => handleKeydown('left', e)}
        />
        {#if leftFile && !leftOpen}
          <button class="clear-btn" onclick={() => { leftFile = ''; leftSearch = ''; }}>×</button>
        {/if}
        {#if leftOpen}
          <div class="dropdown-list">
            {#if leftFlat.length === 0}
              <div class="no-results">No matches found</div>
            {:else}
              {#each [...leftGroups.entries()] as [group, images]}
                <div class="dropdown-group">{group}</div>
                {#each images as img, i}
                  {@const globalIdx = leftFlat.indexOf(img)}
                  <button
                    class="dropdown-item"
                    class:highlighted={leftHighlight === globalIdx}
                    class:selected={leftFile === img.filename}
                    onclick={() => selectImage('left', img)}
                    onmouseenter={() => { leftHighlight = globalIdx; }}
                  >
                    {formatVersion(img)}
                  </button>
                {/each}
              {/each}
            {/if}
          </div>
        {/if}
      </div>
    </div>

    <div class="selector-col">
      <h4>Right Image</h4>
      <div class="type-toggle">
        <button
          class="toggle-btn"
          class:active={rightType === 'baseline'}
          onclick={() => { rightType = 'baseline'; rightFile = ''; rightSearch = ''; }}
        >
          Baselines
        </button>
        <button
          class="toggle-btn"
          class:active={rightType === 'test'}
          onclick={() => { rightType = 'test'; rightFile = ''; rightSearch = ''; }}
        >
          Tests
        </button>
      </div>
      <div class="search-dropdown">
        <input
          type="text"
          class="search-input"
          placeholder="Type to search..."
          bind:value={rightSearch}
          onfocus={() => { rightOpen = true; rightHighlight = -1; }}
          onkeydown={(e) => handleKeydown('right', e)}
        />
        {#if rightFile && !rightOpen}
          <button class="clear-btn" onclick={() => { rightFile = ''; rightSearch = ''; }}>×</button>
        {/if}
        {#if rightOpen}
          <div class="dropdown-list">
            {#if rightFlat.length === 0}
              <div class="no-results">No matches found</div>
            {:else}
              {#each [...rightGroups.entries()] as [group, images]}
                <div class="dropdown-group">{group}</div>
                {#each images as img, i}
                  {@const globalIdx = rightFlat.indexOf(img)}
                  <button
                    class="dropdown-item"
                    class:highlighted={rightHighlight === globalIdx}
                    class:selected={rightFile === img.filename}
                    onclick={() => selectImage('right', img)}
                    onmouseenter={() => { rightHighlight = globalIdx; }}
                  >
                    {formatVersion(img)}
                  </button>
                {/each}
              {/each}
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>

  <button
    class="compare-btn"
    onclick={handleCompare}
    disabled={!leftFile || !rightFile || comparing}
  >
    {#if comparing}
      Comparing...
    {:else}
      Compare Images
    {/if}
  </button>
</div>

<style>
  .compare-selector {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
  }

  .quick-compare-section {
    margin-bottom: 0.75rem;
  }

  .quick-compare-section h4 {
    font-size: 0.875rem;
    font-weight: 500;
    margin-bottom: 0.5rem;
    color: #22c55e;
  }

  .quick-search {
    cursor: pointer;
  }

  .section-divider {
    display: flex;
    align-items: center;
    margin: 1rem 0;
    color: var(--text-muted);
    font-size: 0.75rem;
  }

  .section-divider::before,
  .section-divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  .section-divider span {
    padding: 0 0.75rem;
  }

  .selector-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .selector-col h4 {
    font-size: 0.875rem;
    font-weight: 500;
    margin-bottom: 0.5rem;
    color: var(--text-muted);
  }

  .type-toggle {
    display: flex;
    gap: 0.25rem;
    margin-bottom: 0.5rem;
  }

  .toggle-btn {
    flex: 1;
    padding: 0.375rem 0.5rem;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text-muted);
    font-size: 0.75rem;
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.2s;
  }

  .toggle-btn:hover {
    color: var(--text-strong);
    border-color: var(--text-muted);
  }

  .toggle-btn.active {
    background: var(--accent);
    color: var(--text-strong);
    border-color: var(--accent);
  }

  /* Searchable dropdown */
  .search-dropdown {
    position: relative;
  }

  .search-input {
    width: 100%;
    padding: 0.5rem;
    padding-right: 2rem;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-strong);
    font-size: 0.875rem;
    box-sizing: border-box;
  }

  .search-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .search-input::placeholder {
    color: var(--text-muted);
  }

  .clear-btn {
    position: absolute;
    right: 0.5rem;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 1.25rem;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }

  .clear-btn:hover {
    color: var(--text-strong);
  }

  .dropdown-list {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    max-height: 250px;
    overflow-y: auto;
    background: var(--panel);
    border: 1px solid var(--border-soft);
    border-radius: 6px;
    margin-top: 4px;
    z-index: 100;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  .dropdown-group {
    padding: 0.5rem 0.75rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--accent);
    background: var(--bg);
    position: sticky;
    top: 0;
  }

  .dropdown-item {
    display: block;
    width: 100%;
    padding: 0.5rem 0.75rem;
    padding-left: 1.25rem;
    text-align: left;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 0.8rem;
    cursor: pointer;
    transition: background 0.1s;
  }

  .dropdown-item:hover,
  .dropdown-item.highlighted {
    background: #2a2a2a;
    color: var(--text-strong);
  }

  .dropdown-item.selected {
    background: #3730a3;
    color: var(--text-strong);
  }

  .no-results {
    padding: 1rem;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.875rem;
  }

  .compare-btn {
    width: 100%;
    padding: 0.75rem 1rem;
    background: var(--accent);
    border: none;
    border-radius: 6px;
    color: var(--text-strong);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
  }

  .compare-btn:hover:not(:disabled) {
    background: var(--accent-strong);
  }

  .compare-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
